import { z } from "zod";
import { requireRef } from "../dispatch";
import { fk, ikAll, ikClosest, jointsConfig, kinematicsReady } from "../kinematics";
import { eye, inv, mul, poseToXYZRPW, round, xyzrpwToPose, type Mat } from "../math";
import { autoTargetName } from "../naming";
import { CommandError, defineCommand, ItemRef, Joints, Pose, status, XYZRPW, type CmdCtx } from "../registry";
import type { Item, Workspace } from "../types";
import { absPose, childFrame, currentRobot, listItems, makeItem, toolPose } from "../workspace";
import { createFrame } from "./items";
import { solveGoal } from "../sim/planner";
import { requireRobot } from "./robot";
import { assertTargetEditable } from "./instructions";
import { combinedJoints } from "../sync/axes";






export function defaultTargetRobot(ws: Workspace): Item | undefined {
  const sel = ws.selection.map((s) => ws.items[s]).filter(Boolean);
  const direct = sel.find((i) => i.type === "robot");
  if (direct) return direct;
  for (const it of sel) {
    let cur: Item | undefined = it;
    while (cur?.parent) {
      cur = ws.items[cur.parent];
      if (cur?.type === "robot") return cur;
    }
  }
  return currentRobot(ws);
}






export function defaultTargetParent(ctx: Pick<CmdCtx, "ws" | "tx" | "services">, robot: Item | undefined): string {
  const { ws } = ctx;
  if (ws.selection.length) {
    const sel = ws.items[ws.selection[0]];
    if (sel?.type === "frame") return sel.id;
  }
  const af = robot?.robot?.activeFrame;
  if (af && ws.items[af]) return af;
  for (const r of listItems(ws, { type: "robot" })) {
    const f = r.robot?.activeFrame;
    if (f && ws.items[f]) return f;
  }
  const firstFrame = listItems(ws, { type: "frame" })[0];
  if (firstFrame) return firstFrame.id;
  return createFrame(ctx, {}).id;
}

 
export function tcpIn(ws: Workspace, robot: Item, parentId: string, joints?: number[]): Mat {
  const rd = robot.robot!;
  const tcpAbs = mul(mul(absPose(ws, robot.id), fk(rd.model, joints ?? rd.joints)), toolPose(ws, robot.id));
  return mul(inv(childFrame(ws, parentId)), tcpAbs);
}





export function createTarget(
  ctx: Pick<CmdCtx, "ws" | "tx" | "services">,
  robot: Item | undefined,
  opts: { name?: string; parent?: string; joints?: number[]; pose?: Mat; isJoint?: boolean; absolute?: boolean },
): Item {
  const { ws, tx } = ctx;
  const parent = opts.parent ?? defaultTargetParent(ctx, robot);
   
  let joints = opts.joints?.slice() ?? (robot?.robot ? combinedJoints(ws, robot) : []);
  let pose: Mat;
  if (opts.pose) {
    pose = opts.absolute ? mul(inv(childFrame(ws, parent)), opts.pose) : opts.pose;
    if (!opts.joints && robot?.robot) {
      const flangeInBase = mul(mul(inv(absPose(ws, robot.id)), mul(childFrame(ws, parent), pose)), inv(toolPose(ws, robot.id)));
      joints = ikClosest(robot.robot.model, flangeInBase, robot.robot.joints) ?? robot.robot.joints.slice();
    }
  } else pose = robot?.robot ? tcpIn(ws, robot, parent, joints) : eye();
  const t = makeItem(ws, "target", opts.name ?? autoTargetName(ws, parent), {
    pose,
    target: { joints, isJoint: opts.isJoint ?? false, robot: robot?.id ?? null },
  });
  tx.add(t, parent);
  tx.split(`Add: ${t.name}`);
  return t;
}

defineCommand({
  name: "target.teach",
  title: "Teach Target",
  description:
    "Create 'Target N' at the robot's current position (Ctrl+T): a Cartesian target storing joints and TCP pose, placed in the robot's active reference frame, then selected.",
  category: "target",
  shortcut: "Ctrl+T",
  spec: "R-PROG-56, R-TREE-4, R-TREE-12",
  schema: z.object({ robot: ItemRef.optional(), name: z.string().optional(), parent: ItemRef.optional(), isJoint: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = p.robot !== undefined ? requireRobot(ws, p.robot) : defaultTargetRobot(ws);
    if (!r?.robot) {
      status(ctx, "Select robot first");
      ctx.undoLabel = null;
      return { created: false };
    }
    const parent = p.parent !== undefined ? requireRef(ws, p.parent, "frame").id : undefined;
    const t = createTarget(ctx, r, { name: p.name, parent, isJoint: p.isJoint });
    tx.setMeta("selection", [t.id]);
    ctx.undoLabel = null;
    return { id: t.id, name: t.name, handle: t.handle, xyzrpw: poseToXYZRPW(t.pose).map((v) => round(v, 3)), joints: t.target!.joints };
  },
});

defineCommand({
  name: "target.add",
  title: "Add Target",
  description:
    "Add a target with an explicit pose (xyzrpw/4x4, relative to its parent frame) or joints (API AddTarget). Without a robot the target has no robot link. Name '' is allowed.",
  category: "target",
  spec: "R-TREE-4, R-TREE-12",
  schema: z.object({
    name: z.string().optional(),
    parent: ItemRef.optional(),
    robot: ItemRef.optional(),
    pose: Pose.optional(),
    xyzrpw: XYZRPW.optional(),
    joints: Joints.optional(),
    isJoint: z.boolean().optional(),
  }),
  run(ctx, p) {
    const { ws } = ctx;
    const robot = p.robot !== undefined ? requireRobot(ws, p.robot) : defaultTargetRobot(ws);
    const parent = p.parent !== undefined ? requireRef(ws, p.parent, "parent").id : undefined;
    const pose = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : undefined);
    const t = createTarget(ctx, robot, { name: p.name, parent, pose, joints: p.joints, isJoint: p.isJoint ?? (!!p.joints && !pose) });
    ctx.undoLabel = null;
    return { id: t.id, name: t.name, handle: t.handle };
  },
});

defineCommand({
  name: "target.update",
  title: "Teach Current Position",
  description: "Update a target from the robot's current position (stores current joints and TCP pose).",
  category: "target",
  spec: "R-PROG-55, R-PROG-57",
  schema: z.object({ target: ItemRef, robot: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const t = requireRef(ws, p.target, "target");
    if (t.type !== "target") throw new CommandError(`${t.name} is not a target`);
    if (!t.parent) throw new CommandError("The target is not placed on a reference frame");
    const r = requireRobot(ws, p.robot ?? t.target?.robot ?? undefined);
    assertTargetEditable(ws, t.id);
    tx.set(t.id, { pose: tcpIn(ws, r, t.parent), target: { ...t.target!, joints: combinedJoints(ws, r), robot: r.id } });
    ctx.undoLabel = `Move target: ${t.name}`;
    return { id: t.id };
  },
});

defineCommand({
  name: "target.setJoint",
  title: "Cartesian / Joint Target",
  description: "Mark a target as a joint target (moves use the stored joints) or a Cartesian target (moves use the pose).",
  category: "target",
  undoable: false,
  spec: "R-TREE-41, R-PROG-55",
  schema: z.object({ target: ItemRef, isJoint: z.boolean() }),
  run({ ws, tx }, p) {
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    tx.set(t.id, { target: { ...t.target, isJoint: p.isJoint } });
    return { isJoint: p.isJoint };
  },
});

defineCommand({
  name: "target.setRobot",
  title: "Robot Linked",
  description: "Link a target to a robot (or none).",
  category: "target",
  undoable: false,
  spec: "R-TREE-41, R-TREE-44",
  schema: z.object({ target: ItemRef, robot: ItemRef.nullable() }),
  run({ ws, tx }, p) {
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    const r = p.robot === null ? null : requireRobot(ws, p.robot);
    tx.set(t.id, { target: { ...t.target, robot: r?.id ?? null } });
    return { robot: r?.name ?? null };
  },
});

defineCommand({
  name: "target.setJoints",
  title: "Set Target Joints",
  description: "Set the joints stored in a target; with a linked robot the pose follows by forward kinematics.",
  category: "target",
  spec: "R-PROG-55",
  schema: z.object({ target: ItemRef, joints: Joints }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    if (ctx.origin !== "api") assertTargetEditable(ws, t.id);
    const r = t.target.robot ? ws.items[t.target.robot] : undefined;
    const pose = r?.robot && t.parent ? tcpIn(ws, r, t.parent, p.joints) : t.pose;
    tx.set(t.id, { pose, target: { ...t.target, joints: p.joints.slice() } });
    ctx.undoLabel = ctx.origin === "api" ? null : `Move target: ${t.name}`;
    return { joints: p.joints };
  },
});

defineCommand({
  name: "target.recalculate",
  title: "Recalculate Targets",
  description: "Re-solve the stored joints of Cartesian targets near their old joints (stale after a frame moved).",
  category: "target",
  undoable: false,
  spec: "R-PROG-55",
  schema: z.object({ targets: z.array(ItemRef).min(1) }),
  run({ ws, tx }, p) {
    const out: { name: string; ok: boolean }[] = [];
    for (const ref of p.targets) {
      const t = requireRef(ws, ref, "target");
      const r = t.target?.robot ? ws.items[t.target.robot] : undefined;
      if (!t.target || t.target.isJoint || !r?.robot) continue;
      const q = jointsForTarget(ws, r, { ...t, target: { ...t.target, isJoint: false } }, t.target.joints.length ? t.target.joints : r.robot.joints);
      if (q) tx.set(t.id, { target: { ...t.target, joints: q } });
      out.push({ name: t.name, ok: !!q });
    }
    return out;
  },
});

defineCommand({
  name: "target.info",
  title: "Target Info",
  description: "Pose (relative to parent), joints, type and robot link of a target.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ target: ItemRef }),
  run({ ws }, p) {
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    return {
      name: t.name,
      parent: t.parent ? ws.items[t.parent]?.name : null,
      isJoint: t.target.isJoint,
      joints: t.target.joints,
      xyzrpw: poseToXYZRPW(t.pose).map((v) => round(v, 3)),
      robot: t.target.robot ? ws.items[t.target.robot]?.name : null,
    };
  },
});

 
export function jointsForTarget(ws: Workspace, robot: Item, target: Item, seed: number[]): number[] | null {
  if (!target.target) return null;
  if (target.target.isJoint && target.target.joints.length) return target.target.joints.slice();
  const flangeInBase = mul(mul(inv(absPose(ws, robot.id)), absPose(ws, target.id)), inv(toolPose(ws, robot.id)));
  return solveGoal(robot.robot!.model, flangeInBase, target.target.joints, seed);
}

 

 
function targetRobot(ws: Workspace, t: Item, ref?: string | number): Item {
  if (ref !== undefined) return requireRobot(ws, ref);
  const linked = t.target?.robot ? ws.items[t.target.robot] : undefined;
  if (linked?.robot) return linked;
  return requireRobot(ws, undefined);
}

 
function flangeGoal(ws: Workspace, robot: Item, t: Item): Mat {
  return mul(mul(inv(absPose(ws, robot.id)), absPose(ws, t.id)), inv(toolPose(ws, robot.id)));
}

const sameTurn = (a: number[], b: number[]) =>
  a.length === b.length &&
  a.every((v, k) => {
    const d = Math.abs(v - b[k]) % 360;
    return d < 1e-3 || 360 - d < 1e-3;
  });

 
export function configLabels(robot: Item, q: number[]): { frontRear: string; elbow: string; wrist: string; key: string } {
  const c = kinematicsReady() ? jointsConfig(robot.robot!.model, q) : [0, 0, 0];
   
  const scara = robot.robot!.model.mech === 2;
  const frontRear = c[0] ? "Rear" : "Front";
  const elbow = scara ? (c[1] ? "Right" : "Left") : c[1] ? "Elbow Down" : "Elbow Up";
  const wrist = c[2] ? "Flip" : "Non-Flip";
  return { frontRear, elbow, wrist, key: `${c[0]}${c[1]}${c[2]}` };
}

export interface ConfigRow {
  id: number;
  frontRear: string;
  elbow: string;
  wrist: string;
  joints: number[];
  recommended: boolean;
  current: boolean;
  turn: boolean;
}






export function targetConfigurations(ws: Workspace, robot: Item, t: Item, opts: { showAll?: boolean; recommended?: boolean } = {}): ConfigRow[] {
  const model = robot.robot!.model;
  const sols = ikAll(model, flangeGoal(ws, robot, t));
  const cur = robot.robot!.joints;
  const dist = (q: number[]) => q.reduce((a, v, k) => a + Math.abs(v - (cur[k] ?? 0)), 0);
  const stored = t.target?.joints ?? [];
  const rows: ConfigRow[] = sols.map((q, i) => {
    const l = configLabels(robot, q);
    return {
      id: i,
      frontRear: l.frontRear,
      elbow: l.elbow,
      wrist: l.wrist,
      joints: q,
      recommended: false,
      current: q.length === stored.length && q.every((v, k) => Math.abs(v - stored[k]) < 1e-3),
      turn: sols.slice(0, i).some((prev) => sameTurn(q, prev)),
    };
  });
  const best = new Map<string, ConfigRow>();
  for (const r of rows) {
    const key = configLabels(robot, r.joints).key;
    const b = best.get(key);
    if (!b || dist(r.joints) < dist(b.joints)) best.set(key, r);
  }
  for (const r of best.values()) r.recommended = true;
  return rows.filter((r) => (opts.recommended ? r.recommended : opts.showAll || !r.turn));
}

defineCommand({
  name: "target.configurations",
  title: "Robot Configurations",
  description:
    "List the robot configurations that reach a target (Change Target Configuration, F4): config id, Front/Rear, Elbow Up/Down, Flip/Non-Flip and joints; 'recommended' marks the solution of each configuration closest to the robot's current joints, 'showAll' includes ±360° turn variants.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-58, D-27 (FormRobotConfig)",
  schema: z.object({ target: ItemRef, robot: ItemRef.optional(), showAll: z.boolean().default(false), recommended: z.boolean().default(false) }),
  run({ ws }, p) {
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    const robot = targetRobot(ws, t, p.robot);
    return { robot: robot.name, configurations: targetConfigurations(ws, robot, t, p).map((r) => ({ ...r, joints: r.joints.map((v) => round(v, 4)) })) };
  },
});

defineCommand({
  name: "target.setConfiguration",
  title: "Change Target Configuration",
  description:
    "Store another robot configuration in a target (F4): give the joints of one solution from target.configurations, or a configuration such as 'Rear, Elbow Down, Flip' (the recommended solution of that configuration is used). The target pose does not change.",
  category: "target",
  spec: "R-PROG-58, D-27",
  schema: z.object({ target: ItemRef, robot: ItemRef.optional(), joints: Joints.optional(), config: z.string().optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    assertTargetEditable(ws, t.id);
    const robot = targetRobot(ws, t, p.robot);
    const rows = targetConfigurations(ws, robot, t, { showAll: true });
    let row: ConfigRow | undefined;
    if (p.joints) row = rows.find((r) => r.joints.length === p.joints!.length && r.joints.every((v, k) => Math.abs(v - p.joints![k]) < 1e-2));
    else if (p.config) {
      const want = p.config.toLowerCase().replace(/[^a-z]/g, "");
      row = targetConfigurations(ws, robot, t, { recommended: true }).find((r) => {
        const words = [r.frontRear, r.elbow, r.wrist].map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
        return words.every((w) => want.includes(w)) && want.length === words.join("").length;
      });
    } else throw new CommandError("Give the joints or the configuration to use");
    if (!row) throw new CommandError("Target is not reachable with this configuration");
    tx.set(t.id, { target: { ...t.target, joints: row.joints.slice(), robot: robot.id } });
    ctx.undoLabel = `Move target: ${t.name}`;
    return { target: t.name, configuration: `${row.frontRear}, ${row.elbow}, ${row.wrist}`, joints: row.joints.map((v) => round(v, 4)) };
  },
});

defineCommand({
  name: "target.preview",
  title: "Preview Targets",
  description: "Show the robot at the given targets as previews in the 3D view (F5). Escape hides the preview ('Robot preview hidden').",
  category: "view",
  readonly: true,
  undoable: false,
  spec: "R-PROG-58 (Preview Targets FUN_10039f2ac)",
  schema: z.object({ targets: z.array(ItemRef).min(1) }),
  run(ctx, p) {
    const { ws, services } = ctx;
    const targets = p.targets.map((r) => requireRef(ws, r, "target")).filter((t) => t.target);
    const robotId = targets.map((t) => t.target!.robot).find((r) => r && ws.items[r]?.robot);
    if (!robotId) throw new CommandError("Select targets to preview");
    const robot = ws.items[robotId];
    const joints = targets
      .filter((t) => (t.target!.robot ?? robotId) === robotId)
      .map((t) => jointsForTarget(ws, robot, t, t.target!.joints.length ? t.target!.joints : robot.robot!.joints) ?? t.target!.joints);
    services.emit?.({ type: "preview-targets", robot: robotId, joints });
    return { robot: robot.name, previews: joints.length };
  },
});

 
export function alignedRotation(m: Mat): Mat {
  const axes = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let best: Mat = m;
  let score = -Infinity;
  for (const x of axes)
    for (const y of axes) {
      if (x[0] * y[0] + x[1] * y[1] + x[2] * y[2] !== 0) continue;
      const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
       
      const sc = m[0] * x[0] + m[4] * x[1] + m[8] * x[2] + m[1] * y[0] + m[5] * y[1] + m[9] * y[2] + m[2] * z[0] + m[6] * z[1] + m[10] * z[2];
      if (sc > score) {
        score = sc;
        best = [x[0], y[0], z[0], m[3], x[1], y[1], z[1], m[7], x[2], y[2], z[2], m[11], 0, 0, 0, 1];
      }
    }
  return best;
}

defineCommand({
  name: "target.alignOrientation",
  title: "Align Target Orientation",
  description: "Snap a target's orientation to the closest orientation aligned with its reference frame axes, keeping its position; the stored joints are re-solved.",
  category: "target",
  spec: "R-TREE-41 (Align Target Orientation, FUN_10046a08c)",
  schema: z.object({ target: ItemRef }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    assertTargetEditable(ws, t.id);
    const pose = alignedRotation(t.pose);
    if (pose.every((v, k) => Math.abs(v - t.pose[k]) < 1e-9)) return { changed: false };
    const robot = t.target.robot ? ws.items[t.target.robot] : undefined;
    let joints = t.target.joints;
    if (robot?.robot) {
      const moved = { ...t, pose };
      const q = jointsForTarget({ ...ws, items: { ...ws.items, [t.id]: moved } }, robot, { ...moved, target: { ...t.target, isJoint: false } }, joints.length ? joints : robot.robot.joints);
      if (q) joints = q;
    }
    tx.set(t.id, { pose, target: { ...t.target, joints } });
    ctx.undoLabel = `Move target: ${t.name}`;
    return { changed: true, xyzrpw: poseToXYZRPW(pose).map((v) => round(v, 3)) };
  },
});

defineCommand({
  name: "target.toggleSelect",
  title: "Select (target)",
  description: "Target menu check box 'Select': add the target to the selection or remove it.",
  category: "target",
  undoable: false,
  spec: "R-TREE-41 (Select, FUN_10046a08c)",
  schema: z.object({ target: ItemRef }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const t = requireRef(ws, p.target, "target");
    const sel = ws.selection.includes(t.id) ? ws.selection.filter((s) => s !== t.id) : [...ws.selection, t.id];
    tx.setMeta("selection", sel);
    ctx.undoLabel = null;
    return { selected: sel.includes(t.id) };
  },
});
