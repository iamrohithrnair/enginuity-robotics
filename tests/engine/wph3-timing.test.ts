// Verifies motion profiles, speed/acceleration rules, and program time estimates.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fk } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import { effectiveSpeeds, MOVE_TIME_JOINT, MOVE_TIME_LINEAR, MOVE_TIME_SHORTEST, MOVE_TIME_STRICTEST, moveTiming, profileTime } from "@/engine/sim/timing";
import { absPose, toolPose } from "@/engine/workspace";
import { engine, LIBRARY_KIND_DIR, ROOT } from "../helpers";

type Id = { id: string };
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const ABB = { linear: 1000, joint: 200, linearAccel: 1500, jointAccel: 150, rounding: -1 };

describe("move time (FUN_10048f2d0, FUN_1007031f8)", () => {
  it("accelerated profile: d/v + v/a once the speed is reached, else 2·√(d/a) (probe2 T3/T4)", () => {
    expect(r4(profileTime(100, 1000, 1500))).toBe(0.5164);
    expect(r4(profileTime(200, 1000, 1500))).toBe(0.7303);
    expect(r4(profileTime(100, 100, 200))).toBe(1.5);
    expect(r4(profileTime(100, 50, 1000))).toBe(2.05);
    expect(r4(profileTime(10, 250, 500))).toBe(0.2828);
  });

  it("a negative acceleration means constant speed: t = d / v", () => {
    expect(profileTime(100, 1000, -1)).toBe(0.1);
    expect(profileTime(80.515, 50, -1)).toBeCloseTo(1.6103, 4);
  });

  it("the robot's rounding above 0 drops the accelerations; at 0 or below they apply", () => {
    expect(effectiveSpeeds(ABB)).toEqual({ linear: 1000, joint: 200, linearAccel: 1500, jointAccel: 150 });
    expect(effectiveSpeeds({ ...ABB, rounding: 1 })).toEqual({ linear: 1000, joint: 200, linearAccel: -1, jointAccel: -1 });
    expect(effectiveSpeeds({ ...ABB, rounding: 0.5 }).linearAccel).toBe(-1);
    expect(effectiveSpeeds({ ...ABB, rounding: 0 }).linearAccel).toBe(1500);
  });

  it("speeds and accelerations below 0.1 fall back (FUN_10048f628, FUN_10048f52c)", () => {
    expect(effectiveSpeeds({ linear: 0, joint: 0, linearAccel: 0, jointAccel: 0, rounding: -1 })).toEqual({ linear: 2000, joint: 4000, linearAccel: 100, jointAccel: 200 });
     
    expect(effectiveSpeeds({ linear: 1000, joint: 0, linearAccel: 50, jointAccel: 0, rounding: -1 })).toEqual({ linear: 1000, joint: 2000, linearAccel: 50, jointAccel: 100 });
    expect(effectiveSpeeds({ linear: 0.05, joint: 30, linearAccel: 0.05, jointAccel: 40, rounding: -1 })).toEqual({ linear: 2000, joint: 30, linearAccel: 100, jointAccel: 40 });
  });

  it("default mode: MoveL / MoveC on the linear time, MoveJ on the joint time (probe2 T1/T3/T6)", () => {
    expect(r4(moveTiming(ABB, 100, 30, "linear").time)).toBe(0.5164);
    expect(r4(moveTiming(ABB, 708.3516, 90, "joint").time)).toBe(1.5492);
    expect(r4(moveTiming(ABB, 157.08, 12, "circular").time)).toBe(r4(2 * Math.sqrt(157.08 / 1500)));
     
    expect(r4(moveTiming(ABB, 0.001, 90, "linear").time)).toBe(1.5492);
    expect(moveTiming(ABB, 0.001, 90, "linear").linearProfile).toBe(false);
     
    expect(r4(moveTiming(ABB, 0.0011, 90, "linear").time)).toBe(0.0017);
  });

  it("the other 'Move time calculation' modes: strictest, linear, joint, shortest", () => {
    const tl = profileTime(100, 1000, 1500);
    const tj = profileTime(45, 200, 150);
    expect(moveTiming(ABB, 100, 45, "linear", MOVE_TIME_STRICTEST).time).toBe(Math.max(tl, tj));
    expect(moveTiming(ABB, 100, 45, "joint", MOVE_TIME_LINEAR).time).toBe(tl);
    expect(moveTiming(ABB, 100, 45, "linear", MOVE_TIME_JOINT).time).toBe(tj);
    expect(moveTiming(ABB, 100, 45, "linear", MOVE_TIME_SHORTEST).time).toBe(Math.min(tl, tj));
  });
});

describe("Update() times with the robot's rounding state", () => {
   
  async function cell() {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    await e.run("robot.setJoints", { robot: robot.id, joints: [0, 0, 0, 0, 30, 0] });
    const f1 = (await e.run("item.addFrame", { name: "F1", xyzrpw: [0, 0, 0, 0, 0, 0] })) as unknown as Id;
    await e.run("robot.setActiveFrame", { robot: robot.id, frame: f1.id });
    const qa = [10, 0, 0, 0, 30, 0];
    const a = (await e.run("target.add", { name: "A", parent: f1.id, robot: robot.id, joints: qa, isJoint: true })) as unknown as Id;
    const rd = e.ws.items[robot.id].robot!;
    const tcp = mul(mul(absPose(e.ws, robot.id), fk(rd.model, qa)), toolPose(e.ws, robot.id));
    const prog = (await e.run("program.add", { name: "Steps", robot: robot.id })) as unknown as Id;
     
    await e.run("program.addInstruction", { program: prog.id, kind: "rounding", rounding: 5 });
    await e.run("program.addMoveJ", { program: prog.id, target: a.id });
    const offsets = [
      [2, 0, 0],
      [4, 0, 0],
      [4, 2, 0],
      [4, 2, 2],
    ];
    for (const [i, o] of offsets.entries()) {
      const pose = tcp.slice();
      pose[3] += o[0];
      pose[7] += o[1];
      pose[11] += o[2];
      const t = (await e.run("target.add", { name: `L${i + 1}`, parent: f1.id, robot: robot.id, pose })) as unknown as Id;
      await e.run("program.addMoveL", { program: prog.id, target: t.id });
    }
    const update = async () => ((await e.run("program.update", { program: prog.id })) as unknown as number[]).slice(0, 4);
    return { e, robot: robot.id, update };
  }

  it("rounding off: every move accelerates and stops (Σ 2·√(d/a))", async () => {
    const { update } = await cell();
    const [n, t, d, ratio] = await update();
    expect([n, ratio]).toEqual([6, 1]);
    expect(t).toBeCloseTo(2 * Math.sqrt(10 / 150) + 4 * 2 * Math.sqrt(2 / 1500), 6);
    expect(d).toBeGreaterThan(8);
  });

  it("rounding on: constant speed, t = Σ d / v, joint moves included", async () => {
    const { e, robot, update } = await cell();
    await e.run("robot.setRounding", { robot, rounding: 1 });
    const [, t] = await update();
    expect(t).toBeCloseTo(10 / 200 + 8 / 1000, 6);
    expect((await e.run("robot.motionState", { robot })) as unknown).toMatchObject({ constantSpeed: true, used: { linearAccel: -1, jointAccel: -1 } });
     
    await e.run("robot.setRounding", { robot, rounding: -1 });
    expect((await update())[1]).toBeCloseTo(2 * Math.sqrt(10 / 150) + 4 * 2 * Math.sqrt(2 / 1500), 6);
  });

  it("a joint speed of 0 runs at twice the linear speed", async () => {
    const { e, robot, update } = await cell();
    await e.run("robot.setRounding", { robot, rounding: 1 });
    await e.run("robot.setSpeed", { robot, joint: 0 });
    expect((await update())[1]).toBeCloseTo(10 / 2000 + 8 / 1000, 6);
  });
});

describe("programs without a robot (FUN_1000aeec4, live research/evidence/programs/wph3-probe.json)", () => {
  async function cell() {
    const e = await engine();
     
    const nr = (await e.run("program.add", { name: "NR" })) as unknown as Id;
    const nrm = (await e.run("program.add", { name: "NRMove" })) as unknown as Id;
    expect(e.ws.items[nr.id].program?.robot ?? null).toBeNull();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    await e.run("robot.setJoints", { robot: robot.id, joints: [0, 0, 0, 0, 30, 0] });
    const t1 = (await e.run("target.add", { name: "T1", robot: robot.id, joints: [30, 0, 0, 0, 30, 0], isJoint: true })) as unknown as Id;
    const sub = (await e.run("program.add", { name: "Sub", robot: robot.id })) as unknown as Id;
    await e.run("program.addMoveJ", { program: sub.id, target: t1.id });
    await e.run("program.addInstruction", { program: nr.id, kind: "call", text: "Sub" });
    await e.run("program.addInstruction", { program: nr.id, kind: "io", ioName: "5", ioValue: 1 });
    await e.run("program.addInstruction", { program: nr.id, kind: "pause", pauseMs: 100 });
    await e.run("program.addMoveJ", { program: nrm.id, target: t1.id });
    const update = async (id: string) => ((await e.run("program.update", { program: id })) as unknown as (number | string)[]).map((v) => (typeof v === "number" ? r4(v) : v));
    return { e, nr: nr.id, nrm: nrm.id, sub: sub.id, robot: robot.id, t1: t1.id, update };
  }

  it("Update() answers [-1, 0, 0, 0] with calls, I/O and pauses, and with moves", async () => {
    const { nr, nrm, sub, update } = await cell();
    expect(await update(nr)).toEqual([-1, 0, 0, 0, ""]);
    expect(await update(nrm)).toEqual([-1, 0, 0, 0, ""]);
    expect(await update(sub)).toEqual([1, 0.8944, 190.7728, 1, ""]);
  });

  it("Check Path shows 'Select a robot for this program'", async () => {
    const { e, nr } = await cell();
    expect((await e.run("program.check", { program: nr })) as unknown).toMatchObject({ ok: false, message: "Select a robot for this program" });
  });

  it("a robot program calling a program without a robot: the call is valid and adds nothing (FUN_10052a334)", async () => {
    const { e, robot, t1, update } = await cell();
    const caller = (await e.run("program.add", { name: "Caller", robot })) as unknown as Id;
    await e.run("program.addMoveJ", { program: caller.id, target: t1 });
    await e.run("program.addInstruction", { program: caller.id, kind: "call", text: "NR" });
    expect(await update(caller.id)).toEqual([2, 0.8944, 190.7728, 1, ""]);
  });
});

const STATIONS = LIBRARY_KIND_DIR("stations");
const mirrored = (...files: string[]) => files.every((f) => existsSync(path.join(STATIONS, f)));
const TM5 = "Curve-Following-with-Omron-TM5-700.rdk";

describe.skipIf(!mirrored(TM5, "Dispensing-with-Kassow-KR0810.rdk", "Mixed-Applications-with-KUKA.rdk", "Machining-with-ABB-IRB-120-3-0-6.rdk", "Machining-and-Synchronization.rdk", "Inspection-with-UR10.rdk"))(
  "example programs of many short segments match RoboDK's Update() (library mirror)",
  () => {
    async function open(file: string) {
      const e = await engine();
      await e.run("station.openRdk", { base64: readFileSync(path.join(STATIONS, file)).toString("base64") });
      const byName = (type: string, name: string) => Object.values(e.ws.items).find((i) => i.type === type && i.name === name)!.id;
      const update = async (name: string) => ((await e.run("program.update", { program: byName("program", name) })) as unknown as (number | string)[]).map((v) => (typeof v === "number" ? r4(v) : v));
      return { e, byName, update };
    }

    it("TM5-700 Outline with the station's rounding 1, then with setRounding(-1) (wph3-probe.json)", async () => {
      const { e, byName, update } = await open(TM5);
      expect(await update("Outline")).toEqual([46, 12.0496, 2543.7162, 1, ""]);
      await e.run("robot.setRounding", { robot: byName("robot", "Omron TM5-700"), rounding: -1 });
      expect(await update("Outline")).toEqual([46, 41.654, 2543.7162, 1, ""]);
    });

    it("machining and dispensing programs whose robots keep rounding on (wpq-update-probe*.json)", async () => {
      expect(await (await open("Mixed-Applications-with-KUKA.rdk")).update("TestUsinage_002_1_T1_Ebauche")).toEqual([149, 21.0696, 21170.2756, 1, ""]);
      expect(await (await open("Machining-and-Synchronization.rdk")).update("Path1")).toEqual([149, 14.9308, 2926.006, 1, ""]);
      const [n, t, , ratio] = await (await open("Machining-with-ABB-IRB-120-3-0-6.rdk")).update("DXFPath");
      expect([n, t, ratio]).toEqual([3160, 579.5991, 0]);
       
      const kassow = await (await open("Dispensing-with-Kassow-KR0810.rdk")).update("Dispensing_3-Axis");
      expect([kassow[0], kassow[3]]).toEqual([206, 1]);
      expect(Math.abs((kassow[1] as number) - 9.0003) / 9.0003).toBeLessThan(0.002);
    }, 120_000);

    it("a program without a robot in a library station: [-1, 0, 0, 0] (PictureShot, wph3-probe.json)", async () => {
      const { update } = await open("Inspection-with-UR10.rdk");
      expect(await update("PictureShot")).toEqual([-1, 0, 0, 0, ""]);
    });
  },
);

 
 
 
const BATCHES = ["wph3-batch-probe-2.json", "wph3-batch-probe-3.json", "wph3-batch-probe-4.json"].map((f) => path.join(ROOT, "research/evidence/programs", f));
const batchCases = BATCHES.filter((f) => existsSync(f)).flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as { cases: { station: string; update: Record<string, number[]> }[] }).cases);

describe.skipIf(!batchCases.length || !mirrored(...new Set(batchCases.map((c) => c.station))))("Update() of library example programs (wph3-batch-probe-*.json)", () => {
  for (const c of batchCases) {
    it(c.station, async () => {
      const e = await engine();
      await e.run("station.openRdk", { base64: readFileSync(path.join(STATIONS, c.station)).toString("base64") });
      for (const [name, rdk] of Object.entries(c.update)) {
        const p = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === name)!;
        const [n, t, d, ratio] = ((await e.run("program.update", { program: p.id })) as unknown as number[]).map(Number);
        expect([name, n, ratio]).toEqual([name, rdk[0], rdk[3]]);
        expect(Math.abs(t - rdk[1]), `${name} time ${t} vs ${rdk[1]}`).toBeLessThanOrEqual(Math.max(1e-4, rdk[1] * 5e-4));
        expect(Math.abs(d - rdk[2]), `${name} distance ${d} vs ${rdk[2]}`).toBeLessThanOrEqual(0.01);
      }
    }, 120_000);
  }
});
