// Locates mirrored library assets, reports missing files, and decodes qCompress payloads.
 
 
 
 
 
 
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

 
export const LIBRARY_DIR = process.env.ENGINUITY_LIBRARY_DIR ? path.resolve(process.env.ENGINUITY_LIBRARY_DIR) : path.resolve(__dirname, "../data/library");

export type LibraryKind = "robots" | "tools" | "stations";
const KINDS: LibraryKind[] = ["robots", "tools", "stations"];

 
export const LIBRARY_FILE = (kind: LibraryKind, name: string) => path.join(LIBRARY_DIR, "files", `library-${kind}`, name);

 
export const LIBRARY_KIND_DIR = (kind: LibraryKind) => path.join(LIBRARY_DIR, "files", `library-${kind}`);

 
export function libraryMirrorNote(): string | undefined {
  const files = path.join(LIBRARY_DIR, "files");
  const present = existsSync(files) && KINDS.some((k) => existsSync(LIBRARY_KIND_DIR(k)) && readdirSync(LIBRARY_KIND_DIR(k)).length > 0);
  if (present) return undefined;
  return `No offline library mirror at ${LIBRARY_DIR}: tests that need library robots, tools or stations are skipped (npm run library:mirror creates it; ENGINUITY_LIBRARY_DIR points at another one)`;
}

const told = new Set<string>();





export function libraryMissing(what: string): string {
  const note = `${what} is not in the offline library mirror (${LIBRARY_DIR})`;
  if (!told.has(note) && existsSync(path.join(LIBRARY_DIR, "files"))) {
    told.add(note);
    console.warn(`[library] ${note}: the tests that need it are skipped`);
  }
  return note;
}

 
export function hasLibraryFile(kind: LibraryKind, name: string): boolean {
  if (existsSync(LIBRARY_FILE(kind, name))) return true;
  libraryMissing(`library-${kind}/${name}`);
  return false;
}

const DIR_OF: Record<string, LibraryKind> = { robot: "robots", axis: "robots", tool: "tools", object: "tools", station: "stations" };





export function findLibraryFile(name: string, kind?: string): string | undefined {
  const first: LibraryKind = (kind && DIR_OF[kind]) || (/\.rdk$/i.test(name) ? "stations" : /\.tool$/i.test(name) ? "tools" : "robots");
  for (const k of [first, ...KINDS.filter((x) => x !== first)]) {
    const p = LIBRARY_FILE(k, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}






export function qUncompress(bytes: Uint8Array): Buffer {
  const declared = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(0);
  const out = inflateSync(bytes.subarray(4));
  if (out.length !== declared) throw new Error(`qUncompress: ${declared} bytes declared, ${out.length} inflated`);
  return out;
}
