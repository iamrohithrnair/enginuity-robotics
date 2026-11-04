 
 
 
import { beforeAll, describe, expect, it } from "vitest";
import { mul, rotx, roty, rotz, transl, DEG, type Mat } from "@/engine/math";
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

type Move = ["J" | "L", string] | ["C", [string, string]] | ["R", number] | ["P", number] | ["S", number[]] | ["CALL", string];

 
async function upd(moves: Move[], start = J0, name = `tp${++n}`): Promise<number[]> {
  await e.run("robot.setJoints", { robot: robot.id, joints: start });
  const p = (await e.run("program.add", { name, robot: robot.id })) as unknown as Id;
  await e.run("program.addInstruction", { program: p.id, kind: "frame", frame: frame.id });
  await e.run("program.addInstruction", { program: p.id, kind: "tool", tool: tool.id });
  for (const [kind, val] of moves) {
    if (kind === "J") await e.run("program.addMoveJ", { program: p.id, target: val });
    else if (kind === "L") await e.run("program.addMoveL", { program: p.id, target: val });
    else if (kind === "C") await e.run("program.addMoveC", { program: p.id, via: val[0], target: val[1] });
    else if (kind === "R") await e.run("program.addInstruction", { program: p.id, kind: "rounding", rounding: val });
    else if (kind === "P") await e.run("program.addInstruction", { program: p.id, kind: "pause", pauseMs: val });
    else if (kind === "S") await e.run("program.addInstruction", { program: p.id, kind: "speed", linear: val[0], joint: val[1] ?? -1, linearAccel: val[2] ?? -1, jointAccel: val[3] ?? -1 });
    else if (kind === "CALL") await e.run("program.addInstruction", { program: p.id, kind: "call", text: val });
  }
  return (await e.run("program.update", { program: p.id })) as unknown as number[];
}

const t = (u: number[], expected: number) => expect(near(u[1], expected, 1e-4), `time ${u[1]} vs ${expected}`).toBe(true);

describeAbb("probe2 T0–T2: MoveJ (R-PROG-19, R-PROG-24)", () => {
  it("T0 start position matters", async () => {
    const u = await upd([["J", await jt(J0)]], [0, 0, 0, 0, 0, 0]);
    expect(u[0]).toBe(3);
    t(u, 0.8944);
    expect(near(u[2], 90.0578, 1e-3)).toBe(true);
    const v = await upd([["J", await jt(J0)]]);
    expect(v.slice(0, 4)).toEqual([3, 0, 0, 1]);
  });
  const cases: [number, number, number][] = [
    [0, 1, 0.1633], [0, 2, 0.2309], [0, 5, 0.3651], [0, 10, 0.5164], [0, 20, 0.7303], [0, 45, 1.0954], [0, 90, 1.5492],
    [5, 100, 1.633], [5, 200, 2.3094], [5, 300, 2.8333], [5, 390, 3.2833],
    [1, 10, 0.5164], [2, 10, 0.5164], [3, 10, 0.5164], [4, 10, 0.5164], [5, 10, 0.5164],
  ];
  it.each(cases)("T1/T2 axis %i +%i° → %f s", async (axis, d, expected) => {
    const j = J0.slice();
    j[axis] += d;
    t(await upd([["J", await jt(j)]]), expected);
  });
  it("T2 multi-axis moves synchronise on the largest delta; distance is the TCP path", async () => {
    t(await upd([["J", await jt([90, 30, 0, 0, 30, 0])]]), 1.5492);
    t(await upd([["J", await jt([90, 30, 0, -90, 30, 90])]]), 1.5492);
    const u = await upd([["J", await jt([90, 0, 0, 0, 30, 0])]]);
    expect(near(u[2], 708.3516, 1e-3)).toBe(true);
  });
});

describeAbb("probe2 T3–T4: MoveL and robot speed state (R-PROG-17, R-PROG-20)", () => {
  it.each([
    [1, 0.0516], [10, 0.1633], [50, 0.3651], [100, 0.5164], [200, 0.7303],
  ])("T3 MoveL %i mm → %f s, distance = %i mm", async (d, expected) => {
    const u = await upd([["L", await ct(mul(P0, transl(0, d, 0)))]]);
    t(u, expected);
    expect(near(u[2], d, 1e-6)).toBe(true);
  });
  it("T4 robot joint speed/acceleration", async () => {
    const rows: [number, number, number, number][] = [
      [30, 100, 5, 0.4472], [30, 100, 20, 0.9667], [30, 100, 90, 3.3],
      [100, 1000, 5, 0.1414], [100, 1000, 20, 0.3], [100, 1000, 90, 1.0],
      [10, 50, 5, 0.7], [10, 50, 20, 2.2], [10, 50, 90, 9.2],
    ];
    for (const [vj, aj, d, expected] of rows) {
      await e.run("robot.setSpeed", { robot: robot.id, joint: vj, jointAccel: aj });
      t(await upd([["J", await jt([d, 0, 0, 0, 30, 0])]]), expected);
    }
    await e.run("robot.setSpeed", { robot: robot.id, joint: 200, jointAccel: 150 });
  });
  it("T4 robot linear speed/acceleration", async () => {
    const rows: [number, number, number, number][] = [
      [100, 200, 10, 0.4472], [100, 200, 100, 1.5], [50, 1000, 10, 0.25], [50, 1000, 100, 2.05],
      [250, 500, 10, 0.2828], [250, 500, 100, 0.8944], [1000, 1e6, 10, 0.011], [1000, 1e6, 100, 0.101],
    ];
    for (const [v, a, d, expected] of rows) {
      await e.run("robot.setSpeed", { robot: robot.id, linear: v, linearAccel: a });
      t(await upd([["L", await ct(mul(P0, transl(0, d, 0)))]]), expected);
    }
    await e.run("robot.setSpeed", { robot: robot.id, jointAccel: 1e6 });
    t(await upd([["J", await jt([90, 0, 0, 0, 30, 0])]]), 0.4502);
    await e.run("robot.setSpeed", { robot: robot.id, linear: 1000, joint: 200, linearAccel: 1500, jointAccel: 150 });
  });
});

describeAbb("probe2 T5–T10: instructions in the estimate (R-PROG-20..24)", () => {
  it("T5 Set Speed instructions are not applied by Update()", async () => {
    const l100 = await ct(mul(P0, transl(0, 100, 0)));
    t(await upd([["S", [50]], ["L", l100]]), 0.5164);
    t(await upd([["S", [-1, 10, -1, 10]], ["J", await jt([90, 0, 0, 0, 30, 0])]]), 1.5492);
  });
  it("T6 rotation-only MoveL uses the joint profile on the largest joint change", async () => {
    t(await upd([["L", await ct(mul(P0, rotz(45 * DEG)))]]), 1.0954);
    t(await upd([["L", await ct(mul(P0, rotz(90 * DEG)))]]), 1.5492);
    t(await upd([["L", await ct(mul(P0, rotx(10 * DEG)))]]), 0.8587);
    t(await upd([["L", await ct(mul(P0, roty(30 * DEG)))]]), 1.1053);
    const rows: [number, number][] = [[0.001, 1.5492], [0.0011, 0.0017], [0.01, 0.0052], [1, 0.0516], [100, 0.5164]];
    for (const [dy, expected] of rows) t(await upd([["L", await ct(mul(mul(P0, transl(0, dy, 0)), rotz(90 * DEG)))]]), expected);
  });
  it("T7 MoveC uses the arc length", async () => {
    const A = await ct(mul(P0, transl(0, 50, 0)));
    const B = await ct(mul(P0, transl(50, 100, 0)));
    const C = await ct(mul(P0, transl(0, 150, 0)));
    const u = await upd([["L", A], ["C", [B, C]]]);
    t(u, 1.0124);
    expect(near(u[2], 207.0796, 1e-3)).toBe(true);
  });
  it("T8 rounding does not change the estimate", async () => {
    const sq = [await ct(mul(P0, transl(0, 100, 0))), await ct(mul(P0, transl(100, 100, 0))), await ct(mul(P0, transl(100, 0, 0))), await ct(P0)];
    for (const r of [-1, 5, 50]) t(await upd([["R", r], ...sq.map((s) => ["L", s] as Move)]), 2.0656);
  });
  it("T9 pauses add their duration; Stop and 0 add nothing", async () => {
    const l100 = await ct(mul(P0, transl(0, 100, 0)));
    for (const [ms, expected] of [[500, 1.0164], [1234, 1.7504], [0, 0.5164], [-1, 0.5164]]) t(await upd([["L", l100], ["P", ms]]), expected);
  });
  it("T10 program calls are expanded; a missing call adds nothing and counts as valid", async () => {
    await upd([["J", await jt([45, 0, 0, 0, 30, 0])]], J0, "Sub45");
    const u = await upd([["CALL", "Sub45"]]);
    expect(u[0]).toBe(3);
    t(u, 1.0954);
    expect(near(u[2], 354.1758, 1e-3)).toBe(true);
    const m = await upd([["CALL", "NoSuchProgram"]]);
    expect(m.slice(0, 4)).toEqual([3, 0, 0, 1]);
  });
});
