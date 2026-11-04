 
 
 
 
 
 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fk, ikClosest, ikTrack, initKinematics, simpleModel } from "@/engine/kinematics";
import { eye, inv, mul, poseDistance, transl } from "@/engine/math";
import { planProgram } from "@/engine/sim/planner";
import { absPose, toolPose } from "@/engine/workspace";
import { engine, LIBRARY_KIND_DIR } from "../helpers";

type Id = { id: string };
const round = (v: number[], d = 4) => v.map((x) => Math.round(x * 10 ** d) / 10 ** d + 0);

describe("gripper IK (mechanism types 15 and 17)", () => {
  const rows = [{ alpha: 0, a: 0, theta: 0, d: 0, lower: -40, upper: 0, kind: "linear" as const }];
  it("returns the reference joints for any pose", async () => {
    await initKinematics();
    const far = transl(5000, -3000, 900);
    for (const mech of [15, 17]) {
      const gripper = { ...simpleModel(rows), mech };
      expect(ikClosest(gripper, far, [-20.32])).toEqual([-20.32]);
      expect(ikTrack(gripper, eye(), [-31.82])).toEqual([-31.82]);
    }
     
    expect(ikClosest(simpleModel(rows), far, [-20])).toBeNull();
  });
});

describe("program targets and calls", () => {
  async function cell() {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    await e.run("robot.setJoints", { robot: robot.id, joints: [0, 0, 0, 0, 30, 0] });
    const f1 = (await e.run("item.addFrame", { name: "F1", xyzrpw: [0, 0, 0, 0, 0, 0] })) as unknown as Id;
    const f2 = (await e.run("item.addFrame", { name: "F2", xyzrpw: [0, 60, -40, 0, 0, 0] })) as unknown as Id;
    await e.run("robot.setActiveFrame", { robot: robot.id, frame: f1.id });
     
    const t = (await e.run("target.add", { name: "T", parent: f1.id, robot: robot.id })) as unknown as Id;
    return { e, robot: robot.id, f1: f1.id, f2: f2.id, t: t.id };
  }
  const tcpAbs = (e: Awaited<ReturnType<typeof engine>>, robot: string, q: number[]) => mul(mul(absPose(e.ws, robot), fk(e.ws.items[robot].robot!.model, q)), toolPose(e.ws, robot));

  it("a move places the target's pose in the frame of the last Set Ref.", async () => {
    const { e, robot, f2, t } = await cell();
    const prog = (await e.run("program.add", { name: "Shifted", robot })) as unknown as Id;
    await e.run("program.addInstruction", { program: prog.id, kind: "frame", frame: f2 });
    await e.run("program.addMoveJ", { program: prog.id, target: t });
    const plan = planProgram(e.ws, prog.id);
    expect(plan.ok).toBe(true);
    const reached = tcpAbs(e, robot, plan.final!);
    const expected = mul(absPose(e.ws, f2), e.ws.items[t].pose);
    expect(poseDistance(reached, expected).mm).toBeLessThan(1e-6);
     
    expect(poseDistance(reached, absPose(e.ws, t)).mm).toBeCloseTo(Math.hypot(60, 40), 6);
  });

  it("without a Set Ref. the robot's active frame places the targets", async () => {
    const { e, robot, f2, t } = await cell();
    const prog = (await e.run("program.add", { name: "Plain", robot })) as unknown as Id;
    await e.run("program.addMoveJ", { program: prog.id, target: t });
    expect(poseDistance(tcpAbs(e, robot, planProgram(e.ws, prog.id).final!), absPose(e.ws, t)).mm).toBeLessThan(1e-6);
    await e.run("robot.setActiveFrame", { robot, frame: f2 });
    const shifted = tcpAbs(e, robot, planProgram(e.ws, prog.id).final!);
    expect(poseDistance(shifted, mul(absPose(e.ws, f2), e.ws.items[t].pose)).mm).toBeLessThan(1e-6);
  });

  it("a called program of the same robot continues from the caller's state; a failing one does not fail the caller", async () => {
    const { e, robot, f2, t } = await cell();
    const far = (await e.run("target.add", { name: "Far", parent: f2, robot, pose: transl(4000, 0, 0) })) as unknown as Id;
    const sub = (await e.run("program.add", { name: "Sub", robot })) as unknown as Id;
    await e.run("program.addMoveJ", { program: sub.id, target: t });
    const bad = (await e.run("program.add", { name: "Bad", robot })) as unknown as Id;
    await e.run("program.addMoveJ", { program: bad.id, target: far.id });
    const main = (await e.run("program.add", { name: "Caller", robot })) as unknown as Id;
    await e.run("program.addInstruction", { program: main.id, kind: "frame", frame: f2 });
    await e.run("program.addInstruction", { program: main.id, kind: "call", text: "Sub" });
    await e.run("program.addInstruction", { program: main.id, kind: "call", text: "Bad" });
    const plan = planProgram(e.ws, main.id);
     
    expect(poseDistance(tcpAbs(e, robot, plan.final!), mul(absPose(e.ws, f2), e.ws.items[t].pose)).mm).toBeLessThan(1e-6);
    expect([plan.ok, plan.validInstructions, plan.ratio]).toEqual([true, 3, 1]);
    const alone = planProgram(e.ws, bad.id);
    expect([alone.ok, alone.validInstructions, alone.ratio]).toEqual([false, 0, 0]);
  });

  it("a called program of another robot drives that robot from its current joints at every call", async () => {
    const { e, robot, t } = await cell();
    const other = (await e.run("library.load", { file: "UR5e.robot" })) as unknown as Id;
    await e.run("robot.setJoints", { robot: other.id, joints: [0, -90, 90, 0, 90, 0] });
    const jt = (await e.run("target.add", { name: "J", robot: other.id, joints: [30, -90, 90, 0, 90, 0], isJoint: true })) as unknown as Id;
    const move = (await e.run("program.add", { name: "OtherMove", robot: other.id })) as unknown as Id;
    await e.run("program.addMoveJ", { program: move.id, target: jt.id });
    const main = (await e.run("program.add", { name: "Cell", robot })) as unknown as Id;
    await e.run("program.addInstruction", { program: main.id, kind: "call", text: "OtherMove" });
    await e.run("program.addMoveJ", { program: main.id, target: t });
    await e.run("program.addInstruction", { program: main.id, kind: "call", text: "OtherMove" });
    const plan = planProgram(e.ws, main.id);
    expect(plan.ok).toBe(true);
    const others = plan.segments.filter((s) => s.robot === other.id && s.samples.length);
    expect(others).toHaveLength(2);
     
    for (const s of others) expect(round(s.samples[0])).toEqual([0, -90, 90, 0, 90, 0]);
    expect(others[0].t1 - others[0].t0).toBeGreaterThan(0);
    expect(others[1].t1 - others[1].t0).toBeCloseTo(others[0].t1 - others[0].t0, 9);
     
    expect(plan.final!.length).toBe(6);
    expect(poseDistance(tcpAbs(e, robot, plan.final!), absPose(e.ws, t)).mm).toBeLessThan(1e-6);
  });
});

describe("'set position' events", () => {
  it("restore the recorded parent before the absolute pose (Behavior 4, FUN_1000c7adc)", async () => {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    const home = (await e.run("item.addFrame", { name: "Pallet", xyzrpw: [300, 0, 0, 0, 0, 0] })) as unknown as Id;
    const elsewhere = (await e.run("item.addFrame", { name: "Table", xyzrpw: [0, 500, 0, 0, 0, 0] })) as unknown as Id;
    const box = (await e.run("object.addShape", { shape: "box", name: "Part", parent: home.id })) as unknown as Id;
    const prog = (await e.run("program.add", { name: "Reset", robot: robot.id })) as unknown as Id;
    const ev = (await e.run("program.addInstruction", { program: prog.id, kind: "event", eventAction: "show" })) as unknown as Id;
    const recorded = transl(310, 20, 5);
    e.ws.items[ev.id].instruction!.event = { action: "move", positions: [{ item: box.id, parent: home.id, pose: recorded }], relative: false };
    await e.run("item.setParent", { item: box.id, parent: elsewhere.id });
    await e.run("sim.event", { robot: null, instruction: ev.id });
    expect(e.ws.items[box.id].parent).toBe(home.id);
    expect(poseDistance(absPose(e.ws, box.id), recorded).mm).toBeLessThan(1e-9);
    expect(poseDistance(e.ws.items[box.id].pose, mul(inv(absPose(e.ws, home.id)), recorded)).mm).toBeLessThan(1e-9);
  });
});

describe("attach events (FUN_1003cdc94)", () => {
  it("measure to object origins or geometry within the event's distance, among the listed objects for options 3 and 4", async () => {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    await e.run("robot.setJoints", { robot: robot.id, joints: [0, 0, 0, 0, 90, 0] });
    const tool = (await e.run("robot.addTool", { robot: robot.id, name: "Grip", xyzrpw: [0, 0, 50, 0, 0, 0] })) as unknown as Id;
    await e.run("robot.setActiveTool", { robot: robot.id, tool: tool.id });
    const r = e.ws.items[robot.id].robot!;
    const tcp = mul(mul(absPose(e.ws, robot.id), fk(r.model, r.joints)), toolPose(e.ws, robot.id));
    const [x, y, z] = [tcp[3], tcp[7], tcp[11]];
     
     
    const part = (await e.run("object.addShape", { shape: "box", name: "Part", sizeX: 10, sizeY: 10, sizeZ: 10, xyzrpw: [x + 30, y, z - 5, 0, 0, 0] })) as unknown as Id;
    const plate = (await e.run("object.addShape", { shape: "box", name: "Plate", sizeX: 800, sizeY: 800, sizeZ: 20, xyzrpw: [x - 300, y, z - 30, 0, 0, 0] })) as unknown as Id;
    const prog = (await e.run("program.add", { name: "Attach", robot: robot.id })) as unknown as Id;
    const ev = (await e.run("program.addInstruction", { program: prog.id, kind: "event", eventAction: "attach" })) as unknown as Id;
    const attach = async (option: number, distance: number, objects: string[] = []) => {
      e.ws.items[ev.id].instruction!.event = { action: "attach", tool: tool.id, objects, option, distance };
      const res = (await e.run("sim.event", { robot: robot.id, instruction: ev.id })) as unknown as { attached?: string } | null;
      for (const id of [part.id, plate.id]) if (e.ws.items[id].parent === tool.id) await e.run("item.setParent", { item: id, parent: e.ws.activeStation!, keepAbsolute: true });
      return res?.attached ?? null;
    };
    expect(await attach(1, 200)).toBe("Part");
    expect(await attach(2, 200)).toBe("Plate");
    expect(await attach(3, 400, [plate.id])).toBe("Plate");
    expect(await attach(1, 20)).toBeNull();
    expect(await attach(2, 20)).toBe("Plate");
  });
});

const STATIONS = LIBRARY_KIND_DIR("stations");
const R540 = path.join(STATIONS, "Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk");
const SCARA = path.join(STATIONS, "Assembly-and-Material-Handling-with-KUKA-KR5-scara-R550-Z200.rdk");

describe.skipIf(!existsSync(R540) || !existsSync(SCARA))("KUKA assembly examples (library mirror)", () => {
  async function open(file: string) {
    const e = await engine();
    await e.run("station.openRdk", { base64: readFileSync(file).toString("base64") });
    const program = (name: string) => Object.values(e.ws.items).find((i) => i.type === "program" && i.name === name)!.id;
    const update = async (name: string) => ((await e.run("program.update", { program: program(name) })) as unknown as (number | string)[]).map((v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v));
    return { e, program, update };
  }

  it("KR 3 R540: Update() of the gripper, pick, assembly and main programs matches RoboDK", async () => {
    const { update } = await open(R540);
    expect(await update("GripperOpen")).toEqual([3, 0, 0, 1, ""]);
    expect(await update("Pick_TubeType1")).toEqual([7, 3.7181, 442.7923, 1, ""]);
    expect(await update("TubeAssembly_Part1")).toEqual([5, 11.7625, 1792.4711, 1, ""]);
    expect(await update("Tube1")).toEqual([6, 18.9905, 2862.4917, 1, ""]);
    expect(await update("Main")).toEqual([13, 231.6482, 37181.3112, 1, ""]);
  });

  it("KR 3 R540: every program passes Check Path, gripper moves included", async () => {
    const { e } = await open(R540);
    const programs = Object.values(e.ws.items).filter((i) => i.type === "program");
    expect(programs).toHaveLength(28);
    for (const p of programs) {
      const r = (await e.run("program.check", { program: p.id })) as unknown as { ok: boolean; message: string };
      expect([p.name, r.ok, r.message]).toEqual([p.name, true, "No problems found for this path"]);
    }
  });

  it("KR 3 R540: Pick_TubeType1 reaches its targets in the robot's frame (joint list, TubeType1-1 / TubeType1-2)", async () => {
    const { e, program } = await open(R540);
    const byName = (n: string) => Object.values(e.ws.items).find((i) => i.name === n)!.id;
    const first = async (frame: string) => {
      await e.run("robot.setActiveFrame", { robot: byName("KUKA KR 3 R540"), frame: byName(frame) });
      const r = (await e.run("program.jointList", { program: program("Pick_TubeType1"), mmStep: 1000, degStep: 1000 })) as unknown as { points: { joints: number[] }[] };
      return round(r.points[0].joints);
    };
    expect(await first("TubeType1-1")).toEqual([-23.1986, -50.7497, 81.1553, 0, 59.5944, -23.1986]);
    expect(await first("TubeType1-2")).toEqual([-27.2768, -62.0692, 99.6486, 0, 52.4206, -27.2768]);
  });

  it("KR5 SCARA: a pick program that fails on its own does not fail the programs calling it", async () => {
    const { update } = await open(SCARA);
    expect(await update("Pick_TubeType1")).toEqual([2, 0, 0, 0, ""]);
    expect(await update("TubeAssembly_Part1")).toEqual([5, 8.9121, 1464.6509, 1, ""]);
    expect(await update("Tube1")).toEqual([6, 21.0357, 2660.0189, 1, ""]);
  });
});

const mirrored = (...files: string[]) => files.every((f) => existsSync(path.join(STATIONS, f)));

describe.skipIf(!mirrored("Machining-with-ABB-IRB-120-3-0-6.rdk", "Machining-and-Synchronization.rdk", "Conveying-and-Palletizing-with-TM14X.rdk", "Assembly-and-Material-Handling-with-Adept-Viper-s650.rdk", "Dispensing-with-Kassow-KR0810.rdk", "Welding-with-Panasonic-TA-1600.rdk", "Material-Handling-and-Synchronization-with-Brooks.rdk"))(
  "Update() of other example programs (research/evidence/programs/wpq-update-probe.json)",
  () => {
    const update = async (file: string, name: string) => {
      const e = await engine();
      await e.run("station.openRdk", { base64: readFileSync(path.join(STATIONS, file)).toString("base64") });
      const p = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === name)!;
      return ((await e.run("program.update", { program: p.id })) as unknown as (number | string)[]).map((v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v));
    };

    it("generic mechanisms reach the joints closest to their targets (CNC door with the gantry's tool, conveyor without frame)", async () => {
      expect(await update("Machining-and-Synchronization.rdk", "OpenDoor")).toEqual([3, 0, 0, 1, ""]);
      expect(await update("Conveying-and-Palletizing-with-TM14X.rdk", "RunConveyor")).toEqual([2, 4518.0544, 451755.4407, 1, ""]);
    });

    it("called programs that fail on their own fail like RoboDK's", async () => {
      expect(await update("Assembly-and-Material-Handling-with-Adept-Viper-s650.rdk", "Pick_TubeType1")).toEqual([6, 4.4113, 522.7058, 0, ""]);
      expect(await update("Welding-with-Panasonic-TA-1600.rdk", "RAWeld2")).toEqual([4, 0, 0, 0, ""]);
      expect(await update("Material-Handling-and-Synchronization-with-Brooks.rdk", "Read Microplate")).toEqual([2, 0, 0, 0, ""]);
    });

    it("tiny arcs whose three points are almost in a line still run (DXF toolpath)", async () => {
       
      const [valid, time, distance, ratio] = await update("Machining-with-ABB-IRB-120-3-0-6.rdk", "DXFPath");
      expect([valid, ratio]).toEqual([3160, 0]);
      expect(time as number).toBeCloseTo(579.5991, 3);
      expect(distance as number).toBeCloseTo(4005.5422, 3);
    });

    it("a 7-axis robot's linear paths are not held to the 6-axis joint 5 singularity test", async () => {
       
       
      const [valid, time, , ratio] = await update("Dispensing-with-Kassow-KR0810.rdk", "Dispensing_3-Axis");
      expect([valid, ratio]).toEqual([206, 1]);
      expect(Math.abs((time as number) - 9.0003) / 9.0003).toBeLessThan(0.001);
    });
  },
);

describe.skipIf(!mirrored("Material-Handling-with-TM12.rdk", "Drilling-and-Milling-with-KUKA-KR-10-R900-sixx-02.rdk", "Assembly-and-Material-Handling-with-Epson-C3.rdk", "Curve-Following-with-Omron-TM5-700.rdk", "Milling-and-Synchronization-with-KUKA-02.rdk"))(
  "Update() of example programs (research/evidence/programs/wpq-update-probe-3.json)",
  () => {
    const update = async (file: string, name: string) => {
      const e = await engine();
      await e.run("station.openRdk", { base64: readFileSync(path.join(STATIONS, file)).toString("base64") });
      const p = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === name)!;
      return ((await e.run("program.update", { program: p.id })) as unknown as (number | string)[]).map((v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v));
    };

    it("subprograms whose targets need the caller's frame fail on their own", async () => {
      expect(await update("Material-Handling-with-TM12.rdk", "Pick Carrier 1")).toEqual([1, 0, 0, 0, ""]);
      expect(await update("Drilling-and-Milling-with-KUKA-KR-10-R900-sixx-02.rdk", "DrillingPart")).toEqual([1, 0, 0, 0, ""]);
      expect(await update("Assembly-and-Material-Handling-with-Epson-C3.rdk", "Pick_TubeType1")).toEqual([2, 0.8089, 0, 0, ""]);
    });

    it("a Set Ref. with Force Original Pose places a generated program's targets at the stored frame", async () => {
       
      const [valid, time, distance, ratio] = await update("Curve-Following-with-Omron-TM5-700.rdk", "Outline");
      expect([valid, time, distance, ratio]).toEqual([46, 12.0496, 2543.7162, 1]);
    });

    it("a forced Set Ref. whose stored pose is the frame's own pose keeps following the frame (rail and turntable cell)", async () => {
       
      const [valid, time, , ratio] = await update("Milling-and-Synchronization-with-KUKA-02.rdk", "FaceMachining");
      expect([valid, ratio]).toEqual([560, 1]);
      expect(time as number).toBeCloseTo(4.2747, 3);
    });
  },
);
