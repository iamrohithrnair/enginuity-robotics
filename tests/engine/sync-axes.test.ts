 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generationSettings, buildIntermediate } from "@/engine/commands/generate";
import { fk } from "@/engine/kinematics";
import { inv, mul, poseDistance, transl, type Mat } from "@/engine/math";
import { motionState, planMove, planProgram, planOptionsFromSettings } from "@/engine/sim/planner";
import { absPoseWith, combinedJoints, jointOverrides, MAX_SYNC_JOINTS, syncAxes, syncBaseAbs } from "@/engine/sync/axes";
import { SyncImport } from "@/engine/sync/import";
import { SyncKinematics } from "@/engine/sync/plan";
import type { Item } from "@/engine/types";
import { absPose, toolPose } from "@/engine/workspace";
import { engine, LIBRARY_FILE } from "../helpers";

type Built = { id: string };
const RY90: Mat = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
const RYM90: Mat = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];





async function cell() {
  const e = await engine();
  const rail = (await e.run("mechanism.build", { type: 4, name: "Rail", lower: [-3000], upper: [3000], base: RY90, tool: RYM90 })) as unknown as Built;
  const arm = (await e.run("mechanism.build", { type: 7, name: "Arm", params: [400, 180, 0, 600, 120, 620, 115], parent: rail.id })) as unknown as Built;
  const table = (await e.run("mechanism.build", { type: 1, name: "Table", lower: [-360], upper: [360] })) as unknown as Built;
  const ws = e.ws;
  await e.run("item.setPose", { item: ws.items[rail.id].parent!, pose: transl(0, 0, 0), relativeTo: "station" });
  await e.run("item.setPose", { item: ws.items[table.id].parent!, pose: transl(1100, -900, 0), relativeTo: "station" });
  const part = (await e.run("item.addFrame", { name: "Part", parent: table.id, xyzrpw: [150, 80, 300, 0, 0, 30] })) as unknown as Built;
  return { e, rail: rail.id, arm: arm.id, table: table.id, part: part.id };
}

 
const tcpAt = (e: Awaited<ReturnType<typeof engine>>, arm: string, q: number[]) => {
  const robot = e.ws.items[arm];
  const over = jointOverrides(e.ws, robot, q);
  return mul(mul(absPoseWith(e.ws, arm, over), fk(robot.robot!.model, q.slice(0, 6))), toolPose(e.ws, arm));
};

describe("synchronizing a robot with external axes (robot.syncAxes)", () => {
  it("orders the joints robot first, then each axis, and labels them like the sync dialog", async () => {
    const { e, rail, arm, table } = await cell();
    const r = (await e.run("robot.syncAxes", { robot: arm, axes: [rail, table] })) as unknown as { message: string; axes: { name: string; side: string; ids: string }[] };
    expect(r.message).toBe("Arm is synchronized with: Rail (id 7-7), Table (id 8-8)");
    expect(r.axes).toEqual([
      { name: "Rail", side: "robot", ids: "7-7" },
      { name: "Table", side: "part", ids: "8-8" },
    ]);
    const info = (await e.run("robot.syncInfo", { robot: arm })) as unknown as { joints: number; candidates: { linearTrack: { name: string }[]; turntableOrTrack: { name: string }[] } };
    expect(info.joints).toBe(8);
    expect(info.candidates.linearTrack.map((c) => c.name)).toEqual(["Rail"]);
    expect(info.candidates.turntableOrTrack.map((c) => c.name)).toEqual(["Table"]);
     
    const off = (await e.run("robot.syncAxes", { robot: arm, axes: [] })) as unknown as { message: string };
    expect(off.message).toBe("No axes currently synchronized with Arm");
    expect(syncAxes(e.ws, e.ws.items[arm])).toEqual([]);
  });

  it("refuses a mechanism mounted on the robot and more than 12 joints", async () => {
    const { e, rail, arm } = await cell();
    const gripper = (await e.run("mechanism.build", { type: 4, name: "Slide", parent: arm })) as unknown as Built;
    expect((await e.tryRun("robot.syncAxes", { robot: arm, axes: [gripper.id] })).error).toMatch(/External axis not detected as linear track or rotative table!/);
    const gantries = [];
    for (const name of ["G1", "G2"]) gantries.push(((await e.run("mechanism.build", { type: 6, name })) as unknown as Built).id);
     
    expect((await e.tryRun("robot.syncAxes", { robot: arm, axes: [rail, ...gantries] })).error).toMatch(/at most 12 joints/);
    expect(MAX_SYNC_JOINTS).toBe(12);
  });

  it("drops axes beyond 12 joints counting from the end of the list, as a station file is loaded", async () => {
    const { e, rail, arm } = await cell();
    const g1 = ((await e.run("mechanism.build", { type: 6, name: "G1" })) as unknown as Built).id;
    const g2 = ((await e.run("mechanism.build", { type: 6, name: "G2" })) as unknown as Built).id;
    const robot = e.ws.items[arm];
    robot.robot = { ...robot.robot!, sync: [g1, g2, rail] };
     
    expect(syncAxes(e.ws, robot).map((a) => [a.item.name, a.at])).toEqual([
      ["G2", 6],
      ["Rail", 9],
    ]);
  });
});

describe("joints of a synchronized robot", () => {
  it("setJoints with the extra values moves the axes; the combined vector lists them after the robot's", async () => {
    const { e, rail, arm, table } = await cell();
    await e.run("robot.syncAxes", { robot: arm, axes: [rail, table] });
    await e.run("robot.setJoints", { robot: arm, joints: [5, -10, 20, 0, 40, 0, 650, 30] });
    expect(e.ws.items[arm].robot!.joints).toEqual([5, -10, 20, 0, 40, 0]);
    expect(e.ws.items[rail].robot!.joints).toEqual([650]);
    expect(e.ws.items[table].robot!.joints).toEqual([30]);
    expect(combinedJoints(e.ws, e.ws.items[arm])).toEqual([5, -10, 20, 0, 40, 0, 650, 30]);
     
    await e.run("sim.setJoints", { robot: arm, joints: [6, -10, 20, 0, 40, 0, 700, -15] });
    expect([e.ws.items[arm].robot!.joints[0], e.ws.items[rail].robot!.joints[0], e.ws.items[table].robot!.joints[0]]).toEqual([6, 700, -15]);
  });

  it("the synchronized base is the last axis's: a part-side flange or a robot-side base", async () => {
    const { e, rail, arm, table } = await cell();
    const ws = e.ws;
    const robot = ws.items[arm];
    const q = [0, 0, 0, 0, 30, 0, 500, 40];
    const base = (sync: string[]) => {
      robot.robot = { ...robot.robot!, sync };
      return syncBaseAbs(ws, robot, jointOverrides(ws, robot, q));
    };
    const tableFlange = mul(absPose(ws, table), fk(ws.items[table].robot!.model, [40]));
    expect(poseDistance(base([rail, table]), tableFlange).mm).toBeLessThan(1e-9);
    expect(poseDistance(base([table, rail]), absPose(ws, rail)).mm).toBeLessThan(1e-9);
    expect(poseDistance(base([rail]), absPose(ws, rail)).mm).toBeLessThan(1e-9);
    expect(poseDistance(base([]), absPose(ws, arm)).mm).toBeLessThan(1e-9);
  });
});

describe("planning a synchronized robot", () => {
  async function synced() {
    const c = await cell();
    await c.e.run("robot.syncAxes", { robot: c.arm, axes: [c.rail, c.table] });
    await c.e.run("robot.setJoints", { robot: c.arm, joints: [0, -10, 20, 0, 40, 0, 0, 0] });
    const prog = (await c.e.run("program.add", { name: "Sync", robot: c.arm })) as unknown as Built;
    return { ...c, prog: prog.id };
  }
   
  async function targetAt(c: Awaited<ReturnType<typeof synced>>, name: string, q: number[]) {
    const partAbs = absPoseWith(c.e.ws, c.part, jointOverrides(c.e.ws, c.e.ws.items[c.arm], q));
    const pose = mul(inv(partAbs), tcpAt(c.e, c.arm, q));
    return ((await c.e.run("target.add", { name, parent: c.part, robot: c.arm, pose, joints: q, isJoint: false })) as unknown as Built).id;
  }

  it("MoveJ interpolates every joint, the axes included, and times the largest change", async () => {
    const c = await synced();
    const t = ((await c.e.run("target.add", { name: "J", parent: c.part, robot: c.arm, joints: [10, -15, 25, 5, 35, 10, 900, 15], isJoint: true })) as unknown as Built).id;
    await c.e.run("program.addInstruction", { program: c.prog, kind: "frame", frame: c.part });
    await c.e.run("program.addMoveJ", { program: c.prog, target: t });
    const plan = planProgram(c.e.ws, c.prog);
    expect(plan.ok).toBe(true);
    expect(plan.final).toEqual([10, -15, 25, 5, 35, 10, 900, 15]);
    const seg = plan.segments.find((s) => s.kind === "move")!;
    for (const s of seg.samples) expect(s.length).toBe(8);
     
    expect(seg.profile!.d).toBeCloseTo(900, 9);
  });

  it("MoveL keeps the TCP on a straight line on the turntable while the rail and table move linearly", async () => {
    const c = await synced();
    const start = [0, -10, 20, 0, 40, 0, 0, 0];
    const end = [8, -4, 14, 3, 46, -5, 400, 25];
    const t = await targetAt(c, "L", end);
    await c.e.run("program.addInstruction", { program: c.prog, kind: "frame", frame: c.part });
    await c.e.run("program.addMoveL", { program: c.prog, target: t });
    const plan = planProgram(c.e.ws, c.prog, { stepMM: 1, stepDeg: 1 });
    expect(plan.ok).toBe(true);
    const seg = plan.segments.find((s) => s.kind === "move")!;
    const n = seg.samples.length - 1;
     
    expect(n).toBeGreaterThanOrEqual(400);
    const robot = c.e.ws.items[c.arm];
    const inPart = (q: number[]) => mul(inv(absPoseWith(c.e.ws, c.part, jointOverrides(c.e.ws, robot, q))), tcpAt(c.e, c.arm, q));
    const p0 = inPart(start);
    const p1 = c.e.ws.items[t].pose;
    seg.samples.forEach((q, k) => {
      const s = k / n;
      expect(q[6]).toBeCloseTo(start[6] + s * (end[6] - start[6]), 6);
      expect(q[7]).toBeCloseTo(start[7] + s * (end[7] - start[7]), 6);
      const p = inPart(q);
      for (const i of [3, 7, 11]) expect(Math.abs(p[i] - (p0[i] + s * (p1[i] - p0[i])))).toBeLessThan(1e-6);
    });
     
    expect(plan.distance).toBeCloseTo(Math.hypot(p1[3] - p0[3], p1[7] - p0[7], p1[11] - p0[11]), 6);
    expect(poseDistance(inPart(plan.final!), p1).mm).toBeLessThan(1e-6);
  });

  it("the rail brings a target beyond the arm's reach within reach", async () => {
    const c = await synced();
    const far = [0, -10, 20, 0, 40, 0, 2600, 0];
    const t = await targetAt(c, "Far", far);
    await c.e.run("program.addInstruction", { program: c.prog, kind: "frame", frame: c.part });
    await c.e.run("program.addMoveJ", { program: c.prog, target: t });
    expect(planProgram(c.e.ws, c.prog).ok).toBe(true);
     
    await c.e.run("robot.syncAxes", { robot: c.arm, axes: [] });
    await c.e.run("robot.setJoints", { robot: c.arm, joints: [0, -10, 20, 0, 40, 0] });
    const alone = planProgram(c.e.ws, c.prog);
    expect(alone.ok).toBe(false);
    expect(alone.errors[0].message).toMatch(/is not reachable/);
  });

  it("a single move from the API state plans on the combined joints", async () => {
    const c = await synced();
    const ws = c.e.ws;
    const robot = ws.items[c.arm];
    const st = motionState(ws, robot);
    expect(st.joints).toEqual([0, -10, 20, 0, 40, 0, 0, 0]);
    const fake: Item = { id: "__m", handle: 0, type: "instruction", name: "MoveJ", parent: null, children: [], visible: true, pose: robot.pose, instruction: { kind: "move", moveType: "joint", joints: [0, -10, 20, 0, 40, 0, -300, 90] } };
    const r = planMove(ws, robot, st, fake, planOptionsFromSettings(c.e.services.settings));
    expect(r.ok).toBe(true);
    expect(r.joints).toEqual([0, -10, 20, 0, 40, 0, -300, 90]);
  });

  it("generated programs carry the axes: RobotPost axes and types, joints of every move", async () => {
    const c = await synced();
    const t = ((await c.e.run("target.add", { name: "J", parent: c.part, robot: c.arm, joints: [10, -15, 25, 5, 35, 10, 900, 15], isJoint: true })) as unknown as Built).id;
    await c.e.run("program.addMoveJ", { program: c.prog, target: t });
    const inter = buildIntermediate(c.e.ws, c.prog, { settings: generationSettings(c.e.services.settings) });
    expect(inter.text).toMatch(/r = RobotPost\(.*,8, axes_type=\['R','R','R','R','R','R','T','J'\]/);
    expect(inter.text).toContain("r.MoveJ(None,[10,-15,25,5,35,10,900,15],None)");
  });
});

describe("station import of synchronized programs (src/engine/sync/import.ts)", () => {
  it("Set Ref. poses are w.r.t. the synchronized base and embedded targets sit at their stored axes", async () => {
    const c = await cell();
    await c.e.run("robot.syncAxes", { robot: c.arm, axes: [c.rail, c.table] });
    const ws = c.e.ws;
    const robot = ws.items[c.arm];
    const imp = new SyncImport(ws, robot);
    const k = new SyncKinematics(ws, robot);
    const now = combinedJoints(ws, robot);
    const linked = mul(inv(k.base(now)), absPose(ws, c.part));
     
    expect(imp.setRef(c.part, linked, 1)).toEqual({ kind: "frame", frame: c.part, pose: linked });
     
    const other = mul(linked, transl(0, 0, 50));
    expect(imp.setRef(c.part, other, 1)).toEqual({ kind: "frame", frame: c.part, pose: other, forcePose: true });
     
    const q = [0, 0, 0, 0, 30, 0, 200, 60];
    const abs = imp.place(transl(0, 0, 100), q);
    expect(poseDistance(abs, mul(mul(k.base(q), other), transl(0, 0, 100))).mm).toBeLessThan(1e-9);
  });
});

 
 

const STATION = (f: string) => LIBRARY_FILE("stations", f);
const LIVE: [station: string, program: string, update: [number, number, number, number]][] = [
   
  ["Synchronization-and-Welding-with-ABB-02.rdk", "Path1", [78, 3.2561, 3341.048, 1]],
  ["Synchronization-and-Welding-with-ABB-02.rdk", "Path2", [16, 2.4188, 2325.0, 1]],
  ["Synchronization-and-Welding-with-ABB-02.rdk", "Path3", [78, 1.8713, 3768.3291, 1]],
  ["Bending-Palletizing-and-Synchronization-with-Yaskawa-MH24.rdk", "Bend1 Sheet1", [4, 5.7199, 943.9747, 0]],
  ["Bending-Palletizing-and-Synchronization-with-Yaskawa-MH24.rdk", "TurnSheet1", [21, 29.9921, 3749.388, 1]],
  ["Milling-and-Synchronization-with-KUKA-02.rdk", "SyncMoveRail", [6, 0.27, 2055.0926, 0]],
  ["Mixed-Applications-with-Multiple-Robots.rdk", "Machining", [958, 200.3612, 25513.9314, 1]],
  ["Synchronization-and-Washing-with-Fanuc-M-710iC-45M.rdk", "L-Transfer", [5, 27.3957, 12857.2426, 1]],
  ["Synchronization-and-Washing-with-Fanuc-M-710iC-45M.rdk", "L-FrontWingUp", [18, 80.6529, 44732.8818, 1]],
  ["Synchronization-and-Welding-with-KUKA-02.rdk", "Weld2", [43, 1.7546, 2453.6124, 1]],
   
  ["Milling-and-Synchronization-with-KUKA-02.rdk", "FaceMachining", [560, 4.2747, 3198.9101, 1]],
  ["Mixed-Applications-with-KUKA.rdk", "TestUsinage_002_1_T1_Ebauche", [149, 21.0696, 21170.2756, 1]],
  ["Machining-and-Synchronization-with-KUKA.rdk", "Milling_2_T1", [3612, 918.9925, 98985.8279, 1]],
  ["Machining-and-Synchronization.rdk", "Path1", [149, 14.9308, 2926.006, 1]],
];

describe("synchronized library programs: Update() as live RoboDK", () => {
  const stations = [...new Set(LIVE.map((c) => c[0]))];
  for (const station of stations) {
    it.skipIf(!existsSync(STATION(station)))(
      station,
      async () => {
        const e = await engine();
        await e.run("station.openRdk", { base64: readFileSync(STATION(station)).toString("base64") });
        for (const [, name, live] of LIVE.filter((c) => c[0] === station)) {
          const prog = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === name)!;
          const plan = planProgram(e.ws, prog.id, planOptionsFromSettings(e.services.settings));
          const got = [plan.validInstructions, plan.duration, plan.distance, plan.ratio];
          expect(got[0], `${name} valid instructions`).toBe(live[0]);
          expect(Math.abs(got[1] - live[1]), `${name} time ${got[1]}`).toBeLessThan(1e-4);
          expect(Math.abs(got[2] - live[2]), `${name} distance ${got[2]}`).toBeLessThan(1e-3);
          expect(got[3], `${name} ratio`).toBe(live[3]);
        }
      },
      300_000,
    );
  }

  it.skipIf(!existsSync(STATION("Machining-and-Synchronization-with-KUKA.rdk")))(
    "imports the synchronized axes in joint order: the rail carrying the robot, then the positioner",
    async () => {
      const e = await engine();
      await e.run("station.openRdk", { base64: readFileSync(STATION("Machining-and-Synchronization-with-KUKA.rdk")).toString("base64") });
      const robot = Object.values(e.ws.items).find((i) => i.type === "robot" && i.name === "KUKA KR 500 3")!;
      expect(syncAxes(e.ws, robot).map((a) => [a.item.name, a.side, a.at])).toEqual([
        ["Rail", "robot", 6],
        ["KUKA DKP-400", "part", 7],
      ]);
      expect(combinedJoints(e.ws, robot)).toHaveLength(9);
    },
    120_000,
  );
});
