// Verifies imported machining curves, points, approach moves, and project events.
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inv, mul, type Mat } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { engine } from "../helpers";
import { hasMirror, STATIONS_DIR } from "./groundtruth";

async function open(file: string) {
  const e = await engine();
  await e.run("station.openRdk", { base64: Buffer.from(readFileSync(path.join(STATIONS_DIR, file))).toString("base64") });
  const named = (type: Item["type"], name: string) => {
    const it = Object.values(e.ws.items).find((i) => i.type === type && i.name === name);
    if (!it) throw new Error(`no ${type} ${name}`);
    return it;
  };
  return { e, ws: e.ws, named };
}

const movePoses = (ws: Workspace, prog: string): Mat[] =>
  ws.items[prog].children.map((c) => ws.items[c].instruction).filter((d) => d?.kind === "move" && d.pose).map((d) => d!.pose!);

 
function rigidResidual(a: Mat[], b: Mat[]): number {
  const pa = a.map((m) => [m[3], m[7], m[11]]);
  const pb = b.map((m) => [m[3], m[7], m[11]]);
  const n = pa.length;
  const ca = [0, 1, 2].map((k) => pa.reduce((s, p) => s + p[k], 0) / n);
  const cb = [0, 1, 2].map((k) => pb.reduce((s, p) => s + p[k], 0) / n);
  const S = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pb.reduce((s, p, k) => s + (p[i] - cb[i]) * (pa[k][j] - ca[j]), 0)));
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
   
  const shift = N.flat().reduce((s, v) => s + Math.abs(v), 0) + 1;
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 5000; it++) {
    const r = N.map((row, i) => row.reduce((s, v, j) => s + v * q[j], 0) + shift * q[i]);
    const l = Math.hypot(...r);
    q = r.map((v) => v / l);
  }
  const [w, x, y, z] = q;
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  let ss = 0;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < 3; i++) ss += (R[i][0] * (pb[k][0] - cb[0]) + R[i][1] * (pb[k][1] - cb[1]) + R[i][2] * (pb[k][2] - cb[2]) - (pa[k][i] - ca[i])) ** 2;
  }
  return Math.sqrt(ss / n);
}

 
function relativeRotationGap(a: Mat[], b: Mat[]): number {
  const angle = (m: Mat) => (Math.acos(Math.min(1, Math.max(-1, (m[0] + m[5] + m[10] - 1) / 2))) * 180) / Math.PI;
  let worst = 0;
  for (let k = 1; k < a.length; k++) worst = Math.max(worst, Math.abs(angle(mul(inv(a[k - 1]), a[k])) - angle(mul(inv(b[k - 1]), b[k]))));
  return worst;
}

describe.skipIf(!hasMirror())("machining example stations: curves, points and projects", () => {
  it("reads the curves, points and curve follow projects of the ABB IRB 1300 station and regenerates their programs", async () => {
    const { e, ws, named } = await open("Curve-Following-with-ABB-IRB-1300-11-0-9.rdk");
     
    expect(named("object", "TestPiece").object!.curves).toHaveLength(45);
    expect(named("object", "BowlHoles Original").object!.points).toHaveLength(15);
    expect(named("object", "CurvePath2").object!.curves!.map((c) => c.points.length)).toEqual([18, 18]);
    expect(named("object", "GearCurve").object!.curves![0].points).toHaveLength(1060);
    for (const row of named("object", "CurvePath1").object!.curves![0].points) {
      expect(row).toHaveLength(6);
      expect(Math.hypot(row[3], row[4], row[5])).toBeCloseTo(1, 4);
    }

    const projects = Object.values(ws.items).filter((i) => i.type === "machining");
    expect(projects.map((p) => p.name).sort()).toEqual(["Bowl Holes Drilling settings", "Bowl Path settings", "Outline settings"]);
    for (const p of projects) {
      const m = p.machining!;
      expect(m.kind).toBe("curve");
      expect(ws.items[m.robot!].name).toBe("ABB IRB 1300-11/0.9");
      expect(ws.items[m.frame!].name).toBe("Reference SW");
      expect(ws.items[m.tool!].name).toBe("Generic Pencil Tool");
      expect(ws.items[m.program!].name).toBe(p.name.replace(/ settings$/, ""));
    }
    const outline = named("machining", "Outline settings").machining!;
    expect(ws.items[outline.input!.object!].name).toBe("CurvePath1");
     
    expect(outline.input!.reversed).toEqual([0]);
    expect(named("machining", "Bowl Path settings").machining!.input).toMatchObject({ curves: [0, 1], reversed: [1] });

    for (const name of ["Outline settings", "Bowl Holes Drilling settings"]) {
      const project = named("machining", name);
      const stored = movePoses(ws, project.machining!.program!);
      const r = (await e.run("machining.update", { project: project.id })) as unknown as { ok: boolean; ratio: number };
      expect(r.ok, name).toBe(true);
      const regenerated = movePoses(ws, project.machining!.program!);
      expect(regenerated.length, name).toBe(stored.length);
      expect(rigidResidual(stored, regenerated), name).toBeLessThan(1e-3);
      expect(relativeRotationGap(stored, regenerated), name).toBeLessThan(1e-3);
    }
  });

  it("decodes approach and retract moves (Yaskawa GP7 welding station: one project per approach type)", async () => {
    const { e, named } = await open("Welding-with-Yaskawa-GP7.rdk");
    const spec = (name: string) => {
      const m = named("machining", name).machining!;
      return [m.approach, m.retract];
    };
    expect(spec("Approach Normal Settings")).toEqual(["Normal 100", "Normal 100"]);
    expect(spec("Approach Tangent Settings")).toEqual(["Tangent 100", "Tangent 100"]);
    expect(spec("Approach Side Settings")).toEqual(["Side 100", "Side 100"]);
    expect(spec("Approach XYZ Settings")).toEqual(["XYZ -100 -100 100", "XYZ 100 -100 100"]);
    expect(spec("Approach Arc Normal Settings")).toEqual(["ArcN 400 60", "ArcN 400 60"]);
    expect(spec("Approach Chain 1 Settings")[0]).toBe("ArcN 200 90; Normal 100");
     
    for (const name of ["Approach Normal Settings", "Approach Tangent Settings", "Approach XYZ Settings"]) {
      const project = named("machining", name);
      const stored = movePoses(e.ws, project.machining!.program!);
      await e.run("machining.update", { project: project.id });
      const regenerated = movePoses(e.ws, project.machining!.program!);
      expect(regenerated.length, name).toBe(stored.length);
      expect(rigidResidual(stored, regenerated), name).toBeLessThan(1e-3);
      expect(relativeRotationGap(stored, regenerated), name).toBeLessThan(1e-3);
    }
  });

  it("reads point follow, CAM, NC and 3D printing projects with their program events", async () => {
    const weld = await open("Welding-with-KUKA-KR-120-R2900-extra.rdk");
    const w1 = weld.named("machining", "Weld1 settings").machining!;
    expect(w1.kind).toBe("point");
    expect(weld.ws.items[w1.input!.object!].name).toBe("Weldpart");
    expect(weld.named("object", "Weldpart").object!.points).toHaveLength(7);
     
    expect(w1.events).toMatchObject({ CallAction: "DoWeld", CallActionOn: 1, CallProgStart: "onStart", CallProgStartOn: 0, SpindleRPM: "SetRPM(%1)", RapidSpeed: 200, Mcode: "M_RunCode(%1)" });

    const cam = await open("CAM-Drilling-Machining.rdk");
    const drilling = cam.named("machining", "Drilling Project").machining!;
    expect(drilling.kind).toBe("machining");
    expect(cam.ws.items[drilling.program!].name).toBe("Drilling");

    const nc = await open("Machining-with-Fanuc-M-710iC-45M.rdk");
    expect(nc.named("machining", "Car_hood Settings").machining!.input!.nc!.file).toMatch(/Car hood\.NCI$/);

    const print = await open("Additive-Manufacturing-with-ABB-IRB-120-3-0-6.rdk");
    expect(print.named("machining", "Print3D settings").machining!.kind).toBe("print3d");
  });
});
