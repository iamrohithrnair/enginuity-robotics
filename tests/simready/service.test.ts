// Verifies SimReady cache path safety, download retries, conversion reuse, and thumbnails.
 
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hfAssetFiles, resetListingMemo } from "@/server/simready/files";
import { checkId, checkRelPath, httpConfig } from "@/server/simready/http";
import { createSimReadyService } from "@/server/simready/service";
import type { ConvertedAsset } from "@/server/simready/usd";

const root = mkdtempSync(path.join(tmpdir(), "simready-svc-"));
const env = { ...process.env };
httpConfig.backoffMs = 1;
let dir = root;
let n = 0;

beforeEach(() => {
  dir = path.join(root, `t${++n}`);
  process.env.ENGINUITY_SIMREADY_DIR = dir;
  delete process.env.ENGINUITY_SIMREADY_OFFLINE;
  resetListingMemo();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...env };
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ID = "box_test_a01";
const ROOT = `simready_usd/sm_${ID}_01.usd`;
const FILES: Record<string, string> = {
  [ROOT]: "#usda 1.0\n(subLayers = [@payloads/base.usda@])\n",
  "simready_usd/payloads/base.usda": "#usda 1.0\ndef Mesh \"m\" {}\n",
  ".metadata/com.nvidia.simready.root_usds.json": JSON.stringify({ entries: [ROOT] }),
};

 
function fakeHub(opts: { fail?: number; wrongSize?: boolean; extra?: Record<string, Uint8Array> } = {}) {
  const calls: string[] = [];
  let fail = opts.fail ?? 0;
  const bytes = (rel: string) => opts.extra?.[rel] ?? new TextEncoder().encode(FILES[rel]);
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes(`/tree/main/${ID}?recursive=true`))
      return Response.json(
        Object.keys({ ...FILES, ...opts.extra }).map((rel) => ({ type: "file", path: `${ID}/${rel}`, size: bytes(rel).length, ...(rel.endsWith(".usd") ? { lfs: { oid: "abc123", size: bytes(rel).length } } : {}) })),
      );
    const m = /\/resolve\/main\/([^/]+)\/(.+)$/.exec(url);
    if (!m) return new Response("not found", { status: 404 });
    const rel = m[2].split("/").map(decodeURIComponent).join("/");
    if (m[1] !== ID || !(rel in FILES || (opts.extra && rel in opts.extra))) return new Response("not found", { status: 404 });
    if (fail > 0) {
      fail--;
      return new Response("busy", { status: 503 });
    }
    const b = bytes(rel);
    return new Response(new Uint8Array(opts.wrongSize ? b.slice(1) : b));
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fileCalls: () => calls.filter((c) => c.includes("/resolve/")).length };
}

describe("ids and paths", () => {
  it("rejects anything that could leave the cache folder", () => {
    for (const bad of ["../x", "/etc/passwd", "a/../../b", "C:/x", "..", "", "a\0b"]) expect(() => checkRelPath(bad)).toThrow(/Invalid SimReady file path/);
    expect(checkRelPath("simready_usd/./payloads/base.usda")).toBe("simready_usd/payloads/base.usda");
    for (const bad of ["../x", "a/b", "..", "", "a b"]) expect(() => checkId(bad)).toThrow(/Invalid SimReady asset id/);
    expect(checkId("box_corrugated_brown_b20")).toBe("box_corrugated_brown_b20");
  });
});

describe("asset files", () => {
  it("downloads a file once, then reads the cache; stat and list come from the listing", async () => {
    const hub = fakeHub();
    const files = hfAssetFiles(ID);
    expect(new TextDecoder().decode((await files.get(ROOT))!)).toContain("subLayers");
    expect(existsSync(path.join(dir, "assets", ID, ...ROOT.split("/")))).toBe(true);
    await files.get(ROOT);
    expect(hub.fileCalls()).toBe(1);
    expect(await files.stat!(ROOT)).toEqual({ size: FILES[ROOT].length, sha256: "abc123" });
    expect((await files.list!()).sort()).toEqual(Object.keys(FILES).sort());
     
    expect(await files.get("simready_usd/missing.usda")).toBeNull();
    expect(hub.fileCalls()).toBe(1);
    await expect(files.get("../../etc/passwd")).rejects.toThrow(/Invalid SimReady file path/);
  });

  it("retries 503s, checks sizes and shares concurrent downloads", async () => {
    const hub = fakeHub({ fail: 2 });
    const files = hfAssetFiles(ID);
    const [a, b] = await Promise.all([files.get(ROOT), files.get(ROOT)]);
    expect(a).toEqual(b);
     
    expect(hub.fileCalls()).toBe(3);
    resetListingMemo();
    process.env.ENGINUITY_SIMREADY_DIR = path.join(dir, "other");
    const bad = fakeHub({ wrongSize: true });
    await expect(hfAssetFiles(ID).get(ROOT)).rejects.toThrow(/size/);
    expect(bad.fileCalls()).toBe(3);
  });

  it("offline: cache only, naming the missing asset", async () => {
    process.env.ENGINUITY_SIMREADY_OFFLINE = "1";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(hfAssetFiles("pallet_wood_a01").get(ROOT)).rejects.toThrow(/pallet_wood_a01.*not in the local cache/);
    expect(f).not.toHaveBeenCalled();
  });
});

const tri = (z: number) => Float32Array.from([0, 0, z, 100, 0, z, 0, 100, z]);
const converted = (): ConvertedAsset => ({
  parts: [
    { triangles: tri(0), color: [0.6, 0.4, 0.2, 1], normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
    { triangles: tri(50) },
  ],
  triangles: 2,
  bbox: { min: [0, 0, 0], max: [100, 100, 50] },
  metersPerUnit: 0.01,
  upAxis: "Y",
  physics: { mass: 1.5, dynamicFriction: 0.4 },
  files: [ROOT, "simready_usd/payloads/base.usda"],
  warnings: ["no textures"],
});

describe("service", () => {
  it("prepares once (root from root_usds.json), then serves the conversion cache", async () => {
    fakeHub();
    const convert = vi.fn(async (rootUsd: string, files: { get(p: string): Promise<Uint8Array | null> }, opts?: { onProgress?(p: { phase: "geometry"; file?: string }): void }) => {
      expect(rootUsd).toBe(ROOT);
      await files.get(rootUsd);
      await files.get("simready_usd/payloads/base.usda");
      opts?.onProgress?.({ phase: "geometry", file: "simready_usd/payloads/base.usda" });
      return converted();
    });
    const svc = createSimReadyService(convert as never);
    const [a, b] = await Promise.all([svc.prepare(ID), svc.prepare(ID)]);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(a.cached).toBe(false);
    expect(a.downloadedBytes).toBeGreaterThan(0);
    expect(b.triangles).toBe(2);
    expect(a.size).toEqual([100, 100, 50]);
    expect(a.bytes).toBe(FILES[ROOT].length + FILES["simready_usd/payloads/base.usda"].length);
    expect(existsSync(path.join(dir, "assets", ID, ".enginuity-v1.json"))).toBe(true);
    const c = await svc.prepare(ID);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(c.cached).toBe(true);
    expect(c.downloadedBytes).toBe(0);
    expect(c.name).toBe("Box Test A01");
    expect(c.physics).toEqual({ mass: 1.5, dynamicFriction: 0.4 });
    expect(Array.from(c.parts[0].triangles)).toEqual(Array.from(tri(0)));
    expect(Array.from(c.parts[0].normals!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(c.parts[0].color).toEqual([0.6, 0.4, 0.2, 1]);
    expect(c.parts[1].normals).toBeUndefined();
     
    expect(c.parts[0].triangles).not.toBe((await svc.prepare(ID)).parts[0].triangles);
    const st = svc.status();
    expect(st.jobs).toEqual([]);
    expect(st.cache).toMatchObject({ assets: 1, prepared: 1, dir });
    expect(st.cache.bytes).toBeGreaterThan(0);
  });

  it("reports conversion failures and keeps nothing", async () => {
    fakeHub();
    const svc = createSimReadyService((async () => {
      throw new Error("bad layer");
    }) as never);
    await expect(svc.prepare(ID)).rejects.toThrow(/Could not convert SimReady asset "box_test_a01": bad layer/);
    expect(existsSync(path.join(dir, "assets", ID, ".enginuity-v1.json"))).toBe(false);
    expect(svc.status().recent[0]).toMatchObject({ asset: ID, ok: false });
  });

  it("makes WebP thumbnails from the dataset render and caches them", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 256, height: 256, channels: 3, background: "#c08040" } }).png().toBuffer());
    const hub = fakeHub({ extra: { [`simready_usd/.thumbs/256x256/sm_${ID}_01.usd.png`]: png } });
    const svc = createSimReadyService((async () => converted()) as never);
    const img = await svc.thumbnail(ID, 100);
    const meta = await sharp(img).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([100, 100]);
    await svc.thumbnail(ID, 100);
    expect(hub.fileCalls()).toBe(1);
    expect(existsSync(path.join(dir, "thumbs", `${ID}-100.webp`))).toBe(true);
    await expect(svc.thumbnail("pallet_nothumb_a01", 100)).rejects.toThrow(/has no thumbnail/);
  });
});
