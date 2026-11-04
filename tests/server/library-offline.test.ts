 
 
 
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => undefined }));

import { GET as imageRoute } from "@/app/api/library/image/[...path]/route";
import { libraryCatalog, libraryDownload, mirrorLibrary, mirrorSummary, readManifest, verifyMirror } from "@/server/library-core";
import { engine } from "../helpers";

const CDN = "https://cdn.robodk.com";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ENTRIES = [
   
  { id: "UR5e", name: "UR5e", file: "UR5e.robot", kind: "robot", image: `${CDN}/robot/img/UR5e.png` },
  { id: "Grip", name: "Gripper", file: "Grip.tool", kind: "tool", image: "/api/library/image/robotlib/tools/Grip.png" },
];
const URLS = {
  robot: `${CDN}/downloads-library/library-robots/UR5e.robot`,
  tool: `${CDN}/downloads-library/library-tools/Grip.tool`,
  robotImg: `${CDN}/robot/img/UR5e.png`,
  toolImg: `${CDN}/robotlib/tools/Grip.png`,
  bundle: `${CDN}/library-robots/bundlerdklib.js`,
};
const BUNDLE = 'var lib={DATA_ALL:{UR5e:{MT:"R",N:"UR5e",F:"UR5e.robot",IS:"UR5e.png"},Grip:{MT:"T",N:"Gripper",F:"Grip.tool",I:"Grip.png"}}};';
const THREE_DAYS_AGO = Date.now() / 1000 - 3 * 86400;
const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const ctx = (p: string[]) => ({ params: Promise.resolve({ path: p }) });
const image = (p: string[]) => imageRoute(new Request(`http://localhost/api/library/image/${p.join("/")}`), ctx(p));

let root: string;
let lib: string;
const saved = { dir: process.env.ROBOCRAFT_DATA_DIR, offline: process.env.ROBOCRAFT_LIBRARY_OFFLINE };

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "rc-library-"));
  lib = path.join(root, "library");
  process.env.ROBOCRAFT_DATA_DIR = root;
  delete process.env.ROBOCRAFT_LIBRARY_OFFLINE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [["ROBOCRAFT_DATA_DIR", saved.dir], ["ROBOCRAFT_LIBRARY_OFFLINE", saved.offline]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

function put(rel: string, data: string | Uint8Array) {
  const f = path.join(lib, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, data);
  return f;
}

 
function mirrored() {
  put("catalog.json", JSON.stringify(ENTRIES));
  put("files/library-robots/UR5e.robot", "robot-bytes");
  put("files/tool-Grip.tool", "tool-bytes");  
  put("images/robot/img/UR5e.png", PNG);
  put("mirror.json", JSON.stringify({ version: 1, source: CDN, files: {}, failures: [], completedAt: new Date().toISOString() }));
  utimesSync(path.join(lib, "catalog.json"), THREE_DAYS_AGO, THREE_DAYS_AGO);
}

function noNetwork() {
  const f = vi.fn(async () => {
    throw new TypeError("fetch failed: network disabled in this test");
  });
  vi.stubGlobal("fetch", f);
  return f;
}

 
function fakeCdn(files: Record<string, string | Uint8Array<ArrayBuffer>>, flaky: string[] = []) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const failures = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ url, headers });
      const body = files[url];
      if (body === undefined) return new Response("not found", { status: 404 });
      const etag = `"${sha(body)}"`;
      const length = typeof body === "string" ? Buffer.byteLength(body) : body.length;
      const n = failures.get(url) ?? 0;
      if (flaky.includes(url) && n < 2) {
        failures.set(url, n + 1);
        if (n === 0) return new Response("busy", { status: 503 });
        return new Response(typeof body === "string" ? body.slice(1) : body.slice(1), { headers: { "content-length": String(length) } });
      }
      if (headers["if-none-match"] === etag) return new Response(null, { status: 304 });
      return new Response(body, { headers: { etag, "last-modified": "Wed, 04 Nov 2026 17:24:44 GMT", "content-length": String(length) } });
    }),
  );
  return calls;
}

const CDN_FILES = { [URLS.robot]: "robot-bytes", [URLS.tool]: "tool-bytes", [URLS.robotImg]: PNG, [URLS.toolImg]: PNG };

describe("offline robot library", () => {
  it("serves the catalog, library files and thumbnails from the mirror without the network", async () => {
    mirrored();
    const fetch = noNetwork();
    const catalog = await libraryCatalog();
    expect(catalog.map((e) => e.image)).toEqual(["/api/library/image/robot/img/UR5e.png", "/api/library/image/robotlib/tools/Grip.png"]);
    expect(text((await libraryDownload("UR5e.robot", "robot")).bytes)).toBe("robot-bytes");
     
    expect(text((await libraryDownload("Grip.tool", "tool")).bytes)).toBe("tool-bytes");
    expect(existsSync(path.join(lib, "files/library-tools/Grip.tool"))).toBe(true);
    const res = await image(["robot", "img", "UR5e.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads an item missing from the mirror once and keeps it", async () => {
    mirrored();
    const calls = fakeCdn({ [`${CDN}/downloads-library/library-robots/KR6.robot`]: "kr6", [URLS.toolImg]: PNG });
    expect(text((await libraryDownload("KR6.robot", "robot")).bytes)).toBe("kr6");
    expect(text((await libraryDownload("KR6.robot", "robot")).bytes)).toBe("kr6");
    expect((await image(["robotlib", "tools", "Grip.png"])).status).toBe(200);
    expect((await image(["robotlib", "tools", "Grip.png"])).status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([`${CDN}/downloads-library/library-robots/KR6.robot`, URLS.toolImg]);
    expect(existsSync(path.join(lib, "images/robotlib/tools/Grip.png"))).toBe(true);
  });

  it("the thumbnail route rejects path traversal and anything outside the CDN thumbnail folders", async () => {
    mirrored();
    const fetch = noNetwork();
    for (const p of [
      ["robot", "img", "..", "..", "catalog.json"],
      ["robot", "img", "..%2F..%2Fmirror.json"],
      ["robot", "img", "..", "..", "..", "settings.png"],
      ["robot", "img", "nested", "UR5e.png"],
      ["robot", "img", ".hidden.png"],
      ["robot", "img", "logo.svg"],
      ["files", "library-robots", "UR5e.robot"],
      ["etc", "passwd.png"],
    ]) {
      expect((await image(p)).status, p.join("/")).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mirrors everything, skipping files already present, removing stale .part files and writing the manifest", async () => {
    put("catalog.json", JSON.stringify(ENTRIES));
    put("files/library-robots/UR5e.robot", "robot-bytes");
    const stale = put("files/library-tools/Grip.tool.4242-1.part", "partial");
    utimesSync(stale, THREE_DAYS_AGO, THREE_DAYS_AGO);
    const calls = fakeCdn(CDN_FILES);
    const progress: number[] = [];
    const r = await mirrorLibrary({ concurrency: 2, retryDelayMs: 1, onProgress: (p) => progress.push(p.done) });
    expect(r).toMatchObject({ items: 2, total: 4, downloaded: 3, unchanged: 1, failed: 0, failures: [] });
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(calls.map((c) => c.url).sort()).toEqual([URLS.robotImg, URLS.tool, URLS.toolImg].sort());
    expect(calls.every((c) => c.headers["user-agent"] === "Enginuity/1.0 (+library mirror)")).toBe(true);
    expect(existsSync(stale)).toBe(false);
    const m = readManifest()!;
    expect(Object.keys(m.files).sort()).toEqual(["files/library-robots/UR5e.robot", "files/library-tools/Grip.tool", "images/robot/img/UR5e.png", "images/robotlib/tools/Grip.png"]);
    expect(m.files["files/library-tools/Grip.tool"]).toMatchObject({ bytes: 10, sha256: sha("tool-bytes"), etag: `"${sha("tool-bytes")}"`, lastModified: "Wed, 04 Nov 2026 17:24:44 GMT" });
    expect(m.files["files/library-robots/UR5e.robot"]).toMatchObject({ bytes: 11, sha256: sha("robot-bytes") });
    expect(m).toMatchObject({ items: 2, failures: [] });
    expect(m.completedAt).toBeTruthy();
    expect(existsSync(path.join(lib, "mirror.lock"))).toBe(false);
    expect(mirrorSummary()).toMatchObject({ items: 2, files: 2, images: 2, mirrored: true, offlineOnly: false });
     
    calls.length = 0;
    expect(await mirrorLibrary({ retryDelayMs: 1 })).toMatchObject({ downloaded: 0, unchanged: 4 });
    expect(calls).toEqual([]);
  });

  it("refresh re-reads the catalog and revalidates every file with conditional requests", async () => {
    put("catalog.json", JSON.stringify(ENTRIES));
    const calls = fakeCdn({ ...CDN_FILES, [URLS.bundle]: BUNDLE });
    await mirrorLibrary({ retryDelayMs: 1 });
    calls.length = 0;
    const r = await mirrorLibrary({ refresh: true, retryDelayMs: 1 });
    expect(r).toMatchObject({ items: 2, downloaded: 0, unchanged: 4, failed: 0 });
    expect(calls[0]).toMatchObject({ url: URLS.bundle });
    expect(calls.slice(1).map((c) => [c.url, c.headers["if-none-match"]]).sort()).toEqual(
      Object.entries(CDN_FILES)
        .map(([url, body]) => [url, `"${sha(body)}"`])
        .sort(),
    );
    expect(existsSync(path.join(lib, "bundlerdklib.js"))).toBe(true);
    expect((await libraryCatalog()).map((e) => e.file)).toEqual(["Grip.tool", "UR5e.robot"]);
  });

  it("retries server errors and truncated bodies, and records failures without stopping", async () => {
    put("catalog.json", JSON.stringify(ENTRIES));
    const { [URLS.tool]: _missing, ...files } = CDN_FILES;
    void _missing;
    fakeCdn(files, [URLS.robot]);
    const r = await mirrorLibrary({ retryDelayMs: 1 });
    expect(r).toMatchObject({ downloaded: 3, failed: 1 });
    expect(r.failures).toEqual([{ path: "files/library-tools/Grip.tool", url: URLS.tool, error: "HTTP 404" }]);
    expect(readManifest()!.failures).toEqual(r.failures);
    expect(readManifest()!.files["files/library-robots/UR5e.robot"].sha256).toBe(sha("robot-bytes"));
  });

  it("verify re-hashes the mirror and drops missing or corrupt files so the next run fetches them", async () => {
    put("catalog.json", JSON.stringify(ENTRIES));
    fakeCdn(CDN_FILES);
    await mirrorLibrary({ retryDelayMs: 1 });
    noNetwork();
    expect(verifyMirror()).toEqual({ checked: 4, ok: 4, missing: [], corrupt: [], notMirrored: 0 });
    writeFileSync(path.join(lib, "files/library-robots/UR5e.robot"), "tampered!!!");
    rmSync(path.join(lib, "images/robotlib/tools/Grip.png"));
    expect(verifyMirror()).toEqual({ checked: 4, ok: 2, missing: ["images/robotlib/tools/Grip.png"], corrupt: ["files/library-robots/UR5e.robot"], notMirrored: 2 });
    expect(existsSync(path.join(lib, "files/library-robots/UR5e.robot"))).toBe(false);
    expect(readManifest()!.completedAt).toBeUndefined();
  });

  it("ROBOCRAFT_LIBRARY_OFFLINE=1 never touches the network and names what is missing", async () => {
    process.env.ROBOCRAFT_LIBRARY_OFFLINE = "1";
    const fetch = noNetwork();
    await expect(libraryCatalog()).rejects.toThrow("The robot library catalog is not in the offline mirror (ROBOCRAFT_LIBRARY_OFFLINE=1). Run `npm run library:mirror` once while online.");
    mirrored();
     
    expect(await libraryCatalog(true)).toHaveLength(2);
    await expect(libraryDownload("Missing.robot", "robot")).rejects.toThrow("Missing.robot is not in the offline robot library (ROBOCRAFT_LIBRARY_OFFLINE=1)");
    const res = await image(["robot", "img", "Missing.png"]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Thumbnail not in the offline robot library: robot/img/Missing.png" });
    await expect(mirrorLibrary()).rejects.toThrow("Mirroring needs the network: unset ROBOCRAFT_LIBRARY_OFFLINE");
    expect(mirrorSummary()).toMatchObject({ offlineOnly: true, mirrored: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("library.mirror and library.mirrorStatus are agent tools backed by the server mirror", async () => {
    const e = await engine();
    const mirror = vi.fn(() => ({ state: "running" }));
    e.services.library!.mirror = mirror;
    e.services.library!.mirrorStatus = () => ({ state: "idle", items: 2165 });
    expect(await e.run("library.mirror", {}, "agent")).toEqual({ state: "running" });
    expect(mirror).toHaveBeenCalledWith({ refresh: false, concurrency: 2 });
    expect(await e.run("library.mirrorStatus", {}, "agent")).toEqual({ state: "idle", items: 2165 });
    const res = await e.tryRun("library.mirror", { concurrency: 9 }, "agent");
    expect(res.ok).toBe(false);
  });
});
