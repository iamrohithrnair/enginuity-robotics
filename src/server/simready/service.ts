 
 
 
 
 

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { MeshPart } from "@/engine/meshformats";
import type { Services, SimReadyPrepared } from "@/engine/registry";
import { entryOf, searchSimReady, simreadyCatalog, type SimReadyQuery, type SimReadySearchResult } from "./catalog";
import { hfAssetFiles, type AssetListing } from "./files";
import { SimReadyError, assetDir, assetFile, checkId, errorMessage, hfGet, limiter, offlineOnly, resolveUrl, shared, simreadyDir, writeAtomic } from "./http";
import { convertSimReadyAsset, type ConvertedAsset, type SimReadyPhysics } from "./usd";

export interface PrepareOptions {
   
  textures?: boolean;
   
  force?: boolean;
}

 
export interface PreparedMeta {
  version: 1;
  id: string;
  name: string;
  category: string;
  root: string;
  textures: boolean;
  triangles: number;
   
  bbox: { min: [number, number, number]; max: [number, number, number] };
   
  size: [number, number, number];
  metersPerUnit: number;
  upAxis: "Y" | "Z";
  physics?: SimReadyPhysics;
  warnings: string[];
   
  files: string[];
   
  bytes: number;
   
  parts: { color?: [number, number, number, number]; floats: number; normals: boolean }[];
  createdAt: string;
}

export interface EnsureResult {
  meta: PreparedMeta;
  cached: boolean;
  downloadedBytes: number;
  ms: number;
}

export interface SimReadyJob {
  asset: string;
  phase: string;
  file?: string;
   
  files: number;
   
  bytes: number;
  startedAt: string;
}

const META = ".enginuity-v1.json";
const BIN = ".enginuity-v1.bin";
 
const thumbDownloads = shared("thumbDownloads", () => limiter(4));

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function readMeta(id: string): PreparedMeta | null {
  const file = path.join(assetDir(id), META);
  if (!existsSync(file) || !existsSync(path.join(assetDir(id), BIN))) return null;
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as PreparedMeta;
    return m.version === 1 && Array.isArray(m.parts) ? m : null;
  } catch {
    return null;
  }
}

 
function readParts(meta: PreparedMeta): MeshPart[] {
  const raw = readFileSync(path.join(assetDir(meta.id), BIN));
  if (raw.length % 4) throw new SimReadyError(`The converted SimReady asset "${meta.id}" is damaged; prepare it again`, 500);
  const all = new Float32Array(new Uint8Array(raw).buffer);
  const need = meta.parts.reduce((n, p) => n + p.floats * (p.normals ? 2 : 1), 0);
  if (all.length !== need) throw new SimReadyError(`The converted SimReady asset "${meta.id}" is damaged; prepare it again`, 500);
  let o = 0;
  return meta.parts.map((p) => {
    const triangles = all.slice(o, (o += p.floats));
    const normals = p.normals ? all.slice(o, (o += p.floats)) : undefined;
    return { triangles, ...(p.color ? { color: p.color } : {}), ...(normals ? { normals } : {}) };
  });
}

function writeConverted(meta: Omit<PreparedMeta, "parts">, parts: MeshPart[]): PreparedMeta {
  const layout = parts.map((p) => ({ ...(p.color ? { color: p.color } : {}), floats: p.triangles.length, normals: p.normals?.length === p.triangles.length }));
  const total = layout.reduce((n, p) => n + p.floats * (p.normals ? 2 : 1), 0);
  const all = new Float32Array(total);
  let o = 0;
  parts.forEach((p, i) => {
    all.set(p.triangles, o);
    o += p.triangles.length;
    if (layout[i].normals) {
      all.set(p.normals!, o);
      o += p.triangles.length;
    }
  });
  const full: PreparedMeta = { ...meta, parts: layout };
   
  writeAtomic(path.join(assetDir(meta.id), BIN), new Uint8Array(all.buffer));
  writeAtomic(path.join(assetDir(meta.id), META), JSON.stringify(full));
  return full;
}

 
async function rootUsd(id: string, files: ReturnType<typeof hfAssetFiles>, listing: AssetListing): Promise<string> {
  const has = (p: string) => listing.files.some((f) => f.path === p);
  try {
    const j = await files.get(".metadata/com.nvidia.simready.root_usds.json");
    const first = j && (JSON.parse(new TextDecoder().decode(j)) as { entries?: unknown[] }).entries?.[0];
    if (typeof first === "string" && has(first.replace(/^\.\//, ""))) return first.replace(/^\.\//, "");
  } catch (err) {
    if (err instanceof SimReadyError && err.status !== 500) throw err;
  }
  const guess = `simready_usd/sm_${id}_01.usd`;
  if (has(guess)) return guess;
  const any = listing.files.map((f) => f.path).find((p) => /^simready_usd\/[^/]+\.usd[ac]?$/i.test(p));
  if (!any) throw new SimReadyError(`SimReady asset "${id}" has no root USD file`, 422);
  return any;
}

function du(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  if (!existsSync(dir)) return { files, bytes };
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      const s = du(p);
      files += s.files;
      bytes += s.bytes;
    } else if (d.isFile()) {
      files++;
      bytes += statSync(p).size;
    }
  }
  return { files, bytes };
}

 
export function serviceState() {
  return {
    jobs: new Map<string, SimReadyJob>(),
    recent: [] as { asset: string; ok: boolean; ms: number; error?: string; at: string }[],
    inflight: new Map<string, Promise<EnsureResult>>(),
    thumbs: new Map<string, Promise<Buffer>>(),
    noThumb: new Set<string>(),
  };
}

export function createSimReadyService(convert: typeof convertSimReadyAsset = convertSimReadyAsset, state = serviceState()) {
  const { jobs, recent, inflight, thumbs, noThumb } = state;

  async function convertAndCache(id: string, textures: boolean): Promise<EnsureResult> {
    const t0 = Date.now();
    const job: SimReadyJob = { asset: id, phase: "listing", files: 0, bytes: 0, startedAt: new Date(t0).toISOString() };
    jobs.set(id, job);
    try {
      const files = hfAssetFiles(id, {
        onStart(rel) {
          job.phase = "download";
          job.file = rel;
        },
        onDone(_rel, n) {
          job.files++;
          job.bytes += n;
        },
      });
      const listing = await files.listing();
      const root = await rootUsd(id, files, listing);
      let conv: ConvertedAsset;
      try {
        conv = await convert(root, files, {
          textures,
          onProgress(p) {
            job.phase = p.phase;
            if (p.file) job.file = p.file;
          },
        });
      } catch (err) {
        throw err instanceof SimReadyError ? err : new SimReadyError(`Could not convert SimReady asset "${id}": ${errorMessage(err)}`, 422);
      }
      const parts = conv.parts.filter((p) => p.triangles.length >= 9);
      if (!parts.length) throw new SimReadyError(`SimReady asset "${id}" has no geometry Enginuity can show`, 422);
      job.phase = "saving";
      const size = new Map(listing.files.map((f) => [f.path, f.size]));
      const { min, max } = conv.bbox;
      const e = entryOf(id);
      const meta = writeConverted(
        {
          version: 1,
          id,
          name: e.name,
          category: e.category,
          root,
          textures,
          triangles: parts.reduce((n, p) => n + p.triangles.length / 9, 0),
          bbox: conv.bbox,
          size: [r3(max[0] - min[0]), r3(max[1] - min[1]), r3(max[2] - min[2])],
          metersPerUnit: conv.metersPerUnit,
          upAxis: conv.upAxis,
          ...(conv.physics ? { physics: conv.physics } : {}),
          warnings: conv.warnings ?? [],
          files: conv.files ?? [],
          bytes: (conv.files ?? []).reduce((n, f) => n + (size.get(f) ?? 0), 0),
          createdAt: new Date().toISOString(),
        },
        parts,
      );
      const ms = Date.now() - t0;
      recent.unshift({ asset: id, ok: true, ms, at: new Date().toISOString() });
      return { meta, cached: false, downloadedBytes: job.bytes, ms };
    } catch (err) {
      recent.unshift({ asset: id, ok: false, ms: Date.now() - t0, error: errorMessage(err), at: new Date().toISOString() });
      throw err;
    } finally {
      recent.splice(10);
      jobs.delete(id);
    }
  }

   
  async function ensure(id: string, opts: PrepareOptions = {}): Promise<EnsureResult> {
    checkId(id);
    const t0 = Date.now();
    const textures = opts.textures !== false;
    const meta = opts.force ? null : readMeta(id);
     
    if (meta && (meta.textures || !textures)) return { meta, cached: true, downloadedBytes: 0, ms: Date.now() - t0 };
    const key = `${assetDir(id)}|${textures}`;
    let p = inflight.get(key);
    if (!p) {
      p = convertAndCache(id, textures).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

   
  async function prepare(id: string, opts: PrepareOptions = {}): Promise<SimReadyPrepared> {
    const t0 = Date.now();
    let r = await ensure(id, opts);
    let parts: MeshPart[];
    try {
      parts = readParts(r.meta);
    } catch {
       
      r = await ensure(id, { ...opts, force: true });
      parts = readParts(r.meta);
    }
    const { meta } = r;
    return {
      id: meta.id,
      name: meta.name,
      category: meta.category,
      parts,
      triangles: meta.triangles,
      bbox: meta.bbox,
      size: meta.size,
      ...(meta.physics ? { physics: meta.physics } : {}),
      warnings: meta.warnings,
      cached: r.cached,
      downloadedBytes: r.downloadedBytes,
      bytes: meta.bytes,
      ms: Date.now() - t0,
    };
  }

  async function search(q: SimReadyQuery = {}): Promise<SimReadySearchResult> {
    const cat = await simreadyCatalog();
    const res = searchSimReady(cat.entries, q);
    return cat.stale ? { ...res, error: `Showing the cached catalog: ${cat.stale}` } : res;
  }

  function status() {
    const dir = simreadyDir();
    const root = path.join(dir, "assets");
    let assets = 0;
    let prepared = 0;
    let bytes = 0;
    if (existsSync(root))
      for (const d of readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        assets++;
        if (existsSync(path.join(root, d.name, META))) prepared++;
        bytes += du(path.join(root, d.name)).bytes;
      }
    const t = du(path.join(dir, "thumbs"));
    return {
      jobs: [...jobs.values()].map((j) => ({ ...j })),
      cache: { assets, prepared, thumbnails: t.files, bytes: bytes + t.bytes, dir },
      offline: offlineOnly(),
      recent: recent.slice(),
    };
  }

   
  async function thumbSource(id: string): Promise<Uint8Array | null> {
    const get = async (rel: string) => {
      const local = assetFile(id, rel);
      if (existsSync(local)) return new Uint8Array(readFileSync(local));
      return (await thumbDownloads(() => hfGet(resolveUrl(id, rel), { what: `the thumbnail of ${id}` })))?.bytes ?? null;
    };
    const guess = `simready_usd/sm_${id}_01.usd`;
    const first = await get(`simready_usd/.thumbs/256x256/sm_${id}_01.usd.png`);
    if (first) return first;
    let root = guess;
    const j = await get(".metadata/com.nvidia.simready.root_usds.json");
    if (j) {
      try {
        const e = (JSON.parse(new TextDecoder().decode(j)) as { entries?: unknown[] }).entries?.[0];
        if (typeof e === "string" && e) root = e.replace(/^\.\//, "");
      } catch {
         
      }
    }
    const dir = path.posix.dirname(root);
    const file = path.posix.basename(root);
    const candidates = [`${dir}/.thumbs/256x256/${file}.png`, `${dir}/.thumbs/${file.replace(/\.usd[ac]?$/i, "")}_thumbnail.png`].filter((c) => c !== `simready_usd/.thumbs/256x256/sm_${id}_01.usd.png`);
    for (const c of candidates) {
      const b = await get(c);
      if (b) return b;
    }
    return null;
  }

   
  async function thumbnail(id: string, size = 192): Promise<Buffer> {
    checkId(id);
    const px = Math.min(512, Math.max(64, Math.round(Number.isFinite(size) ? size : 192)));
    const out = path.join(simreadyDir(), "thumbs", `${id}-${px}.webp`);
    if (existsSync(out)) return readFileSync(out);
    if (noThumb.has(id)) throw new SimReadyError(`SimReady asset "${id}" has no thumbnail`, 404);
    let p = thumbs.get(out);
    if (!p) {
      p = (async () => {
        const src = await thumbSource(id);
        if (!src) {
          noThumb.add(id);
          throw new SimReadyError(`SimReady asset "${id}" has no thumbnail`, 404);
        }
        const webp = await sharp(src).resize(px, px, { fit: "inside", withoutEnlargement: false }).webp({ quality: 80 }).toBuffer();
        writeAtomic(out, webp);
        return webp;
      })().finally(() => thumbs.delete(out));
      thumbs.set(out, p);
    }
    return p;
  }

  return { search, ensure, prepare, status, thumbnail };
}

export type SimReadyService = ReturnType<typeof createSimReadyService>;

declare global {
  var __enginuitySimReady: SimReadyService | undefined;
}

 
 
globalThis.__enginuitySimReady = createSimReadyService(convertSimReadyAsset, shared("service", serviceState));

 
export function simready(): SimReadyService {
  return (globalThis.__enginuitySimReady ??= createSimReadyService(convertSimReadyAsset, shared("service", serviceState)));
}

 
export function attachSimReady(services: Services) {
  services.simready = {
    search: (q) => simready().search(q),
    prepare: (id, opts) => simready().prepare(id, opts),
    status: () => simready().status(),
  };
}

 
const running = globalThis.__robocraft;
if (running && !running.services.simready) attachSimReady(running.services);
