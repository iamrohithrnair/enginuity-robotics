// Verifies SimReady loading, object placement, physics metadata, and search commands.
import { describe, expect, it, vi } from "vitest";
import type { SimReadyPrepared } from "@/engine/registry";
import { engine } from "../helpers";

const prepared = (cached: boolean): SimReadyPrepared => ({
  id: "box_corrugated_brown_b20",
  name: "Box Corrugated Brown B20",
  category: "box",
  parts: [
    { triangles: Float32Array.from([0, 0, 0, 300, 0, 0, 0, 200, 0]), color: [0.6, 0.45, 0.3, 1], normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
    { triangles: Float32Array.from([0, 0, 250, 300, 0, 250, 0, 200, 250]) },
  ],
  triangles: 2,
  bbox: { min: [0, 0, 0], max: [300, 200, 250] },
  size: [300, 200, 250],
  physics: { mass: 0.8, dynamicFriction: 0.5 },
  warnings: [],
  cached,
  downloadedBytes: cached ? 0 : 12345,
  bytes: 12345,
  ms: 1,
});

async function withService() {
  const e = await engine();
  let calls = 0;
  const prepare = vi.fn(async () => prepared(calls++ > 0));
  e.services.simready = {
    search: async (q) => ({
      total: 1,
      items: [{ id: "box_corrugated_brown_b20", name: "Box Corrugated Brown B20", category: "box", tags: ["box"] }].filter(() => !q.query || "box".includes(q.query)),
      categories: [{ value: "box", count: 1 }],
    }),
    prepare,
    status: () => ({ jobs: [], cache: { assets: 1, bytes: 1, dir: "/tmp" } }),
  };
  return { ...e, prepare };
}

describe("simready commands", () => {
  it("simready.load adds one selected object with normals, physics and attribution", async () => {
    const { ws, run, undo, prepare } = await withService();
    const r = await run("simready.load", { asset: "box_corrugated_brown_b20", xyzrpw: [100, 0, 0, 0, 0, 0] });
    expect(prepare).toHaveBeenCalledWith("box_corrugated_brown_b20", {});
    expect(r).toMatchObject({ name: "Box Corrugated Brown B20", asset: "box_corrugated_brown_b20", triangles: 2, size: [300, 200, 250], cached: false, downloadedBytes: 12345, attribution: "NVIDIA SimReady Assets · CC BY 4.0" });
    expect(r.physics).toEqual({ mass: 0.8, friction: 0.5 });
    const item = ws.items[r.id as string];
    expect(item.type).toBe("object");
    expect(item.object?.source).toBe("simready/box_corrugated_brown_b20");
    expect(item.object?.meshes).toHaveLength(2);
    expect(item.object?.meshes[0].normals).toBeTruthy();
    expect(item.object?.meshes[1].normals).toBeUndefined();
    expect(item.object?.meshes[1].color).toEqual([0.86, 0.87, 0.9, 1]);
    expect(item.physics).toEqual({ mass: 0.8, friction: 0.5 });
    expect(item.pose[3]).toBe(100);
    expect(JSON.stringify(undo.list())).toContain("Add: Box Corrugated Brown B20");
     
    const again = await run("simready.load", { asset: "box_corrugated_brown_b20", name: "Box 2", textures: false });
    expect(prepare).toHaveBeenLastCalledWith("box_corrugated_brown_b20", { textures: false });
    expect(again).toMatchObject({ name: "Box 2", cached: true, downloadedBytes: 0 });
     
    expect((undo.list() as { undo: string[] }).undo.slice(-2)).toEqual(["Add: Box 2", "Add SimReady Asset"]);
    undo.undo();
    undo.undo();
    expect(ws.items[again.id as string]).toBeUndefined();
    expect(ws.items[r.id as string]).toBeTruthy();
  });

  it("rests assets whose origin is at their top on the parent's XY plane (unless rest: false)", async () => {
    const { ws, run, services } = await withService();
    services.simready!.prepare = async () => ({ ...prepared(true), bbox: { min: [-300, -200, -253], max: [300, 200, 0] } });
    const a = await run("simready.load", { asset: "crate_blue_a01", xyzrpw: [800, 0, 10, 0, 0, 0] });
    expect(ws.items[a.id as string].pose[11]).toBeCloseTo(263);
    const b = await run("simready.load", { asset: "crate_blue_a01" });
    expect(ws.items[b.id as string].pose[11]).toBeCloseTo(253);
    const c = await run("simready.load", { asset: "crate_blue_a01", xyzrpw: [800, 0, 10, 0, 0, 0], rest: false });
    expect(ws.items[c.id as string].pose[11]).toBeCloseTo(10);
  });

  it("simready.search and simready.status answer from the service", async () => {
    const { run } = await withService();
    const s = await run("simready.search", { query: "box" });
    expect(s).toEqual({ total: 1, items: [{ id: "box_corrugated_brown_b20", name: "Box Corrugated Brown B20", category: "box" }], categories: [{ value: "box", count: 1 }], source: "NVIDIA SimReady Assets (CC BY 4.0)" });
    expect(await run("simready.status")).toMatchObject({ jobs: [] });
  });

  it("needs the server", async () => {
    const { tryRun, services } = await engine();
    delete services.simready;
    const r = await tryRun("simready.load", { asset: "box_corrugated_brown_b20" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SimReady assets are only available on the server");
  });
});
