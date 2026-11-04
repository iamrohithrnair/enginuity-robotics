 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { fk, ikClosest } from "../kinematics";
import { inv, mul, rotz, type Mat } from "../math";
import { CommandError, defineCommand, ItemRef, type CmdCtx } from "../registry";
import type { Item } from "../types";
import { absPose, activeToolOf, findByName, toolPose } from "../workspace";
import { addInstruction, createProgram } from "./programs";
import { requireRobot } from "./robot";

export const ISO_MSG = {
  noRobot: "Add a robot first.",
  invalid: "Invalid parameters. Can't create ISO 9283 cube.<br>Change the cube center or side.",
} as const;

export const ISO_PROGRAM = "ISO9283";
const PLANE_ANGLE: Record<string, number> = { A: Math.PI, B: Math.PI / 2, C: 0, D: -Math.PI / 2 };
const S2 = 0.7071067811865475;

 
export function isoCubePoints(center: number[], side: number, plane: "A" | "B" | "C" | "D" = "C"): [number, number, number][] {
  const h = Math.abs(side) * 0.5;
  const R = rotz(PLANE_ANGLE[plane] ?? 0);
  const col = (j: number): number[] => [R[j] * h, R[4 + j] * h, R[8 + j] * h];
  const [u, v, w] = [col(0), col(1), col(2)];
  const c = center;
  const P = (a: number, b: number, d: number): [number, number, number] => [0, 1, 2].map((k) => c[k] + a * u[k] + b * v[k] + d * w[k]) as [number, number, number];
  return [P(0, 0, 0), P(-1, -1, 1), P(-1, 1, 1), P(1, 1, -1), P(1, -1, -1), P(0, -1, 0), P(0, -0.5, 0), P(0, 0.5, 0), P(0, 1, 0), P(S2, 0, -S2), P(-S2, 0, S2)];
}

 
export const ISO_SEQUENCE: ({ type: "joint" | "linear"; p: number } | { type: "circular"; via: number; end: number })[] = [
  { type: "joint", p: 0 },
  { type: "joint", p: 0 },
  ...[1, 2, 3, 4, 1, 3, 8].map((p) => ({ type: "linear" as const, p })),
  { type: "circular", via: 10, end: 5 },
  { type: "circular", via: 9, end: 8 },
  ...[5, 8, 7, 0].map((p) => ({ type: "linear" as const, p })),
];

 
export function solveIsoCube(robot: Item, tcp: Mat, refJoints: number[], points: number[][]): number[][] | null {
  const model = robot.robot!.model;
  const ref = mul(fk(model, refJoints), tcp);
  const out: number[][] = [];
  for (const p of points) {
    const target = ref.slice();
    target[3] = p[0];
    target[7] = p[1];
    target[11] = p[2];
    const q = ikClosest(model, mul(target, inv(tcp)), refJoints);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

const f1 = (v: number) => v.toFixed(1);

export interface IsoSpec {
  robot: Item;
  center: number[];
  side: number;
  plane: "A" | "B" | "C" | "D";
  refJoints: number[];
  tool?: Item;
  maximize?: boolean;
  program?: Item;
}

 
export function createIsoCube(ctx: CmdCtx, spec: IsoSpec): { program: Item; side: number; joints: number[][] } {
  const { ws, tx } = ctx;
  const { robot } = spec;
  const tcp = spec.tool ? spec.tool.pose : toolPose(ws, robot.id);
  let side = spec.side;
  let joints = solveIsoCube(robot, tcp, spec.refJoints, isoCubePoints(spec.center, side, spec.plane));
  if (spec.maximize && joints) {
     
    let lo = side;
    let hi = side * 2;
    while (hi < 1e5 && solveIsoCube(robot, tcp, spec.refJoints, isoCubePoints(spec.center, hi, spec.plane))) {
      lo = hi;
      hi *= 2;
    }
    while (hi - lo > 0.1) {
      const mid = (lo + hi) / 2;
      if (solveIsoCube(robot, tcp, spec.refJoints, isoCubePoints(spec.center, mid, spec.plane))) lo = mid;
      else hi = mid;
    }
    side = lo;
    joints = solveIsoCube(robot, tcp, spec.refJoints, isoCubePoints(spec.center, side, spec.plane));
  }
  if (!joints) throw new CommandError(ISO_MSG.invalid);
  const prog = spec.program ?? findByName(ws, ISO_PROGRAM, "program") ?? createProgram(ctx, ISO_PROGRAM, robot);
   
  for (const c of [...ws.items[prog.id].children]) tx.remove(c);
  if (prog.program?.robot !== robot.id) tx.set(prog.id, { program: { ...prog.program!, robot: robot.id } });
  const base = absPose(ws, robot.id);
  const model = robot.robot!.model;
  const poseOf = (q: number[]) => mul(mul(base, fk(model, q)), tcp);
  const tool = spec.tool ?? activeToolOf(ws, robot.id);
  addInstruction(ws, tx, prog, { kind: "tool", tool: tool?.id ?? null, pose: tcp, forcePose: !tool }, null, true);
  for (const step of ISO_SEQUENCE) {
    if (step.type === "circular") {
      addInstruction(ws, tx, prog, { kind: "movec", moveType: "circular", pose: poseOf(joints[step.via]), pose2: poseOf(joints[step.end]), joints: joints[step.end] }, null, true);
    } else {
      addInstruction(ws, tx, prog, { kind: "move", moveType: step.type, joints: joints[step.p], pose: poseOf(joints[step.p]) }, null, true);
    }
  }
   
  const first = ws.items[prog.id].children[0];
  addInstruction(ws, tx, prog, { kind: "code", codeType: 3, text: `Side ${f1(side)}. Center ${f1(spec.center[0])},${f1(spec.center[1])},${f1(spec.center[2])}.` }, first ?? null);
  return { program: ws.items[prog.id], side, joints };
}

defineCommand({
  name: "iso.cube",
  title: "Create ISO 9283 cube",
  description:
    "Create the ISO 9283 test program (Utilities ▸ Create ISO 9283 cube): 11 points of a cube of the given side around `center` (robot base coordinates, mm) on the diagonal test plane A–D, all with the TCP orientation at the reference joints (default: the robot's current joints). Fills the program \"ISO9283\" with MoveJ/MoveL/MoveC through P1…P10 and the comment \"Side … Center …\". maximize=true grows the cube to the largest reachable side. Fails with an error message when a point is unreachable.",
  category: "program",
  spec: "B-UTIL-17",
  schema: z.object({
    robot: ItemRef.optional(),
    center: z.array(z.number()).length(3).optional().describe("cube centre [x,y,z] in the robot base frame (default: the TCP position at the reference joints)"),
    side: z.number().positive().default(200),
    plane: z.enum(["A", "B", "C", "D"]).default("C"),
    refJoints: z.array(z.number()).optional(),
    tool: ItemRef.optional(),
    maximize: z.boolean().default(false),
  }),
  run(ctx, p) {
    const { ws } = ctx;
    let robot: Item;
    try {
      robot = requireRobot(ws, p.robot);
    } catch (e) {
      if (p.robot === undefined) throw new CommandError(ISO_MSG.noRobot);
      throw e;
    }
    const tool = p.tool !== undefined ? requireRef(ws, p.tool, "tool") : undefined;
    const refJoints = (p.refJoints ?? robot.robot!.joints).slice(0, robot.robot!.model.nq);
    const tcp = tool ? tool.pose : toolPose(ws, robot.id);
    const ref = mul(fk(robot.robot!.model, refJoints), tcp);
    const center = p.center ?? [ref[3], ref[7], ref[11]];
    const out = createIsoCube(ctx, { robot, center, side: p.side, plane: p.plane, refJoints, tool, maximize: p.maximize });
    ctx.undoLabel = `Add: ${out.program.name}`;
    return { program: out.program.name, id: out.program.id, side: out.side, center, points: isoCubePoints(center, out.side, p.plane), instructions: out.program.children.length };
  },
});

defineCommand({
  name: "iso.program",
  title: "ISO 9283 Program",
  description:
    "Create (or reuse) the program \"ISO9283\" of a robot, as Popup_ProgISO9283 does before showing the ISO 9283 cube dialog; dialog=true opens that dialog in the Enginuity window. Use iso.cube to fill the program.",
  category: "program",
  spec: "B-UTIL-17",
  schema: z.object({ robot: ItemRef.optional(), dialog: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws } = ctx;
    let robot: Item;
    try {
      robot = requireRobot(ws, p.robot);
    } catch (e) {
      if (p.robot === undefined) throw new CommandError(ISO_MSG.noRobot);
      throw e;
    }
    const prog = findByName(ws, ISO_PROGRAM, "program") ?? createProgram(ctx, ISO_PROGRAM, robot);
    if (p.dialog && (ctx.services.view?.clients() ?? 0) > 0) ctx.services.emit?.({ type: "ui-action", name: "actionISO_9283_targets_and_path" });
    ctx.undoLabel = null;
    return { id: prog.id, name: prog.name, robot: robot.name };
  },
});
