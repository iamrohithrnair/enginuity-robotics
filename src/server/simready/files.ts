// Lists SimReady asset dependencies and caches downloaded dataset files.
 
 
 
 

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AssetFiles } from "./usd";
import { HF_API, SimReadyError, assetDir, assetFile, checkId, checkRelPath, errorMessage, hfGet, hfTree, httpConfig, limiter, offlineOnly, resolveUrl, shared, writeAtomic } from "./http";

export interface ListingEntry {
   
  path: string;
  size: number;
  sha256?: string;
}

export interface AssetListing {
  id: string;
  fetchedAt: string;
  files: ListingEntry[];
}

 
export interface DownloadEvents {
  onStart?(relPath: string, size?: number): void;
  onDone?(relPath: string, bytes: number): void;
}

const LISTING = ".listing.json";
 
const downloads = shared("downloads", () => limiter(4));
const pending = shared("pending", () => new Map<string, Promise<Uint8Array | null>>());
const listings = shared("listings", () => new Map<string, Promise<AssetListing>>());

 
function walk(dir: string, base = ""): ListingEntry[] {
  if (!existsSync(dir)) return [];
  const out: ListingEntry[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(path.join(dir, d.name), rel));
    else if (d.isFile() && !d.name.endsWith(".part") && !(base === "" && (d.name === LISTING || d.name.startsWith(".enginuity-")))) out.push({ path: rel, size: statSync(path.join(dir, d.name)).size });
  }
  return out;
}

async function fetchListing(id: string): Promise<AssetListing> {
  const file = path.join(assetDir(id), LISTING);
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as AssetListing;
      if (Array.isArray(j.files)) return j;
    } catch {
       
    }
  }
  if (offlineOnly()) {
     
    const files = walk(assetDir(id));
    if (files.length) return { id, fetchedAt: new Date().toISOString(), files };
    throw new SimReadyError(`SimReady asset "${id}" is not in the local cache (offline mode, ENGINUITY_SIMREADY_OFFLINE=1)`, 503);
  }
  const items = await hfTree(`${HF_API}/tree/main/${encodeURIComponent(id)}?recursive=true`, `the files of SimReady asset "${id}"`);
  const files: ListingEntry[] = [];
  for (const it of (items ?? []) as { type?: string; path?: string; size?: number; lfs?: { oid?: string; size?: number } }[]) {
    if (it?.type !== "file" || typeof it.path !== "string" || !it.path.startsWith(`${id}/`)) continue;
    const rel = it.path.slice(id.length + 1);
    try {
      checkRelPath(rel);
    } catch {
      continue;
    }
    files.push({ path: rel, size: Number(it.lfs?.size ?? it.size ?? 0), ...(it.lfs?.oid ? { sha256: it.lfs.oid } : {}) });
  }
  if (!files.length) throw new SimReadyError(`Unknown SimReady asset: ${id}`, 404);
  const listing: AssetListing = { id, fetchedAt: new Date().toISOString(), files };
  writeAtomic(file, JSON.stringify(listing));
  return listing;
}

 
export function assetListing(id: string): Promise<AssetListing> {
  checkId(id);
  const key = assetDir(id);
  let p = listings.get(key);
  if (!p) {
    p = fetchListing(id);
    listings.set(key, p);
     
    p.catch(() => listings.delete(key));
  }
  return p;
}

 
export function resetListingMemo() {
  listings.clear();
}

 
export function downloadAssetFile(id: string, rel: string, expectedSize?: number, ev: DownloadEvents = {}): Promise<Uint8Array | null> {
  const file = assetFile(id, rel);
  let p = pending.get(file);
  if (p) return p;
  p = downloads(async () => {
     
    if (existsSync(file) && (expectedSize === undefined || statSync(file).size === expectedSize)) return new Uint8Array(readFileSync(file));
    ev.onStart?.(rel, expectedSize);
    const check = (b: Uint8Array) => (expectedSize !== undefined && b.length !== expectedSize ? `size ${b.length} B instead of ${expectedSize} B` : null);
    const res = await hfGet(resolveUrl(id, rel), { what: `${id}/${rel}`, timeoutMs: httpConfig.fileTimeoutMs, check });
    if (!res) return null;
    writeAtomic(file, res.bytes);
    ev.onDone?.(rel, res.bytes.length);
    return res.bytes;
  }).finally(() => pending.delete(file));
  pending.set(file, p);
  return p;
}





export function hfAssetFiles(id: string, ev: DownloadEvents = {}): AssetFiles & { listing(): Promise<AssetListing> } {
  checkId(id);
  const listing = () => assetListing(id);
  const find = async (rel: string) => {
    const r = checkRelPath(rel);
    return { r, entry: (await listing()).files.find((f) => f.path === r) };
  };
  return {
    listing,
    async get(rel) {
      const { r, entry } = await find(rel);
       
      if (!entry) return null;
      const file = assetFile(id, r);
      if (existsSync(file) && statSync(file).size === entry.size) return new Uint8Array(readFileSync(file));
      if (offlineOnly()) throw new SimReadyError(`SimReady asset "${id}" is not fully cached: ${r} is missing (offline mode, ENGINUITY_SIMREADY_OFFLINE=1)`, 503);
      try {
        return await downloadAssetFile(id, r, entry.size, ev);
      } catch (err) {
        throw err instanceof SimReadyError ? err : new SimReadyError(`Could not store ${id}/${r}: ${errorMessage(err)}`, 500);
      }
    },
    async stat(rel) {
      const { entry } = await find(rel);
      return entry ? { size: entry.size, ...(entry.sha256 ? { sha256: entry.sha256 } : {}) } : undefined;
    },
    async list() {
      return (await listing()).files.map((f) => f.path);
    },
  };
}
