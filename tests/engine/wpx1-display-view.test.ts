// Verifies display-string parsing, camera presets, and cross-robot joint-path listings.
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { engine, LIBRARY_KIND_DIR } from "../helpers";
import { describe, expect, it } from "vitest";
import { parseDisplayString } from "@/engine/displayString";

describe("Display strings (FUN_1004b1a48)", () => {
  it("starts from the defaults on every call: no particle, line width and point size -1", () => {
    expect(parseDisplayString("")).toEqual({ lineWidth: -1, pointSize: -1, color: null, particle: null });
  });

  it("reads LINEW / POINTSIZE / PARTICLE case-insensitively, splits on spaces and skips empty parts", () => {
    const s = parseDisplayString("  linew=2.5  PointSize=7 particle=SPHERE(4,8)");
    expect(s.lineWidth).toBe(2.5);
    expect(s.pointSize).toBe(7);
    expect(s.particle).toEqual({ kind: "sphere", radius: 4, facets: 8, scale: null });
  });

  it("COLOR= is case-sensitive; Qt colour names and #RRGGBB; an invalid colour is opaque black", () => {
    expect(parseDisplayString("COLOR=#00ff00").color).toEqual([0, 1, 0, 1]);
    expect(parseDisplayString("COLOR=red").color).toEqual([1, 0, 0, 1]);
    expect(parseDisplayString("color=red").color).toBeNull();
    expect(parseDisplayString("COLOR=notacolour").color).toEqual([0, 0, 0, 1]);
  });

  it("PARTICLE=CUBE(…) with the closing bracket removed; non-numbers read as 0 (QString::toFloat)", () => {
    expect(parseDisplayString("PARTICLE=CUBE(10,20,30)").particle).toEqual({ kind: "cube", size: [10, 20, 30] });
    expect(parseDisplayString("LINEW=abc").lineWidth).toBe(0);
  });
});

describe("G_ViewPose2 presets and fit (FUN_10035969c / FUN_100359864)", async () => {
   
  const { fitViewPose, VIEW_PRESET_ANGLES } = await import("@/server/rdkapi/cmd-x1");

  it("the six presets are the R-IM-20 angles: iso, front, top, right, left, back", () => {
    expect(VIEW_PRESET_ANGLES).toEqual({ 1: [-60, -135], 2: [-90, -90], 3: [0, -90], 4: [-90, -180], 5: [-90, 0], 6: [-90, 90] });
  });

  it("the box centre goes on the view axis at 1.2·max(size, 600)/2/tan(angle/2)", () => {
    const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
     
    const p = fitViewPose(rot, [0, 0, 0, 1000, 0, 0], 30);
    expect(p[3]).toBe(-500);
    expect(p[11]).toBeCloseTo((-1.2 * 1000 * 0.5) / Math.tan((15 * Math.PI) / 180), 2);
     
    const q = fitViewPose(rot, [0, 0, 0, 10, 10, 10], 30);
    expect(q[11] + 5).toBeCloseTo((-1.2 * 600 * 0.5) / Math.tan((15 * Math.PI) / 180), 2);
  });
});

 


const R540 = path.join(LIBRARY_KIND_DIR("stations"), "Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk");
const PROBE = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/api-probe/wpx1/wpx1-probe.json"), "utf8")) as { step: string; value: { reply: unknown[] } }[];

describe.skipIf(!existsSync(R540))("InstructionListJoints of a program calling another robot's programs (KR 3 R540 Pick_TubeType1)", () => {
  it("matches RoboDK's live matrix: start points of later moves, steps from the previous point, path-row move ids", async () => {
    const e = await engine();
    await e.run("station.openRdk", { base64: readFileSync(R540).toString("base64") });
    const byName = (n: string) => Object.values(e.ws.items).find((i) => i.name === n)!.id;
    await e.run("robot.setActiveFrame", { robot: byName("KUKA KR 3 R540"), frame: byName("TubeType1-1") });
    const prog = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === "Pick_TubeType1")!.id;
    const r = (await e.run("program.jointList", { program: prog, mmStep: 1000, degStep: 1000 })) as unknown as { status: number; message: string; points: { joints: number[]; error: number; mm: number; deg: number; row: number }[] };
    const [rows, cols, data] = PROBE.find((s) => s.step === "G_ProgJointList.pick")!.value.reply[0] as [number, number, number[]];
    const live = Array.from({ length: cols }, (_, j) => data.slice(j * rows, (j + 1) * rows));
    expect([r.status, r.message, r.points.length]).toEqual([7, "Success", cols]);
    r.points.forEach((p, j) => {
      const mine = [...p.joints, p.error, p.mm, p.deg, p.row];
      mine.forEach((v, i) => expect(v).toBeCloseTo(live[j][i], 3));
    });
  });
});
