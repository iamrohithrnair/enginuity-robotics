// Verifies instruction edits for target shifts, motion types, reference/tool settings, and events.
 
 
import { describe, expect, it } from "vitest";
import { lockedText, toolShift } from "@/engine/commands/instructions";
import { inv, mul, poseToXYZRPW, rotz, transl, DEG } from "@/engine/math";
import type { Item } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import { engine } from "../helpers";

type Id = { id: string; name?: string };

async function cell() {
  const e = await engine();
  const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
  const frame = (await e.run("item.addFrame", { name: "Work" })) as unknown as Id;
  await e.run("robot.setActiveFrame", { robot: robot.id, frame: frame.id });
  await e.run("robot.setJoints", { robot: robot.id, joints: [0, 0, 0, 0, 30, 0] });
  const t1 = (await e.run("target.teach", { robot: robot.id, name: "T1" })) as unknown as Id;
  await e.run("robot.setJoints", { robot: robot.id, joints: [10, 10, 0, 0, 30, 0] });
  const t2 = (await e.run("target.teach", { robot: robot.id, name: "T2", isJoint: true })) as unknown as Id;
  const prog = (await e.run("program.add", { name: "P", robot: robot.id })) as unknown as Id;
  const m1 = (await e.run("program.addMoveL", { program: prog.id, target: t1.id })) as unknown as Id;
  const m2 = (await e.run("program.addMoveJ", { program: prog.id, target: t2.id })) as unknown as Id;
  return { e, robot, frame, t1, t2, prog, m1, m2 };
}

const item = (e: Awaited<ReturnType<typeof engine>>, id: string) => e.ws.items[id] as Item;
const close = (a: number[], b: number[], tol = 1e-6) => a.every((v, k) => Math.abs(v - b[k]) < tol);

describe("Modify ▸ Offset Targets (FUN_1004ec3d0)", () => {
  it("shifts Cartesian targets in their reference frame and marks the instruction with '*'", async () => {
    const c = await cell();
    const before = item(c.e, c.t1.id).pose.slice();
    const r = (await c.e.run("instruction.offsetTargets", { instructions: [c.m1.id, c.m2.id], offset: [10, -5, 2] })) as unknown as { altered: string[]; jointSpace: string[]; message: string };
    expect(close(item(c.e, c.t1.id).pose, mul(transl(10, -5, 2), before))).toBe(true);
    expect(item(c.e, c.m1.id).name).toBe("MoveL (T1)*");
     
    expect(r.jointSpace).toEqual(["MoveJ (T2)"]);
    expect(r.message).toBe("The following Move instructions were not altered because the position is defined in joint space:<br>MoveJ (T2)<br>");
    expect(item(c.e, c.m2.id).name).toBe("MoveJ (T2)");
  });

  it("ignores a shift shorter than 0.001 mm", async () => {
    const c = await cell();
    const before = item(c.e, c.t1.id).pose.slice();
    const r = (await c.e.run("instruction.offsetTargets", { instructions: [c.m1.id], offset: [0.0005, 0, 0] })) as unknown as { altered: string[] };
    expect(r.altered).toEqual([]);
    expect(item(c.e, c.t1.id).pose).toEqual(before);
    expect(item(c.e, c.m1.id).name).toBe("MoveL (T1)");
  });
});

describe("Modify ▸ Relative Tool Shift (FUN_1004ec3d0)", () => {
  it("post-multiplies the target pose by the TCP shift and renames ' (Tx 1.0)'", async () => {
    const c = await cell();
    const before = item(c.e, c.t1.id).pose.slice();
    await c.e.run("instruction.relativeToolShift", { instructions: [c.m1.id], axis: "Tx", value: 1 });
    expect(close(item(c.e, c.t1.id).pose, mul(before, transl(1, 0, 0)))).toBe(true);
    expect(item(c.e, c.m1.id).name).toBe("MoveL (T1) (Tx 1.0)");
  });

  it("rotations are in degrees about the tool axes", async () => {
    const c = await cell();
    const before = item(c.e, c.t1.id).pose.slice();
    await c.e.run("instruction.relativeToolShift", { instructions: [c.m1.id], axis: "Rz", value: 90 });
    expect(close(item(c.e, c.t1.id).pose, mul(before, rotz(90 * DEG)), 1e-6)).toBe(true);
    expect(close(toolShift("Ty", 2.5), transl(0, 2.5, 0))).toBe(true);
    expect(item(c.e, c.m1.id).name).toBe("MoveL (T1) (Rz 90.0)");
  });
});

describe("move types and target types", () => {
  it("Set Move Joint / Linear / Search Linear rename the moves; circular moves are left alone", async () => {
    const c = await cell();
    await c.e.run("instruction.setMoveType", { instructions: [c.m1.id, c.m2.id], moveType: "joint" });
    expect([item(c.e, c.m1.id).name, item(c.e, c.m2.id).name]).toEqual(["MoveJ (T1)", "MoveJ (T2)"]);
    await c.e.run("instruction.setMoveType", { instructions: [c.m1.id], moveType: "search" });
    expect(item(c.e, c.m1.id).name).toBe("SearchL (T1)");
    expect(item(c.e, c.m1.id).instruction?.moveType).toBe("search");
  });

  it("Set as Joint / Cartesian Targets switches the linked targets", async () => {
    const c = await cell();
    await c.e.run("instruction.setTargetType", { instructions: [c.m1.id, c.m2.id], joint: true });
    expect([item(c.e, c.t1.id).target?.isJoint, item(c.e, c.t2.id).target?.isJoint]).toEqual([true, true]);
    await c.e.run("instruction.setTargetType", { instructions: [c.m2.id], joint: false });
    expect(item(c.e, c.t2.id).target?.isJoint).toBe(false);
  });

  it("Select Targets selects the linked targets; Hide Target Objects hides them", async () => {
    const c = await cell();
    await c.e.run("instruction.selectLinked", { instructions: [c.m1.id, c.m2.id] });
    expect(c.e.ws.selection).toEqual([c.t1.id, c.t2.id]);
    await c.e.run("instruction.hideTargets", { instructions: [c.m1.id] });
    expect(item(c.e, c.t1.id).visible).toBe(false);
    expect(item(c.e, c.t2.id).visible).toBe(true);
  });
});

describe("Move ▸ Teach Current Position (FUN_100099e70)", () => {
  it("re-teaches the linked target from the robot's current joints", async () => {
    const c = await cell();
    await c.e.run("robot.setJoints", { robot: c.robot.id, joints: [20, -10, 5, 0, 40, 0] });
    await c.e.run("instruction.teachCurrentPosition", { instruction: c.m1.id });
    expect(item(c.e, c.t1.id).target?.joints).toEqual([20, -10, 5, 0, 40, 0]);
     
    const fk = (await c.e.run("robot.solveFK", { robot: c.robot.id, joints: [20, -10, 5, 0, 40, 0], withTool: true })) as unknown as { pose: number[] };
    const parent = item(c.e, c.t1.id).parent!;
    const tcpRel = mul(inv(absPose(c.e.ws, parent)), mul(absPose(c.e.ws, c.robot.id), fk.pose));
    expect(close(item(c.e, c.t1.id).pose, tcpRel, 1e-4)).toBe(true);
  });
});

describe("Set Ref. / Set Tool links (FUN_1000a5d0c, FUN_1000a2ce0)", () => {
  it("Remove Reference Link keeps the pose; Force Original Pose and Copy Reference Pose use it", async () => {
    const c = await cell();
    const f = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "frame", frame: c.frame.id })) as unknown as Id;
    expect(item(c.e, f.id).name).toBe("Set Ref.: Work");
    await c.e.run("instruction.setLink", { instruction: f.id, item: null });
    expect(item(c.e, f.id).name).toBe("Change Frame");
    const stored = item(c.e, f.id).instruction!.pose!;
    const expected = mul(inv(absPose(c.e.ws, c.robot.id)), absPose(c.e.ws, c.frame.id));
    expect(close(stored, expected, 1e-9)).toBe(true);
    const copy = (await c.e.run("instruction.copyPose", { instruction: f.id })) as unknown as { clipboardText: string };
    expect(copy.clipboardText.split("\n")).toHaveLength(4);
    expect(copy.clipboardText.split("\n")[0].split(", ")).toHaveLength(4);
    await c.e.run("instruction.setLink", { instruction: f.id, item: c.frame.id });
    expect(item(c.e, f.id).name).toBe("Set Ref.: Work");
    await c.e.run("instruction.forceOriginalPose", { instruction: f.id, force: true });
    expect(item(c.e, f.id).instruction?.forcePose).toBe(true);
  });
});

describe("Event ▸ Record all Objects (FUN_1000c9850)", () => {
  it("turns the event into a relative set-position event of every object", async () => {
    const c = await cell();
    const box = (await c.e.run("object.addShape", { shape: "box", name: "Box" })) as unknown as Id;
    await c.e.run("item.setPose", { item: box.id, xyzrpw: [100, 200, 0, 0, 0, 0] });
    const ev = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "event", eventAction: "attach" })) as unknown as Id;
    await c.e.run("event.recordAllObjects", { instruction: ev.id });
    const e = item(c.e, ev.id).instruction!.event!;
    expect(e.action).toBe("move");
    expect(e.relative).toBe(true);
    expect(e.positions?.map((p) => p.item)).toEqual([box.id]);
    expect(poseToXYZRPW(e.positions![0].pose).slice(0, 3)).toEqual([100, 200, 0]);
    expect(item(c.e, ev.id).name).toBe("Move Box");
  });
});

describe("Execute Instruction / Skip Wait", () => {
  it("runs exactly one instruction through the simulator at its index", async () => {
    const c = await cell();
    const starts: unknown[] = [];
    const skips: unknown[] = [];
    c.e.services.runner = { start: (id, o) => starts.push([id, o]), stopAll: () => undefined, moveRobot: () => undefined, skipWait: (id) => (skips.push(id), []) };
    await c.e.run("program.executeInstruction", { instruction: c.m2.id });
    expect(starts).toEqual([[c.prog.id, { startAt: 1, count: 1 }]]);
    await c.e.run("program.skipWait", { instruction: c.m1.id });
    expect(skips).toEqual([c.prog.id]);
  });

  it("is refused for a move without robot or target", async () => {
    const c = await cell();
    c.e.services.runner = { start: () => undefined, stopAll: () => undefined, moveRobot: () => undefined };
    await c.e.run("program.setRobot", { program: c.prog.id, robot: null });
    const r = await c.e.tryRun("program.executeInstruction", { instruction: c.m1.id });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Robot or target are not valid");
  });
});

describe("insertion rules", () => {
  it("skips an insert whose 'after' reference is not in the program (R-PROG-16)", async () => {
    const c = await cell();
    const other = (await c.e.run("program.add", { name: "Q", robot: c.robot.id })) as unknown as Id;
    const q1 = (await c.e.run("program.addInstruction", { program: other.id, kind: "pause" })) as unknown as Id;
    const n = item(c.e, c.prog.id).children.length;
    const r = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "pause", after: q1.id })) as unknown as { skipped?: boolean };
    expect(r.skipped).toBe(true);
    expect(item(c.e, c.prog.id).children).toHaveLength(n);
  });

  it("opens the editor after a GUI insert of Program Call, Show Message, Set Speed and Set Rounding", async () => {
    const c = await cell();
    for (const kind of ["call", "print", "speed", "rounding", "pause"]) {
      c.e.events.length = 0;
      const r = (await c.e.run("program.addInstruction", { program: c.prog.id, kind }, "ui")) as unknown as Id;
      const opened = c.e.events.filter((x) => x.type === "edit-instruction").map((x) => x.instruction);
      expect(opened).toEqual(kind === "pause" ? [] : [r.id]);
    }
     
    c.e.events.length = 0;
    await c.e.run("program.addInstruction", { program: c.prog.id, kind: "print", text: "hi" }, "api");
    await c.e.run("program.addInstruction", { program: c.prog.id, kind: "speed", linear: 100 }, "api");
    expect(c.e.events.filter((x) => x.type === "edit-instruction")).toHaveLength(0);
    await c.e.run("program.addInstruction", { program: c.prog.id, kind: "print" }, "api");
    expect(c.e.events.filter((x) => x.type === "edit-instruction")).toHaveLength(1);
  });

  it("adds Select Robot (type 5), custom (type 12) and Search Linear instructions", async () => {
    const c = await cell();
    const s = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "robot", robot: c.robot.id })) as unknown as Id;
    expect(item(c.e, s.id).name).toBe(`Select Robot: ${item(c.e, c.robot.id).name}`);
    const cu = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "custom", name: "Glue", path: "glue.py", blocking: false })) as unknown as Id;
    expect(item(c.e, cu.id).params).toMatchObject({ PathRunSim: "glue.py", Blocking: "0" });
    await c.e.run("instruction.setCustom", { instruction: cu.id, name: "Glue2", blocking: true });
    expect(item(c.e, cu.id).name).toBe("Glue2");
    expect(item(c.e, cu.id).params?.Blocking).toBe("1");
    const sl = (await c.e.run("program.addSearchL", { program: c.prog.id, target: c.t1.id })) as unknown as Id;
    expect(item(c.e, sl.id).name).toBe("SearchL (T1)");
  });
});

describe("Locked programs (R-ERR-27)", () => {
  it("refuse changes with RoboDK's message", async () => {
    const c = await cell();
    await c.e.run("program.setFlags", { programs: [c.prog.id], locked: true });
    const add = await c.e.tryRun("program.addInstruction", { program: c.prog.id, kind: "pause" });
    expect(add.error).toBe(lockedText("P"));
    expect(lockedText("P")).toBe("The program P is running or it is locked and it can't be modified.");
    const edit = await c.e.tryRun("instruction.edit", { instruction: c.m1.id, moveType: "joint" });
    expect(edit.error).toBe(lockedText("P"));
    const teach = await c.e.tryRun("target.update", { target: c.t1.id });
    expect(teach.error).toBe(lockedText("P"));
    await c.e.run("program.setFlags", { programs: [c.prog.id], locked: false });
    expect((await c.e.tryRun("program.addInstruction", { program: c.prog.id, kind: "pause" })).ok).toBe(true);
  });
});

describe("Simulation Event names (InsEvent_UpdateName FUN_1000c68fc)", () => {
  it("an event whose tool or single object is missing keeps the name 'Not defined'", async () => {
    const c = await cell();
    const ev = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "event", eventAction: "attach" })) as unknown as Id;
     
    expect(item(c.e, ev.id).name).toBe("Not defined");
    const tool = (await c.e.run("robot.addTool", { robot: c.robot.id, name: "Gripper" })) as unknown as Id;
    const ev2 = (await c.e.run("program.addInstruction", { program: c.prog.id, kind: "event", eventAction: "detach", tool: tool.id })) as unknown as Id;
    expect(item(c.e, ev2.id).name).toBe("Detach from Gripper");
    await c.e.run("item.delete", { items: [tool.id] });
    expect(item(c.e, ev2.id).name).toBe("Detach from Gripper");
  });
});
