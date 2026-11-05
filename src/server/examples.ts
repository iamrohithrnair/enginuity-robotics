// Serves example catalogs, thumbnails and station data with library checks.
 
 

import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EXAMPLE_SLUG, type ExampleCatalog, type ExampleEntry } from "@/engine/examples";
import type { Services } from "@/engine/registry";
import { libraryDir, mirrorPaths } from "./library-core";

export const EXAMPLES_DIR = process.env.ENGINUITY_EXAMPLES_DIR ?? path.join(  process.cwd(), "examples");

 
function inside(dir: string, rel: string): string {
  const full = path.resolve(dir, rel);
  if (!full.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Not an example file: ${rel}`);
  return full;
}

export function readExampleCatalog(dir = EXAMPLES_DIR): ExampleEntry[] {
  const data = JSON.parse(readFileSync(path.join(dir, "catalog.json"), "utf8")) as ExampleCatalog;
  return (data.examples ?? []).filter((e) => EXAMPLE_SLUG.test(e.slug));
}

 
export function missingLibraryFiles(e: ExampleEntry): string[] {
  const dir = libraryDir();
  const want = [...e.robots.map((f) => ({ f, kind: "robot" as const })), ...e.tools.map((f) => ({ f, kind: "tool" as const }))];
  return want.filter(({ f, kind }) => !existsSync(path.join(dir, mirrorPaths({ id: f, name: f, file: f, kind }).file))).map(({ f }) => f);
}

 
export function exampleThumbnail(slug: string, dir = EXAMPLES_DIR): Uint8Array {
  if (!EXAMPLE_SLUG.test(slug)) throw new Error(`Not an example: ${slug}`);
  const e = readExampleCatalog(dir).find((x) => x.slug === slug);
  if (!e) throw new Error(`Not an example: ${slug}`);
  return new Uint8Array(readFileSync(inside(dir, e.thumbnail)));
}

export function createExampleServices(dir = EXAMPLES_DIR): NonNullable<Services["examples"]> {
  return {
    async list() {
      return readExampleCatalog(dir).map((e) => ({ ...e, missing: missingLibraryFiles(e) }));
    },
    async load(slug) {
      const e = readExampleCatalog(dir).find((x) => x.slug === slug);
      if (!e) throw new Error(`Not an example: ${slug}`);
      return JSON.parse(readFileSync(inside(dir, e.station), "utf8"));
    },
  };
}





export function visibleLibraryEntries<T extends { kind: string }>(entries: T[], settings: Record<string, unknown>): T[] {
  return settings.RC_SHOW_LIBRARY_STATIONS ? entries : entries.filter((e) => e.kind !== "station");
}
