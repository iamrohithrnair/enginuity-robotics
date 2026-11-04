 
 
 
 
 
 
 
 
 
 
 

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DATASET_ID = "nvidia/simready-assets";
export const DATASET_URL = `https://huggingface.co/datasets/${DATASET_ID}`;
export const DATASET_LICENSE = "CC-BY-4.0";
export const ATTRIBUTION = "NVIDIA SimReady Assets · CC BY 4.0";
export const HF_API = `https://huggingface.co/api/datasets/${DATASET_ID}`;
export const HF_RESOLVE = `https://huggingface.co/datasets/${DATASET_ID}/resolve/main`;
const UA = "Enginuity/1.0 (+simready on-demand)";

 
export class SimReadyError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

 
export function simreadyDir(): string {
  return process.env.ENGINUITY_SIMREADY_DIR || path.join(process.env.ROBOCRAFT_DATA_DIR ?? path.join(  process.cwd(), "data"), "simready");
}

 
export const offlineOnly = () => process.env.ENGINUITY_SIMREADY_OFFLINE === "1";

const ID = /^[A-Za-z0-9_.-]+$/;

 
export function checkId(id: unknown): string {
  if (typeof id !== "string" || !ID.test(id) || /^\.+$/.test(id) || id.length > 200) throw new SimReadyError(`Invalid SimReady asset id: ${JSON.stringify(id)}`, 400);
  return id;
}

 
export function checkRelPath(rel: unknown): string {
  if (typeof rel !== "string" || !rel || rel.includes("\0")) throw new SimReadyError(`Invalid SimReady file path: ${JSON.stringify(rel)}`, 400);
  const p = rel.replace(/\\/g, "/");
  const norm = path.posix.normalize(p);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || norm === "." || norm === ".." || norm.startsWith("../") || norm.startsWith("/") || p.split("/").includes(".."))
    throw new SimReadyError(`Invalid SimReady file path: ${JSON.stringify(rel)}`, 400);
  return norm;
}

export const assetDir = (id: string) => path.join(simreadyDir(), "assets", checkId(id));
export const assetFile = (id: string, rel: string) => path.join(assetDir(id), ...checkRelPath(rel).split("/"));
export const resolveUrl = (id: string, rel: string) => `${HF_RESOLVE}/${encodeURIComponent(checkId(id))}/${checkRelPath(rel).split("/").map(encodeURIComponent).join("/")}`;

let partSeq = 0;
 
export function writeAtomic(file: string, data: Uint8Array | string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${++partSeq}.part`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

 
export const httpConfig = { retries: 2, backoffMs: 600, apiTimeoutMs: 30_000, fileTimeoutMs: 300_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

declare global {
  var __enginuitySimReadyShared: Record<string, unknown> | undefined;
}






export function shared<T>(key: string, init: () => T): T {
  const s = (globalThis.__enginuitySimReadyShared ??= {});
  return (s[key] ??= init()) as T;
}

 
export function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "user-agent": UA };
   
  if (process.env.HF_TOKEN) h.authorization = `Bearer ${process.env.HF_TOKEN}`;
  return h;
}






export async function hfGet(url: string, opts: { timeoutMs?: number; what?: string; check?: (bytes: Uint8Array) => string | null } = {}): Promise<{ bytes: Uint8Array; headers: Headers } | null> {
  if (offlineOnly()) throw new SimReadyError(`${opts.what ?? url} is not in the local SimReady cache (offline mode, ENGINUITY_SIMREADY_OFFLINE=1)`, 503);
  let last = "";
  for (let attempt = 0; attempt <= httpConfig.retries; attempt++) {
    if (attempt) await sleep(httpConfig.backoffMs * 3 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: headers(), redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? httpConfig.apiTimeoutMs) });
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        last = `HTTP ${res.status}`;
        if (res.status === 429 || res.status >= 500) continue;
        break;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const bad = opts.check?.(bytes);
      if (bad) {
        last = bad;
        continue;
      }
      return { bytes, headers: res.headers };
    } catch (err) {
      last = errorMessage(err);
    }
  }
  throw new SimReadyError(`Could not download ${opts.what ?? url} from Hugging Face: ${last}`, 502);
}

 
export async function hfTree(url: string, what: string): Promise<unknown[] | null> {
  const out: unknown[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 50; page++) {
    const res = await hfGet(next, { what });
    if (!res) {
      if (page === 0) return null;
      throw new SimReadyError(`Could not list ${what}: a page of the listing is missing`, 502);
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(res.bytes));
    if (!Array.isArray(data)) throw new SimReadyError(`Unexpected listing of ${what} from Hugging Face`, 502);
    out.push(...data);
    next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  return out;
}
