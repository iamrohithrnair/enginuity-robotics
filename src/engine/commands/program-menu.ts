import { z } from "zod";
import { checkCollisions } from "../collision";
import { requireRef } from "../dispatch";
import { CommandError, defineCommand, ItemRef, status } from "../registry";
import { planProgram } from "../sim/planner";
import { commitJoints, jointOverridesOf } from "../sync/axes";
import type { Item, Workspace } from "../types";
import { assertProgramEditable } from "./instructions";
import { addInstruction, createProgram, requireProgram } from "./programs";
import { jointsForTarget } from "./targets";

 
 
 

function requirePrograms(ws: Workspace, refs: (string | number)[]): Item[] {
  return refs.map((r) => {
    const it = requireRef(ws, r, "program");
    if (it.type !== "program") throw new CommandError(`${it.name} is not a program`);
    return it;
  });
}

defineCommand({
  name: "program.setFlags",
  title: "Program Display and Lock",
  description:
    "Program menu check boxes for one or several programs: showInstructions (list the instructions in the tree), displayPath (draw the program path in the 3D view), locked (refuse changes with \"The program … is running or it is locked and it can't be modified.\").",
  category: "program",
  undoable: false,
  spec: "R-TREE-43 (Show Instructions / Display Path / Locked), R-ERR-27",
  schema: z.object({ programs: z.array(ItemRef).min(1), showInstructions: z.boolean().optional(), displayPath: z.boolean().optional(), locked: z.boolean().optional() }),
  run({ ws, tx }, p) {
    const progs = requirePrograms(ws, p.programs);
    for (const prog of progs) {
      const next = { ...prog.program };
      if (p.showInstructions !== undefined) next.showInstructions = p.showInstructions;
      if (p.displayPath !== undefined) next.displayPath = p.displayPath;
      if (p.locked !== undefined) next.locked = p.locked;
      tx.set(prog.id, { program: next });
    }
    return progs.map((prog) => ({
      program: prog.name,
      showInstructions: ws.items[prog.id].program?.showInstructions !== false,
      displayPath: !!ws.items[prog.id].program?.displayPath,
      locked: !!ws.items[prog.id].program?.locked,
    }));
  },
});

defineCommand({
  name: "program.makeMain",
  title: "Make Main Program",
  description:
    "Create a program named 'MainProgram' (robot of the first program) that calls the given programs in order, one 'Call <program>' instruction each.",
  category: "program",
  spec: "R-TREE-43 (several programs ▸ Make Main Program, FUN_1000a8cec)",
  schema: z.object({ programs: z.array(ItemRef).min(1) }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const progs = requirePrograms(ws, p.programs);
    const robot = progs[0].program?.robot ? ws.items[progs[0].program.robot] : undefined;
    const main = createProgram(ctx, "MainProgram", robot?.robot ? robot : undefined);
    for (const prog of progs) addInstruction(ws, tx, main, { kind: "code", codeType: 0, text: prog.name }, null, true);
    tx.setMeta("selection", [main.id]);
    ctx.undoLabel = null;
    return { id: main.id, name: main.name, calls: progs.map((x) => x.name) };
  },
});

defineCommand({
  name: "program.recalculateTargets",
  title: "Recalculate Targets",
  description: "Re-solve the joints stored in the Cartesian targets a program moves to, near their old joints (after a reference frame or the robot moved).",
  category: "program",
  spec: "R-TREE-43 (Recalculate Targets)",
  schema: z.object({ program: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const prog = requireProgram(ws, p.program);
    assertProgramEditable(ws, prog);
    const robot = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
    const done: { target: string; ok: boolean }[] = [];
    const seen = new Set<string>();
    for (const id of prog.children) {
      const ins = ws.items[id]?.instruction;
      for (const tid of [ins?.target, ins?.target2]) {
        const t = tid ? ws.items[tid] : undefined;
        if (!t?.target || seen.has(t.id)) continue;
        seen.add(t.id);
        const r = t.target.robot && ws.items[t.target.robot]?.robot ? ws.items[t.target.robot] : robot;
        if (t.target.isJoint || !r?.robot) continue;
        const q = jointsForTarget(ws, r, { ...t, target: { ...t.target, isJoint: false } }, t.target.joints.length ? t.target.joints : r.robot.joints);
        if (q) tx.set(t.id, { target: { ...t.target, joints: q } });
        done.push({ target: t.name, ok: !!q });
      }
    }
    ctx.undoLabel = `Recalculate Targets: ${prog.name}`;
    return done;
  },
});

 
export interface CheckResult {
  ok: boolean;
  title: string;
  message: string;
  validInstructions: number;
}

const CHECK_HINT = "(one or more targets are not reachable, a linear move is not possible or the robot tool and reference frames are not properly set).";

export function checkProgram(ws: Workspace, prog: Item, opts: { collisions: boolean; settings: Record<string, unknown>; geometry: Parameters<typeof checkCollisions>[1] }): CheckResult & { collisionJoints?: number[]; collisionRobot?: string } {
  const total = prog.children.filter((c) => ws.items[c]?.instruction).length;
  const robot = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
  const failed = (message: string) => ({ ok: false, title: `${prog.name} program check failed`, message, validInstructions: -1 });
  if (!robot?.robot) return failed("Select a robot for this program");
  const st = ws.activeStation;
  const plan = planProgram(ws, prog.id, {
    stepMM: Number(opts.settings.PathStepMM ?? 1),
    wristTolerance: Number(opts.settings.ToleranceSingularityWrist ?? 2.5),
    collisionStepMM: Number(opts.settings.PathStepCollisionMM ?? 4),
    collisionStepDeg: Number(opts.settings.PathStepCollisionDeg ?? 4),
    collide: opts.collisions && st ? (robotId, q) => checkCollisions(ws, opts.geometry, st, 0, jointOverridesOf(ws, robotId, q)).length > 0 : undefined,
  });
  const n = plan.validInstructions;
  if (n < total && !plan.collisionJoints) {
    const insItems = prog.children.map((c) => ws.items[c]).filter((i) => i?.instruction);
    const at = insItems[n];
    return { ...failed(`Path failed at instruction ${n + 1}: <strong>${at?.name ?? ""}</strong><br>${CHECK_HINT}`), validInstructions: n };
  }
  if (opts.collisions && plan.collisionJoints) {
     
     
    return { ok: false, title: `${prog.name} program check failed`, message: plan.message, validInstructions: n, collisionJoints: plan.collisionJoints, collisionRobot: plan.collisionRobot };
  }
  const message = opts.collisions ? "No problems found for this path<br>No collisions detected." : "No problems found for this path";
  return { ok: true, title: `${prog.name} program check success`, message, validInstructions: n };
}

defineCommand({
  name: "program.check",
  title: "Check Path",
  description:
    "Check a program like Check Path (F5) / Check Path and Collisions (Shift+F5): returns ok, the title ('<program> program check success|failed') and the message the check shows ('No problems found for this path', 'Path failed at instruction N: <name>…', 'Select a robot for this program', collision report). With collisions the robot is left at the first colliding configuration.",
  category: "program",
  undoable: false,
  spec: "R-PROG-29 (FUN_1000ae754, FUN_1000b0108)",
  schema: z.object({ program: ItemRef.optional(), collisions: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws, tx, services } = ctx;
    const prog = requireProgram(ws, p.program);
    const res = checkProgram(ws, prog, { collisions: p.collisions, settings: services.settings, geometry: services.geometry });
    const robotId = res.collisionRobot ?? prog.program?.robot;
    const robot = robotId ? ws.items[robotId] : undefined;
    if (res.collisionJoints && robot?.robot) commitJoints(ws, tx, robot.id, res.collisionJoints);
     
    if (p.collisions && res.ok) status(ctx, res.title);
    if (ctx.origin === "ui") void services.ask?.(res.message, ["OK"], res.title);
    ctx.undoLabel = null;
    return { ok: res.ok, title: res.title, message: res.message, validInstructions: res.validInstructions };
  },
});
