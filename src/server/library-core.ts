// Caches, searches and mirrors robot library catalogs, models and images.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LibraryEntry } from "../engine/registry";
import { extractLiterals } from "./jsliteral";

type Kind = LibraryEntry["kind"];

const CDN = "https://cdn.robodk.com";
const BUNDLE_URL = `${CDN}/library-robots/bundlerdklib.js`;
const UA = "Enginuity/1.0 (+library browser)";
const MIRROR_UA = "Enginuity/1.0 (+library mirror)";
export const IMAGE_ROUTE = "/api/library/image/";
const LIB_DIR: Record<Kind, string> = {
  robot: "library-robots",
  tool: "library-tools",
  axis: "library-robots",
  object: "library-tools",
  station: "library-stations",
};
const IMAGE_DIR: Record<Kind, string> = {
  robot: "robot/img/",
  axis: "robot/img/",
  tool: "robotlib/tools/",
  object: "robotlib/tools/",
  station: "library-stations/lib/img/",
};
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const IMAGE_NAME = /^[\w(][\w .()+-]*\.(png|jpe?g|gif|webp)$/i;
const FILE_NAME = /^[\w .()+-]+\.(robot|tool|stl|step|stp|rdk|rdka|igs|iges|obj)$/i;
const CATALOG_TTL_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 120_000;
const RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 25;

 
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function libraryDir(): string {
  const d = path.join(process.env.ROBOCRAFT_DATA_DIR ?? path.join(  process.cwd(), "data"), "library");
  mkdirSync(d, { recursive: true });
  return d;
}

 
export const offlineOnly = () => process.env.ROBOCRAFT_LIBRARY_OFFLINE === "1";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : -1);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let partSeq = 0;
 
function writeAtomic(dest: string, data: Uint8Array | string) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.${process.pid}-${++partSeq}.part`;
  writeFileSync(part, data);
  renameSync(part, dest);
}

function walk(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, d.name);
    if (d.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

 

const KIND_BY_MT: Record<string, Kind> = { R: "robot", T: "tool", E: "axis", O: "object", S: "station" };

function toEntry(key: string, raw: Record<string, unknown>): LibraryEntry | null {
  const file = String(raw.F ?? "");
  if (!file) return null;
   
  const kind: Kind = raw.MT ? (KIND_BY_MT[String(raw.MT)] ?? "robot") : /\.rdk$/i.test(file) ? "station" : "object";
  const img = String(raw.IS ?? raw.I ?? "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    id: key,
    name: String(raw.N ?? key),
    file,
    image: img ? IMAGE_ROUTE + IMAGE_DIR[kind] + encodeURIComponent(img) : undefined,
    brand: raw.B ? String(raw.B) : undefined,
    model: raw.M ? String(raw.M) : undefined,
    type: raw.T ? String(raw.T) : undefined,
    kind,
    axes: num(raw.A),
    reach: num(raw.R),
    payload: num(raw.P),
    weight: num(raw.W),
    repeatability: num(raw.E),
    applications: Array.isArray(raw.AP) ? raw.AP.map(String) : [],
  };
}

 
export function parseCatalog(src: string): LibraryEntry[] {
  const seen = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const table of extractLiterals(src, "DATA_ALL")) {
    if (!table || typeof table !== "object") continue;
    for (const [key, raw] of Object.entries(table as Record<string, Record<string, unknown>>)) {
      const e = raw && typeof raw === "object" ? toEntry(key, raw) : null;
      if (!e || seen.has(`${e.kind}:${e.file}`)) continue;
      seen.add(`${e.kind}:${e.file}`);
      entries.push(e);
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

 
export function localImage(url: string | undefined): string | undefined {
  return url?.startsWith(`${CDN}/`) ? IMAGE_ROUTE + url.slice(CDN.length + 1) : url;
}

const memo = new Map<string, { at: number; entries: LibraryEntry[] }>();

export async function libraryCatalog(force = false): Promise<LibraryEntry[]> {
  const dir = libraryDir();
  const cached = path.join(dir, "catalog.json");
   
  const stale = (at: number) => !existsSync(path.join(dir, "mirror.json")) && Date.now() - at >= CATALOG_TTL_MS;
  const hit = memo.get(dir);
  if (hit && !force && mtime(cached) <= hit.at && !stale(hit.at)) return hit.entries;
  const keep = (entries: LibraryEntry[]) => {
    memo.set(dir, { at: Date.now(), entries });
    return entries;
  };
  const fromDisk = () => keep((JSON.parse(readFileSync(cached, "utf8")) as LibraryEntry[]).map((e) => ({ ...e, image: localImage(e.image) })));
  if (existsSync(cached) && (offlineOnly() || (!force && !stale(mtime(cached))))) return fromDisk();
  if (offlineOnly()) throw new LibraryError("The robot library catalog is not in the offline mirror (ROBOCRAFT_LIBRARY_OFFLINE=1). Run `npm run library:mirror` once while online.", 404);
  let src: string;
  try {
    const res = await fetch(BUNDLE_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    src = await res.text();
  } catch (err) {
    if (existsSync(cached)) return fromDisk();
    throw new LibraryError(`Robot library unavailable (${message(err)}). Check your internet connection.`);
  }
  const entries = parseCatalog(src);
  if (!entries.length) {
    if (existsSync(cached)) return fromDisk();
    throw new LibraryError("The robot library catalog format was not recognised");
  }
  writeAtomic(path.join(dir, "bundlerdklib.js"), src);
  writeAtomic(cached, JSON.stringify(entries));
  return keep(entries);
}

 
function hasTag(field: string | undefined, want: string) {
  const w = want.trim().toLowerCase();
  return (field ?? "").split(",").some((t) => t.trim().toLowerCase() === w);
}

export function searchCatalog(
  entries: LibraryEntry[],
  q: {
    query?: string;
    kind?: LibraryEntry["kind"];
    brand?: string;
    type?: string;
    axes?: number;
    payloadMin?: number;
    payloadMax?: number;
    reachMin?: number;
    reachMax?: number;
    application?: string;
    limit?: number;
    offset?: number;
  },
) {
  const terms = (q.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter((e) => {
    if (q.kind && e.kind !== q.kind) return false;
    if (q.brand && !hasTag(e.brand, q.brand)) return false;
    if (q.type && !hasTag(e.type, q.type)) return false;
    if (q.axes !== undefined && e.axes !== q.axes) return false;
    if (q.payloadMin !== undefined && (e.payload ?? -1) < q.payloadMin) return false;
    if (q.payloadMax !== undefined && (e.payload ?? Infinity) > q.payloadMax) return false;
    if (q.reachMin !== undefined && (e.reach ?? -1) < q.reachMin) return false;
    if (q.reachMax !== undefined && (e.reach ?? Infinity) > q.reachMax) return false;
    if (q.application && !(e.applications ?? []).some((a) => a.toLowerCase() === q.application!.toLowerCase())) return false;
    const hay = `${e.name} ${e.brand ?? ""} ${e.model ?? ""} ${e.type ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 60;
  return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
}

 

export function libraryFileUrl(file: string, kind: Kind = "robot"): string {
  return `${CDN}/downloads-library/${LIB_DIR[kind] ?? "library-robots"}/${encodeURIComponent(file)}`;
}

 
const fileRel = (file: string, kind: Kind) => `files/${LIB_DIR[kind] ?? "library-robots"}/${file}`;

 
export function mirrorPaths(e: LibraryEntry): { file: string; image?: string } {
  const img = e.image ? imagePath(e.image) : null;
  return img ? { file: fileRel(e.file, e.kind), image: `images/${img}` } : { file: fileRel(e.file, e.kind) };
}

 
function adoptLegacy(dir: string, file: string, kind: Kind): boolean {
  const lib = LIB_DIR[kind] ?? "library-robots";
  for (const k of Object.keys(LIB_DIR) as Kind[]) {
    const old = path.join(dir, "files", `${k}-${file}`);
    if (LIB_DIR[k] !== lib || !existsSync(old)) continue;
    const dest = path.join(dir, fileRel(file, kind));
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(old, dest);
    return true;
  }
  return false;
}

 
export async function libraryDownload(file: string, kind: Kind = "robot"): Promise<{ bytes: Uint8Array; url: string }> {
  if (!FILE_NAME.test(file)) throw new LibraryError(`Invalid library file name: ${file}`, 400);
  const dir = libraryDir();
  const url = libraryFileUrl(file, kind);
  const local = path.join(dir, fileRel(file, kind));
  if (existsSync(local) || adoptLegacy(dir, file, kind)) return { bytes: new Uint8Array(readFileSync(local)), url };
  if (offlineOnly()) throw new LibraryError(`${file} is not in the offline robot library (ROBOCRAFT_LIBRARY_OFFLINE=1)`, 404);
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new LibraryError(`Download failed (${res.status}) for ${url}`, res.status === 404 ? 404 : 502);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeAtomic(local, bytes);
  return { bytes, url };
}

 
export function imagePath(p: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(p.startsWith(IMAGE_ROUTE) ? p.slice(IMAGE_ROUTE.length) : p);
  } catch {
    return null;
  }
  const prefix = Object.values(IMAGE_DIR).find((d) => rel.startsWith(d));
  return prefix && IMAGE_NAME.test(rel.slice(prefix.length)) ? rel : null;
}

const remoteImageUrl = (rel: string) => `${CDN}/${rel.split("/").map(encodeURIComponent).join("/")}`;

 
export async function libraryImage(p: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const rel = imagePath(p);
  if (!rel) throw new LibraryError(`Not a library thumbnail: ${p}`, 400);
  const local = path.join(libraryDir(), "images", rel);
  const type = IMAGE_TYPES[rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()];
  if (existsSync(local)) return { bytes: new Uint8Array(readFileSync(local)), type };
  if (offlineOnly()) throw new LibraryError(`Thumbnail not in the offline robot library: ${rel}`, 404);
  const res = await fetch(remoteImageUrl(rel), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new LibraryError(`Thumbnail download failed (${res.status})`, res.status === 404 ? 404 : 502);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeAtomic(local, bytes);
  return { bytes, type };
}

 

export interface MirrorEntry {
  bytes: number;
  sha256: string;
  etag?: string;
  lastModified?: string;
  at: string;
}
export interface MirrorFailure {
  path: string;
  url: string;
  error: string;
}
export interface MirrorManifest {
  version: 1;
  source: string;
   
  catalogAt?: string;
  items?: number;
  startedAt?: string;
   
  completedAt?: string;
   
  files: Record<string, MirrorEntry>;
  failures: MirrorFailure[];
}
export interface MirrorProgress {
   
  total: number;
  done: number;
  downloaded: number;
  unchanged: number;
  failed: number;
   
  bytes: number;
  current?: string;
}
export interface MirrorResult extends MirrorProgress {
  items: number;
  failures: MirrorFailure[];
  aborted?: string;
  seconds: number;
}
export interface MirrorOptions {
   
  refresh?: boolean;
   
  concurrency?: number;
  onProgress?: (p: MirrorProgress) => void;
  signal?: AbortSignal;
   
  retryDelayMs?: number;
}

export function readManifest(dir = libraryDir()): MirrorManifest | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "mirror.json"), "utf8")) as MirrorManifest;
  } catch {
    return null;
  }
}

 
export function lockHolder(dir = libraryDir()): { pid: number; startedAt: string } | null {
  try {
    const lock = JSON.parse(readFileSync(path.join(dir, "mirror.lock"), "utf8")) as { pid: number; startedAt: string };
    process.kill(lock.pid, 0);
    return lock;
  } catch {
    return null;
  }
}

function acquireLock(dir: string): () => void {
  const f = path.join(dir, "mirror.lock");
  const holder = lockHolder(dir);
  if (holder) throw new LibraryError(`The library mirror is already running (process ${holder.pid})`, 409);
  rmSync(f, { force: true });
  try {
    writeFileSync(f, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx" });
  } catch {
    throw new LibraryError("The library mirror is already running", 409);
  }
  return () => rmSync(f, { force: true });
}

 
function removeStaleParts(dir: string) {
  for (const f of [...walk(path.join(dir, "files")), ...walk(path.join(dir, "images"))]) {
    if (f.endsWith(".part") && Date.now() - mtime(f) > 60_000) rmSync(f, { force: true });
  }
}

function entryFromDisk(f: string): MirrorEntry {
  const bytes = readFileSync(f);
  return { bytes: bytes.length, sha256: sha256(bytes), at: new Date(mtime(f)).toISOString() };
}





async function download(url: string, headers: Record<string, string>, delayMs: number): Promise<{ status: number; bytes?: Uint8Array; headers: Headers }> {
  for (let attempt = 0; ; attempt++) {
    let wait = delayMs * 3 ** attempt;
    try {
      const res = await fetch(url, { headers: { "user-agent": MIRROR_UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 304) return { status: 304, headers: res.headers };
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const len = res.headers.get("content-length");
        const enc = res.headers.get("content-encoding");
         
        if (len === null || (enc && enc !== "identity") || Number(len) === bytes.length) return { status: res.status, bytes, headers: res.headers };
        throw new Error(`truncated download (${bytes.length} of ${len} bytes)`);
      }
      await res.body?.cancel().catch(() => undefined);
      if (res.status !== 429 && res.status < 500) throw new LibraryError(`HTTP ${res.status}`, res.status);
      const after = Number(res.headers.get("retry-after"));
      if (after > 0) wait = Math.min(60_000, after * 1000);
      if (attempt >= RETRIES) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof LibraryError || attempt >= RETRIES) throw err;
    }
    await sleep(wait);
  }
}

interface MirrorTask {
  rel: string;
  url: string;
}

async function mirrorOne(dir: string, task: MirrorTask, known: MirrorEntry | undefined, opts: MirrorOptions): Promise<{ entry: MirrorEntry; downloaded: boolean }> {
  const dest = path.join(dir, task.rel);
  const size = existsSync(dest) ? statSync(dest).size : -1;
   
  const have = size >= 0 && (!known || known.bytes === size);
  if (have && !opts.refresh) return { entry: known ?? entryFromDisk(dest), downloaded: false };
  const headers: Record<string, string> = {};
  if (have) {
    if (known?.etag) headers["if-none-match"] = known.etag;
    headers["if-modified-since"] = known?.lastModified ?? new Date(mtime(dest)).toUTCString();
  }
  const res = await download(task.url, headers, opts.retryDelayMs ?? 1000);
  if (res.status === 304) return { entry: known ?? entryFromDisk(dest), downloaded: false };
  writeAtomic(dest, res.bytes!);
  const entry: MirrorEntry = { bytes: res.bytes!.length, sha256: sha256(res.bytes!), at: new Date().toISOString() };
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  if (etag) entry.etag = etag;
  if (lastModified) entry.lastModified = lastModified;
  return { entry, downloaded: true };
}





export async function mirrorLibrary(opts: MirrorOptions = {}): Promise<MirrorResult> {
  if (offlineOnly()) throw new LibraryError("Mirroring needs the network: unset ROBOCRAFT_LIBRARY_OFFLINE", 409);
  const t0 = Date.now();
  const dir = libraryDir();
  const release = acquireLock(dir);
  try {
    removeStaleParts(dir);
    const entries = await libraryCatalog(!!opts.refresh);
    const manifest: MirrorManifest = readManifest(dir) ?? { version: 1, source: CDN, files: {}, failures: [] };
    manifest.startedAt = new Date().toISOString();
    manifest.catalogAt = new Date(mtime(path.join(dir, "catalog.json"))).toISOString();
    manifest.items = entries.length;
    const tasks: MirrorTask[] = [];
    for (const e of entries) {
      const rel = mirrorPaths(e);
      if (!existsSync(path.join(dir, rel.file))) adoptLegacy(dir, e.file, e.kind);
      tasks.push({ rel: rel.file, url: libraryFileUrl(e.file, e.kind) });
      if (rel.image) tasks.push({ rel: rel.image, url: remoteImageUrl(rel.image.slice("images/".length)) });
    }
    const progress: MirrorProgress = { total: tasks.length, done: 0, downloaded: 0, unchanged: 0, failed: 0, bytes: 0 };
    const failures: MirrorFailure[] = [];
    const save = () => writeAtomic(path.join(dir, "mirror.json"), JSON.stringify(manifest, null, 1));
    let next = 0;
    let consecutive = 0;
    let aborted: string | undefined;
    const worker = async () => {
      while (next < tasks.length && !aborted) {
        if (opts.signal?.aborted) {
          aborted = "cancelled";
          break;
        }
        const task = tasks[next++];
        progress.current = task.rel;
        try {
          const r = await mirrorOne(dir, task, manifest.files[task.rel], opts);
          manifest.files[task.rel] = r.entry;
          if (r.downloaded) {
            progress.downloaded++;
            progress.bytes += r.entry.bytes;
          } else progress.unchanged++;
          consecutive = 0;
        } catch (err) {
          failures.push({ path: task.rel, url: task.url, error: message(err) });
          progress.failed++;
          if (++consecutive >= MAX_CONSECUTIVE_FAILURES) aborted = `${consecutive} downloads failed in a row (last: ${message(err)})`;
        }
        progress.done++;
        if (progress.done % 50 === 0) save();
        opts.onProgress?.({ ...progress });
      }
    };
    const n = Math.min(4, Math.max(1, Math.floor(opts.concurrency ?? 2)));
    await Promise.all(Array.from({ length: n }, worker));
    manifest.failures = failures;
    if (!aborted) manifest.completedAt = new Date().toISOString();
    save();
    return { ...progress, current: undefined, items: entries.length, failures, aborted, seconds: Math.round((Date.now() - t0) / 1000) };
  } finally {
    release();
  }
}

export interface MirrorSummary {
   
  items: number;
   
  files: number;
  images: number;
  bytes: number;
   
  mirrored: boolean;
  completedAt?: string;
  catalogAt?: string;
  failures: MirrorFailure[];
  offlineOnly: boolean;
   
  runningElsewhere?: { pid: number; startedAt: string };
}

 
export function mirrorSummary(): MirrorSummary {
  const dir = libraryDir();
  const m = readManifest(dir);
  let files = 0;
  let images = 0;
  let bytes = 0;
  for (const [root, isImage] of [["files", false], ["images", true]] as const) {
    for (const f of walk(path.join(dir, root))) {
      if (f.endsWith(".part")) continue;
      if (isImage) images++;
      else files++;
      bytes += statSync(f).size;
    }
  }
  const cat = path.join(dir, "catalog.json");
  const items = memo.get(dir)?.entries.length ?? (existsSync(cat) ? (JSON.parse(readFileSync(cat, "utf8")) as unknown[]).length : 0);
  const holder = lockHolder(dir);
  return {
    items,
    files,
    images,
    bytes,
    mirrored: !!m?.completedAt,
    completedAt: m?.completedAt,
    catalogAt: m?.catalogAt,
    failures: m?.failures ?? [],
    offlineOnly: offlineOnly(),
    ...(holder && holder.pid !== process.pid ? { runningElsewhere: holder } : {}),
  };
}

export interface VerifyResult {
  checked: number;
  ok: number;
  missing: string[];
  corrupt: string[];
   
  notMirrored: number;
}





export function verifyMirror(onProgress?: (done: number, total: number) => void): VerifyResult {
  const dir = libraryDir();
  const manifest = readManifest(dir);
  if (!manifest) throw new LibraryError("There is no offline library mirror yet (mirror.json is missing). Run `npm run library:mirror`.", 404);
  const keys = Object.keys(manifest.files);
  const res: VerifyResult = { checked: keys.length, ok: 0, missing: [], corrupt: [], notMirrored: 0 };
  keys.forEach((rel, i) => {
    const f = path.join(dir, rel);
    const want = manifest.files[rel];
    if (!existsSync(f)) {
      res.missing.push(rel);
      delete manifest.files[rel];
    } else {
      const bytes = readFileSync(f);
      if (bytes.length === want.bytes && sha256(bytes) === want.sha256) res.ok++;
      else {
        res.corrupt.push(rel);
        rmSync(f, { force: true });
        delete manifest.files[rel];
      }
    }
    onProgress?.(i + 1, keys.length);
  });
  const cat = path.join(dir, "catalog.json");
  if (existsSync(cat)) {
    for (const e of JSON.parse(readFileSync(cat, "utf8")) as LibraryEntry[]) {
      const rel = mirrorPaths({ ...e, image: localImage(e.image) });
      if (!manifest.files[rel.file]) res.notMirrored++;
      if (rel.image && !manifest.files[rel.image]) res.notMirrored++;
    }
  }
  if (res.missing.length || res.corrupt.length) {
    delete manifest.completedAt;
    writeAtomic(path.join(dir, "mirror.json"), JSON.stringify(manifest, null, 1));
  }
  return res;
}
