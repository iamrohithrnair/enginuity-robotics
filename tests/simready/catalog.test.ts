 
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryOf, parseRootListing, prettyName, resetCatalogMemo, searchSimReady, simreadyCatalog } from "@/server/simready/catalog";
import { httpConfig } from "@/server/simready/http";

const dir = mkdtempSync(path.join(tmpdir(), "simready-cat-"));
const env = { ...process.env };
httpConfig.backoffMs = 1;

beforeEach(() => {
  process.env.ENGINUITY_SIMREADY_DIR = dir;
  delete process.env.ENGINUITY_SIMREADY_OFFLINE;
  resetCatalogMemo();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...env };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const dirs = (...ids: string[]) => ids.map((p) => ({ type: "directory", oid: "x", size: 0, path: p }));

describe("names and categories", () => {
  it("pretty-prints folder names and keeps variant codes and acronyms", () => {
    expect(prettyName("box_corrugated_brown_b20")).toBe("Box Corrugated Brown B20");
    expect(prettyName("conveyor_belt_a47")).toBe("Conveyor Belt A47");
    expect(prettyName("CT_injection_system_a01")).toBe("CT Injection System A01");
    expect(prettyName("IV_pole_a01")).toBe("IV Pole A01");
    expect(prettyName("engineComponent_engine_oil_pan_d01")).toBe("Engine Component Engine Oil Pan D01");
    expect(entryOf("handTool_hammer_a01")).toEqual({ id: "handTool_hammer_a01", name: "Hand Tool Hammer A01", category: "handTool", tags: ["hand", "tool", "hammer"] });
  });

  it("lists directories only (no files, no dot folders)", () => {
    const e = parseRootListing([...dirs("pallet_wood_a01", ".github", "box_a01"), { type: "file", path: "README.md" }, { type: "file", path: ".gitattributes" }]);
    expect(e.map((x) => x.id)).toEqual(["box_a01", "pallet_wood_a01"]);
  });
});

describe("catalog cache", () => {
  it("follows the Link pagination, caches catalog.json and serves the stale cache offline", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("cursor=2")) return Response.json([...dirs("pallet_wood_a01"), { type: "file", path: "README.md" }]);
      return new Response(JSON.stringify(dirs("box_corrugated_brown_b20", "box_a01")), {
        headers: { "content-type": "application/json", link: '<https://huggingface.co/api/datasets/nvidia/simready-assets/tree/main?limit=1000&cursor=2>; rel="next"' },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cat = await simreadyCatalog();
    expect(cat.entries.map((e) => e.id)).toEqual(["box_a01", "box_corrugated_brown_b20", "pallet_wood_a01"]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/api/datasets/nvidia/simready-assets/tree/main?limit=1000");
    expect(existsSync(path.join(dir, "catalog.json"))).toBe(true);
     
    await simreadyCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
     
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    resetCatalogMemo();
    const stale = await simreadyCatalog(true);
    expect(stale.entries).toHaveLength(3);
    expect(stale.stale).toMatch(/HTTP 503/);
  });

  it("refreshes a catalog older than 7 days and never fetches offline", async () => {
    writeFileSync(path.join(dir, "catalog.json"), JSON.stringify({ fetchedAt: "2020-01-01T00:00:00Z", entries: [entryOf("old_a01")] }));
    process.env.ENGINUITY_SIMREADY_OFFLINE = "1";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await simreadyCatalog()).entries[0].id).toBe("old_a01");
    expect(f).not.toHaveBeenCalled();
    delete process.env.ENGINUITY_SIMREADY_OFFLINE;
    resetCatalogMemo();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(dirs("new_a01"))));
    expect((await simreadyCatalog()).entries.map((e) => e.id)).toEqual(["new_a01"]);
    expect(JSON.parse(readFileSync(path.join(dir, "catalog.json"), "utf8")).entries[0].id).toBe("new_a01");
  });
});

describe("search", () => {
  const entries = ["cardboard_box_a01", "box_corrugated_brown_b20", "box_a01", "pallet_wood_a01", "pallet_plastic_box_a02", "conveyor_belt_a47"].map(entryOf);

  it("ranks exact and prefix matches first and counts categories", () => {
    const r = searchSimReady(entries, { query: "box" });
    expect(r.total).toBe(4);
    expect(r.items.slice(0, 2).map((e) => e.id)).toEqual(["box_a01", "box_corrugated_brown_b20"]);
    expect(r.categories).toEqual([
      { value: "box", count: 2 },
      { value: "cardboard", count: 1 },
      { value: "pallet", count: 1 },
    ]);
    expect(searchSimReady(entries, { query: "BOX_CORRUGATED_BROWN_B20" }).items[0].id).toBe("box_corrugated_brown_b20");
     
    expect(searchSimReady(entries, { query: "brown corrugated" }).items.map((e) => e.id)).toEqual(["box_corrugated_brown_b20"]);
  });

  it("filters by category and pages", () => {
    expect(searchSimReady(entries, { category: "Pallet" }).items.map((e) => e.id)).toEqual(["pallet_plastic_box_a02", "pallet_wood_a01"]);
    const page = searchSimReady(entries, { limit: 2, offset: 2 });
    expect(page.total).toBe(6);
    expect(page.items).toHaveLength(2);
  });
});
