// Verifies simulation seeking places the robot on its path and selects the running instruction.
 
import { describe, expect, it } from "vitest";
import { planProgram } from "@/engine/sim/planner";
import { engine } from "../helpers";

type Id = { id: string };

async function cell() {
  const e = await engine();
  const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
  await e.run("robot.setJoints", { robot: robot.id, joints: [0, 0, 0, 0, 30, 0] });
  const a = (await e.run("target.add", { name: "A", robot: robot.id, joints: [30, 0, 0, 0, 30, 0] })) as unknown as Id;
  const b = (await e.run("target.add", { name: "B", robot: robot.id, joints: [30, -20, 10, 0, 40, 0] })) as unknown as Id;
  const p = (await e.run("program.add", { name: "Seq", robot: robot.id })) as unknown as Id;
  await e.run("program.addMoveJ", { program: p.id, target: a.id });
  await e.run("program.addMoveJ", { program: p.id, target: b.id });
  return { e, robot: robot.id, program: p.id };
}

describe("program.seek (simulation sequence slider)", () => {
  it("places the robot along the planned program and selects the running instruction", async () => {
    const { e, robot, program } = await cell();
    const plan = planProgram(e.ws, program);
    expect(plan.duration).toBeGreaterThan(0);
    const undoBefore = e.undo.list().undo.length;

    const end = (await e.run("program.seek", { program, t: plan.duration * 10 })) as unknown as { t: number; instruction: string };
    expect(end.t).toBeCloseTo(plan.duration, 9);
    expect(e.ws.items[robot].robot!.joints.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([30, -20, 10, 0, 40, 0]);
    expect(e.ws.items[e.ws.selection[0]].name).toBe(end.instruction);

     
    const from = [0, 0, 0, 0, 30, 0];
    const start = (await e.run("program.seek", { program, t: 0, from })) as unknown as { joints: number[] };
    expect(start.joints.map((v) => Math.round(v * 1e6) / 1e6)).toEqual(from);
    const first = plan.segments[0];
    const mid = (await e.run("program.seek", { program, t: (first.t0 + first.t1) / 2, from })) as unknown as { joints: number[]; instruction: string };
    expect(mid.joints[0]).toBeGreaterThan(0);
    expect(mid.joints[0]).toBeLessThan(30);
    expect(mid.instruction).toBe(e.ws.items[first.instruction].name);

    expect(e.undo.list().undo.length).toBe(undoBefore);
  });

  it("refuses programs without a robot", async () => {
    const e = await engine();
    const p = (await e.run("program.add", { name: "Lonely" })) as unknown as Id;
    const r = await e.tryRun("program.seek", { program: p.id, t: 0 });
    expect(r.ok).toBe(false);
  });
});
