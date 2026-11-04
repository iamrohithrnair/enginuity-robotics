import { z } from "zod";
import { requireRef, resolveRef } from "../dispatch";
import { xyzrpwToPose } from "../math";
import { autoName, instructionName } from "../naming";
import { CommandError, defineCommand, ItemRef, Joints, Pose, status, XYZRPW, type CmdCtx } from "../registry";
import type { InstructionData, Item, Workspace } from "../types";
import type { Tx } from "../tx";
import { absPose, firstRobot, listItems, makeItem } from "../workspace";
import { activeStationId } from "./items";
import { requireRobot } from "./robot";
import { createTarget, defaultTargetRobot } from "./targets";
import { checkCollisions } from "../collision";
import { planProgram } from "../sim/planner";
import { commitJoints, jointOverridesOf } from "../sync/axes";
import { assertProgramEditable } from "./instructions";

 
let lastProgram: string | null = null;

export function requireProgram(ws: Workspace, ref: string | number | undefined): Item {
  if (ref === undefined) {
    const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "program" || i?.type === "instruction");
    if (sel?.type === "program") return sel;
    if (sel?.type === "instruction" && sel.parent) return ws.items[sel.parent];
    if (lastProgram && ws.items[lastProgram]?.type === "program") return ws.items[lastProgram];
    const progs = listItems(ws, { type: "program" });
    if (progs.length === 1) return progs[0];
    throw new CommandError("Select a program first");
  }
  const it = requireRef(ws, ref, "program");
  if (it.type !== "program") throw new CommandError(`${it.name} is not a program`);
  return it;
}






 
export function instructionSelectedIn(ws: Workspace, prog: Item): boolean {
  return ws.selection.some((s) => ws.items[s]?.type === "instruction" && ws.items[s]?.parent === prog.id);
}

 
function selectAfterInsert(ws: Workspace, tx: Tx, prog: Item, ins: Item, hadReference: boolean) {
  if (hadReference) tx.setMeta("selection", [ins.id]);
}

export function addInstruction(ws: Workspace, tx: Tx, prog: Item, data: InstructionData, after?: string | null, append = false): Item {
  const ins = makeItem(ws, "instruction", instructionName(ws, data), { instruction: data });
  let index: number | undefined;
  const ref = after ?? (append ? undefined : ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "instruction" && i.parent === prog.id)?.id);
  if (ref) {
    const k = ws.items[prog.id].children.indexOf(ref);
    if (k >= 0) index = k + 1;
  }
  tx.add(ins, prog.id, index);
  tx.split(`Add: ${ins.name}`);
  lastProgram = prog.id;
  return ins;
}







function afterRef(ws: Workspace, prog: Item, after: string | number | undefined): string | undefined | null {
  if (after === undefined) return undefined;
  const ref = requireRef(ws, after);
  return prog.children.includes(ref.id) ? ref.id : null;
}

const SKIPPED = { skipped: true, warning: "NodeProgram::Add_Instruction_skip_update: after item provided does not exist in current program" };






function openEditor(ctx: CmdCtx, ins: Item, apiEmpty: boolean) {
  if (ctx.origin === "ui" || (ctx.origin === "api" && apiEmpty)) ctx.services.emit?.({ type: "edit-instruction", instruction: ins.id });
}

 
function programRobot(ws: Workspace, ref: string | number | undefined): Item | undefined {
  if (ref !== undefined) return requireRobot(ws, ref);
  return defaultTargetRobot(ws) ?? firstRobot(ws);
}

export function createProgram(ctx: Pick<CmdCtx, "ws" | "tx">, name: string | undefined, robot: Item | undefined): Item {
  const { ws, tx } = ctx;
  const st = activeStationId(ws);
  const prog = makeItem(ws, "program", name ?? autoName(ws, st, "program"), { program: { robot: robot?.id ?? null } });
  tx.add(prog, st);
  tx.split(`Add: ${prog.name}`);
  lastProgram = prog.id;
  return prog;
}

defineCommand({
  name: "program.add",
  title: "Add Program",
  description:
    "Add a program ('ProgN', counting programs and Python programs) at the station root, linked to the given/selected/first robot. With targets selected (UI) it creates a program moving through them.",
  category: "program",
  spec: "R-TREE-5, R-TREE-13",
  schema: z.object({ name: z.string().optional(), robot: ItemRef.optional(), targets: z.array(ItemRef).optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const robot = programRobot(ws, p.robot);
    const prog = createProgram(ctx, p.name, robot);
    const targets = (p.targets ?? (ctx.origin === "ui" ? ws.selection : []))
      .map((r) => resolveRef(ws, r))
      .filter((i): i is Item => i?.type === "target");
    for (const t of targets) addInstruction(ws, tx, prog, { kind: "move", moveType: "joint", target: t.id }, null, true);
    tx.setMeta("selection", [prog.id]);
    ctx.undoLabel = null;
    return { id: prog.id, name: prog.name, handle: prog.handle };
  },
});

defineCommand({
  name: "program.setRobot",
  title: "Program Robot",
  description: "Link a program to a robot (or none).",
  category: "program",
  undoable: false,
  spec: "R-TREE-13, R-TREE-43",
  schema: z.object({ program: ItemRef, robot: ItemRef.nullable() }),
  run({ ws, tx }, p) {
    const prog = requireProgram(ws, p.program);
    const r = p.robot === null ? null : requireRobot(ws, p.robot);
    tx.set(prog.id, { program: { ...prog.program, robot: r?.id ?? null } });
    return { robot: r?.name ?? null };
  },
});

const MoveSchema = z.object({
  program: ItemRef.optional(),
  target: ItemRef.optional().describe("Existing target; when omitted the selected target is used, else a new target is taught at the robot's current position"),
  joints: Joints.optional().describe("Target-less move to joint values (API MoveJ(joints))"),
  pose: Pose.optional().describe("Target-less move to an absolute TCP pose"),
  xyzrpw: XYZRPW.optional(),
  after: ItemRef.optional(),
  createTarget: z.boolean().default(true).describe("false = store joints/pose in the instruction instead of creating a target"),
});

let moveIndex = 0;

function moveCommand(name: string, title: string, moveType: "joint" | "linear" | "search") {
  defineCommand({
    name,
    title,
    description:
      moveType === "search"
        ? "Search Linear instruction (SearchL, MOVE_TYPE_LINEARSEARCH): a linear move toward the given or selected target that stops where its input triggers; otherwise like a linear move (a new 'Target N' is taught at the robot's current position). Inserted after the selected instruction, else at the end."
        : `${title} (R-PROG-8): uses the given or selected target; otherwise a new 'Target N' is taught at the robot's current position in its active frame. Inserted after the selected instruction, else at the end.`,
    category: "program",
    spec: "R-PROG-8, R-PROG-16",
    schema: MoveSchema,
    run(ctx, p) {
      const { ws, tx } = ctx;
      const prog = requireProgram(ws, p.program);
      assertProgramEditable(ws, prog);
      const after = afterRef(ws, prog, p.after);
      if (after === null) return SKIPPED;
      const robot = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
      let data: InstructionData;
      const pose = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : undefined);
      if (p.target !== undefined) {
        const t = requireRef(ws, p.target, "target");
        if (t.type !== "target") throw new CommandError(`${t.name} is not a target`);
        data = { kind: "move", moveType, target: t.id };
      } else if ((p.joints || pose) && !p.createTarget) {
        moveIndex += 1;
        data = { kind: "move", moveType, joints: p.joints, pose, index: moveIndex };
      } else {
        const sel = !p.joints && !pose ? ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "target") : undefined;
        if (sel) data = { kind: "move", moveType, target: sel.id };
        else {
          if (!robot?.robot) throw new CommandError("Select robot first");
          const t = createTarget(ctx, robot, { joints: p.joints, pose, isJoint: !!p.joints && !pose, absolute: true });
          data = { kind: "move", moveType, target: t.id };
        }
      }
      const hadRef = after !== undefined || instructionSelectedIn(ws, prog);
      const ins = addInstruction(ws, tx, prog, data, after);
      selectAfterInsert(ws, tx, prog, ins, hadRef);
      ctx.undoLabel = null;
      return { id: ins.id, name: ins.name, target: data.target ? ws.items[data.target]?.name : null };
    },
  });
}
moveCommand("program.addMoveJ", "Move Joint Instruction", "joint");
moveCommand("program.addMoveL", "Move Linear Instruction", "linear");
moveCommand("program.addSearchL", "Search Linear Instruction", "search");

defineCommand({
  name: "program.addMoveC",
  title: "Move Circular Instruction",
  description: "Add a circular move through `via` to `target`. From the UI the two selected targets are used.",
  category: "program",
  spec: "R-PROG-8",
  schema: z.object({ program: ItemRef.optional(), via: ItemRef.optional(), target: ItemRef.optional(), after: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const prog = requireProgram(ws, p.program);
    assertProgramEditable(ws, prog);
    const after = afterRef(ws, prog, p.after);
    if (after === null) return SKIPPED;
    const selTargets = ws.selection.map((s) => ws.items[s]).filter((i) => i?.type === "target");
    const a = p.via !== undefined ? requireRef(ws, p.via, "target") : selTargets[0];
    const b = p.target !== undefined ? requireRef(ws, p.target, "target") : selTargets[1];
    if (!a || !b || a.type !== "target" || b.type !== "target") {
      throw new CommandError("Robtargets are not properly defined. Select two targets before adding a move circular instruction.");
    }
    const hadRef = after !== undefined || instructionSelectedIn(ws, prog);
    const ins = addInstruction(ws, tx, prog, { kind: "movec", moveType: "circular", target: a.id, target2: b.id }, after);
    selectAfterInsert(ws, tx, prog, ins, hadRef);
    ctx.undoLabel = null;
    return { id: ins.id, name: ins.name };
  },
});






defineCommand({
  name: "program.addInstruction",
  title: "Add Program Instruction",
  description:
    "Add a non-motion instruction: speed (linear mm/s, joint deg/s, accelerations; -1 = unset), rounding (mm, -1 = Accurate), frame/tool change, pause (ms, -1 = Stop), print (message), comment, call (program call), thread (start program in parallel), code (insert raw code), io (set digital/analog output or wait for digital input), event (attach/detach/show/hide/home), robot (Select Robot: following moves use that robot), custom (named instruction running an executable or .py script: path, icon, blocking, 'Run on Robot' command). From the UI, Program Call, Show Message, Set Speed and Set Rounding open their editor after the insert.",
  category: "program",
  spec: "R-PROG-1..16",
  schema: z.object({
    program: ItemRef.optional(),
    kind: z.enum(["speed", "rounding", "frame", "tool", "pause", "print", "comment", "call", "thread", "code", "io", "event", "robot", "custom"]),
    linear: z.number().optional(),
    joint: z.number().optional(),
    linearAccel: z.number().optional(),
    jointAccel: z.number().optional(),
    rounding: z.number().optional(),
    frame: ItemRef.optional(),
    tool: ItemRef.optional(),
    pauseMs: z.number().optional(),
    text: z.string().optional(),
    ioMode: z.enum(["set", "wait"]).optional(),
    ioName: z.string().optional(),
    ioValue: z.union([z.string(), z.number()]).optional(),
    analog: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    eventAction: z.enum(["attach", "detach", "show", "hide", "home", "conveyor", "create", "remove", "wait"]).optional(),
    objects: z.array(ItemRef).optional(),
    robot: ItemRef.optional().describe("Select Robot instruction: the robot following moves use (default: the selected robot, else the program's robot)"),
    name: z.string().optional().describe("custom instruction name"),
    path: z.string().optional().describe("custom instruction: executable or .py file run in simulation"),
    icon: z.string().optional().describe("custom instruction: icon file"),
    blocking: z.boolean().optional().describe("custom instruction: wait for the executable to finish (default true)"),
    robotCommand: z.string().optional().describe("custom instruction: 'Run on Robot' command"),
    after: ItemRef.optional(),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const prog = requireProgram(ws, p.program);
    assertProgramEditable(ws, prog);
    const after = afterRef(ws, prog, p.after);
    if (after === null) return SKIPPED;
    const robot = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
    let data: InstructionData;
    let params: Record<string, string> | undefined;
    switch (p.kind) {
      case "speed": {
        const none = p.linear === undefined && p.joint === undefined && p.linearAccel === undefined && p.jointAccel === undefined;
        data = { kind: "speed", speed: { linear: none ? 500 : p.linear ?? -1, joint: p.joint ?? -1, linearAccel: p.linearAccel ?? -1, jointAccel: p.jointAccel ?? -1 } };
        break;
      }
      case "rounding":
        data = { kind: "rounding", rounding: p.rounding ?? -1 };
        break;
      case "frame": {
         
         
        const f = p.frame !== undefined ? requireRef(ws, p.frame, "frame") : robot?.parent ? ws.items[robot.parent] : undefined;
        data = { kind: "frame", frame: f?.id ?? null };
        break;
      }
      case "tool": {
        const t = p.tool !== undefined ? requireRef(ws, p.tool, "tool") : robot?.robot?.activeTool ? ws.items[robot.robot.activeTool] : undefined;
        data = { kind: "tool", tool: t?.id ?? null };
        break;
      }
      case "pause":
        data = { kind: "pause", pauseMs: p.pauseMs ?? 500 };
        break;
      case "print":
        data = { kind: "print", text: p.text || "Display message" };
        break;
      case "comment":
        data = { kind: "code", codeType: 3, text: p.text ?? "" };
        break;
      case "call":
        data = { kind: "code", codeType: 0, text: p.text ?? "Program1" };
        break;
      case "thread":
        data = { kind: "code", codeType: 2, text: p.text ?? "Program1" };
        break;
      case "code":
        data = { kind: "code", codeType: 1, text: p.text ?? "" };
        break;
      case "io":
        data = {
          kind: "io",
          io: { mode: p.ioMode ?? "set", name: p.ioName ?? "5", value: String(p.ioValue ?? 1), timeoutMs: p.timeoutMs, analog: p.analog || undefined },
        };
        break;
      case "event": {
        const tool = p.tool !== undefined ? requireRef(ws, p.tool, "tool").id : robot?.robot?.activeTool ?? null;
        const objects = (p.objects ?? []).map((r) => requireRef(ws, r).id);
        const frame = p.frame !== undefined ? requireRef(ws, p.frame, "frame").id : robot?.robot?.activeFrame ?? null;
        data = { kind: "event", event: { action: p.eventAction ?? "attach", tool, objects, frame, distance: 200 } };
        break;
      }
      case "robot": {
         
        const r = p.robot !== undefined ? requireRobot(ws, p.robot) : (ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "robot") ?? robot);
        if (!r) throw new CommandError("Select robot first");
        data = { kind: "robot", robot: r.id };
        break;
      }
      case "custom": {
         
        const name = p.name ?? p.text;
        if (!name) throw new CommandError("Enter instruction name");
        data = { kind: "custom", text: name };
        params = { PathRunSim: p.path ?? "", PathIcon: p.icon ?? "", PathRunRobot: p.robotCommand ?? "", Blocking: p.blocking === false ? "0" : "1" };
        if (ctx.origin === "agent") params.Author = "agent";
        break;
      }
    }
    const hadRef = after !== undefined || instructionSelectedIn(ws, prog);
    const ins = addInstruction(ws, tx, prog, data!, after);
    if (params) tx.set(ins.id, { params: { ...(ins.params ?? {}), ...params } });
    selectAfterInsert(ws, tx, prog, ins, hadRef);
    ctx.undoLabel = null;
    if (p.kind === "call" || p.kind === "print" || p.kind === "speed" || p.kind === "rounding") {
      const apiEmpty = (p.kind === "print" && !p.text) || (p.kind === "speed" && p.linear === undefined && p.joint === undefined && p.linearAccel === undefined && p.jointAccel === undefined);
      openEditor(ctx, ins, apiEmpty);
    }
    return { id: ins.id, name: ins.name };
  },
});

 
defineCommand({
  name: "instruction.edit",
  title: "Edit Instruction",
  description:
    "Change parameters of an instruction (target, move type, speeds, rounding, pause, text, IO, event action). The display name is regenerated from the parameters.",
  category: "program",
  undoable: false,
  spec: "R-PROG-2, R-PROG-3, R-PROG-59",
  schema: z.object({
    instruction: ItemRef,
    target: ItemRef.optional(),
    target2: ItemRef.optional(),
    moveType: z.enum(["joint", "linear", "search"]).optional(),
    rounding: z.number().optional(),
    pauseMs: z.number().optional(),
    text: z.string().optional(),
    codeType: z.number().int().min(0).max(3).optional(),
    linear: z.number().optional(),
    joint: z.number().optional(),
    linearAccel: z.number().optional(),
    jointAccel: z.number().optional(),
    ioMode: z.enum(["set", "wait"]).optional(),
    ioValue: z.union([z.string(), z.number()]).optional(),
    ioName: z.string().optional(),
    analog: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    frame: ItemRef.nullable().optional(),
    tool: ItemRef.nullable().optional(),
    eventAction: z.enum(["attach", "detach", "show", "hide", "home", "conveyor", "create", "remove", "wait"]).optional(),
    robot: ItemRef.optional().describe("Select Robot instruction: the robot"),
  }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.instruction, "instruction");
    if (!it.instruction) throw new CommandError(`${it.name} is not an instruction`);
    const prog = it.parent ? ws.items[it.parent] : undefined;
    if (prog?.type === "program") assertProgramEditable(ws, prog);
    const ins = structuredClone(it.instruction);
    if (p.target !== undefined) ins.target = requireRef(ws, p.target, "target").id;
    if (p.target2 !== undefined) ins.target2 = requireRef(ws, p.target2, "target").id;
    if (p.moveType && ins.kind === "move") ins.moveType = p.moveType;
    if (p.rounding !== undefined) ins.rounding = p.rounding;
    if (p.pauseMs !== undefined) ins.pauseMs = p.pauseMs;
    if (p.text !== undefined) ins.text = p.text;
    if (p.codeType !== undefined && ins.kind === "code") ins.codeType = p.codeType;
    if (ins.speed) {
      ins.speed = {
        linear: p.linear ?? ins.speed.linear,
        joint: p.joint ?? ins.speed.joint,
        linearAccel: p.linearAccel ?? ins.speed.linearAccel,
        jointAccel: p.jointAccel ?? ins.speed.jointAccel,
      };
    }
    if (ins.io) {
      ins.io = {
        ...ins.io,
        mode: p.ioMode ?? ins.io.mode,
        name: p.ioName ?? ins.io.name,
        value: p.ioValue !== undefined ? String(p.ioValue) : ins.io.value,
        analog: p.analog ?? ins.io.analog,
        timeoutMs: p.timeoutMs ?? ins.io.timeoutMs,
      };
    }
    if (p.frame !== undefined) ins.frame = p.frame === null ? null : requireRef(ws, p.frame, "frame").id;
    if (p.tool !== undefined) ins.tool = p.tool === null ? null : requireRef(ws, p.tool, "tool").id;
    if (ins.event && p.eventAction) ins.event = { ...ins.event, action: p.eventAction };
    if (p.robot !== undefined && ins.kind === "robot") ins.robot = requireRobot(ws, p.robot).id;
    const name = instructionName(ws, ins);
    tx.set(it.id, { instruction: ins, name });
    return { id: it.id, name };
  },
});





defineCommand({
  name: "program.update",
  title: "Check Program",
  description:
    "Validate and estimate a program, like the API's Update(): returns [valid instructions, cycle time (s), path length (mm), valid ratio (1 ok, 0 kinematic failure, fraction before a collision), message]. Set checkCollisions to test collisions along the path. The time uses the robot's current speed state (its Set Speed / Set Rounding instructions are not run): while the robot's rounding is on, moves run at constant speed without accelerations. A program without a robot returns [-1, 0, 0, 0].",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "R-PROG-23, R-PROG-24, R-PROG-25, R-PROG-26, R-PROG-28",
  schema: z.object({ program: ItemRef.optional(), checkCollisions: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws, services } = ctx;
    const prog = requireProgram(ws, p.program);
    const st = ws.activeStation;
    const plan = planProgram(ws, prog.id, {
      stepMM: Number(services.settings.PathStepMM ?? 1),
      wristTolerance: Number(services.settings.ToleranceSingularityWrist ?? 2.5),
      collisionStepMM: Number(services.settings.PathStepCollisionMM ?? 4),
      collisionStepDeg: Number(services.settings.PathStepCollisionDeg ?? 4),
      moveTimeCalc: Number(services.settings.MoveTimeCalc ?? 3),
      collide: p.checkCollisions && st ? (robotId, q) => checkCollisions(ws, services.geometry, st, 0, jointOverridesOf(ws, robotId, q)).length > 0 : undefined,
    });
     
    const robotId = plan.collisionRobot ?? prog.program?.robot;
    const robot = robotId ? ws.items[robotId] : undefined;
    if (plan.collisionJoints && robot?.robot) commitJoints(ws, ctx.tx, robot.id, plan.collisionJoints);
    status(ctx, `Done updating ${prog.name}`);
    return [plan.validInstructions, plan.duration, plan.distance, plan.ratio, plan.message];
  },
});

defineCommand({
  name: "program.instructions",
  title: "List Instructions",
  description: "List a program's instructions with their type and parameters.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ program: ItemRef.optional() }),
  run({ ws }, p) {
    const prog = requireProgram(ws, p.program);
    return prog.children.map((c, i) => {
      const it = ws.items[c];
      const ins = it.instruction;
      return {
        index: i,
        id: it.id,
        name: it.name,
        kind: ins?.kind,
        moveType: ins?.moveType,
        target: ins?.target ? ws.items[ins.target]?.name ?? "(deleted)" : undefined,
        target2: ins?.target2 ? ws.items[ins.target2]?.name ?? "(deleted)" : undefined,
        joints: ins?.joints,
        absolute: ins?.target && ws.items[ins.target] ? absPose(ws, ins.target) : undefined,
      };
    });
  },
});
