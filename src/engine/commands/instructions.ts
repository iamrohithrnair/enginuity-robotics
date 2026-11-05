// Edits and executes instructions with program locks and linked-target checks.
import { z } from "zod";
import { requireRef } from "../dispatch";
import { fk, ikClosest } from "../kinematics";
import { DEG, eye, inv, mul, rotx, roty, rotz, transl, type Mat } from "../math";
import { instructionName } from "../naming";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";
import type { InstructionData, Item, Workspace } from "../types";
import { absPose, childFrame, descendants, toolPose } from "../workspace";
import { jointsForTarget, tcpIn } from "./targets";

 
 
 
 
 
 

 
export const lockedText = (name: string) => `The program ${name} is running or it is locked and it can't be modified.`;

export function assertProgramEditable(ws: Workspace, prog: Item) {
  if (prog.program?.locked || ws.busy?.includes(prog.id)) throw new CommandError(lockedText(prog.name), "locked");
}

 
export function programsUsingTarget(ws: Workspace, targetId: string): Item[] {
  const out: Item[] = [];
  for (const it of Object.values(ws.items)) {
    if (it.type !== "program") continue;
    if (it.children.some((c) => ws.items[c]?.instruction?.target === targetId || ws.items[c]?.instruction?.target2 === targetId)) out.push(it);
  }
  return out;
}

export function assertTargetEditable(ws: Workspace, targetId: string) {
  for (const p of programsUsingTarget(ws, targetId)) assertProgramEditable(ws, p);
}

export interface InsRef {
  it: Item;
  ins: InstructionData;
  prog: Item;
  index: number;
}

export function requireInstruction(ws: Workspace, ref: string | number): InsRef {
  const it = requireRef(ws, ref, "instruction");
  if (!it.instruction) throw new CommandError(`${it.name} is not an instruction`);
  const prog = it.parent ? ws.items[it.parent] : undefined;
  if (!prog || prog.type !== "program") throw new CommandError(`${it.name} is not part of a program`);
  return { it, ins: it.instruction, prog, index: prog.children.indexOf(it.id) };
}

 
export function robotAt(ws: Workspace, prog: Item, index: number): Item | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const ins = ws.items[prog.children[i]]?.instruction;
    if (ins?.kind === "robot" && ins.robot && ws.items[ins.robot]?.robot) return ws.items[ins.robot];
  }
  const r = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
  return r?.robot ? r : undefined;
}






export function frameAt(ws: Workspace, prog: Item, index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const ins = ws.items[prog.children[i]]?.instruction;
    if (ins?.kind === "frame" && ins.frame && ws.items[ins.frame]) return ins.frame;
  }
  return null;
}

const isMove = (ins: InstructionData) => ins.kind === "move" || ins.kind === "movec";
const targetsOf = (ws: Workspace, ins: InstructionData): Item[] =>
  [ins.target, ins.kind === "movec" ? ins.target2 : undefined].map((id) => (id ? ws.items[id] : undefined)).filter((t): t is Item => t?.type === "target");

function rename(ctx: CmdCtx, it: Item, name: string) {
  if (it.name !== name) ctx.tx.set(it.id, { name });
}

defineCommand({
  name: "program.executeInstruction",
  title: "Execute Instruction",
  description:
    "Run one instruction on its own through the simulator, exactly as the program would run it: a move takes the robot to its target, Set Ref./Set Tool/Speed/Rounding change the robot state, a Pause waits, Set IO writes the IO, Wait IO waits, an event runs, a Program Call runs the called program.",
  category: "program",
  undoable: false,
  spec: "R-PROG-59 (Execute Instruction, instruction Start vtable+0xe8)",
  schema: z.object({ instruction: ItemRef }),
  run({ ws, services }, p) {
    const { it, ins, prog, index } = requireInstruction(ws, p.instruction);
     
    if (isMove(ins)) {
      const robot = robotAt(ws, prog, index);
      const hasGoal = ins.kind === "movec" ? targetsOf(ws, ins).length === 2 : !!(ins.target ? ws.items[ins.target] : ins.joints?.length || ins.pose);
      if (!robot || !hasGoal) throw new CommandError("Robot or target are not valid");
    }
    if (!services.runner) throw new CommandError("The simulation runs on the server");
    services.runner.start(prog.id, { startAt: index, count: 1 });
    return { program: prog.name, instruction: it.name };
  },
});

defineCommand({
  name: "program.skipWait",
  title: "Skip Wait",
  description:
    "End the current wait of a running program early: a timed Pause, a Pause waiting for OK, a Wait for Digital Input (Skip DI Wait) or an event waiting for an object. Without a program every current wait ends. Nothing happens when nothing waits.",
  category: "program",
  undoable: false,
  readonly: true,
  spec: "R-PROG-59 (Skip Wait FUN_1000a1124, Skip DI Wait FUN_1006049bc)",
  schema: z.object({ program: ItemRef.optional(), instruction: ItemRef.optional() }),
  run({ ws, services }, p) {
    let prog: Item | undefined;
    if (p.instruction !== undefined) prog = requireInstruction(ws, p.instruction).prog;
    else if (p.program !== undefined) prog = requireRef(ws, p.program, "program");
    const ids = services.runner?.skipWait?.(prog?.id) ?? [];
    return { skipped: ids.map((id) => ws.items[id]?.name ?? id) };
  },
});

defineCommand({
  name: "instruction.teachCurrentPosition",
  title: "Teach Current Position",
  description:
    "Re-teach a move instruction from the robot's current position: its target (or the joints/pose stored in a target-less move) takes the robot's current joints and TCP pose.",
  category: "program",
  spec: "R-PROG-59 (Move menu FUN_100099e70)",
  schema: z.object({ instruction: ItemRef }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const { it, ins, prog, index } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "move") throw new CommandError(`${it.name} is not a move instruction`);
    const robot = robotAt(ws, prog, index);
    const target = ins.target ? ws.items[ins.target] : undefined;
    if (!robot?.robot || (ins.target && !target)) throw new CommandError("Robot or target are not valid");
    assertProgramEditable(ws, prog);
    const q = robot.robot.joints.slice();
    if (target) {
      if (!target.parent) throw new CommandError("Robot or target are not valid");
      assertTargetEditable(ws, target.id);
      tx.set(target.id, { pose: tcpIn(ws, robot, target.parent), target: { ...target.target!, joints: q, robot: robot.id } });
      ctx.undoLabel = `Move target: ${target.name}`;
      return { target: target.name, joints: q };
    }
    const tcpAbs = mul(mul(absPose(ws, robot.id), robotFk(robot, q)), toolPose(ws, robot.id));
    const next: InstructionData = { ...ins, joints: ins.joints ? q : undefined, pose: ins.pose || !ins.joints ? tcpAbs : undefined };
    tx.set(it.id, { instruction: next });
    ctx.undoLabel = `Modify: ${it.name}`;
    return { instruction: it.name, joints: q };
  },
});

function robotFk(robot: Item, q: number[]): Mat {
  return fk(robot.robot!.model, q);
}

const Instructions = z.array(ItemRef).min(1);

 
function moveInstructions(ws: Workspace, refs: (string | number)[]): InsRef[] {
  return refs.map((r) => requireInstruction(ws, r)).filter((x) => isMove(x.ins));
}

defineCommand({
  name: "instruction.selectLinked",
  title: "Select Linked Items",
  description:
    "Select the items instructions point to: the target(s) of moves (Select Target / Select Targets), the frame of Set Ref., the tool of Set Tool, the robot of Select Robot, or the program of a Program Call (Reveal in the tree).",
  category: "program",
  undoable: false,
  spec: "R-PROG-59 (Select Target / Select Reference / Select Tool / Reveal in the tree)",
  schema: z.object({ instructions: Instructions }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const ids: string[] = [];
    for (const r of p.instructions) {
      const { ins } = requireInstruction(ws, r);
      const add = (id?: string | null) => id && ws.items[id] && !ids.includes(id) && ids.push(id);
      if (isMove(ins)) for (const t of targetsOf(ws, ins)) add(t.id);
      else if (ins.kind === "frame") add(ins.frame);
      else if (ins.kind === "tool") add(ins.tool);
      else if (ins.kind === "robot") add(ins.robot);
      else if (ins.kind === "code" && (ins.codeType === 0 || ins.codeType === 2)) {
        const callee = Object.values(ws.items).find((i) => (i.type === "program" || i.type === "python") && i.name === ins.text);
        add(callee?.id);
      }
    }
    tx.setMeta("selection", ids);
    ctx.undoLabel = null;
    return { selected: ids.map((id) => ws.items[id].name) };
  },
});

defineCommand({
  name: "instruction.hideTargets",
  title: "Hide Target Objects",
  description: "Hide the target(s) linked to move instructions in the 3D view (Hide Target Object / Hide Target Objects).",
  category: "program",
  undoable: false,
  spec: "R-PROG-59 (FUN_100099e70, FUN_1000d7ae0, FUN_1004ec3d0)",
  schema: z.object({ instructions: Instructions }),
  run({ ws, tx }, p) {
    const hidden: string[] = [];
    for (const { ins } of moveInstructions(ws, p.instructions))
      for (const t of targetsOf(ws, ins))
        if (t.visible) {
          tx.set(t.id, { visible: false });
          hidden.push(t.name);
        }
    return { hidden };
  },
});

defineCommand({
  name: "instruction.setMoveType",
  title: "Set Move Type",
  description:
    "Change move instructions to Joint (MoveJ), Linear (MoveL) or Search Linear (SearchL) keeping their targets. Circular moves are left unchanged. The names follow (MoveJ (Target 1) …).",
  category: "program",
  spec: "R-PROG-59 (Joint Move / Linear Move / Search Linear, Set Move Joint / Set Move Linear)",
  schema: z.object({ instructions: Instructions, moveType: z.enum(["joint", "linear", "search"]) }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const changed: string[] = [];
    for (const { it, ins, prog } of moveInstructions(ws, p.instructions)) {
      if (ins.kind !== "move" || ins.moveType === p.moveType) continue;
      assertProgramEditable(ws, prog);
      const next = { ...ins, moveType: p.moveType };
      tx.set(it.id, { instruction: next, name: instructionName(ws, next) });
      changed.push(it.name);
    }
    ctx.undoLabel = changed.length === 1 ? `Modify: ${changed[0]}` : "Modify instructions";
    return { changed };
  },
});

defineCommand({
  name: "instruction.setTargetType",
  title: "Set as Joint / Cartesian Targets",
  description: "Make the targets of the selected move instructions joint targets (moves use their joints) or Cartesian targets (moves use their pose).",
  category: "program",
  spec: "R-PROG-59 (Set as Joint Targets / Set as Cartesian Targets, FUN_1004ec3d0)",
  schema: z.object({ instructions: Instructions, joint: z.boolean() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const changed: string[] = [];
    for (const { ins } of moveInstructions(ws, p.instructions))
      for (const t of targetsOf(ws, ins)) {
        if (!t.target || t.target.isJoint === p.joint || changed.includes(t.name)) continue;
        tx.set(t.id, { target: { ...t.target, isJoint: p.joint } });
        changed.push(t.name);
      }
    ctx.undoLabel = "Modify targets";
    return { changed };
  },
});

 
export function jointSpaceMessage(names: string[]): string {
  return `The following Move instructions were not altered because the position is defined in joint space:<br>${names.map((n) => `${n}<br>`).join("")}`;
}





function shiftTarget(ws: Workspace, ctx: CmdCtx, t: Item, robot: Item | undefined, f: (pose: Mat) => Mat) {
  const pose = f(t.pose);
  let joints = t.target!.joints;
  if (robot?.robot && t.parent) {
    const moved = { ...t, pose };
    const q = jointsForTarget({ ...ws, items: { ...ws.items, [t.id]: moved } }, robot, { ...moved, target: { ...t.target!, isJoint: false } }, joints.length ? joints : robot.robot.joints);
    if (q) joints = q;
  }
  ctx.tx.set(t.id, { pose, target: { ...t.target!, joints } });
}

defineCommand({
  name: "instruction.offsetTargets",
  title: "Offset Targets",
  description:
    "Shift the targets of the selected move instructions by [x, y, z] mm in their reference frame (\"Set shift value for the selected targets (mm)\"). Joint targets are not altered and are listed in the result message. Changed instructions get a trailing '*'.",
  category: "program",
  spec: "R-PROG-59 (Modify ▸ Offset Targets, FUN_1004ec3d0)",
  schema: z.object({ instructions: Instructions, offset: z.array(z.number()).length(3) }),
  run(ctx, p) {
    const { ws } = ctx;
    const [x, y, z_] = p.offset;
     
    if (x * x + y * y + z_ * z_ < 1e-6) return { altered: [], jointSpace: [], message: "" };
    const shift = transl(x, y, z_);
    const altered: string[] = [];
    const jointSpace: string[] = [];
    for (const { it, ins, prog, index } of moveInstructions(ws, p.instructions)) {
      const [t1, t2] = targetsOf(ws, ins);
      if (!t1) continue;
      assertProgramEditable(ws, prog);
      const robot = robotAt(ws, prog, index);
      if (t1.target?.isJoint) jointSpace.push(it.name);
      else {
        shiftTarget(ws, ctx, t1, robot, (pose) => mul(shift, pose));
        rename(ctx, it, `${ws.items[it.id].name}*`);
        altered.push(it.name);
      }
       
      if (ins.kind === "movec" && t2 && !t2.target?.isJoint) shiftTarget(ws, ctx, t2, robot, (pose) => mul(pose, shift));
    }
    const message = jointSpace.length ? jointSpaceMessage(jointSpace) : "";
    if (message) void ctx.services.ask?.(message, ["OK"]);
    ctx.undoLabel = "Offset Targets";
    return { altered, jointSpace, message };
  },
});

const SHIFT_AXES = ["Tx", "Ty", "Tz", "Rx", "Ry", "Rz"] as const;

 
export function toolShift(axis: (typeof SHIFT_AXES)[number], v: number): Mat {
  switch (axis) {
    case "Tx":
      return transl(v, 0, 0);
    case "Ty":
      return transl(0, v, 0);
    case "Tz":
      return transl(0, 0, v);
    case "Rx":
      return rotx(v * DEG);
    case "Ry":
      return roty(v * DEG);
    case "Rz":
      return rotz(v * DEG);
  }
}

defineCommand({
  name: "instruction.relativeToolShift",
  title: "Relative Tool Shift",
  description:
    "Shift the targets of the selected move instructions along a tool axis (Tx, Ty, Tz in mm; Rx, Ry, Rz in degrees), relative to the TCP. Joint targets are not altered (listed in the message); changed instructions are renamed with the shift, e.g. 'MoveL (Target 1) (Tx 1.0)'.",
  category: "program",
  spec: "R-PROG-59 (Modify ▸ Relative Tool Shift, FUN_1004ec3d0)",
  schema: z.object({ instructions: Instructions, axis: z.enum(SHIFT_AXES), value: z.number().min(-999999).max(999999).default(1) }),
  run(ctx, p) {
    const { ws } = ctx;
    const shift = toolShift(p.axis, p.value);
    const altered: string[] = [];
    const jointSpace: string[] = [];
    for (const { it, ins, prog, index } of moveInstructions(ws, p.instructions)) {
      const targets = targetsOf(ws, ins);
      if (!targets.length) continue;
      assertProgramEditable(ws, prog);
      const robot = robotAt(ws, prog, index);
      if (targets[0].target?.isJoint) {
        jointSpace.push(it.name);
        continue;
      }
      for (const t of targets) if (!t.target?.isJoint) shiftTarget(ws, ctx, t, robot, (pose) => mul(pose, shift));
      rename(ctx, it, `${ws.items[it.id].name} (${p.axis} ${p.value.toFixed(1)})`);
      altered.push(it.name);
    }
    const message = jointSpace.length ? jointSpaceMessage(jointSpace) : "";
    if (message) void ctx.services.ask?.(message, ["OK"]);
    ctx.undoLabel = "Relative Tool Shift";
    return { altered, jointSpace, message };
  },
});

 
export function linkedPose(ws: Workspace, ins: InstructionData, robot: Item | undefined): Mat | null {
  if (ins.kind === "frame") {
    if (!ins.frame || !ws.items[ins.frame]) return null;
    const frameAbs = childFrame(ws, ins.frame);
    return robot ? mul(inv(absPose(ws, robot.id)), frameAbs) : frameAbs;
  }
  if (ins.kind === "tool") return ins.tool && ws.items[ins.tool] ? ws.items[ins.tool].pose.slice() : null;
  return null;
}

 
export function effectivePose(ws: Workspace, ins: InstructionData, robot: Item | undefined): Mat | null {
  if (ins.forcePose || !(ins.kind === "frame" ? ins.frame : ins.tool)) return ins.pose ?? null;
  return linkedPose(ws, ins, robot) ?? ins.pose ?? null;
}

defineCommand({
  name: "instruction.setLink",
  title: "Set / Remove Reference or Tool Link",
  description:
    "Set Ref./Set Tool instructions: link to a frame/tool (Set Reference Link / Set Tool Link; its current pose is captured) or remove the link keeping the pose (item: null).",
  category: "program",
  spec: "R-PROG-7, R-PROG-59 (FUN_1000a5d0c, FUN_1000a2ce0)",
  schema: z.object({ instruction: ItemRef, item: ItemRef.nullable() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const { it, ins, prog, index } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "frame" && ins.kind !== "tool") throw new CommandError(`${it.name} is not a Set Reference Frame or Set Tool instruction`);
    assertProgramEditable(ws, prog);
    const robot = robotAt(ws, prog, index);
    const key = ins.kind;
    let next: InstructionData;
    let linked: Item | null = null;
    if (p.item === null) next = { ...ins, pose: effectivePose(ws, ins, robot) ?? ins.pose, [key]: null };
    else {
      linked = requireRef(ws, p.item, key);
      if (linked.type !== key) throw new CommandError(`${linked.name} is not a ${key === "frame" ? "reference frame" : "tool"}`);
      next = { ...ins, [key]: linked.id };
      next.pose = linkedPose(ws, next, robot) ?? ins.pose;
    }
    tx.set(it.id, { instruction: next, name: instructionName(ws, next) });
    ctx.undoLabel = `Modify: ${it.name}`;
    return { name: instructionName(ws, next), linked: linked?.name ?? null };
  },
});

defineCommand({
  name: "instruction.forceOriginalPose",
  title: "Force Original Pose",
  description: "Set Ref./Set Tool instructions: use the pose stored in the instruction instead of the linked item's current pose (checkable).",
  category: "program",
  spec: "R-PROG-7, R-PROG-59 (Force Original Pose)",
  schema: z.object({ instruction: ItemRef, force: z.boolean() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const { it, ins, prog, index } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "frame" && ins.kind !== "tool") throw new CommandError(`${it.name} is not a Set Reference Frame or Set Tool instruction`);
    assertProgramEditable(ws, prog);
    const pose = ins.pose ?? linkedPose(ws, ins, robotAt(ws, prog, index)) ?? undefined;
    tx.set(it.id, { instruction: { ...ins, forcePose: p.force, pose } });
    ctx.undoLabel = `Modify: ${it.name}`;
    return { force: p.force };
  },
});

 
export function poseClipboardText(m: Mat): string {
  return [0, 1, 2, 3].map((r) => m.slice(r * 4, r * 4 + 4).map((x) => (Object.is(x, -0) ? 0 : x).toFixed(6)).join(", ")).join("\n");
}

defineCommand({
  name: "instruction.copyPose",
  title: "Copy Reference / Tool Pose",
  description:
    "Copy the pose a Set Ref. (frame w.r.t. the robot base) or Set Tool (TCP w.r.t. the flange) instruction applies, as a 4x4 matrix text for the clipboard.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "R-PROG-59 (Copy Reference Pose / Copy Tool Pose)",
  schema: z.object({ instruction: ItemRef }),
  run(ctx, p) {
    const { ws } = ctx;
    const { it, ins, prog, index } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "frame" && ins.kind !== "tool") throw new CommandError(`${it.name} is not a Set Reference Frame or Set Tool instruction`);
    const pose = effectivePose(ws, ins, robotAt(ws, prog, index)) ?? eye();
    status(ctx, `${ins.kind === "frame" ? "Reference" : "Tool"} pose copied to the clipboard`);
    return { clipboardText: poseClipboardText(pose), pose };
  },
});

defineCommand({
  name: "event.recordAllObjects",
  title: "Record all Objects",
  description:
    "Turn a simulation event into a 'set position' event that puts every object of the station (or of the program's folder) back where it is now: parent and pose relative to it.",
  category: "program",
  spec: "R-PROG-13, R-PROG-59 (Event menu FUN_1000c9850)",
  schema: z.object({ instruction: ItemRef }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const { it, ins, prog } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "event") throw new CommandError(`${it.name} is not a simulation event`);
    assertProgramEditable(ws, prog);
     
    const holder = prog.parent ? ws.items[prog.parent] : undefined;
    let root: Item | undefined = holder;
    if (holder?.type !== "folder") {
      root = prog;
      while (root?.parent) root = ws.items[root.parent];
    }
    const objects = root ? descendants(ws, root.id).filter((i) => i.type === "object") : [];
    const positions = objects.map((o) => ({ item: o.id, parent: o.parent, pose: o.pose.slice() }));
    const event = { ...(ins.event ?? { action: "move" as const }), action: "move" as const, objects: objects.map((o) => o.id), positions, relative: true };
    const next: InstructionData = { ...ins, event };
    tx.set(it.id, { instruction: next, name: instructionName(ws, next) });
    ctx.undoLabel = `Modify: ${it.name}`;
    return { recorded: objects.map((o) => o.name) };
  },
});

defineCommand({
  name: "instruction.showContactPoint",
  title: "Show Contact Point",
  description: "Search Linear (SearchL) instructions: show where the last simulated search stopped. Reports 'Contact point not recorded' when the search never stopped on its input.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "R-PROG-59 (Move menu FUN_100099e70)",
  schema: z.object({ instruction: ItemRef }),
  run(ctx, p) {
    const { ws, services } = ctx;
    const { it, ins, prog, index } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "move") throw new CommandError(`${it.name} is not a move instruction`);
    if (!ins.contact) {
      status(ctx, "Contact point not recorded");
      return { recorded: false };
    }
     
    const robot = robotAt(ws, prog, index);
    if (robot?.robot) {
      const flange = mul(mul(inv(absPose(ws, robot.id)), ins.contact), inv(toolPose(ws, robot.id)));
      const q = ikClosest(robot.robot.model, flange, robot.robot.joints);
      if (q) services.emit?.({ type: "preview-targets", robot: robot.id, joints: [q] });
    }
    status(ctx, "Showing contact point");
    return { recorded: true, pose: ins.contact };
  },
});

 

const CUSTOM_KEYS = { name: "", path: "PathRunSim", icon: "PathIcon", robotCommand: "PathRunRobot" } as const;

 
const customApprovalKey = (hash: (s: string) => string, file: string, contentHash: string | null) => hash(`${file}\n${contentHash ?? ""}`);

defineCommand({
  name: "instruction.setCustom",
  title: "Edit Custom Instruction",
  description:
    "Change a custom instruction (INS_TYPE_CUSTOM 12): name (Set Name), path of the executable or .py run in simulation (Modify Path), icon (Modify Icon), blocking (wait for it to finish), 'Run on Robot' command.",
  category: "program",
  spec: "R-PROG-15, R-PROG-59 (custom menu FUN_10061dec0)",
  schema: z.object({
    instruction: ItemRef,
    name: z.string().optional(),
    path: z.string().optional(),
    icon: z.string().optional(),
    blocking: z.boolean().optional(),
    robotCommand: z.string().optional(),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const { it, ins, prog } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "custom") throw new CommandError(`${it.name} is not a custom instruction`);
    assertProgramEditable(ws, prog);
    const params = { ...(it.params ?? {}) };
    for (const [k, key] of Object.entries(CUSTOM_KEYS)) {
      const v = p[k as keyof typeof CUSTOM_KEYS];
      if (v !== undefined && key) params[key] = v;
    }
    if (p.blocking !== undefined) params.Blocking = p.blocking ? "1" : "0";
     
    if (ctx.origin === "agent" && (p.path !== undefined || p.robotCommand !== undefined)) params.Author = "agent";
    else if (ctx.origin === "ui" && p.path !== undefined) delete params.Author;
    const next = p.name !== undefined ? { ...ins, text: p.name } : ins;
    tx.set(it.id, { params, instruction: next, ...(p.name !== undefined ? { name: p.name } : {}) });
    ctx.undoLabel = `Modify: ${it.name}`;
    return { name: p.name ?? it.name, path: params.PathRunSim ?? "", blocking: params.Blocking !== "0" };
  },
});

defineCommand({
  name: "instruction.runCustom",
  title: "Run Custom Instruction",
  description:
    "Start the executable or .py file of a custom instruction (what Execute Instruction does for it). Paths are relative to the Enginuity Python folder unless absolute. A path the Copilot wrote waits for the user's confirmation.",
  category: "program",
  undoable: false,
  readonly: true,
  spec: "R-PROG-15 (Execute Instruction / Stop Instruction)",
  schema: z.object({ instruction: ItemRef, stop: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws, services } = ctx;
    const { it, ins } = requireInstruction(ws, p.instruction);
    if (ins.kind !== "custom") throw new CommandError(`${it.name} is not a custom instruction`);
    if (!services.python) throw new CommandError("Custom instructions run on the Enginuity server");
    if (p.stop) return { stopped: services.python.stop(it.id) };
    const file = it.params?.PathRunSim ?? "";
    if (!file) throw new CommandError(`${it.name} has no executable path (Modify Path)`);
     
    const fs = services.python.fileState(file);
    const key = customApprovalKey(services.python.hash, file, fs.contentHash);
    if ((it.params?.Author === "agent" || fs.agentWritten) && it.params?.Approved !== key) {
      const shown = `# custom instruction ${it.name} runs:\n# ${fs.full}${fs.exists ? "" : " (file not found)"}${fs.text !== undefined ? `\n\n${fs.text}` : ""}`;
      services.emit?.({ type: "python-confirm", item: null, instruction: it.id, name: it.name, code: shown, hash: key });
      status(ctx, `Waiting for you to confirm running ${it.name}`);
      return { started: false, pending: true };
    }
    const err = services.python.startFile(it.id, it.name, file);
    if (err) throw new CommandError(err);
    return { started: true, blocking: it.params?.Blocking !== "0" };
  },
});

defineCommand({
  name: "instruction.approveCustom",
  title: "Confirm Custom Instruction",
  description: "The user confirms a Copilot-written custom instruction path (UI only) and starts it.",
  category: "program",
   
  internal: true,
  undoable: false,
  spec: "Enginuity consent rule for agent-written code",
  schema: z.object({ instruction: ItemRef, hash: z.string() }),
  run(ctx, p) {
    if (ctx.origin !== "ui") throw new CommandError("Only the user can confirm running code, from the Enginuity window");
    const { ws, tx, services } = ctx;
    const { it } = requireInstruction(ws, p.instruction);
    const file = it.params?.PathRunSim ?? "";
    if (!services.python || customApprovalKey(services.python.hash, file, services.python.fileState(file).contentHash) !== p.hash) throw new CommandError("The instruction changed since you reviewed it");
    tx.set(it.id, { params: { ...(it.params ?? {}), Approved: p.hash } });
    ctx.undoLabel = null;
    const err = services.python.startFile(it.id, it.name, file);
    if (err) throw new CommandError(err);
    return { started: true };
  },
});
