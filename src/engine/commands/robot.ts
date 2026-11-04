import { z } from "zod";
import { requireRef } from "../dispatch";
import { clampJoints, fk, ikAll, ikClosest, jointsConfig, linkFrames } from "../kinematics";
import { eye, inv, mul, poseToXYZRPW, round, transl, xyzrpwToPose, rotx, roty, rotz, DEG, type Mat } from "../math";
import { autoName } from "../naming";
import { CommandError, defineCommand, ItemRef, Joints, Pose, XYZRPW, type CmdCtx } from "../registry";
import type { Item, MeshRef, RobotData, RobotModel, Workspace } from "../types";
import type { Tx } from "../tx";
import { absPose, activeToolOf, childFrame, makeItem, toolPose } from "../workspace";
import { jointsByItem } from "../sync/axes";
import { activeStationId, adoptAsActiveFrame } from "./items";

 
function moveRobotUndo(ctx: CmdCtx, r: Item) {
  ctx.undoLabel = ctx.origin === "api" ? null : `Move robot: ${r.name}`;
}

export function requireRobot(ws: Workspace, ref: string | number | undefined): Item {
  if (ref === undefined) {
    const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "robot");
    if (sel) return sel;
    const any = Object.values(ws.items).find((i) => i.type === "robot" && (!ws.activeStation || isIn(ws, i.id, ws.activeStation)));
    if (!any) throw new CommandError("No robot in the station. Load one from the robot library first.");
    return any;
  }
  const it = requireRef(ws, ref, "robot");
  if (it.type !== "robot" || !it.robot) throw new CommandError(`${it.name} is not a robot`);
  return it;
}

function isIn(ws: Workspace, id: string, stationId: string) {
  let cur = ws.items[id];
  while (cur?.parent) cur = ws.items[cur.parent];
  return cur?.id === stationId;
}

 
export function robotDataFromParsed(json: Record<string, unknown>, links: MeshRef[][]): RobotData {
  type Row = { alpha: number; a: number; theta: number; d: number; kind: number };
  const dh = (json.dh as Row[]) ?? [];
  const nq = Number(json.dof ?? dh.length);
  const lowerInt = (json.lower_internal as number[]) ?? [];
  const upperInt = (json.upper_internal as number[]) ?? [];
  const model: RobotModel = {
    base: (json.base as Mat)?.length === 16 ? (json.base as Mat) : eye(),
    flange: (json.flange as Mat)?.length === 16 ? (json.flange as Mat) : eye(),
    joints: dh.map((r, i) => ({
      kind: r.kind === 1 ? "linear" : "rotary",
      alpha: r.alpha,
      a: r.a,
      theta: r.theta,
      d: r.d,
      lower: lowerInt[i] ?? -180,
      upper: upperInt[i] ?? 180,
    })),
    nq,
    map: (json.map as number[])?.length === dh.length * nq ? (json.map as number[]) : identityMap(dh.length, nq),
    userLower: ((json.lower as number[]) ?? []).slice(0, nq),
    userUpper: ((json.upper as number[]) ?? []).slice(0, nq),
    polygon: ((json.polygon as [number, number][]) ?? []).map((p) => [p[0], p[1]]),
    mech: Number(json.mech ?? 1),
     
    meshLinks: Number(json.nlinks) > 0 ? Number(json.nlinks) : undefined,
    mechParams: Array.isArray(json.mech_params) && (json.mech_params as number[]).length ? (json.mech_params as number[]) : undefined,
  };
  const home = ((json.home as number[]) ?? new Array(nq).fill(0)).slice(0, nq);
  const saved = ((json.joints as number[]) ?? home).slice(0, nq);
  const sp = (json.speeds as Record<string, number>) ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    model,
    joints: saved.slice(),
    home,
    links,
     
     
    postProcessor: String(json.post_processor ?? ""),
     
    ...(Array.isArray(json.header) && (json.header as unknown[]).length ? { header: (json.header as number[]).slice() } : {}),
    ...(json.native_name ? { nativeName: String(json.native_name) } : {}),
    ...(num(json.payload) !== undefined ? { payload: num(json.payload) } : {}),
    ...(num(json.reach) !== undefined ? { reach: num(json.reach) } : {}),
    ...(num(json.repeatability) !== undefined ? { repeatability: num(json.repeatability) } : {}),
    ...(num(json.weight) !== undefined ? { weight: num(json.weight) } : {}),
     
     
     
     
    speeds: {
      linear: num(sp.linear) ?? 1000,
      joint: num(sp.joint) ?? 200,
      linearAccel: num(sp.linear_accel) ?? 1500,
      jointAccel: num(sp.joint_accel) ?? 150,
    },
     
    ...(num(sp.rounding) !== undefined ? { rounding: num(sp.rounding) } : {}),
  };
}

function identityMap(rows: number, cols: number) {
  const m = new Array(rows * cols).fill(0);
  for (let i = 0; i < Math.min(rows, cols); i++) m[i * cols + i] = 1;
  return m;
}





export function addRobotItem(ws: Workspace, tx: Tx, name: string, data: RobotData, parentId: string, basePose?: Mat): { base: Item; robot: Item } {
  const base = makeItem(ws, "frame", `${name} Base`);
  if (basePose) base.pose = basePose;
  tx.add(base, parentId);
   
   
  adoptAsActiveFrame(ws, tx, base.id);
  const robot = makeItem(ws, "robot", name, { robot: { ...data, activeFrame: null } });
  tx.add(robot, base.id);
  tx.split(`Add: ${name}`);
  return { base, robot };
}

defineCommand({
  name: "robot.setJoints",
  title: "Set Robot Joints",
  description: "Move a robot instantly to joint values (degrees/mm). Values outside the joint limits are clamped to the limit.",
  category: "robot",
  spec: "KIN-SETJOINTS",
  schema: z.object({ robot: ItemRef.optional(), joints: Joints }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
     
    const q = clampJoints(r.robot!.model, p.joints);
    tx.set(r.id, { robot: { ...r.robot!, joints: q } });
     
    for (const [id, qa] of jointsByItem(ws, r.id, p.joints).slice(1)) tx.set(id, { robot: { ...ws.items[id].robot!, joints: clampJoints(ws.items[id].robot!.model, qa) } });
    moveRobotUndo(ctx, r);
    return { robot: r.name, joints: q };
  },
});

defineCommand({
  name: "robot.home",
  title: "Move Robot Home",
  description: "Move the robot to its home joints instantly.",
  category: "robot",
  schema: z.object({ robot: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
    tx.set(r.id, { robot: { ...r.robot!, joints: r.robot!.home.slice() } });
    moveRobotUndo(ctx, r);
    return { joints: r.robot!.home };
  },
});

defineCommand({
  name: "robot.setHome",
  title: "Set Home Joints",
  description: "Define the robot's home joints (defaults to current joints).",
  category: "robot",
  undoable: false,
  schema: z.object({ robot: ItemRef.optional(), joints: Joints.optional() }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
    const h = p.joints ?? r.robot!.joints.slice();
    tx.set(r.id, { robot: { ...r.robot!, home: h } });
    return { home: h };
  },
});

defineCommand({
  name: "robot.setJointLimits",
  title: "Set Joint Limits",
  description: "Change robot joint limits (lower/upper per joint).",
  category: "robot",
  undoable: false,
  schema: z.object({ robot: ItemRef.optional(), lower: Joints, upper: Joints }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
    const model = structuredClone(r.robot!.model);
    for (let k = 0; k < model.nq; k++) {
      if (p.lower[k] !== undefined) model.userLower[k] = p.lower[k];
      if (p.upper[k] !== undefined) model.userUpper[k] = p.upper[k];
    }
     
    model.joints.forEach((j, row) => {
      let lo = 0;
      let hi = 0;
      let used = false;
      for (let k = 0; k < model.nq; k++) {
        const g = model.map[row * model.nq + k];
        if (!g) continue;
        used = true;
        const a = g * model.userLower[k];
        const b = g * model.userUpper[k];
        lo += Math.min(a, b);
        hi += Math.max(a, b);
      }
      if (used) {
        j.lower = lo;
        j.upper = hi;
      }
    });
    tx.set(r.id, { robot: { ...r.robot!, model } });
    return { lower: model.userLower, upper: model.userUpper };
  },
});

defineCommand({
  name: "robot.jogJoint",
  title: "Jog Joint",
  description: "Increment one joint by `delta` (deg or mm). Joint index is 1-based.",
  category: "robot",
  spec: "KIN-JOG-JOINT",
  schema: z.object({ robot: ItemRef.optional(), joint: z.number().int().min(1), delta: z.number() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
    moveRobotUndo(ctx, r);
    const q = r.robot!.joints.slice();
    if (p.joint > r.robot!.model.nq) throw new CommandError(`Robot has no joint ${p.joint}`);
    q[p.joint - 1] += p.delta;
    const c = clampJoints(r.robot!.model, q);
    tx.set(r.id, { robot: { ...r.robot!, joints: c } });
    return { joints: c };
  },
});

defineCommand({
  name: "robot.jogCartesian",
  title: "Jog Cartesian",
  description:
    "Move the robot TCP along/around an axis (x,y,z mm; rx,ry,rz deg) with respect to the active reference frame ('reference') or the tool ('tool'). Fails if the target is unreachable.",
  category: "robot",
  spec: "KIN-JOG-CART",
  schema: z.object({
    robot: ItemRef.optional(),
    axis: z.enum(["x", "y", "z", "rx", "ry", "rz"]),
    delta: z.number(),
    frame: z.enum(["reference", "tool"]).default("reference"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
    moveRobotUndo(ctx, r);
    const rd = r.robot!;
    const tcp = toolPose(ws, r.id);
    const flange = fk(rd.model, rd.joints);
    const cur = mul(flange, tcp);  
    let step: Mat;
    if (p.axis === "x") step = transl(p.delta, 0, 0);
    else if (p.axis === "y") step = transl(0, p.delta, 0);
    else if (p.axis === "z") step = transl(0, 0, p.delta);
    else if (p.axis === "rx") step = rotx(p.delta * DEG);
    else if (p.axis === "ry") step = roty(p.delta * DEG);
    else step = rotz(p.delta * DEG);
    let next: Mat;
    if (p.frame === "tool") next = mul(cur, step);
    else {
       
      const refId = rd.activeFrame && ws.items[rd.activeFrame] ? rd.activeFrame : r.parent;
      const baseAbs = absPose(ws, r.id);
      const refAbs = refId ? absPose(ws, refId) : eye();
      const refInBase = mul(inv(baseAbs), refAbs);
      const tcpInRef = mul(inv(refInBase), cur);
      const p0 = [tcpInRef[3], tcpInRef[7], tcpInRef[11]];
      let moved: Mat;
      if (p.axis.startsWith("r")) {
        moved = mul(step, tcpInRef);
        moved[3] = p0[0];
        moved[7] = p0[1];
        moved[11] = p0[2];
      } else moved = mul(step, tcpInRef);
      next = mul(refInBase, moved);
    }
    const flangeTarget = mul(next, inv(tcp));
    const q = ikClosest(rd.model, flangeTarget, rd.joints);
    if (!q) throw new CommandError("Target not reachable");
    tx.set(r.id, { robot: { ...rd, joints: q } });
    return { joints: q };
  },
});

defineCommand({
  name: "robot.moveTo",
  title: "Move Robot To Pose",
  description:
    "Move the robot TCP to a pose (xyzrpw or 4x4) expressed in the active reference frame (default) or the station. Uses the IK solution closest to the current joints.",
  category: "robot",
  spec: "KIN-IK",
  schema: z.object({
    robot: ItemRef.optional(),
    pose: Pose.optional(),
    xyzrpw: XYZRPW.optional(),
    relativeTo: z.enum(["reference", "station", "base"]).default("reference"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
    moveRobotUndo(ctx, r);
    const rd = r.robot!;
    const pose = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : undefined);
    if (!pose) throw new CommandError("Provide pose or xyzrpw");
    const baseAbs = absPose(ws, r.id);
    let inBase: Mat;
    if (p.relativeTo === "base") inBase = pose;
    else if (p.relativeTo === "station") inBase = mul(inv(baseAbs), pose);
    else {
      const refId = rd.activeFrame && ws.items[rd.activeFrame] ? rd.activeFrame : r.parent;
      const refAbs = refId ? absPose(ws, refId) : eye();
      inBase = mul(inv(baseAbs), mul(refAbs, pose));
    }
    const q = ikClosest(rd.model, mul(inBase, inv(toolPose(ws, r.id))), rd.joints);
    if (!q) throw new CommandError("Target not reachable");
    tx.set(r.id, { robot: { ...rd, joints: q } });
    return { joints: q };
  },
});

defineCommand({
  name: "robot.solveFK",
  title: "Forward Kinematics",
  description: "Flange pose (robot base frame) for joint values, as 4x4 and xyzrpw. Read-only.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "KIN-FK",
  schema: z.object({ robot: ItemRef.optional(), joints: Joints.optional(), withTool: z.boolean().default(false) }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    let t = fk(r.robot!.model, p.joints ?? r.robot!.joints);
    if (p.withTool) t = mul(t, toolPose(ws, r.id));
    return { pose: t.map((v) => round(v, 6)), xyzrpw: poseToXYZRPW(t).map((v) => round(v, 4)) };
  },
});

defineCommand({
  name: "robot.solveIK",
  title: "Inverse Kinematics",
  description: "Joint solution closest to `seed` (default: current joints) for a flange pose in the robot base frame. Returns null if unreachable.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "KIN-IK",
  schema: z.object({ robot: ItemRef.optional(), pose: Pose.optional(), xyzrpw: XYZRPW.optional(), seed: Joints.optional(), all: z.boolean().default(false) }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    const pose = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : undefined);
    if (!pose) throw new CommandError("Provide pose or xyzrpw");
    if (p.all) return { solutions: ikAll(r.robot!.model, pose).map((s) => s.map((v) => round(v, 4))) };
    const q = ikClosest(r.robot!.model, pose, p.seed ?? r.robot!.joints);
    return { joints: q ? q.map((v) => round(v, 4)) : null };
  },
});

defineCommand({
  name: "robot.config",
  title: "Robot Configuration",
  description: "JointsConfig: [rear, lower, flip, turns] flags of a joint vector (default current joints).",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "KIN-CONFIG",
  schema: z.object({ robot: ItemRef.optional(), joints: Joints.optional() }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    return { config: jointsConfig(r.robot!.model, p.joints ?? r.robot!.joints) };
  },
});

defineCommand({
  name: "robot.linkFrames",
  title: "Robot Link Frames",
  description: "Absolute poses of every robot link for given (or current) joints.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ robot: ItemRef.optional(), joints: Joints.optional() }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    const base = absPose(ws, r.id);
    return linkFrames(r.robot!.model, p.joints ?? r.robot!.joints).map((f) => mul(base, f).map((v) => round(v, 4)));
  },
});

defineCommand({
  name: "robot.addTool",
  title: "Add Tool (TCP)",
  description:
    "Add an empty tool (TCP) to a robot ('Tool N', N = tools in the station incl. the new one) with a TCP pose relative to the flange. It becomes the active tool only if the robot has none.",
  category: "robot",
  spec: "R-TREE-6, R-TREE-14",
  schema: z.object({ robot: ItemRef.optional(), name: z.string().optional(), xyzrpw: XYZRPW.optional(), pose: Pose.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
    const tool = makeItem(ws, "tool", p.name ?? autoName(ws, activeStationId(ws), "tool"), { tool: { meshes: [] } });
    tool.pose = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : eye());
    tx.add(tool, r.id);
    const rd = ws.items[r.id].robot!;
     
    if (!rd.activeTool || !ws.items[rd.activeTool]) tx.set(r.id, { robot: { ...rd, activeTool: tool.id, tcp: null } });
    ctx.undoLabel = `Add: ${tool.name}`;
    return { id: tool.id, name: tool.name, handle: tool.handle };
  },
});

defineCommand({
  name: "robot.setActiveTool",
  title: "Set Active Tool",
  description: "Choose which of the robot's tools is active (used for jogging, targets and programs).",
  category: "robot",
  undoable: false,
  schema: z.object({ robot: ItemRef.optional(), tool: ItemRef }),
  run({ ws, tx }, p) {
    const t = requireRef(ws, p.tool, "tool");
    if (t.type !== "tool") throw new CommandError(`${t.name} is not a tool`);
    const r = p.robot !== undefined ? requireRobot(ws, p.robot) : t.parent ? ws.items[t.parent] : undefined;
    if (!r?.robot) throw new CommandError("Tool is not attached to a robot");
     
    tx.set(r.id, { robot: { ...r.robot, activeTool: t.id, tcp: null } });
    return { tool: t.name };
  },
});

defineCommand({
  name: "robot.setActiveFrame",
  title: "Set Active Reference",
  description: "Choose the reference frame used by the robot for jogging and new targets.",
  category: "robot",
  undoable: false,
  schema: z.object({ robot: ItemRef.optional(), frame: ItemRef }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
    const f = requireRef(ws, p.frame, "frame");
    if (f.type !== "frame") throw new CommandError(`${f.name} is not a reference frame`);
    tx.set(r.id, { robot: { ...r.robot!, activeFrame: f.id } });
    return { frame: f.name };
  },
});

defineCommand({
  name: "robot.setPostProcessor",
  title: "Select Post Processor",
  description: "Set the post processor used when generating programs for this robot.",
  category: "robot",
  undoable: false,
  spec: "POST-SELECT",
  schema: z.object({ robot: ItemRef.optional(), post: z.string() }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
     
    const post = p.post.replace(/\.py$/i, "");
    tx.set(r.id, { robot: { ...r.robot!, postProcessor: post } });
    return { post };
  },
});

defineCommand({
  name: "robot.setSpeed",
  title: "Set Robot Speed",
  description: "Set default robot speeds (linear mm/s, joint deg/s) and accelerations; -1 keeps a value.",
  category: "robot",
  undoable: false,
  schema: z.object({
    robot: ItemRef.optional(),
    linear: z.number().default(-1),
    joint: z.number().default(-1),
    linearAccel: z.number().default(-1),
    jointAccel: z.number().default(-1),
  }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
    const s = { ...r.robot!.speeds };
    if (p.linear >= 0) s.linear = p.linear;
    if (p.joint >= 0) s.joint = p.joint;
    if (p.linearAccel >= 0) s.linearAccel = p.linearAccel;
    if (p.jointAccel >= 0) s.jointAccel = p.jointAccel;
    tx.set(r.id, { robot: { ...r.robot!, speeds: s } });
    return s;
  },
});

 
export function tcpAbs(ws: Workspace, robotId: string): Mat {
  return mul(childFrame(ws, robotId), activeToolOf(ws, robotId)?.pose ?? eye());
}

export { activeStationId };
