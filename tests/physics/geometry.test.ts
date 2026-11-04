 
 
import { describe, expect, it } from "vitest";
import { AUTO, decide, type Candidate, type Relations } from "@/engine/physics/classify";
import { detectPrimitive, weld } from "@/engine/physics/geometry";
import { hullFaces, quadrangulate, sphereDirections, supportPoints } from "@/engine/physics/hull";
import { boxMesh, cylinderMesh, sphereMesh } from "@/engine/meshio";

const unique = (tri: Float32Array) => {
  const w = weld(tri);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < w.count; i++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], w.vertices[i * 3 + k]);
      max[k] = Math.max(max[k], w.vertices[i * 3 + k]);
    }
  return { ...w, min, max };
};

describe("mesh analysis", () => {
  it("welds a triangle soup into shared vertices", () => {
    const w = weld(boxMesh(100, 200, 300));
    expect(w.count).toBe(8);
    expect(w.indices.length).toBe(36);
  });

  it("recognises Enginuity's box, cylinder and sphere shapes with their dimensions", () => {
    const b = unique(boxMesh(100, 200, 300));
    expect(detectPrimitive(b.vertices, b.count, b.min, b.max)).toEqual({ kind: "box", center: [0, 0, 150], half: [50, 100, 150] });
    const c = unique(cylinderMesh(120, 250));
    const cp = detectPrimitive(c.vertices, c.count, c.min, c.max);
    expect(cp?.kind).toBe("cylinder");
    if (cp?.kind === "cylinder") {
      expect(cp.axis).toBe(2);
      expect(cp.radius).toBeCloseTo(120, 3);
      expect(cp.halfHeight).toBeCloseTo(125, 3);
      expect(cp.center[2]).toBeCloseTo(125, 3);
    }
    const s = unique(sphereMesh(80));
    const sp = detectPrimitive(s.vertices, s.count, s.min, s.max);
    expect(sp?.kind).toBe("sphere");
    if (sp?.kind === "sphere") expect(sp.radius).toBeCloseTo(80, 2);
  });

  it("does not take a coarse prism or a sheared box for a primitive", () => {
    const hex = unique(cylinderMesh(100, 50, 6));
    expect(detectPrimitive(hex.vertices, hex.count, hex.min, hex.max)).toBeNull();
    const tri = boxMesh(100, 100, 100);
    for (let i = 0; i < tri.length; i += 3) if (tri[i + 2] > 50) tri[i] += 30;  
    const sh = unique(tri);
    expect(detectPrimitive(sh.vertices, sh.count, sh.min, sh.max)).toBeNull();
  });
});

describe("hulls", () => {
  it("support points span a dense mesh's hull to within 0.25 % of its radius", () => {
     
    const n = 40000;
    const v = new Float32Array(n * 3);
    const dirs = sphereDirections(n);
    for (let i = 0; i < n; i++) {
      v[i * 3] = 300 * dirs[i * 3];
      v[i * 3 + 1] = 200 * dirs[i * 3 + 1];
      v[i * 3 + 2] = 120 * dirs[i * 3 + 2];
    }
    const sp = supportPoints(v, 1024);
    expect(sp.length / 3).toBeLessThanOrEqual(1024 + 6);
     
    const bound = 0.0025 * 300;
     
    const test = sphereDirections(997);
    for (let d = 0; d < 997; d++) {
      const [x, y, z] = [test[d * 3], test[d * 3 + 1], test[d * 3 + 2]];
      let full = -Infinity;
      let red = -Infinity;
      for (let i = 0; i < n; i++) full = Math.max(full, v[i * 3] * x + v[i * 3 + 1] * y + v[i * 3 + 2] * z);
      for (let i = 0; i < sp.length / 3; i++) red = Math.max(red, sp[i * 3] * x + sp[i * 3 + 1] * y + sp[i * 3 + 2] * z);
      expect(full - red).toBeLessThanOrEqual(bound);
    }
  });

  it("quadrangulate leaves no face with more than four vertices on a round base", () => {
     
    const n = 8;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(Math.cos((i / n) * 2 * Math.PI) * 0.1, Math.sin((i / n) * 2 * Math.PI) * 0.1, 0);
    for (let i = 0; i < n; i++) pts.push(Math.cos((i / n) * 2 * Math.PI) * 0.1, Math.sin((i / n) * 2 * Math.PI) * 0.1, 0.3);
    const idx: number[] = [];
    for (let i = 1; i + 1 < n; i++) idx.push(0, i + 1, i, n, n + i, n + i + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(i, j, n + j, i, n + j, n + i);
    }
    const hull = { vertices: Float32Array.from(pts), indices: Uint32Array.from(idx) };
    expect(hullFaces(hull).filter((f) => f.verts.length > 4)).toHaveLength(2);
    const moved = quadrangulate(hull)!;
     
    const zs = [...Array(2 * n).keys()].map((i) => moved[i * 3 + 2]);
    expect(zs.slice(0, n).filter((zz) => zz === 0)).toHaveLength(4);
    expect(zs.slice(n).filter((zz) => Math.abs(zz - 0.3) < 1e-7)).toHaveLength(4);
    expect(zs.slice(0, n).every((zz) => zz >= 0 && zz < 0.003)).toBe(true);
  });
});

describe("the Auto rule", () => {
   
  const cand = (key: string, size: number, extra: Partial<Candidate> = {}): Candidate => ({ key, name: key, mode: "auto", size, volume: (size / 1000) ** 3 / 3, locked: false, ...extra });
  const rel = (r: Partial<{ pen: Record<string, Record<string, number>>; touch: Record<string, string[]>; below: Record<string, string[]>; overlap: Record<string, Record<string, number>> }>): Relations => ({
    pen: new Map(Object.entries(r.pen ?? {}).map(([k, v]) => [k, new Map(Object.entries(v))])),
    touch: new Map(Object.entries(r.touch ?? {}).map(([k, v]) => [k, new Set(v)])),
    below: new Map(Object.entries(r.below ?? {}).map(([k, v]) => [k, new Set(v)])),
    overlap: new Map(Object.entries(r.overlap ?? {}).map(([k, v]) => [k, new Map(Object.entries(v))])),
  });
  const floor = { key: "floor", name: "the floor", role: "floor" as const };

  it("a table carrying parts is Static; the parts are Dynamic and rest on it", () => {
    const d = decide([cand("Table", 1200), cand("P1", 100), cand("P2", 80)], [floor], rel({ below: { Table: ["floor"], P1: ["Table"], P2: ["Table"] } }));
    expect(d.get("Table")).toEqual({ role: "static", reason: "supports 2 parts", ignore: [] });
    expect(d.get("P1")).toEqual({ role: "dynamic", reason: "rests on Table", ignore: [] });
  });

  it("boxes of one size stacked stay Dynamic (only a clearly larger supporter is a fixture)", () => {
    const d = decide([cand("A", 300), cand("B", 300)], [floor], rel({ below: { A: ["floor"], B: ["A"] } }));
    expect(d.get("A")?.role).toBe("dynamic");
    expect(d.get("B")?.reason).toBe("rests on A");
    expect(300 / 300).toBeLessThan(AUTO.supporterRatio);
  });

  it("large, locked, embedded, robot-carrying and mounted objects are Static; floating ones fall", () => {
    const others = [floor, { key: "R#0", name: "Robot base", role: "kinematic" as const, robotBase: true }, { key: "Wall", name: "Wall", role: "static" as const }];
    const d = decide(
      [cand("Fence", 2400), cand("Locked", 100, { locked: true }), cand("Sunk", 100), cand("Pedestal", 500), cand("Lamp", 200), cand("Loose", 100)],
      others,
      rel({ pen: { Sunk: { Wall: 5 } }, touch: { Lamp: ["Wall"] }, below: { "R#0": ["Pedestal"], Pedestal: ["floor"] } }),
    );
    expect(d.get("Fence")?.reason).toBe("large: 2.4 m");
    expect(d.get("Locked")?.reason).toBe("locked");
    expect(d.get("Sunk")?.reason).toBe("penetrates Wall");
    expect(d.get("Pedestal")?.reason).toBe("carries Robot base");
    expect(d.get("Lamp")?.reason).toBe("mounted on Wall");
    expect(d.get("Loose")).toEqual({ role: "dynamic", reason: "floating", ignore: [] });
  });

  it("a bin whose hull would swallow its parts is Static; two parts modelled overlapping ignore each other", () => {
    const d = decide(
      [cand("Bin", 600), cand("Part", 80), cand("A", 100), cand("B", 100)],
      [floor],
      rel({ pen: { Bin: { Part: 60 }, A: { B: 20 }, B: { A: 20 } }, below: { Bin: ["floor"], Part: ["Bin"] } }),
    );
    expect(d.get("Bin")?.role).toBe("static");
    expect(d.get("A")).toEqual({ role: "dynamic", reason: "floating", ignore: ["B"] });
    expect(d.get("B")?.ignore).toEqual(["A"]);
  });

  it("a jig modelled around its part holds it; a rack carrying two windshields is a fixture; tall stacks keep their top layers loose", () => {
    const at = (z0: number, z1: number, x0 = 0, x1 = 500): Candidate["box"] => ({ min: [x0, 0, z0], max: [x1, 500, z1] });
    const d = decide(
      [cand("Jig", 550, { box: at(2, 202) }), cand("Part", 550, { box: at(32, 207) })],
      [floor],
      rel({ pen: { Jig: { Part: 64 }, Part: { Jig: 64 } }, below: { Jig: ["floor"], Part: ["Jig"] } }),
    );
    expect(d.get("Jig")?.reason).toBe("holds Part");
    expect(d.get("Part")?.reason).toBe("penetrates Jig");
    const rack = decide(
      [cand("Rack", 1500, { box: at(0, 1400), volume: 0.3 }), cand("W1", 1500, { box: at(100, 1300), volume: 0.05 }), cand("W2", 1500, { box: at(100, 1300), volume: 0.05 })],
      [floor],
      rel({ below: { Rack: ["floor"], W1: ["Rack"], W2: ["Rack"] } }),
    );
    expect(rack.get("Rack")?.reason).toBe("supports 2 parts");
     
    const plates = Array.from({ length: 8 }, (_, i) => cand(`P${i}`, 500, { box: at(i * 2, i * 2 + 2) }));
    const below: Record<string, string[]> = { P0: ["floor"] };
    for (let i = 1; i < 8; i++) below[`P${i}`] = [`P${i - 1}`];
    const m = decide(plates, [floor], rel({ below }));
    expect([...Array(8).keys()].map((i) => m.get(`P${i}`)?.role)).toEqual(["static", "static", "static", "static", "dynamic", "dynamic", "dynamic", "dynamic"]);
    expect(m.get("P0")?.reason).toBe("under a stack of 7 parts");
  });

  it("parts overlapping side by side ignore each other instead of freezing the whole cluster", () => {
    const at = (x: number): Candidate["box"] => ({ min: [x, 0, 0], max: [x + 50, 50, 40] });
    const d = decide(
      [cand("Big", 2400, { box: at(-100) }), cand("A", 50, { box: at(0) }), cand("B", 50, { box: at(40) })],
      [floor],
      rel({ pen: { A: { Big: 10, B: 10 }, B: { A: 10 } }, overlap: { A: { B: 10 }, B: { A: 10 } }, below: { A: ["floor"], B: ["floor"] } }),
    );
     
    expect(d.get("A")?.reason).toBe("penetrates Big");
    expect(d.get("B")?.role).toBe("dynamic");
  });

  it("a part released by a tool falls and ignores the tool until it is clear of it", () => {
    const d = decide([cand("Part", 80, { released: true, carrier: "Gripper" })], [floor, { key: "Gripper", name: "Gripper", role: "kinematic" }], rel({ pen: { Part: { Gripper: 8 } }, touch: { Part: ["Gripper"] } }));
    expect(d.get("Part")).toEqual({ role: "dynamic", reason: "released", ignore: ["Gripper"] });
  });
});
