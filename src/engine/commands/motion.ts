 
 
 
 
 

import { z } from "zod";
import { checkCollisions } from "../collision";
import { requireRef } from "../dispatch";
import { fk, ikClosest } from "../kinematics";
import { inv, mul, type Mat } from "../math";
import { ioDisplayName } from "../naming";
import { jointList, planOptionsFromSettings, planProgram } from "../sim/planner";
import { getStationParam, setStationParam } from "../stationParams";
import { commitJoints, jointOverridesOf } from "../sync/axes";
import type { Item, Workspace } from "../types";
import { absPose, childFrame, descendants, stationOf, toolPose } from "../workspace";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";
import { robotJoints, robotReferenceAbs } from "./collisions";
import { activeStationId } from "./items";
import { requireRobot } from "./robot";

const Joints = z.array(z.number());
const Pose = z.array(z.number()).length(16);

function requireProgram(ws: Workspace, ref: string | number | undefined): Item {
  if (ref === undefined) {
    const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "program");
    if (sel) return sel;
    throw new CommandError("Select a program");
  }
  const p = requireRef(ws, ref, "program");
  if (p.type !== "program") throw new CommandError(`${p.name} is not a program`);
  return p;
}

const collider = (ctx: CmdCtx, program: Item) => {
  const st = stationOf(ctx.ws, program.id)?.id ?? activeStationId(ctx.ws);
  return (robotId: string, q: number[]) => checkCollisions(ctx.ws, ctx.services.geometry, st, Number(ctx.services.settings.Collision_Clearance ?? 0), jointOverridesOf(ctx.ws, robotId, q)).length > 0;
};

defineCommand({
  name: "program.jointList",
  title: "Program Joint List",
  description:
    "The program path as joint points (InstructionListJoints): sampled every mmStep along linear moves and degStep along joint moves, starting at the program's first target. Each point has the joints, an error code (0 ok, 1000 wrist singularity, 10000000 unreachable, 100000 collision, …), the instruction index and the time from the first target. status: instruction count, -1 path not continuous, -2 unreachable targets. With checkCollisions every point is tested and the robot is left on the first colliding one (else on the last point).",
  category: "program",
  undoable: false,
  spec: "R-PROG-27 (FUN_1000bd6fc)",
  schema: z.object({ program: ItemRef.optional(), mmStep: z.number().positive().default(10), degStep: z.number().positive().default(5), checkCollisions: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const prog = requireProgram(ws, p.program);
    const opts = { ...planOptionsFromSettings(ctx.services.settings), stepMM: p.mmStep, stepDeg: p.degStep };
    if (p.checkCollisions) status(ctx, `Checking collisions for program ${prog.name}`);
    const res = jointList(ws, prog.id, { ...opts, checkCollisions: p.checkCollisions ? collider(ctx, prog) : undefined });
    const robot = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
    if (res.robotJoints && robot?.robot) commitJoints(ws, tx, robot.id, res.robotJoints);
    if (p.checkCollisions) status(ctx, "Done");
    return { status: res.status, message: res.message, mmStep: p.mmStep, degStep: p.degStep, points: res.points };
  },
});

defineCommand({
  name: "program.checkCollisions",
  title: "Check Path and Collisions",
  description:
    "Validate a program and check its path for collisions at the given steps (Update with collision checking): returns [valid instructions, cycle time (s), path length (mm), valid ratio, message]. The ratio says where the first collision is ((k+1)/n + i)/N; the robot is left on the colliding configuration.",
  category: "program",
  undoable: false,
  spec: "R-PROG-28 (FUN_1000b0108)",
  schema: z.object({ program: ItemRef.optional(), mmStep: z.number().optional(), degStep: z.number().optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const prog = requireProgram(ws, p.program);
    const base = planOptionsFromSettings(ctx.services.settings);
    const plan = planProgram(ws, prog.id, {
      ...base,
      collisionStepMM: p.mmStep && p.mmStep > 0 ? p.mmStep : base.collisionStepMM,
      collisionStepDeg: p.degStep && p.degStep > 0 ? p.degStep : base.collisionStepDeg,
      collide: collider(ctx, prog),
    });
    const robotId = plan.collisionRobot ?? prog.program?.robot;
    const robot = robotId ? ws.items[robotId] : undefined;
    if (plan.collisionJoints && robot?.robot) commitJoints(ws, tx, robot.id, plan.collisionJoints);
    status(ctx, `Done updating ${prog.name}`);
    return [plan.validInstructions, plan.duration, plan.distance, plan.ratio, plan.message];
  },
});

 
function goalPose(ws: Workspace, robot: Item, g: { target?: string | number; joints?: number[]; pose?: number[] }): Mat {
  const tool = toolPose(ws, robot.id);
  if (g.target !== undefined) {
    const t = requireRef(ws, g.target, "target");
    if (t.target?.isJoint && t.target.joints.length) return mul(mul(absPose(ws, robot.id), fk(robot.robot!.model, t.target.joints)), tool);
    return absPose(ws, t.id);
  }
  if (g.joints) return mul(mul(absPose(ws, robot.id), fk(robot.robot!.model, robotJoints(robot, g.joints))), tool);
  if (g.pose) return mul(robotReferenceAbs(ws, robot), g.pose as Mat);
  throw new CommandError("Give a target, joints or a pose");
}

const Goal = z.object({ target: ItemRef.optional(), joints: Joints.optional(), pose: Pose.optional() });

defineCommand({
  name: "robot.moveC",
  title: "Move Circular (simulated)",
  description:
    "Animate the robot along a circular arc from its current TCP through `via` to `to` at the current simulation speed (API MoveC). Each point is a target, joints, or a TCP pose relative to the robot's active reference frame.",
  category: "simulation",
  undoable: false,
  spec: "B-SIM-17",
  schema: z.object({ robot: ItemRef.optional(), via: Goal, to: Goal }),
  run({ ws, services }, p) {
    const r = requireRobot(ws, p.robot);
    const via = goalPose(ws, r, p.via);
    const end = goalPose(ws, r, p.to);
    if (!services.runner?.moveRobotArc) throw new CommandError("Simulation is only available on the server");
    services.runner.moveRobotArc(r.id, via, end);
    return { started: true };
  },
});

defineCommand({
  name: "robot.showSequence",
  title: "Show Sequence",
  description:
    "Preview a sequence of robot configurations as transparent ghost robots (Item.ShowSequence): joints (one list per configuration) or TCP poses relative to the robot's reference frame (solved near the current joints). timeoutMs ≤ 0 keeps them until the next preview; an empty list clears them.",
  category: "simulation",
  readonly: true,
  undoable: false,
  spec: "API Show_Seq / Show_SeqPoses (FUN_10033761c, FUN_1003372f4)",
  schema: z.object({ robot: ItemRef.optional(), joints: z.array(Joints).optional(), poses: z.array(Pose).optional(), timeoutMs: z.number().default(-1) }),
  run({ ws, services }, p) {
    const r = requireRobot(ws, p.robot);
    let seq: number[][] = (p.joints ?? []).map((q) => robotJoints(r, q));
    if (p.poses?.length) {
      const base = absPose(ws, r.id);
      const ref = robotReferenceAbs(ws, r);
      const tool = toolPose(ws, r.id);
      let seed = r.robot!.joints;
      seq = [];
      for (const pose of p.poses) {
        const flange = mul(mul(mul(inv(base), ref), pose as Mat), inv(tool));
        const q = ikClosest(r.robot!.model, flange, seed);
        if (q) {
          seq.push(q);
          seed = q;
        }
      }
    }
    services.emit?.({ type: "show-sequence", robot: r.id, joints: seq, timeoutMs: p.timeoutMs });
    return { shown: seq.length };
  },
});

 
export function fmtG(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e < -4 || e >= 6) return v.toExponential(5).replace(/\.?0+e/, "e").replace(/e([+-])(\d)$/, "e$10$2");
  return String(Number(v.toPrecision(6)));
}

 
export function robotIntrospection(robot: Item) {
  const rd = robot.robot!;
  const h = rd.header;
  const rows = h && h.length >= 4 ? Math.round(h[2]) || 20 : 20;
  const cell = (c: number, r: number) => (h ? h[c * rows + r] : undefined);
  const pulses = h ? Array.from({ length: rd.model.nq }, (_, j) => cell(49, j) ?? 0) : [];
  return {
    name: robot.name,
    nativeName: rd.nativeName ?? "",
    mechType: rd.model.mech,
    axes: rd.model.nq,
    reach: rd.reach ?? null,
    payload: rd.payload ?? null,
    repeatability: rd.repeatability ?? null,
    weight: rd.weight ?? null,
    postProcessor: rd.postProcessor,
    masteringJoints: rd.home.slice(),
    pulsesPerDegree: pulses,
    isCalibrated: false,
    isAccuracyActive: false,
    hasHeader: !!h,
  };
}

 
export function robotHeaderValue(robot: Item, n: number): string {
  if (!(n >= 0) || n >= 16000) return "Invalid";
  const h = robot.robot?.header;
  if (!h) return "Invalid";
  return fmtG(h[Math.trunc(n)] ?? 0);
}

defineCommand({
  name: "robot.info",
  title: "Robot Information",
  description:
    "Robot model facts from its robot file (R-KIN-33): native model name, mechanism type, number of axes, reach (mm), payload (kg), repeatability (mm), weight (kg), post processor, mastering (home) joints and pulses per degree; `value` reads a raw header cell index N like setParam('RobotValue', N).",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-KIN-33",
  schema: z.object({ robot: ItemRef.optional(), value: z.number().int().optional() }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    const info = robotIntrospection(r);
    return p.value !== undefined ? { ...info, value: robotHeaderValue(r, p.value) } : info;
  },
});

 

defineCommand({
  name: "io.get",
  title: "Get IO",
  description: "Read a digital input/output (or an analog one with analog: true) of the simulation: numbers name IO_<n> / AO_<n>, other names are used as they are (getDI / getAI). Empty when never set.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-39",
  schema: z.object({ name: z.string(), analog: z.boolean().default(false) }),
  run({ ws }, p) {
    const key = ioDisplayName(p.name, p.analog);
    return { name: key, value: getStationParam(ws, key) ?? "" };
  },
});

defineCommand({
  name: "io.set",
  title: "Set IO",
  description: "Set a digital (or analog) output of the simulation (setDO / setAO). A program waiting for that value (Wait DI) continues.",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-39",
  schema: z.object({ name: z.string(), value: z.union([z.string(), z.number(), z.boolean()]), analog: z.boolean().default(false) }),
  run({ ws, tx }, p) {
    const key = ioDisplayName(p.name, p.analog);
    const value = typeof p.value === "boolean" ? (p.value ? "1" : "0") : String(p.value);
     
    if (!setStationParam({ ws, tx }, key, value)) throw new CommandError("No station");
    return { name: key, value };
  },
});

 

 
function toolTcpAbs(ws: Workspace, tool: Item): Mat {
  return absPose(ws, tool.id);
}

 
const held = (ws: Workspace, tool: Item) => tool.children.map((k) => ws.items[k]).filter((i): i is Item => i?.type === "object");

function reparentKeep(ctx: CmdCtx, it: Item, parentId: string) {
  const { ws, tx } = ctx;
  const pose = mul(inv(childFrame(ws, parentId)), absPose(ws, it.id));
  if (it.parent && ws.items[it.parent]) tx.set(it.parent, { children: ws.items[it.parent].children.filter((c) => c !== it.id) });
  tx.set(parentId, { children: [...ws.items[parentId].children.filter((c) => c !== it.id), it.id] });
  tx.set(it.id, { parent: parentId, pose });
}

defineCommand({
  name: "tool.attach",
  title: "Attach Closest Object",
  description:
    "Attach to a tool the closest object whose origin is within `tolerance` mm of the TCP (default 200 mm), optionally only objects whose name contains `keyword` or one of `objects`. The object keeps its absolute pose and moves with the tool (AttachClosest). Returns the attached object or null.",
  category: "simulation",
  spec: "R-PROG-40 (FUN_1000c7730)",
  schema: z.object({ tool: ItemRef, keyword: z.string().optional(), tolerance: z.number().optional(), objects: z.array(ItemRef).optional() }),
  run(ctx, p) {
    const { ws } = ctx;
    const tool = requireRef(ws, p.tool, "tool");
    if (tool.type !== "tool") throw new CommandError(`${tool.name} is not a tool`);
    const tcp = toolTcpAbs(ws, tool);
    const candidates = p.objects?.length
      ? p.objects.map((r) => requireRef(ws, r))
      : descendants(ws, activeStationId(ws)).filter((it) => it.type === "object" && it.parent !== tool.id && (!p.keyword || it.name.includes(p.keyword)));
    const tol = p.tolerance && p.tolerance > 0 ? p.tolerance : 200;
    let best: { it: Item; d: number } | null = null;
    for (const it of candidates) {
      const a = absPose(ws, it.id);
      const d = Math.hypot(a[3] - tcp[3], a[7] - tcp[7], a[11] - tcp[11]);
      if (d <= tol && (!best || d < best.d)) best = { it, d };
    }
    if (!best) return { attached: null };
    reparentKeep(ctx, best.it, tool.id);
    ctx.tx.split(`Attach: ${best.it.name}`);
    return { attached: best.it.name, id: best.it.id };
  },
});

defineCommand({
  name: "tool.detach",
  title: "Detach Objects",
  description: "Detach the object held by a tool that is closest to its TCP (all: true for every held object) and place it under `parent` (the station by default), keeping its absolute pose (DetachClosest / DetachAll).",
  category: "simulation",
  spec: "R-PROG-40",
  schema: z.object({ tool: ItemRef, parent: ItemRef.optional(), all: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws } = ctx;
    const tool = requireRef(ws, p.tool, "tool");
    const parent = p.parent !== undefined ? requireRef(ws, p.parent).id : activeStationId(ws);
    const list = held(ws, tool);
    let chosen = list;
    if (!p.all) {
      const tcp = toolTcpAbs(ws, tool);
      let best: { it: Item; d: number } | null = null;
      for (const it of list) {
        const a = absPose(ws, it.id);
        const d = Math.hypot(a[3] - tcp[3], a[7] - tcp[7], a[11] - tcp[11]);
        if (!best || d < best.d) best = { it, d };
      }
      chosen = best ? [best.it] : [];
    }
    for (const it of chosen) reparentKeep(ctx, it, parent);
    if (chosen.length) ctx.tx.split(`Detach: ${chosen.map((c) => c.name).join(", ")}`);
    return { detached: chosen.map((c) => c.name), ids: chosen.map((c) => c.id) };
  },
});

