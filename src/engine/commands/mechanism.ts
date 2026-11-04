 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { transformTriangles } from "../exporters";
import { clampJoints, linkFrames } from "../kinematics";
import { DEG, eye, inv, mul, type Mat } from "../math";
import { CommandError, defineCommand, ItemRef, Pose, type CmdCtx } from "../registry";
import type { Item, MeshRef, RobotData, RobotModel } from "../types";
import { buildMechanismModel, MECHANISM_PARAMS, MECHANISM_TYPES, mechanismKinematics, internalLimits } from "../utilities/mechanism";
import { absPose, childFrame } from "../workspace";
import { activeStationId, apiNoUndo } from "./items";
import { addRobotItem, requireRobot } from "./robot";

 
export const MECHANISM_DEFAULT_NAME = "My Mechanism";
const BUILT_SPEEDS = { linear: 1000, linearAccel: 50, joint: 5000, jointAccel: 50 };

const TYPE_BY_LABEL = new Map(MECHANISM_TYPES.map((t) => [t.label.toLowerCase(), t.code]));

function typeCode(t: number | string): number {
  if (typeof t === "number") return t;
  const byLabel = TYPE_BY_LABEL.get(t.trim().toLowerCase());
  if (byLabel !== undefined) return byLabel;
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  throw new CommandError(`Unknown mechanism type "${t}"`);
}

export interface BuildSpec {
  type: number;
  name: string;
  objects: (Item | null)[];
  params: number[];
  build?: number[];
  home?: number[];
  senses?: number[];
  lower?: number[];
  upper?: number[];
  base?: Mat;
  tool?: Mat;
  replace?: Item;
  parent?: string;
}

 
export function buildMechanism(ctx: CmdCtx, spec: BuildSpec): { robot: Item; base: Item | null } {
  const { ws, tx, services } = ctx;
  let kin;
  try {
    kin = mechanismKinematics(spec.type, spec.params);
  } catch {
    throw new CommandError(`Unknown mechanism type ${spec.type}`);
  }
  const n = kin.nq;
  const pad = (v: number[] | undefined, d: number) => Array.from({ length: n }, (_, i) => (Number.isFinite(v?.[i]) ? v![i] : d));
  const build = pad(spec.build, 0);
  const home = pad(spec.home, 0);
  const { model } = buildMechanismModel({
    type: spec.type,
    params: spec.params,
    base: spec.base,
    tool: spec.tool,
    senses: pad(spec.senses, 1).concat(spec.senses?.[6] !== undefined && n === 6 ? [spec.senses[6]] : []),
    lower: pad(spec.lower, -200),
    upper: pad(spec.upper, 200),
  });
   
  const object0 = spec.objects[0];
  const B = object0 ? absPose(ws, object0.id) : eye();
  const frames = linkFrames(model, build);
  const nlinks = model.meshLinks ?? model.joints.length + 1;
  const links: MeshRef[][] = Array.from({ length: nlinks }, () => []);
  spec.objects.slice(0, nlinks).forEach((obj, i) => {
    if (!obj) return;
    const meshes = obj.object?.meshes ?? obj.tool?.meshes ?? [];
    const gp = obj.object?.geometryPose ?? obj.tool?.geometryPose;
    const holder = obj.type === "tool" ? childFrame(ws, obj.parent) : absPose(ws, obj.id);
    const local = mul(inv(mul(B, frames[i] ?? frames[0])), gp ? mul(holder, gp) : holder);
    for (const m of meshes) {
      const tri = services.geometry.get(m.geometry);
      if (!tri?.length) continue;
      links[i].push({ geometry: services.geometry.put(transformTriangles(tri, local)), color: m.color });
    }
  });
  const q = clampJoints(model, home);
  if (spec.replace?.robot) {
    const r = spec.replace;
    tx.set(r.id, { name: spec.name || r.name, robot: { ...r.robot!, model, links, home, joints: q } });
    return { robot: ctx.ws.items[r.id], base: r.parent ? ws.items[r.parent] : null };
  }
  const data: RobotData = { model, joints: q, home, links, postProcessor: "ABB_RAPID_IRC5", speeds: { ...BUILT_SPEEDS } };
  const parent = spec.parent ?? activeStationId(ws);
   
  const baseAbs = B.slice();
  baseAbs[7] += 1000;
  const { base, robot } = addRobotItem(ws, tx, spec.name, data, parent, mul(inv(childFrame(ws, parent)), baseAbs));
  return { robot, base };
}

defineCommand({
  name: "mechanism.types",
  title: "Mechanism Types",
  description: "List the mechanism and robot types of Model Mechanism or Robot in the dialog's order: type code, label, number of axes and the parameter names each type reads.",
  category: "robot",
  readonly: true,
  undoable: false,
  spec: "B-UTIL-04",
  schema: z.object({}),
  run() {
    return MECHANISM_TYPES.map((t) => ({ code: t.code, label: t.label, axes: mechanismKinematics(t.code).nq, params: MECHANISM_PARAMS[t.code] ?? [] }));
  },
});

defineCommand({
  name: "mechanism.build",
  title: "Model Mechanism or Robot",
  description:
    "Build a mechanism or robot from station objects (Utilities ▸ Model Mechanism or Robot / robolink BuildMechanism). `type` is a code or label from mechanism.types (e.g. 1 = 1 rotative axis turntable, 4 = 1 linear axis rail, 6 = 3 linear axes gantry, 9 = 4-axis SCARA, 7 = 6-axis industrial robot). `objects` lists one object per link: the base, then one per axis, as placed at the `build` joints. Joints default to 0, limits to ±200, senses to 1 (−1 inverts an axis). The robot is created with its \"<name> Base\" frame 1000 mm along Y from the first object; `replace` rebuilds an existing robot instead.",
  category: "robot",
  spec: "B-UTIL-04",
  schema: z.object({
    type: z.union([z.number().int(), z.string()]),
    name: z.string().default(MECHANISM_DEFAULT_NAME),
    objects: z.array(ItemRef.nullable()).default([]).describe("base object, then one object per axis (null for no geometry)"),
    params: z.array(z.number()).default([]).describe("type parameters in mm and deg (see mechanism.types)"),
    build: z.array(z.number()).optional().describe("joints at which the objects are placed"),
    home: z.array(z.number()).optional(),
    senses: z.array(z.number()).optional().describe("1 or −1 per axis (6-axis types: a 7th value couples J2 into J3)"),
    lower: z.array(z.number()).optional(),
    upper: z.array(z.number()).optional(),
    base: Pose.optional().describe("base shift H_B (row-major 4x4)"),
    tool: Pose.optional().describe("end-effector shift H_T (row-major 4x4)"),
    parent: ItemRef.optional().describe("frame that holds the new base frame (Base reference F_B; default the station)"),
    replace: ItemRef.optional().describe("robot to rebuild"),
  }),
  run(ctx, p) {
    const { ws } = ctx;
    const type = typeCode(p.type);
    const objects = p.objects.map((o) => {
      if (o === null || o === undefined || o === "") return null;
      const it = requireRef(ws, o, "object");
      if (!it.object && !it.tool) throw new CommandError(`${it.name} has no geometry`);
      return it;
    });
    const replace = p.replace !== undefined ? requireRobot(ws, p.replace) : undefined;
    const parent = p.parent !== undefined ? requireRef(ws, p.parent, "base reference").id : undefined;
    const { robot, base } = buildMechanism(ctx, {
      type,
      name: p.name.trim() || MECHANISM_DEFAULT_NAME,
      objects,
      params: p.params,
      build: p.build,
      home: p.home,
      senses: p.senses,
      lower: p.lower,
      upper: p.upper,
      base: p.base,
      tool: p.tool,
      replace,
      parent,
    });
    apiNoUndo(ctx);
    return { robot: robot.name, id: robot.id, base: base?.name ?? null, axes: robot.robot!.model.nq, joints: robot.robot!.joints };
  },
});

 
function dhRows(model: RobotModel) {
  return model.joints.map((j) => ({ type: j.kind, alpha: j.alpha / DEG, a: j.a, theta: j.theta / DEG, d: j.d }));
}

defineCommand({
  name: "robot.parameters",
  title: "Robot Parameters",
  description:
    "Read a robot's kinematic parameters: the modified DH (DHM) table [alpha, a, theta, d] per joint (deg, mm), joint types, joint senses (diagonal of the joint map), user joint limits, base (H_B) and tool (H_T) shifts, mechanism code and home joints.",
  category: "robot",
  readonly: true,
  undoable: false,
  spec: "B-UTIL-04",
  schema: z.object({ robot: ItemRef.optional() }),
  run(ctx, p) {
    const r = requireRobot(ctx.ws, p.robot);
    const m = r.robot!.model;
    return {
      robot: r.name,
      dh: dhRows(m),
      senses: Array.from({ length: m.nq }, (_, i) => m.map[i * m.nq + i] ?? 1),
      lower: m.userLower,
      upper: m.userUpper,
      base: m.base,
      tool: m.flange,
      mech: m.mech,
      home: r.robot!.home,
    };
  },
});

defineCommand({
  name: "robot.setParameters",
  title: "Set Robot Parameters",
  description:
    "Edit a robot's kinematics like the robot parameters panel: replace rows of the modified DH table (alpha/theta in deg, a/d in mm), the user joint limits, the base (H_B) or tool (H_T) shift, or the home joints. Internal limits follow the user limits through the joint map.",
  category: "robot",
  spec: "B-UTIL-04",
  schema: z.object({
    robot: ItemRef.optional(),
    dh: z.array(z.object({ alpha: z.number(), a: z.number(), theta: z.number(), d: z.number() })).optional(),
    lower: z.array(z.number()).optional(),
    upper: z.array(z.number()).optional(),
    base: Pose.optional(),
    tool: Pose.optional(),
    home: z.array(z.number()).optional(),
  }),
  run(ctx, p) {
    const r = requireRobot(ctx.ws, p.robot);
    const old = r.robot!.model;
    if (p.dh && p.dh.length !== old.joints.length) throw new CommandError(`${r.name} has ${old.joints.length} DH rows`);
    const lower = (p.lower ?? old.userLower).slice(0, old.nq);
    const upper = (p.upper ?? old.userUpper).slice(0, old.nq);
    if (lower.some((v, i) => v > upper[i])) throw new CommandError("The minimum limit must be below the maximum limit");
    const lim = p.lower || p.upper ? internalLimits(old.map, old.nq, lower, upper) : null;
    const model: RobotModel = {
      ...old,
      base: p.base ?? old.base,
      flange: p.tool ?? old.flange,
      userLower: lower,
      userUpper: upper,
      joints: old.joints.map((j, i) => ({
        ...j,
        ...(p.dh ? { alpha: p.dh[i].alpha * DEG, a: p.dh[i].a, theta: p.dh[i].theta * DEG, d: p.dh[i].d } : {}),
        ...(lim && old.joints.length === old.nq ? { lower: lim.lower[i], upper: lim.upper[i] } : {}),
      })),
    };
    const home = p.home ? p.home.slice(0, old.nq) : r.robot!.home;
    ctx.tx.set(r.id, { robot: { ...r.robot!, model, home, joints: clampJoints(model, r.robot!.joints) } });
    ctx.undoLabel = `Robot parameters: ${r.name}`;
    apiNoUndo(ctx);
    return { robot: r.name, dh: dhRows(model), lower, upper, home };
  },
});
