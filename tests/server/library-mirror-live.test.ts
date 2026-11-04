 
 
 
 
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initKinematics, parseRdkFile } from "@/engine/kinematics";
import type { LibraryEntry } from "@/engine/registry";
import { libraryCatalog, libraryDir, libraryDownload, mirrorPaths, mirrorSummary, readManifest } from "@/server/library-core";
import { engine, LIBRARY_DIR } from "../helpers";

 
const DATA = path.dirname(LIBRARY_DIR);
const enabled = process.env.LIBRARY_MIRROR_CHECK === "1" && path.basename(LIBRARY_DIR) === "library" && existsSync(path.join(LIBRARY_DIR, "mirror.json"));
const saved = { dir: process.env.ROBOCRAFT_DATA_DIR, offline: process.env.ROBOCRAFT_LIBRARY_OFFLINE };
 
const every = (list: LibraryEntry[], n: number) => list.filter((_, i) => i % n === 0);

describe.skipIf(!enabled)("offline library mirror (data/library)", () => {
  let catalog: LibraryEntry[];
  const fetch = vi.fn(async () => {
    throw new TypeError("network disabled in this test");
  });

  beforeAll(async () => {
    process.env.ROBOCRAFT_DATA_DIR = DATA;
    process.env.ROBOCRAFT_LIBRARY_OFFLINE = "1";
    vi.stubGlobal("fetch", fetch);
    catalog = await libraryCatalog();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of [["ROBOCRAFT_DATA_DIR", saved.dir], ["ROBOCRAFT_LIBRARY_OFFLINE", saved.offline]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("holds every catalog file and thumbnail with the size recorded in mirror.json", () => {
    const manifest = readManifest()!;
    const problems: string[] = [];
    for (const e of catalog) {
      for (const rel of Object.values(mirrorPaths(e))) {
        const f = path.join(libraryDir(), rel);
        if (!existsSync(f)) problems.push(`missing ${rel}`);
        else if (manifest.files[rel]?.bytes !== statSync(f).size) problems.push(`not in manifest or wrong size: ${rel}`);
      }
    }
    expect(catalog.length).toBeGreaterThan(2000);
    expect(problems).toEqual([]);
    expect(mirrorSummary()).toMatchObject({ mirrored: true, failures: [], offlineOnly: true });
  });

  it("loads robots, tools, external axes, example stations and item archives without the network", async () => {
    const kind = (k: LibraryEntry["kind"]) => catalog.filter((x) => x.kind === k);
    const plain = (k: LibraryEntry["kind"]) => kind(k).filter((x) => !/\.rdka$/i.test(x.file));
    const archives = catalog.filter((x) => /\.rdka$/i.test(x.file));
    const failed: string[] = [];
     
    const attempt = async (x: LibraryEntry, run: (e: Awaited<ReturnType<typeof engine>>) => Promise<unknown>) => {
      const e = await engine();
      e.services.library!.load = (file, k) => libraryDownload(file, k);
      try {
        await run(e);
      } catch (err) {
        failed.push(`${x.file}: ${err instanceof Error ? err.message : err}`);
      }
    };
    for (const x of every(plain("robot"), 150)) await attempt(x, (e) => e.run("library.load", { file: x.file, kind: "robot" }));
    for (const x of every(plain("tool"), 40))
      await attempt(x, async (e) => {
        const robot = (await e.run("library.load", { file: "UR5e.robot", kind: "robot" })) as unknown as { id: string };
        return e.run("library.load", { file: x.file, kind: "tool", robot: robot.id });
      });
    for (const x of every(kind("axis"), 25)) await attempt(x, (e) => e.run("library.load", { file: x.file, kind: "robot" }));
     
     
    await initKinematics();
    const large: string[] = [];
    for (const x of every(kind("station"), 60)) {
      const tree = parseRdkFile((await libraryDownload(x.file, "station")).bytes).json as { items: { kind: string; instructions?: unknown[] }[] };
      if (tree.items.some((i) => i.kind === "program" && (i.instructions?.length ?? 0) > 5000)) large.push(x.file);
      else await attempt(x, (e) => e.run("station.openRdk", { file: x.file }));
    }
    console.info(`stations not opened (programs over 5,000 instructions): ${large.join(", ") || "none"}`);
    for (const x of every(archives, 4)) await attempt(x, (e) => e.run("library.load", { file: x.file, kind: x.kind }));
    expect(failed).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  }, 300_000);
});
