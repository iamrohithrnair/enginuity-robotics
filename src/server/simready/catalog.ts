 
 
 

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HF_API, SimReadyError, errorMessage, hfTree, offlineOnly, simreadyDir, writeAtomic } from "./http";

export interface SimReadyEntry {
  id: string;
  name: string;
  category: string;
  tags: string[];
}

export interface SimReadyCatalog {
  fetchedAt: string;
  entries: SimReadyEntry[];
   
  stale?: string;
}

export interface SimReadyQuery {
  query?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface SimReadySearchResult {
  total: number;
  items: SimReadyEntry[];
   
  categories: { value: string; count: number }[];
  error?: string;
}

const TTL_MS = 7 * 24 * 3600 * 1000;
const ID = /^[A-Za-z0-9_.-]+$/;

 
function words(id: string): string[] {
  return id
    .split(/[_\s]+/)
    .flatMap((w) => w.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(" "))
    .filter(Boolean);
}

 
export function prettyName(id: string): string {
  return words(id)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

 
export const categoryOf = (id: string) => id.split("_")[0] || id;

export function entryOf(id: string): SimReadyEntry {
   
  const tags = [...new Set(words(id).map((w) => w.toLowerCase()).filter((w) => !/^[a-z]?\d+[a-z]?$/.test(w)))];
  return { id, name: prettyName(id), category: categoryOf(id), tags };
}

 
export function parseRootListing(items: unknown[]): SimReadyEntry[] {
  const ids = new Set<string>();
  for (const it of items as { type?: string; path?: string }[]) {
    if (it?.type !== "directory" || typeof it.path !== "string") continue;
    if (it.path.startsWith(".") || !ID.test(it.path)) continue;
    ids.add(it.path);
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).map(entryOf);
}

const catalogFile = () => path.join(simreadyDir(), "catalog.json");
let memo: { file: string; cat: SimReadyCatalog } | null = null;
let inflight: Promise<SimReadyCatalog> | null = null;

function readCached(): SimReadyCatalog | null {
  const file = catalogFile();
  if (memo?.file === file) return memo.cat;
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as SimReadyCatalog;
    if (!Array.isArray(j.entries)) return null;
    memo = { file, cat: j };
    return j;
  } catch {
    return null;
  }
}

async function fetchCatalog(): Promise<SimReadyCatalog> {
  const items = await hfTree(`${HF_API}/tree/main?limit=1000`, "the SimReady catalog");
  if (!items) throw new SimReadyError("The SimReady dataset listing was not found on Hugging Face", 502);
  const entries = parseRootListing(items);
  if (!entries.length) throw new SimReadyError("The SimReady dataset listing is empty", 502);
  const cat: SimReadyCatalog = { fetchedAt: new Date().toISOString(), entries };
  writeAtomic(catalogFile(), JSON.stringify(cat));
  memo = { file: catalogFile(), cat };
  return cat;
}

 
export async function simreadyCatalog(refresh = false): Promise<SimReadyCatalog> {
  const cached = readCached();
  const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS;
  if (cached && (offlineOnly() || (fresh && !refresh))) return cached;
  if (!cached && offlineOnly()) throw new SimReadyError("The SimReady catalog is not in the local cache (offline mode, ENGINUITY_SIMREADY_OFFLINE=1)", 503);
  inflight ??= fetchCatalog().finally(() => (inflight = null));
  try {
    return await inflight;
  } catch (err) {
    if (cached) return { ...cached, stale: errorMessage(err) };
    throw err;
  }
}

 
export function resetCatalogMemo() {
  memo = null;
  inflight = null;
}







export function searchSimReady(entries: SimReadyEntry[], q: SimReadyQuery = {}): SimReadySearchResult {
  const text = (q.query ?? "").trim().toLowerCase();
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const hay = (e: SimReadyEntry) => `${e.id} ${e.name} ${e.category} ${e.tags.join(" ")}`.toLowerCase();
  const matching = tokens.length ? entries.filter((e) => tokens.every((t) => hay(e).includes(t))) : entries;
  const facets = new Map<string, number>();
  for (const e of matching) facets.set(e.category, (facets.get(e.category) ?? 0) + 1);
  const cat = q.category?.trim().toLowerCase();
  const filtered = cat ? matching.filter((e) => e.category.toLowerCase() === cat) : matching;
  const rank = (e: SimReadyEntry) => {
    if (!text) return 0;
    const id = e.id.toLowerCase();
    const name = e.name.toLowerCase();
    if (id === text || name === text) return 0;
    if (id.startsWith(text) || name.startsWith(text) || id.startsWith(text.replace(/\s+/g, "_"))) return 1;
    if (name.split(" ").some((w) => w.startsWith(tokens[0])) && ` ${name}`.includes(` ${text}`)) return 2;
    return 3;
  };
  const ranked = filtered.map((e) => ({ e, r: rank(e) })).sort((a, b) => a.r - b.r || a.e.name.localeCompare(b.e.name));
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.max(1, q.limit ?? 48);
  return {
    total: ranked.length,
    items: ranked.slice(offset, offset + limit).map((x) => x.e),
    categories: [...facets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count })),
  };
}
