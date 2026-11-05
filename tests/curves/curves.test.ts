// Verifies curve and point creation, projection, import, and editing.
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Item } from "@/engine/types";
import { engine, ROOT } from "../helpers";

type Id = { id: string; name: string };
const probe = JSON.parse(readFileSync(path.join(ROOT, "research/evidence/machining/probe-curves.json"), "utf8"));

async function cell() {
  const e = await engine();
  await e.run("station.new", {});
  const frame = (await e.run("item.addFrame", { name: "Part Frame" })) as unknown as Id;
  await e.run("item.setPose", { item: frame.id, pose: [1, 0, 0, 450, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
  const part = (await e.run("object.addShape", { shape: "box", sizeX: 200, sizeY: 150, sizeZ: 50, parent: frame.id, name: "Part" })) as unknown as Id;
  return { e, frame, part };
}

const round = (rows: number[][], d = 3) => rows.map((r) => r.map((v) => Math.round(v * 10 ** d) / 10 ** d + 0));

describe("AddPoints / AddCurve (frames, names, projection)", () => {
  it("add_to_ref projects along -normal onto the top face; points keep no normals", async () => {
    const { e, part } = await cell();
    await e.run("object.addPoints", { object: part.id, addToRef: true, points: [[-50, 40, 60, 0, 0, 1], [50, 40, 60, 0, 0, 1]] });
     
    expect(round(e.ws.items[part.id].object!.points!)).toEqual([[-50, 40, 50], [50, 40, 50]]);
    expect(probe.getpoints_point0[0].map((r: number[]) => r.slice(0, 3))).toEqual([[-50, 40, 25], [50, 40, 25]]);
  });

  it("a new 'Points' / 'Curve' object goes next to the reference with identity pose", async () => {
    const { e, frame, part } = await cell();
    const pts = (await e.run("object.addPoints", { object: part.id, points: [[-50, 40, 60, 0, 0, 1], [50, 40, 60, 0, 0, 1]] })) as unknown as Id;
    const p = e.ws.items[pts.id];
    expect([p.name, e.ws.items[p.parent!].name]).toEqual(probe.addpoints_newobj_name_parent);
    expect(p.parent).toBe(frame.id);
    expect(round(p.object!.points!)).toEqual(probe.addpoints_newobj_points[0].map((r: number[]) => r.slice(0, 3)));
    const top = [[-80, -30, 50, 0, 0, 1], [0, -30, 50, 0, 0, 1], [80, -30, 50, 0, 0, 1]];
    const c1 = (await e.run("object.addCurve", { object: part.id, points: top })) as unknown as Id;
    const c2 = (await e.run("object.addCurve", { object: part.id, points: top })) as unknown as Id;
    const [name, parent, pose] = probe.addcurve_newobj_name_parent_pose;
    expect([e.ws.items[c1.id].name, e.ws.items[e.ws.items[c1.id].parent!].name]).toEqual([name, parent]);
    expect(e.ws.items[c1.id].pose).toEqual(pose.flat());
    expect(e.ws.items[c2.id].name).toBe(probe.addcurve_newobj2_name);
  });

  it("without a reference the object goes to the station root and the points are kept as given", async () => {
    const { e } = await cell();
    const top = [[-80, -30, 50, 0, 0, 1], [0, -30, 50, 0, 0, 1], [80, -30, 50, 0, 0, 1]];
    const c = (await e.run("object.addCurve", { points: top })) as unknown as Id;
    const it = e.ws.items[c.id];
    const [name, parent, curves] = probe.addcurve_free_name_parent;
    expect(it.name).toBe(name);
    expect(e.ws.items[it.parent!].type).toBe("station");
    expect(parent).toBe("MachProbe");
     
    const cols = curves[0][0] as number[][];
    const rows = cols[0].map((_, j) => cols.map((row) => row[j]));
    expect(round(it.object!.curves![0].points)).toEqual(rows);
    const pts = (await e.run("object.addPoints", { points: [[1, 2, 3, 0, 0, 1]] })) as unknown as Id;
    expect(e.ws.items[pts.id].name).toBe(probe.addpoints_free_name_parent[0]);
  });

  it("CLOSEST projection to an edge reports the lower-index (bottom) face; add_to_ref stores object coordinates", async () => {
    const { e, part } = await cell();
    await e.run("object.addCurve", { object: part.id, addToRef: true, projection: 1, points: [[10, 10, 70, 0, 0, 1], [130, 0, 0, 0, 0, 1]] });
    const got = round(e.ws.items[part.id].object!.curves![0].points);
     
    const cols = probe.curves_after_closest[0][0] as number[][];
    const expected = cols[0].map((_, j) => cols.map((row) => row[j])).map((r) => [r[0], r[1], r[2] + 25, r[3], r[4], r[5]]);
    expect(got).toEqual(expected);
  });
});

describe("ProjectPoints (each PROJECTION_* type)", () => {
  const probePts = [[10, 10, 60, 0, 0, 1], [10, 10, 60, 0, 0, -1], [130, 0, 0, 1, 0, 0], [10, 10, 60, 0.3, 0, 0.954]];
  const parse = (s: string): number[][] => JSON.parse(s);
   
   
  const edgeCase = (t: number, rows: number[][]) => (t === 2 || t === 3 ? rows.filter((_, i) => i !== 2) : rows);
  it.each([0, 1, 2, 4, 5])("type %i matches RoboDK", async (t) => {
    const { e, part } = await cell();
    const r = (await e.run("object.projectPoints", { object: part.id, points: probePts, projection: t })) as unknown as { points: number[][] };
    expect(edgeCase(t, round(r.points))).toEqual(edgeCase(t, round(parse(probe[`project_${t}`]))));
  });
  it("type 3 (along normal + recalculated normal) moves like type 2 and reports the face normal", async () => {
    const { e, part } = await cell();
    const r = (await e.run("object.projectPoints", { object: part.id, points: probePts, projection: 3 })) as unknown as { points: number[][] };
    const two = edgeCase(3, round(parse(probe.project_2)));
     
     
    expect(edgeCase(3, round(r.points)).map((row) => row.slice(0, 3))).toEqual(two.map((row) => row.slice(0, 3)));
    expect(round(r.points)[0].slice(3)).toEqual([0, 0, 1]);
  });
  it("rows without a normal are not projected and come back with (0,0,1)", async () => {
    const { e, part } = await cell();
    const r = (await e.run("object.projectPoints", { object: part.id, points: [[10, 10, 60], [10, 10, -60]] })) as unknown as { points: number[][] };
    expect(round(r.points)).toEqual(round(parse(probe.project_xyz_default)));
  });
});

describe("Import Points / Import Curve", () => {
  it("7 columns: a 7th value > 0 starts a curve, single rows become points (FUN_1003d1144)", async () => {
    const { e } = await cell();
    await e.run("edit.select", { items: [] });
    const text = ["0,0,0,0,0,1,1", "10,0,0,0,0,1,0", "20,0,0,0,0,1,0", "0,50,0,0,0,1,1", "10,50,0,0,0,1,0", "99,99,0,0,0,1,1"].join("\n");
    const r = (await e.run("object.importCurve", { text, fileName: "parts/edges.csv" })) as unknown as { id: string; curves: number; points: number };
    expect([r.curves, r.points]).toEqual([2, 1]);
    const it = e.ws.items[r.id];
    expect(it.name).toBe("edges");
    expect(e.ws.items[it.parent!].type).toBe("station");
    expect(it.object!.curves!.map((c) => c.points.length)).toEqual([3, 2]);
    expect(it.object!.points).toEqual([[99, 99, 0]]);
  });
  it("fewer than 7 columns: the whole table is one curve; headers are skipped", async () => {
    const { e } = await cell();
    await e.run("edit.select", { items: [] });
    const r = (await e.run("object.importCurve", { text: "x,y,z\n1,2,3\n4,5,6\n7,8,9\n", fileName: "c.txt" })) as unknown as { curves: number; points: number; id: string };
    expect([r.curves, r.points]).toEqual([1, 0]);
    expect(e.ws.items[r.id].object!.curves![0].points[1]).toEqual([4, 5, 6, 0, 0, 0]);
  });
  it("reports RoboDK's messages when nothing numeric is found", async () => {
    const { e } = await cell();
    await e.run("edit.select", { items: [] });
    expect((await e.tryRun("object.importCurve", { text: "hello\nworld", fileName: "a.csv" })).error).toBe("No curve found (only text format is accepted)");
    expect((await e.tryRun("object.importPoints", { text: "", fileName: "a.csv" })).error).toBe("No points found (only text format is accepted)");
    expect(Object.values(e.ws.items).filter((i: Item) => i.name === "a")).toHaveLength(0);
  });
  it("Import Points goes into the selected object", async () => {
    const { e, part } = await cell();
    await e.run("edit.select", { items: [part.id] });
    const r = (await e.run("object.importPoints", { text: "1 2 3\n4 5 6\n", fileName: "p.csv" })) as unknown as { id: string; created: boolean };
    expect(r).toMatchObject({ id: part.id, created: false });
    expect(e.ws.items[part.id].object!.points).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
  it("exported curves read back with Import Curve", async () => {
    const { e, part } = await cell();
    await e.run("object.addCurve", { object: part.id, addToRef: true, projection: 0, points: [[0, 0, 0, 0, 0, 1], [10, 0, 0, 0, 0, 1]] });
    await e.run("object.addCurve", { object: part.id, addToRef: true, projection: 0, points: [[0, 20, 0, 0, 0, 1], [10, 20, 0, 0, 0, 1], [20, 20, 0, 0, 0, 1]] });
    const ex = (await e.run("object.exportCurves", { object: part.id })) as unknown as { text: string };
    await e.run("edit.select", { items: [] });
    const back = (await e.run("object.importCurve", { text: ex.text, fileName: "back.csv" })) as unknown as { id: string };
    expect(e.ws.items[back.id].object!.curves!.map((c) => c.points)).toEqual(e.ws.items[part.id].object!.curves!.map((c) => c.points));
  });
});

describe("curve edits", () => {
  it("flip, tilt, split in half, spacing and delete", async () => {
    const { e, part } = await cell();
    await e.run("object.addCurve", { object: part.id, addToRef: true, projection: 0, points: [[0, 0, 0, 0, 0, 1], [100, 0, 0, 0, 0, 1]] });
    await e.run("object.editCurve", { object: part.id, curve: 0, op: "flipNormals" });
    expect(e.ws.items[part.id].object!.curves![0].points[0].slice(3)).toEqual([-0, -0, -1]);
    await e.run("object.editCurve", { object: part.id, curve: 0, op: "tiltNormals", angle: 90 });
     
    expect(round(e.ws.items[part.id].object!.curves![0].points)[0].slice(3)).toEqual([0, 1, 0]);
    await e.run("object.editCurve", { object: part.id, curve: 0, op: "spacing", spacing: 10 });
    expect(e.ws.items[part.id].object!.curves![0].points).toHaveLength(11);
    await e.run("object.editCurve", { object: part.id, curve: 0, op: "splitHalf" });
    expect(e.ws.items[part.id].object!.curves!.map((c) => [c.points[0][0], c.points[c.points.length - 1][0]])).toEqual([[0, 50], [50, 100]]);
    await e.run("object.deleteCurves", { object: part.id, curve: 1 });
    expect(e.ws.items[part.id].object!.curves).toHaveLength(1);
    await e.run("edit.undo", {});
    expect(e.ws.items[part.id].object!.curves).toHaveLength(2);
  });
});
