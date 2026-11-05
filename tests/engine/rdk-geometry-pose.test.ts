// Verifies imported station objects and tools retain their geometry transforms.
 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Mat } from "@/engine/math";
import type { Item } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import { engine, LIBRARY_FILE, ROOT } from "../helpers";

const FILE = [LIBRARY_FILE("stations", "Conveying-with-UR10.rdk"), path.join(ROOT, "research/evidence/slf/rdk", "Conveying-with-UR10.rdk")].find((p) => existsSync(p));

type E = Awaited<ReturnType<typeof engine>>;

 
function bounds(e: E, it: Item, m: Mat): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of it.object?.meshes ?? it.tool?.meshes ?? []) {
    const t = e.services.geometry.get(mesh.geometry)!;
    for (let i = 0; i + 2 < t.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = m[k * 4] * t[i] + m[k * 4 + 1] * t[i + 1] + m[k * 4 + 2] * t[i + 2] + m[k * 4 + 3];
        min[k] = Math.min(min[k], v);
        max[k] = Math.max(max[k], v);
      }
    }
  }
  return { min, max };
}
const I: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const round = (v: number[]) => v.map((x) => Math.round(x) + 0);

describe.skipIf(!FILE)("geometry pose of objects and tools in .rdk station files", () => {
  it("Conveying with UR10: the Europallets lie flat and the parts rest on PalletA's", async () => {
    const e = await engine();
    await e.run("station.openRdk", { base64: readFileSync(FILE!).toString("base64") });
    const all = Object.values(e.ws.items);
    const pallets = all.filter((i) => i.type === "object" && i.name === "Europallet");
    expect(pallets).toHaveLength(2);
    for (const p of pallets) {
       
      const g = ((await e.run("object.geometryPose", { item: p.id })) as unknown as { pose: Mat }).pose;
      expect(round(g)).toEqual([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, -145, 0, 0, 0, 1]);
       
      const local = bounds(e, p, I);
      expect(round(local.min)).toEqual([0, 0, -145]);
      expect(round(local.max)).toEqual([800, 1200, -1]);
       
      const w = bounds(e, p, absPose(e.ws, p.id));
      expect(w.max[2] - w.min[2]).toBeCloseTo(144, 0);
    }

    const palletA = pallets.find((p) => e.ws.items[p.parent!]?.name === "PalletA")!;
    const pa = bounds(e, palletA, absPose(e.ws, palletA.id));
    const parts = all.filter((i) => i.type === "object" && /^Part \d+$/.test(i.name) && i.parent === palletA.parent);
    expect(parts).toHaveLength(18);
    let lowest = Infinity;
    for (const part of parts) {
      expect(part.object?.geometryPose).toBeUndefined();
      const b = bounds(e, part, absPose(e.ws, part.id));
       
      expect(b.min[2]).toBeGreaterThanOrEqual(pa.max[2] - 0.5);
      for (const k of [0, 1]) {
        expect(b.min[k]).toBeGreaterThanOrEqual(pa.min[k] - 1);
        expect(b.max[k]).toBeLessThanOrEqual(pa.max[k] + 1);
      }
      lowest = Math.min(lowest, b.min[2]);
    }
     
    expect(lowest - pa.max[2]).toBeGreaterThanOrEqual(0);
    expect(lowest - pa.max[2]).toBeLessThan(2);
  });

  it("tools carry theirs too: GripperA's geometry pose undoes its column 2 (92, 35, 29.5 mm, Rx 90°)", async () => {
    const e = await engine();
    await e.run("station.openRdk", { base64: readFileSync(FILE!).toString("base64") });
    const gripper = Object.values(e.ws.items).find((i) => i.type === "tool" && i.name === "GripperA")!;
    const g = gripper.tool!.geometryPose!;
    const c2: Mat = [1, 0, 0, 92, 0, 0, -1, 35, 0, 1, 0, 29.5, 0, 0, 0, 1];
     
    const prod = [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => [0, 1, 2, 3].reduce((s, k) => s + g[r * 4 + k] * c2[k * 4 + c], 0)));
    expect(prod.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual(I);
  });
});
