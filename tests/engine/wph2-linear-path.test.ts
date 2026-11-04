 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fk, ikClosest, parseRdkFile, simpleModel } from "@/engine/kinematics";
import { mul, rotz, transl, type Mat } from "@/engine/math";
import { elbowAngle, wristToAxis1 } from "@/engine/sim/planner";
import { backMeasure, DEFAULT_PATH_TOLERANCES, elbowMeasure, linearPath, PATH_TURN_180, STEP_JUMP, STEP_WRIST, STEP_WRIST_CROSSES, wristMeasure, type PathTolerances } from "@/engine/sim/linear-path";
import type { RobotModel } from "@/engine/types";
import { engine, hasLibraryFile, LIBRARY_KIND_DIR } from "../helpers";

const DEG = Math.PI / 180;
const row = (theta = 0, extra: Partial<{ a: number; d: number; kind: "rotary" | "linear" }> = {}) => ({ alpha: 0, a: extra.a ?? 0, theta, d: extra.d ?? 0, lower: -360, upper: 360, kind: extra.kind });
const model = (mech: number, thetas: number[], rows?: ReturnType<typeof row>[]): RobotModel => ({ ...simpleModel(rows ?? thetas.map((t) => row(t))), mech });

describe("singularity measures by mechanism type", () => {
  it("wrist (FUN_100734de0): J5 minus its DH offset on type 1, J6 on 7-axis types, the elbow on SCARA, mod 180° on type 6, none on the others", () => {
    const six = [0, 0, 0, 0, 0, 0];
    expect(wristMeasure(model(1, six), [0, 0, 0, 0, 12.5, 0])).toBe(12.5);
    expect(wristMeasure(model(-1, six), [0, 0, 0, 0, -3, 0])).toBe(-3);
     
    const hp = model(1, [0, 0, 0, 0, 90 * DEG, 0]);
    expect(wristMeasure(hp, six)).toBeCloseTo(-90, 12);
    expect(wristMeasure(hp, [0, 0, 0, 0, 90, 0])).toBeCloseTo(0, 12);
     
    const ur = model(6, six);
    expect(wristMeasure(ur, [0, 0, 0, 0, 178.5, 0])).toBeCloseTo(1.5, 12);
    expect(wristMeasure(ur, [0, 0, 0, 0, -1, 0])).toBeCloseTo(1, 12);
    expect(wristMeasure(ur, [0, 0, 0, 0, 270, 0])).toBeCloseTo(90, 12);
     
    const seven = [0, 0, 0, 0, 0, 10 * DEG, 0];
    for (const t of [3, -3, 23]) expect(wristMeasure(model(t, seven), [0, 0, 0, 0, 40, 17, 0])).toBeCloseTo(7, 12);
     
    expect(wristMeasure(model(2, [0, 0, 0, 0]), [10, 4, 50, 0])).toBe(4);
    expect(wristMeasure(model(2, [], [row(0, { kind: "linear" }), row(), row(), row()]), [10, 4, 50, 0])).toBe(50);
     
    expect(wristMeasure(model(7, [0, 0, 0, 0, 90 * DEG, 0]), [0, 0, 0, 0, 5, 0])).toBe(5);
    for (const t of [0, 4, 5, 8, -8, 9, 12, 15, 21, 22]) expect(wristMeasure(model(t, six), [0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it("elbow (FUN_100733e00): θ3 + offset − (atan2(a4, d4) − 90°) on type 1, J3 + offset on type 6, none on the others", () => {
    const r = [row(), row(), row(), row(0, { a: 0, d: 300 }), row(), row()];
    expect(elbowMeasure(model(1, [], r), [0, 0, -90, 0, 0, 0])).toBeCloseTo(0, 12);
    expect(elbowMeasure(model(1, [], r), [0, 0, 10, 0, 0, 0])).toBeCloseTo(100, 12);
    const r2 = [row(), row(), row(-90 * DEG), row(0, { a: 70, d: 302 }), row(), row()];
    expect(elbowMeasure(model(1, [], r2), [0, 0, 0, 0, 0, 0])).toBeCloseTo(-90 - (Math.atan2(70, 302) / DEG - 90), 12);
    expect(elbowMeasure(model(6, [0, 0, 5 * DEG, 0, 0, 0]), [0, 0, -7, 0, 0, 0])).toBeCloseTo(-2, 12);
    for (const t of [2, 3, 8, 9]) expect(elbowMeasure(model(t, [0, 0, 0, 0, 0, 0]), [0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

 
describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("linear paths on an ABB IRB 120", () => {
  let m: RobotModel;
  const tool = transl(0, 0, 100);
  const tcp = (q: number[]) => mul(fk(m, q), tool);
  const tol = (t: Partial<PathTolerances> = {}): PathTolerances => ({ ...DEFAULT_PATH_TOLERANCES, ...t });
  const run = (start: number[], to: Mat, t: Partial<PathTolerances> = {}) => linearPath({ model: m, start, from: tcp(start), to, tool, tol: tol(t) });
  const J0 = [0, 0, 0, 0, 30, 0];

  beforeAll(async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as { id: string };
    m = e.ws.items[r.id].robot!.model;
  });

  it("the elbow and front/back measures are the stretched-arm angle and the wrist's distance to axis 1", () => {
    for (const q of [[0, 10, -40, 20, 30, 0], [0, -30, 60, 0, 45, 10], [0, 50, -20, 0, -30, 0], [0, 0, -77, 0, 30, 0]]) {
      expect(Math.abs(elbowMeasure(m, q)!)).toBeCloseTo(elbowAngle(m, q), 9);
      expect(Math.abs(backMeasure(m, q)!)).toBeCloseTo(wristToAxis1(m, q), 9);
    }
  });

  it("steps = max(trunc(mm / PathStepMM), trunc(deg / PathStepDeg)), at least 1 (FUN_10082ce20)", () => {
    expect(run(J0, mul(transl(10.7, 0, 0), tcp(J0))).steps).toBe(10);
    expect(run(J0, mul(transl(0.4, 0, 0), tcp(J0))).steps).toBe(1);
    expect(run(J0, mul(mul(transl(2.9, 0, 0), tcp(J0)), rotz(15.6 * DEG))).steps).toBe(15);
    expect(run(J0, mul(transl(10.7, 0, 0), tcp(J0)), { stepMM: 5 }).steps).toBe(2);
    const r = run(J0, mul(transl(10.7, 0, 0), tcp(J0)));
    expect([r.code, r.samples.length]).toEqual([0, 11]);
  });

  it("a rotation within ToleranceTurn180 of 180° fails before any step", () => {
    const r = run(J0, mul(tcp(J0), rotz(179.8 * DEG)));
    expect([r.code, r.samples.length]).toEqual([PATH_TURN_180, 1]);
    expect(run(J0, mul(tcp(J0), rotz(179.4 * DEG))).code).not.toBe(PATH_TURN_180);
    expect(run(J0, mul(tcp(J0), rotz(179.8 * DEG)), { turn180: -1 }).code).not.toBe(PATH_TURN_180);
  });

  it("a step whose largest joint change exceeds the smooth-move tolerance fails with code 10 (GlobalParams[3], 25°)", () => {
    const start = [10, 10, 10, 0, 40, 0];
    const to = mul(transl(150, -120, 40), tcp(start));
    const end = ikClosest(m, mul(to, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -100, 0, 0, 0, 1]), start)!;
    const jump = Math.max(...end.map((v, i) => Math.abs(v - start[i])));
    expect(jump).toBeGreaterThan(5);
    const one = { stepMM: 1e5, stepDeg: 1e5 };
    expect(run(start, to, { ...one, smooth: jump - 0.5 }).code).toBe(STEP_JUMP);
    expect(run(start, to, { ...one, smooth: jump + 0.5 }).code).toBe(0);
     
    expect(run(start, to).code).toBe(0);
  });

  it("joint 5 near 0 stops the path at the first step within the wrist tolerance (probe3 MoveL_wrist_flip J5 10 → −10: code 1000)", () => {
    const start = [0, 0, 0, 0, 10, 0];
    const to = tcp([0, 0, 0, 0, -10, 0]);
    const r = run(start, to);
    expect(r.code).toBe(STEP_WRIST);
    const j5 = r.samples.at(-1)![4];
    expect(Math.abs(j5)).toBeLessThan(2.5);
    expect(Math.abs(r.samples.at(-2)![4])).toBeGreaterThanOrEqual(2.5);
     
    const c = run(start, to, { wrist: 0 });
    expect(c.code).toBe(STEP_WRIST_CROSSES);
    expect(c.samples.at(-1)![4]).toBeLessThan(0);
    expect(c.samples.at(-2)![4]).toBeGreaterThanOrEqual(0);
     
    expect(run(start, to, { wrist: -1 }).code).toBe(0);
  });
});

const STATIONS = LIBRARY_KIND_DIR("stations");
const CASES: { file: string; program: string; frame?: [string, string]; robodk: [number, number | null, number] }[] = [
   
   
  { file: "Material-Handling-with-Motoman-HP20D.rdk", program: "Pick sequence", robodk: [15, 11141.0522, 1] },
  { file: "Material-Handling-with-Motoman-HP20D.rdk", program: "Drop Blue", robodk: [4, 1350.0207, 1] },
  { file: "Dispensing-with-AUCTECH-ACR-7.rdk", program: "Dispensing_5-Axis", robodk: [201, 2100.794, 1] },
  { file: "Conveying-Material-Handling-and-Palletizing-with-Yaskawa-GP25.rdk", program: "Palletizing Example Left_L0", robodk: [19, 9572.3942, 0] },
  { file: "Conveying-Material-Handling-and-Palletizing-with-Yaskawa-GP25.rdk", program: "Palletizing Example Right_L1", robodk: [5, 3349.4878, 0] },
  { file: "Conveying-Material-Handling-and-Palletizing-with-ABB-IRB-2400-L.rdk", program: "Palletizing Example Left_L1", robodk: [17, 10490.2865, 0] },
  { file: "Conveying-Material-Handling-and-Palletizing-with-Doosan-Robotics-H2017.rdk", program: "Palletizing Example Left_L0", robodk: [19, 10922.4144, 0] },
  { file: "Conveying-Material-Handling-and-Palletizing-with-UR20.rdk", program: "Palletizing Example Right_L0", robodk: [33, 16212.9434, 0] },
  { file: "Dispensing-with-Delta-Electronics-DC06.rdk", program: "Dispensing_3-Axis", robodk: [157, 1778.7379, 0] },
  { file: "Polishing-and-Sanding-with-uFactory-850.rdk", program: "Curve", robodk: [24, 804.8417, 0] },
  { file: "Inspection-with-KUKA-KR-22-R1610-02.rdk", program: "InspectA", robodk: [7, 2596.0847, 0] },
  { file: "Sample-Station-with-RoboDK-RDK-2200.rdk", program: "Wrist singularity - Lin Move LR", robodk: [3, 20.0814, 0] },
  { file: "Sample-Station-with-RoboDK-RDK-2200.rdk", program: "Wrist singularity - Lin Move UD", robodk: [3, 10, 0] },
  { file: "Welding-with-Fanuc.rdk", program: "GoToWeld4", robodk: [2, 0, 0] },
  { file: "Welding-with-Fanuc.rdk", program: "ReTake-Frame-5-Rob1", robodk: [3, 0, 0] },
  { file: "Assembly-and-Material-Handling-with-igus-ReBeL-6DOF.rdk", program: "Pick_TubeType1", frame: ["igus ReBeL 6DOF", "TubeType1-5"], robodk: [2, 0, 0] },
  { file: "Assembly-and-Material-Handling-with-igus-ReBeL-6DOF.rdk", program: "Pick_TubeType1", frame: ["igus ReBeL 6DOF", "TubeType1-9"], robodk: [2, 0, 0] },
  { file: "Assembly-and-Material-Handling-with-igus-ReBeL-6DOF.rdk", program: "Pick_TubeType2", frame: ["igus ReBeL 6DOF", "TubeType2-12"], robodk: [1, 0, 0] },
   
  { file: "Welding-with-Fanuc.rdk", program: "Weld4-1-2", robodk: [30, 3097.7406, 1] },
  { file: "Dispensing-with-Delta-Electronics-DC06.rdk", program: "Dispensing_3-Axis_JCT", robodk: [157, 1778.738, 0] },
  { file: "Machining-with-ABB-IRB-120-3-0-6-02.rdk", program: "DXFPath", robodk: [3160, 4005.5422, 0] },
  { file: "Conveying-and-Material-Handling-with-Motoman-GP20.rdk", program: "Follow App", robodk: [0, 0, 0] },
  { file: "Welding-with-Panasonic-TA-1600.rdk", program: "RDWeld2", robodk: [4, 0, 0] },
  { file: "Dispensing-with-Kassow-KR0810-02.rdk", program: "Dispensing", robodk: [398, null, 1] },
  { file: "Dispensing-with-Kassow-KR0810.rdk", program: "Dispensing_5-Axis", robodk: [201, null, 1] },
  { file: "Dispensing-with-Kassow-KR0810.rdk", program: "Dispensing_3-Axis_JCT", robodk: [206, null, 1] },
   
  ...([
    ["Yaskawa-GP25", "Left_L1", 21, 10307.0101],
    ["Yaskawa-GP25", "Left_L2", 21, 9991.6931],
    ["Yaskawa-GP25", "Right_L0", 19, 10227.0057],
    ["Yaskawa-GP25", "Right_L2", 21, 10549.372],
    ["Yaskawa-GP25", "Right_L3", 5, 3349.4878],
    ["ABB-IRB-2400-L", "Left_L2", 17, 9889.5038],
    ["ABB-IRB-2400-L", "Left_L3", 67, 30484.8845],
    ["ABB-IRB-2400-L", "Right_L1", 17, 10495.5068],
    ["ABB-IRB-2400-L", "Right_L2", 17, 9994.2957],
    ["ABB-IRB-2400-L", "Right_L3", 29, 15096.6805],
    ["Doosan-Robotics-H2017", "Left_L1", 29, 16200.9879],
    ["Doosan-Robotics-H2017", "Right_L0", 19, 12243.3064],
    ["Doosan-Robotics-H2017", "Right_L1", 29, 17428.4817],
    ["UR20", "Right_L1", 5, 2502.1362],
    ["UR20", "Right_L2", 33, 14755.2681],
    ["UR20", "Right_L3", 5, 2502.1362],
  ] as const).map(([robot, layer, valid, mm]) => ({ file: `Conveying-Material-Handling-and-Palletizing-with-${robot}.rdk`, program: `Palletizing Example ${layer}`, robodk: [valid, mm, 0] as [number, number, number] })),
  { file: "Material-Handling-with-Motoman-HP20D-02.rdk", program: "Transition Pick", robodk: [4, 2820.8155, 1] },
  { file: "Material-Handling-with-Motoman-HP20D-02.rdk", program: "Drop Pink", robodk: [5, 1587.1199, 1] },
   
  { file: "Material-Handling-with-Motoman-HP20D-02.rdk", program: "Pick sequence", robodk: [31, null, 1] },
  { file: "Polishing-and-Sanding-with-Franka-Emika-Panda.rdk", program: "Curve", robodk: [72, null, 1] },
];

describe.skipIf(!CASES.every((c) => existsSync(path.join(STATIONS, c.file))))("Update() of example programs against live RoboDK (wph2-update-probe)", () => {
  it.each(CASES.map((c) => [`${c.program}${c.frame ? ` @ ${c.frame[1]}` : ""} (${c.file})`, c] as const))("%s", async (_, c) => {
    const e = await engine();
    await e.run("station.openRdk", { base64: readFileSync(path.join(STATIONS, c.file)).toString("base64") });
    const byName = (n: string, type?: string) => Object.values(e.ws.items).find((i) => i.name === n && (!type || i.type === type))!.id;
    if (c.frame) await e.run("robot.setActiveFrame", { robot: byName(c.frame[0]), frame: byName(c.frame[1], "frame") });
    const u = (await e.run("program.update", { program: byName(c.program, "program") })) as unknown as number[];
    expect([u[0], u[3]]).toEqual([c.robodk[0], c.robodk[2]]);
    if (c.robodk[1] !== null) expect(Math.abs(u[2] - c.robodk[1])).toBeLessThan(1e-3);
  });
});

const KASSOW = path.join(STATIONS, "Dispensing-with-Kassow-KR0810-02.rdk");

describe.skipIf(!existsSync(KASSOW))("7-axis arms keep joint 3 along a path", () => {
  it("Kassow KR810 (type −3): the first MoveL of 'Dispensing' ends on the joints RoboDK stored for its target", async () => {
    const e = await engine();
    const bytes = readFileSync(KASSOW);
    await e.run("station.openRdk", { base64: bytes.toString("base64") });
    const m = Object.values(e.ws.items).find((i) => i.robot?.model.nq === 7)!.robot!.model;
     
    let stored: Record<string, number[]> = {};
    const walk = (o: unknown) => {
      if (!o || typeof o !== "object") return;
      const it = o as Record<string, unknown>;
      if (it.name === "Dispensing" && Array.isArray(it.instructions))
        stored = Object.fromEntries((it.instructions as { name: string; joints?: number[] }[]).filter((i) => Array.isArray(i.joints)).map((i) => [i.name, i.joints!]));
      for (const v of Object.values(it)) if (v && typeof v === "object") walk(v);
    };
    walk(parseRdkFile(new Uint8Array(bytes)).json);
    const start = stored["MoveJ 1"].slice(0, 7);
    const end = stored["MoveL 2"].slice(0, 7);
    const eyeTool = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const r = linearPath({ model: m, start, from: fk(m, start), to: fk(m, end), tool: eyeTool, tol: DEFAULT_PATH_TOLERANCES });
    expect(r.code).toBe(0);
    const q = r.samples.at(-1)!;
    expect(Math.max(...q.map((v, i) => Math.abs(v - end[i])))).toBeLessThan(0.01);
    expect(Math.abs(q[2] - start[2])).toBeLessThan(1e-6);
  });
});
