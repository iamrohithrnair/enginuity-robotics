 
 
 
import { beforeAll, describe, expect, it } from "vitest";
import { mul, transl, type Mat } from "@/engine/math";
import { tcpIn } from "@/engine/commands/targets";
import { engine, hasLibraryFile, near } from "../helpers";

 
const describeAbb = describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"));

type E = Awaited<ReturnType<typeof engine>>;
type Id = { id: string };
const J0 = [0, 0, 0, 0, 30, 0];
let e: E;
let robot: Id;
let frame: Id;
let tool: Id;
let P0: Mat;
let n = 0;

beforeAll(async () => {
  e = await engine();
  robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
  frame = (await e.run("item.addFrame", { name: "F1" })) as unknown as Id;
  tool = (await e.run("robot.addTool", { robot: robot.id, name: "T1", xyzrpw: [0, 0, 100, 0, 0, 0] })) as unknown as Id;
  await e.run("robot.setActiveFrame", { robot: robot.id, frame: frame.id });
  await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
  P0 = tcpIn(e.ws, e.ws.items[robot.id], frame.id, J0);
});

const jt = async (joints: number[]) => ((await e.run("target.add", { name: `j${++n}`, parent: frame.id, robot: robot.id, joints, isJoint: true })) as unknown as Id).id;
async function ct(pose: Mat) {
  await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
  return ((await e.run("target.add", { name: `c${++n}`, parent: frame.id, robot: robot.id, pose })) as unknown as Id).id;
}

 
async function check(steps: (p: string) => Promise<void>): Promise<number[]> {
  await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
  const p = (await e.run("program.add", { name: `V${++n}`, robot: robot.id })) as unknown as Id;
  await e.run("program.addInstruction", { program: p.id, kind: "frame", frame: frame.id });
  await e.run("program.addInstruction", { program: p.id, kind: "tool", tool: tool.id });
  await steps(p.id);
  await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
  return (await e.run("program.update", { program: p.id })) as unknown as number[];
}
const J = (p: string, t: string) => e.run("program.addMoveJ", { program: p, target: t }).then(() => undefined);
const L = (p: string, t: string) => e.run("program.addMoveL", { program: p, target: t }).then(() => undefined);

function same(u: number[], expected: [number, number, number, number]) {
  expect(u[0]).toBe(expected[0]);
  expect(near(u[1], expected[1], 1e-4), `time ${u[1]} vs ${expected[1]}`).toBe(true);
  expect(near(u[2], expected[2], 1e-3), `distance ${u[2]} vs ${expected[2]}`).toBe(true);
  expect(u[3]).toBe(expected[3]);
  expect(u[4]).toBe("");
}

describeAbb("probe3: kinematic failures stop the estimate (R-PROG-26)", () => {
  it("unreachable Cartesian target with MoveJ / MoveL", async () => {
    const far = await ct(mul(P0, transl(0, 0, -2000)));
    same(await check(async (p) => (await J(p, await jt(J0)), await J(p, far))), [3, 0, 0, 0]);
    same(await check(async (p) => (await J(p, await jt(J0)), await L(p, far))), [3, 0, 0, 0]);
  });
  it("instructions after a failure are not evaluated", async () => {
    const far = await ct(mul(P0, transl(0, 0, -2000)));
    same(
      await check(async (p) => {
        await J(p, await jt(J0));
        await J(p, far);
        await J(p, await jt([90, 0, 0, 0, 30, 0]));
        await e.run("program.addInstruction", { program: p, kind: "io", ioName: "x", ioValue: 1 });
      }),
      [3, 0, 0, 0],
    );
  });
  it("joint target beyond the J1 limit (170 on ±165)", async () => {
    same(await check(async (p) => (await J(p, await jt(J0)), await J(p, await jt([170, 0, 0, 0, 30, 0])))), [3, 0, 0, 0]);
  });
  it("MoveL whose straight line needs J1 beyond its limits (150 → −150)", async () => {
    same(await check(async (p) => (await J(p, await jt([150, 0, 0, 0, 30, 0])), await L(p, await jt([-150, 0, 0, 0, 30, 0])))), [3, 2.0, 1180.586, 0]);
  });
});

describeAbb("probe3: wrist singularity tolerance (R-PROG-26, R-PROG-32)", () => {
  it("MoveL through the wrist singularity fails; MoveJ passes (J5 ±10, ±40)", async () => {
    same(await check(async (p) => (await J(p, await jt([0, 0, 0, 0, 10, 0])), await L(p, await jt([0, 0, 0, 0, -10, 0])))), [3, 0.7303, 60.0386, 0]);
    same(await check(async (p) => (await J(p, await jt([0, 0, 0, 0, 10, 0])), await J(p, await jt([0, 0, 0, 0, -10, 0])))), [4, 1.4606, 120.0771, 1]);
    same(await check(async (p) => (await J(p, await jt([0, 0, 0, 0, 40, 0])), await L(p, await jt([0, 0, 0, 0, -40, 0])))), [3, 0.5164, 30.0193, 0]);
    same(await check(async (p) => (await J(p, await jt([0, 0, 0, 0, 40, 0])), await J(p, await jt([0, 0, 0, 0, -40, 0])))), [4, 1.977, 270.1735, 1]);
  });
  it("MoveL to J5 = 1° fails, J5 = 3° succeeds (tolerance 2.5°)", async () => {
    same(await check(async (p) => (await J(p, await jt(J0)), await L(p, await jt([0, 0, 0, 0, 1, 0])))), [3, 0, 0, 0]);
    same(await check(async (p) => (await J(p, await jt(J0)), await L(p, await jt([0, 0, 0, 0, 3, 0])))), [4, 0.4628, 80.3052, 1]);
  });
});

describeAbb("probe3: other estimate rules", () => {
  it("a program may start with MoveC (semicircle r = 50 mm)", async () => {
    const c1 = await ct(mul(P0, transl(50, 50, 0)));
    const c2 = await ct(mul(P0, transl(0, 100, 0)));
    same(await check(async (p) => void (await e.run("program.addMoveC", { program: p, via: c1, target: c2 }))), [3, 0.6472, 157.0796, 1]);
  });
  it("a call to a missing program counts as valid and adds nothing", async () => {
    same(
      await check(async (p) => {
        await J(p, await jt(J0));
        await e.run("program.addInstruction", { program: p, kind: "call", text: "NoSuchProgram" });
      }),
      [4, 0, 0, 1],
    );
  });
});

describeAbb("probe3: collision report in Update(COLLISION_ON) (R-PROG-28)", () => {
  it("full time/distance, fractional ratio and RoboDK's message format", async () => {
    const abs = (() => {
      const m = e.ws.items[robot.id];
      void m;
      return tcpIn(e.ws, e.ws.items[robot.id], e.ws.activeStation!, J0);
    })();
     
    await e.run("object.addShape", { shape: "box", name: "HitBox", sizeX: 250, sizeY: 250, sizeZ: 250, parent: e.ws.activeStation!, xyzrpw: [abs[3], abs[7], abs[11] - 125, 0, 0, 0] });
    const ca = await jt([90, 0, 0, 0, 30, 0]);
    const cb = await jt([-90, 0, 0, 0, 30, 0]);
    await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
    const p = (await e.run("program.add", { name: "V_collision_sweep_COLLISION_ON", robot: robot.id })) as unknown as Id;
    await e.run("program.addInstruction", { program: p.id, kind: "frame", frame: frame.id });
    await e.run("program.addInstruction", { program: p.id, kind: "tool", tool: tool.id });
    await J(p.id, ca);
    await J(p.id, cb);
    const on = (await e.run("program.update", { program: p.id, checkCollisions: true })) as unknown as [number, number, number, number, string];
    expect(on[0]).toBe(4);
    expect(near(on[1], 3.7401, 1e-4)).toBe(true);
    expect(near(on[2], 2125.0549, 1e-3)).toBe(true);
     
     
    expect(Math.round(on[3] * 1e4) / 1e4).toBe(0.5027);
    expect(on[4]).toMatch(/^\(50\.3 %\) Collision detected\. <br><br>Program: <strong>V_collision_sweep_COLLISION_ON<\/strong><br>Instruction 2: <strong>MoveJ \(j\d+\)<\/strong>$/);
     
    expect(e.ws.items[robot.id].robot!.joints.map((v) => Math.round(v))).toEqual([0, 0, 0, 0, 30, 0]);
    await e.run("robot.setJoints", { robot: robot.id, joints: [90, 0, 0, 0, 30, 0] });
    const off = (await e.run("program.update", { program: p.id })) as unknown as number[];
    expect(off.slice(0, 4).map((v, i) => (i === 1 || i === 2 ? Math.round(v * 1e4) / 1e4 : v))).toEqual([4, 2.1909, 1416.7032, 1]);
    expect(off[4]).toBe("");
     
     
    await e.run("robot.setJoints", { robot: robot.id, joints: [90, 0, 0, 0, 30, 0] });
    const on1 = (await e.run("program.checkCollisions", { program: p.id, mmStep: 1, degStep: 1 })) as unknown as [number, number, number, number, string];
    expect(Math.round(on1[3] * 1e4) / 1e4).toBe(0.837);
    expect(on1[4]).toContain("(83.7 %) Collision detected. <br><br>Program: <strong>V_collision_sweep_COLLISION_ON</strong><br>Instruction 3: <strong>MoveJ");
    expect(Math.round(e.ws.items[robot.id].robot!.joints[0])).toBe(28);
     
    await e.run("robot.setJoints", { robot: robot.id, joints: [90, 0, 0, 0, 30, 0] });
    const on20 = (await e.run("program.checkCollisions", { program: p.id, mmStep: 20, degStep: 20 })) as unknown as [number, number, number, number, string];
    expect(Math.round(on20[3] * 1e4) / 1e4).toBe(0.8619);
    expect(on20[4]).toContain("(86.2 %) Collision detected.");
     
     
    await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
    const jl = (await e.run("program.jointList", { program: p.id, mmStep: 1, degStep: 1, checkCollisions: true })) as unknown as { status: number; message: string; points: { joints: number[]; error: number }[] };
    expect(jl.status).toBe(4);
    expect(jl.message).toBe("Collisions found. ");
    expect(jl.points[0].joints[0]).toBe(90);
    expect([...new Set(jl.points.map((q) => q.error))].sort((a, b) => a - b)).toEqual([0, 100000]);
    expect(Math.round(e.ws.items[robot.id].robot!.joints[0])).toBe(28);
  });
});
