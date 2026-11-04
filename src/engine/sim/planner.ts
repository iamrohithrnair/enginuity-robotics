 
 
 
 
 
 
 
 

import { fk, ikClosest, linkFrames, withinLimits } from "../kinematics";
import { eye, inv, mul, poseDistance, type Mat } from "../math";
import { instructionName } from "../naming";
import type { InstructionData, Item, Workspace } from "../types";
import { absPose, listItems, toolPose } from "../workspace";
import { combinedJoints } from "../sync/axes";
import { isSynced, planSyncMove, syncFrameOf, syncMotionFrame } from "../sync/plan";
import { circularPath, linearPath, type PathTolerances } from "./linear-path";
import { largestJointChange, motionTiming } from "./timing";

 
export interface Profile {
  d: number;
  v: number;
  a: number;
}

 
export function trapezoidTime(d: number, v: number, a: number): number {
  d = Math.abs(d);
  if (d < 1e-12) return 0;
  if (!(v > 0)) return 0;
  if (!(a > 0)) return d / v;
  if (d >= (v * v) / a) return d / v + v / a;
  return 2 * Math.sqrt(d / a);
}

 
export function profileAt(p: Profile, t: number): number {
  const { d, v, a } = p;
  if (d <= 0) return 0;
  const T = trapezoidTime(d, v, a);
  if (t <= 0) return 0;
  if (t >= T) return d;
  if (!(a > 0)) return Math.min(d, v * t);
  if (d >= (v * v) / a) {
    const ta = v / a;
    if (t < ta) return 0.5 * a * t * t;
    if (t < T - ta) return 0.5 * a * ta * ta + v * (t - ta);
    const r = T - t;
    return d - 0.5 * a * r * r;
  }
  const half = T / 2;
  if (t < half) return 0.5 * a * t * t;
  const r = T - t;
  return d - 0.5 * a * r * r;
}

export interface Segment {
   
  instruction: string;
   
  program: string;
   
  robot?: string | null;
  kind: InstructionData["kind"];
  t0: number;
  t1: number;
   
  samples: number[][];
   
  profile?: Profile;
   
  distance: number;
  event?: InstructionData["event"] & { at: number };
  message?: string;
  io?: InstructionData["io"];
  error?: string;
}

export interface Plan {
  program: string;
  robot: string | null;
  ok: boolean;
   
  message: string;
  validInstructions: number;
  duration: number;
  distance: number;
   
  ratio: number;
  segments: Segment[];
  final: number[] | null;
  errors: { instruction: string; message: string; flags: number }[];
   
  collisionJoints?: number[];
   
  collisionRobot?: string;
}

 
 
 
export const ERROR_NO_SOLUTION = 1;
 
export const ERROR_PATH_LIMIT = 10;
 
export const ERROR_J5_CROSSES = 100;
 
export const ERROR_PATH_SINGULARITY = 1000;
 
export const ERROR_ELBOW = 2000;
 
export const ERROR_FRONT_BACK = 4000;
export const ERROR_COLLISION = 100000;
 
export const ERROR_TURN_180 = 1000000;
 
export const ERROR_KINEMATIC = 10000000;
export const ERROR_INVALID_ARC = 100000000;

const digit = (code: number, place: number) => Math.floor((code % (place * 10)) / place);






export function describePathError(value: number): string {
  const code = Math.round(value);
  let s = "";
  let warning = code % 10000000 > 999999;
  if (warning) s += "The robot can't make a rotation so close to 180 deg. (the rotation axis is not properly defined). ";
  if (code % 100000000 > 9999999) s += "Target not reachable. ";
  if (code % 1000000000 > 99999999) s += "Invalid circular move, make sure to select 2 different targets defining an arc from the last robot movement. ";
  if (code % 1000000 > 99999) s += "Collision detected. ";
  if (code % 1000 < 100) {
    const t = code % 10000;
    if (t > 999) {
      if (t < 2000) s += "Joint 5 is too close to a singularity (0 degrees). ";
      else if (t < 4000) s += "Joint 3 is too close the elbow singularity. ";
      else s += "The robot is too close to the front/back singularity (wrist close to axis 1). ";
      warning = true;
    }
  } else s += "Joint 5 crosses 0 degrees. This is a singularity and it is not allowed for a linear move. ";
  if (code % 10 >= 1 && code === 2) s += "One or more targets are not reachable. ";
  else {
    if (code % 10 >= 1) s += "There is no solution available to complete the path. ";
    if (code % 100 >= 10) s += "The robot can't make a linear movement because of joint limits or the target is out of reach. Consider a Joint move instead. ";
  }
  if (warning) s += "<br><br>You can avoid this warning by changing motion tolerances in Tools-Options-Motion. ";
  if (code === 0) s += "The target is too close to the axis limits. ";
  return s;
}

 
export const isPathWarning = (code: number) => digit(code, 1000) > 0 || digit(code, 100) > 0 || digit(code, 1000000) > 0;

 
export interface MotionState {
  joints: number[];
  tool: Mat;
   
  frame: Mat;
  speed: { linear: number; joint: number; linearAccel: number; jointAccel: number };
  rounding: number;
}

export interface MoveResult {
  ok: boolean;
  joints: number[];
  samples: number[][];
  profile?: Profile;
  time: number;
  distance: number;
  error?: { kind: "unreachable" | "path" | "deleted" | "undefined"; text: string; flags: number };
}

export interface PlanOptions {
  start?: number[];
   
  wristTolerance?: number;
   
  elbowTolerance?: number;
   
  backTolerance?: number;
   
  turn180Tolerance?: number;
   
  stepMM?: number;
   
  stepDeg?: number;
   
  smoothTolerance?: number;
   
  collide?: (robotId: string, joints: number[]) => boolean;
  collisionStepMM?: number;
  collisionStepDeg?: number;
   
  moveTimeCalc?: number;
}

 
export function planOptionsFromSettings(settings: Record<string, unknown>): PlanOptions {
  const num = (k: string, d: number) => (Number.isFinite(Number(settings[k])) ? Number(settings[k]) : d);
  return {
    stepMM: num("PathStepMM", 1),
    stepDeg: num("PathStepDeg", 1),
    wristTolerance: num("ToleranceSingularityWrist", 2.5),
    elbowTolerance: num("ToleranceSingularityElbow", 2.5),
    backTolerance: num("ToleranceSingularityBack", -1),
    turn180Tolerance: num("ToleranceTurn180", 0.5),
    smoothTolerance: num("ToleranceSmoothMove", 25),
    collisionStepMM: num("PathStepCollisionMM", 4),
    collisionStepDeg: num("PathStepCollisionDeg", 4),
    moveTimeCalc: num("MoveTimeCalc", 3),
  };
}

 
export function pathTolerances(opts: PlanOptions): PathTolerances {
  return {
    stepMM: opts.stepMM ?? 1,
    stepDeg: opts.stepDeg ?? 1,
    wrist: opts.wristTolerance ?? 2.5,
    elbow: opts.elbowTolerance ?? 2.5,
    back: opts.backTolerance ?? -1,
    turn180: opts.turn180Tolerance ?? 0.5,
    smooth: opts.smoothTolerance ?? 25,
  };
}

const tcpOf = (model: Parameters<typeof fk>[0], q: number[], tool: Mat) => mul(fk(model, q), tool);

type Vec = [number, number, number];
const origin = (m: Mat): Vec => [m[3], m[7], m[11]];
const zAxis = (m: Mat): Vec => [m[2], m[6], m[10]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec) => Math.sqrt(dot(a, a));







export function elbowAngle(model: Parameters<typeof fk>[0], q: number[]): number {
  if (model.nq < 5) return 180;
  const f = linkFrames(model, q);
  const z3 = zAxis(f[3]);
  const flat = (v: Vec): Vec => {
    const k = dot(v, z3);
    return [v[0] - k * z3[0], v[1] - k * z3[1], v[2] - k * z3[2]];
  };
  const u = flat(sub(origin(f[3]), origin(f[2])));
  const w = flat(sub(origin(f[5]), origin(f[3])));
  const nu = norm(u);
  const nw = norm(w);
  if (nu < 1e-9 || nw < 1e-9) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (nu * nw)))) * 180) / Math.PI;
}

 
export function wristToAxis1(model: Parameters<typeof fk>[0], q: number[]): number {
  if (model.nq < 5) return Infinity;
  const f = linkFrames(model, q);
  const z1 = zAxis(f[1]);
  const d = sub(origin(f[5]), origin(f[1]));
  const k = dot(d, z1);
  return norm([d[0] - k * z1[0], d[1] - k * z1[1], d[2] - k * z1[2]]);
}





export function solveGoal(model: Parameters<typeof fk>[0], flangeGoal: Mat, stored: number[] | undefined, seed: number[]): number[] | null {
   
  const own = stored && stored.length >= model.nq ? stored.slice(0, model.nq) : undefined;
  if (own && withinLimits(model, own)) {
    const { mm, deg } = poseDistance(fk(model, own), flangeGoal);
    if (mm < 1e-3 && deg < 1e-3) return own;
  }
  const ref = own ?? seed;
  return ikClosest(model, flangeGoal, ref) ?? (model.mech === 0 ? closestJoints(model, flangeGoal, ref) : null);
}









export function closestJoints(model: Parameters<typeof fk>[0], flangeGoal: Mat, seed: number[]): number[] {
  const n = model.nq;
  const clamp = (v: number, i: number) => Math.min(model.userUpper[i] ?? Infinity, Math.max(model.userLower[i] ?? -Infinity, v));
  const residual = (q: number[]) => {
    const f = fk(model, q);
    return [f[3] - flangeGoal[3], f[7] - flangeGoal[7], f[11] - flangeGoal[11]];
  };
  let q = Array.from({ length: n }, (_, i) => clamp(seed[i] ?? 0, i));
  for (let it = 0; it < 50; it++) {
     
    const r = residual(q);
    const cols = q.map((_, j) => {
      const qh = q.slice();
      qh[j] += 1e-3;
      return residual(qh).map((v, k) => (v - r[k]) / 1e-3);
    });
    const A = cols.map((a) => cols.map((b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const g = cols.map((a) => -(a[0] * r[0] + a[1] * r[1] + a[2] * r[2]));
    A.forEach((row, i) => (row[i] += 1e-9));
    const dq = solveLinear(A, g);
    if (!dq) break;
    const next = q.map((v, i) => clamp(v + dq[i], i));
    const step = Math.max(...next.map((v, i) => Math.abs(v - q[i])));
    q = next;
    if (step < 1e-9) break;
  }
  return q;
}

 
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-15) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

 
function jointPathLength(robot: Item, a: number[], b: number[], tool: Mat): number {
  const rd = robot.robot!;
  const maxd = Math.max(0, ...a.map((v, i) => Math.abs(b[i] - v)));
  const n = Math.max(1, Math.ceil(maxd));
  let len = 0;
  let prev = tcpOf(rd.model, a, tool);
  for (let k = 1; k <= n; k++) {
    const q = a.map((v, i) => v + ((b[i] - v) * k) / n);
    const p = tcpOf(rd.model, q, tool);
    len += Math.hypot(p[3] - prev[3], p[7] - prev[7], p[11] - prev[11]);
    prev = p;
  }
  return len;
}

 
function jointSamples(a: number[], b: number[], stepDeg = 1): number[][] {
  const maxd = Math.max(0, ...a.map((v, i) => Math.abs(b[i] - v)));
  const n = Math.max(1, Math.ceil(maxd / (stepDeg > 0 ? stepDeg : 1) - 1e-9));
  return Array.from({ length: n + 1 }, (_, k) => a.map((v, i) => v + ((b[i] - v) * k) / n));
}









function moveTargetGoal(ws: Workspace, ins: InstructionData, which: "target" | "target2", st: MotionState): { inBase?: Mat; item?: Item; deleted?: boolean } {
  const id = ins[which];
  if (id) {
    const t = ws.items[id];
    if (!t) return { deleted: true };
    return { inBase: mul(st.frame, t.pose), item: t };
  }
  return {};
}







export function planMove(ws: Workspace, robot: Item, st: MotionState, insItem: Item, opts: PlanOptions = {}): MoveResult {
  const r = planMoveGeometry(ws, robot, st, insItem, opts);
  if (!r.ok || !r.samples.length) return r;
  const ins = insItem.instruction!;
  const type = ins.kind === "movec" ? "circular" : ins.moveType === "linear" || ins.moveType === "search" ? "linear" : "joint";
  const { profile, time } = motionTiming(st, r.distance, largestJointChange(r.samples[0], r.samples[r.samples.length - 1]), type, opts.moveTimeCalc);
  return { ...r, profile, time };
}

function planMoveGeometry(ws: Workspace, robot: Item, st: MotionState, insItem: Item, opts: PlanOptions): MoveResult {
   
  if (isSynced(ws, robot)) return planSyncMove(ws, robot, st, insItem, opts);
  const ins = insItem.instruction!;
  const rd = robot.robot!;
  const name = insItem.name;
  const baseInv = inv(absPose(ws, robot.id));
  const fail = (kind: NonNullable<MoveResult["error"]>["kind"], text: string, flags = ERROR_KINEMATIC, samples: number[][] = []): MoveResult => ({
    ok: false,
    joints: samples.at(-1) ?? st.joints,
    samples,
    time: 0,
    distance: 0,
    error: { kind, text, flags },
  });
  const unreachable = () => fail("unreachable", `Target at instruction<br><strong>${name}</strong><br>is not reachable.`);
   
  const program = insItem.parent ? ws.items[insItem.parent]?.name ?? "" : "";
  const notPossible = (code: number, samples: number[][]) =>
    fail("path", `Movement at instruction<br><strong>${program}:${name}</strong><br>is not possible.<br><br>Description:<br>${describePathError(code)}`, code, samples);
  const stepDeg = opts.stepDeg ?? 1;
   
   
   
   
  const tolerances = pathTolerances(opts);
  const fallback = rd.model.mech === 0 ? (goal: Mat, seed: number[]) => closestJoints(rd.model, goal, seed) : undefined;

  if (ins.kind === "move") {
    const tg = moveTargetGoal(ws, ins, "target", st);
    if (tg.deleted) return fail("deleted", `Target at instruction ${name} has been deleted`);
    let endJoints: number[] | null = null;
    let endFlange: Mat | null = null;
     
    if (tg.item?.target?.isJoint && tg.item.target.joints.length) endJoints = tg.item.target.joints.slice(0, rd.model.nq);
    else if (tg.inBase) endFlange = mul(tg.inBase, inv(st.tool));
    else if (ins.joints?.length) endJoints = ins.joints.slice(0, rd.model.nq);
    else if (ins.pose) endFlange = mul(mul(baseInv, ins.pose), inv(st.tool));
    else return fail("undefined", `Target at instruction<br><strong>${name}</strong><br>is not defined.`);
     
    const stored = tg.item?.target?.joints ?? ins.refJoints;

    if (ins.moveType === "linear" || ins.moveType === "search") {
      const fromTcp = tcpOf(rd.model, st.joints, st.tool);
      const toTcp = endFlange ? mul(endFlange, st.tool) : tcpOf(rd.model, endJoints!, st.tool);
      const flangeGoal = endFlange ?? fk(rd.model, endJoints!);
       
      const goal = endJoints ?? solveGoal(rd.model, flangeGoal, stored, st.joints);
      if (!goal) return unreachable();
       
      const path = linearPath({ model: rd.model, start: st.joints, from: fromTcp, to: toTcp, tool: st.tool, tol: tolerances, fallback });
      if (path.code) return notPossible(path.code, path.samples);
      const q = path.samples[path.samples.length - 1];
      const { mm } = poseDistance(fromTcp, toTcp);
      if (mm <= 0.001) {
         
        const d = Math.max(0, ...goal.map((v, i) => Math.abs(v - st.joints[i])));
        const profile = { d, v: st.speed.joint, a: st.speed.jointAccel };
        return { ok: true, joints: q, samples: path.samples, profile, time: trapezoidTime(d, profile.v, profile.a), distance: mm };
      }
      const profile = { d: mm, v: st.speed.linear, a: st.speed.linearAccel };
      return { ok: true, joints: q, samples: path.samples, profile, time: trapezoidTime(mm, profile.v, profile.a), distance: mm };
    }

     
    const q = endJoints ?? solveGoal(rd.model, endFlange!, stored, st.joints);
    if (!q || !withinLimits(rd.model, q)) return unreachable();
    const d = Math.max(0, ...q.map((v, i) => Math.abs(v - st.joints[i])));
    const profile = { d, v: st.speed.joint, a: st.speed.jointAccel };
    return {
      ok: true,
      joints: q,
      samples: jointSamples(st.joints, q, stepDeg),
      profile,
      time: trapezoidTime(d, profile.v, profile.a),
      distance: jointPathLength(robot, st.joints, q, st.tool),
    };
  }

  if (ins.kind === "movec") {
    const a = moveTargetGoal(ws, ins, "target", st);
    const b = moveTargetGoal(ws, ins, "target2", st);
     
    if (!a.inBase && !a.deleted && ins.pose) a.inBase = mul(baseInv, ins.pose);
    if (!b.inBase && !b.deleted && ins.pose2) b.inBase = mul(baseInv, ins.pose2);
    if (a.deleted || b.deleted) return fail("deleted", `Target at instruction ${name} has been deleted`);
    if (!a.inBase || !b.inBase) return fail("undefined", "Robtargets are not properly defined. Select two targets before adding a move circular instruction.");
    const p0 = tcpOf(rd.model, st.joints, st.tool);
    const p1 = a.inBase;
    const p2 = b.inBase;
    if (!ikClosest(rd.model, mul(p2, inv(st.tool)), st.joints)) return fail("unreachable", `Target/s at instruction<br><strong>${name}</strong><br>are not reachable.`);
     
     
     
     
     
    const arc = circularPath({ model: rd.model, start: st.joints, from: p0, via: p1, to: p2, tool: st.tool, tol: tolerances, fallback });
    if (!arc) return notPossible(ERROR_INVALID_ARC, [st.joints.slice()]);
    if (arc.code) return notPossible(arc.code, arc.samples);
    const q = arc.samples[arc.samples.length - 1];
    const profile = { d: arc.length, v: st.speed.linear, a: st.speed.linearAccel };
    return { ok: true, joints: q, samples: arc.samples, profile, time: trapezoidTime(arc.length, profile.v, profile.a), distance: arc.length };
  }
  return fail("undefined", "Not a move instruction");
}

 
export function programByName(ws: Workspace, name: string): Item | undefined {
  return listItems(ws, { type: "program" }).find((p) => p.name === name);
}





export function frameInBase(ws: Workspace, robot: Item): Mat {
  const rd = robot.robot!;
  if (rd.framePose && rd.framePose.length === 16) return rd.framePose;
  const f = rd.activeFrame && ws.items[rd.activeFrame] ? rd.activeFrame : null;
  return f ? mul(inv(absPose(ws, robot.id)), absPose(ws, f)) : eye();
}

 
export function motionState(ws: Workspace, robot: Item, start?: number[]): MotionState {
  const rd = robot.robot!;
   
  if (isSynced(ws, robot)) {
    const q = combinedJoints(ws, robot, start).map((v, i) => (start && Number.isFinite(start[i]) ? start[i] : v));
    return { joints: q, tool: toolPose(ws, robot.id), frame: syncMotionFrame(ws, robot, q), speed: { ...rd.speeds }, rounding: rd.rounding ?? -1 };
  }
  return { joints: (start ?? rd.joints).slice(), tool: toolPose(ws, robot.id), frame: frameInBase(ws, robot), speed: { ...rd.speeds }, rounding: rd.rounding ?? -1 };
}






export function planProgram(ws: Workspace, programId: string, startOrOpts?: number[] | PlanOptions): Plan {
  const opts: PlanOptions = Array.isArray(startOrOpts) ? { start: startOrOpts } : startOrOpts ?? {};
  const prog = ws.items[programId];
  const robot: Item | undefined = prog?.program?.robot ? ws.items[prog.program.robot] : undefined;
  const plan: Plan = { program: programId, robot: robot?.id ?? null, ok: true, message: "", validInstructions: 0, duration: 0, distance: 0, ratio: 1, segments: [], final: null, errors: [] };
  if (!prog) {
    plan.ok = false;
    plan.ratio = 0;
    return plan;
  }
   
   
   
   
  if (!robot?.robot) {
    plan.ok = false;
    plan.ratio = 0;
    plan.validInstructions = -1;
    return plan;
  }
   
   
   
   
   
   
   
   
   
  const main = robot?.robot ? motionState(ws, robot, opts.start) : null;
  let t = 0;
  const visiting = new Set<string>();

   
  const run = (pid: string, top: boolean, caller: Item | undefined, callerState: MotionState | null): boolean => {
    const p = ws.items[pid];
    if (!p || visiting.has(pid)) return true;
    const own = p.program?.robot ? ws.items[p.program.robot] : undefined;
     
     
     
    if (!top && !own?.robot) return true;
    visiting.add(pid);
    const robot = own?.robot ? own : caller;
    const st = top ? main : robot?.id === caller?.id ? callerState : robot?.robot ? motionState(ws, robot) : null;
    let ok = true;
    for (const c of p.children) {
      const item = ws.items[c];
      const ins = item?.instruction;
      if (!ins) continue;
      const seg: Segment = { instruction: c, program: pid, robot: robot?.id ?? null, kind: ins.kind, t0: t, t1: t, samples: [], distance: 0 };
      let valid = true;
      switch (ins.kind) {
        case "move":
        case "movec": {
          if (!robot?.robot || !st) {
            valid = false;
            seg.error = "No robot linked to the program";
            break;
          }
          const r = planMove(ws, robot, st, item, opts);
          seg.samples = r.samples;
          if (!r.ok) {
            valid = false;
            seg.error = r.error!.text;
            if (top) plan.errors.push({ instruction: c, message: r.error!.text, flags: r.error!.flags });
            break;
          }
          seg.profile = r.profile;
          seg.distance = r.distance;
          t += r.time;
          st.joints = r.joints;
          break;
        }
        case "tool": {
           
          const tl = ins.tool ? ws.items[ins.tool] : undefined;
          if (st && ins.pose && (ins.forcePose || !tl)) st.tool = ins.pose;
          else if (st && tl) st.tool = tl.pose;
          break;
        }
        case "frame": {
           
           
          const fr = ins.frame ? ws.items[ins.frame] : undefined;
          if (st && ins.pose && (ins.forcePose || !fr)) st.frame = ins.pose;
          else if (st && robot && fr && isSynced(ws, robot)) st.frame = syncFrameOf(ws, robot, fr.id, st.joints);
          else if (st && robot && fr) st.frame = mul(inv(absPose(ws, robot.id)), absPose(ws, fr.id));
          break;
        }
        case "pause":
          if ((ins.pauseMs ?? -1) > 0) t += ins.pauseMs! / 1000;
          break;
        case "print":
          seg.message = ins.text;
          break;
        case "io":
          seg.io = ins.io;
          break;
        case "event":
          seg.event = { ...ins.event!, at: t };
          break;
        case "code":
          if (ins.codeType === 0 && ins.text) {
            const callee = programByName(ws, ins.text);
            if (callee) {
              seg.t1 = t;
              plan.segments.push(seg);
              if (top) plan.validInstructions += 1;
              run(callee.id, false, robot, st);
              continue;
            }
          }
          break;
        default:
           
          break;
      }
      seg.t1 = t;
      plan.segments.push(seg);
      plan.distance += seg.distance;
      if (!valid) {
        ok = false;
        if (top) {
          plan.ok = false;
          plan.ratio = 0;
        }
        break;
      }
      if (top) plan.validInstructions += 1;
    }
    visiting.delete(pid);
    return ok;
  };
  run(programId, true, undefined, null);
  plan.duration = t;
  plan.final = main?.joints ?? null;
   
   
  const firstMotion = plan.segments.find((s) => s.kind === "move" || s.kind === "movec");
  if (firstMotion?.kind === "movec" && plan.ok) plan.errors.push({ instruction: firstMotion.instruction, message: "Warning! Path is not continuous. ", flags: ERROR_PATH_SINGULARITY + ERROR_PATH_LIMIT });

   
   
  if (plan.ok && opts.collide && robot) {
    const hit = collisionPass(ws, plan, programId, opts);
    if (hit) {
      plan.ratio = hit.ratio;
      plan.message = hit.message;
      plan.collisionJoints = hit.joints;
      plan.collisionRobot = hit.robot;
      plan.errors.push({ instruction: hit.instruction, message: hit.message, flags: ERROR_COLLISION });
    } else {
       
      plan.message = "No problems found.<br>No collisions detected.";
    }
  }
  return plan;
}










function collisionPass(ws: Workspace, plan: Plan, programId: string, opts: PlanOptions, seen = new Set<string>()): { ratio: number; message: string; joints: number[]; robot: string; instruction: string } | null {
  const prog = ws.items[programId];
  const robotId = prog?.program?.robot;
  if (!prog || seen.has(programId)) return null;
  seen.add(programId);
  const children = prog.children.filter((c) => ws.items[c]?.instruction);
  const N = children.length;
  const mmStride = Math.max(1, Math.trunc((opts.collisionStepMM && opts.collisionStepMM > 0 ? opts.collisionStepMM : 4) / (opts.stepMM ?? 1)));
  const degStride = Math.max(1, Math.trunc((opts.collisionStepDeg && opts.collisionStepDeg > 0 ? opts.collisionStepDeg : 4) / (opts.stepDeg ?? 1)));
  let lastCall = 0;
  for (let i = 0; i < N; i++) {
    const item = ws.items[children[i]];
    const ins = item.instruction!;
    if (ins.kind === "code" && ins.codeType === 0 && ins.text) {
      const callee = programByName(ws, ins.text);
      if (!callee) continue;
      const sub = collisionPass(ws, plan, callee.id, opts, seen);
      if (sub) return { ...sub, ratio: lastCall };
      lastCall = i / N;
      continue;
    }
    if (ins.kind !== "move" && ins.kind !== "movec") continue;
    const seg = plan.segments.find((g) => g.instruction === item.id && g.program === programId);
    const rid = seg?.robot ?? robotId;
    if (!seg || !rid) continue;
    const n = seg.samples.length;
    const stride = ins.kind === "move" && ins.moveType === "joint" ? degStride : mmStride;
    for (let k = 0; k < n; k += stride) {
      if (!opts.collide!(rid, seg.samples[k])) continue;
      const ratio = ((k + 1) / n + i) / N;
      const message = `(${(ratio * 100).toFixed(1)} %) Collision detected. <br><br>Program: <strong>${prog.name}</strong><br>Instruction ${i}: <strong>${item.name || instructionName(ws, ins)}</strong>`;
      return { ratio, message, joints: seg.samples[k], robot: rid, instruction: item.id };
    }
  }
  return null;
}

 
export function profileTimeAt(p: Profile, s: number): number {
  const { d, v, a } = p;
  if (d <= 0 || s <= 0) return 0;
  const T = trapezoidTime(d, v, a);
  if (s >= d) return T;
  if (!(a > 0)) return s / v;
  if (d >= (v * v) / a) {
    const ta = v / a;
    const sa = 0.5 * a * ta * ta;
    if (s < sa) return Math.sqrt((2 * s) / a);
    if (s <= d - sa) return ta + (s - sa) / v;
    return T - Math.sqrt((2 * (d - s)) / a);
  }
  if (s <= d / 2) return Math.sqrt((2 * s) / a);
  return T - Math.sqrt((2 * (d - s)) / a);
}

export interface JointListPoint {
  joints: number[];
   
  error: number;
   
  instruction: number;
  






  row?: number;
   
  mm?: number;
  deg?: number;
   
  time: number;
}

export interface JointListResult {
  points: JointListPoint[];
   
  status: number;
  message: string;
   
  robotJoints?: number[];
}











export function jointList(ws: Workspace, programId: string, opts: PlanOptions & { checkCollisions?: (robotId: string, joints: number[]) => boolean } = {}): JointListResult {
  const prog = ws.items[programId];
  const robotId = prog?.program?.robot && ws.items[prog.program.robot]?.robot ? prog.program.robot : null;
  if (!prog || !robotId) return { points: [], status: prog?.children.length ?? 0, message: "Unknow robot to run the program. " };
  const plan = planProgram(ws, programId, { ...opts, collide: undefined });
  const points: JointListPoint[] = [];
  const index = (seg: Segment) => Math.max(0, ws.items[seg.program]?.children.indexOf(seg.instruction) ?? 0);
  const motions = plan.segments.filter((s) => (s.kind === "move" || s.kind === "movec") && s.samples.length && (s.robot ?? robotId) === robotId);
  const t0 = motions[0]?.t1 ?? 0;
  const rows = pathRows(ws, programId);
   
   
   
  motions.forEach((seg, m) => {
    const n = seg.samples.length;
    const from = m === 0 ? n - 1 : 0;
    for (let k = from; k < n; k++) {
      const frac = n > 1 ? k / (n - 1) : 1;
      const t = seg.profile ? seg.t0 + profileTimeAt(seg.profile, frac * seg.profile.d) : seg.t1;
      const first = m === 0 || k === 0;
      const deg = first ? 0 : Math.max(0, ...seg.samples[k].map((v, j) => Math.abs(v - seg.samples[k - 1][j])));
       
      const jointMove = seg.kind === "move" && ws.items[seg.instruction]?.instruction?.moveType === "joint";
      const mm = first || n < 2 ? 0 : jointMove ? tcpChord(ws, seg.robot ?? robotId, seg.samples[k - 1], seg.samples[k]) : seg.distance / (n - 1);
      points.push({ joints: seg.samples[k], error: 0, instruction: index(seg), row: rows.get(seg.instruction) ?? index(seg), mm, deg, time: Math.max(0, t - t0) });
    }
  });
  let status = prog.children.length;
  let message = "";
  const err = plan.errors[0];
  if (err) {
    const warning = isPathWarning(err.flags);
    const code = err.flags === ERROR_COLLISION ? ERROR_COLLISION : warning ? err.flags : ERROR_KINEMATIC;
    const seg = plan.segments.find((s) => s.instruction === err.instruction);
    const own = seg && (seg.robot ?? robotId) === robotId ? seg : undefined;
    const last = own?.samples.at(-1) ?? points.at(-1)?.joints ?? ws.items[robotId].robot!.joints;
    points.push({ joints: last, error: code, instruction: seg ? index(seg) : 0, time: plan.duration - t0 });
    if (warning) {
      status = -1;
      message = "Warning! Path is not continuous. ";
    } else if (code !== ERROR_COLLISION) {
      status = -2;
      message = "One or more targets are not reachable or missing. ";
    }
  }
  let robotJoints: number[] | undefined;
  if (opts.checkCollisions && points.length) {
    for (const p of points) {
      robotJoints = p.joints;
      if (opts.checkCollisions(robotId, p.joints)) {
        p.error = ERROR_COLLISION;
        message += "Collisions found. ";
        break;
      }
    }
  }
  return { points, status, message: message || "Success", robotJoints };
}

 
function tcpChord(ws: Workspace, robotId: string, q0: number[], q1: number[]): number {
  const r = ws.items[robotId]?.robot;
  if (!r) return 0;
  const tool = toolPose(ws, robotId);
  const nq = r.model.nq;
  const a = mul(fk(r.model, q0.slice(0, nq)), tool);
  const b = mul(fk(r.model, q1.slice(0, nq)), tool);
  return Math.hypot(a[3] - b[3], a[7] - b[7], a[11] - b[11]);
}

 
function pathRows(ws: Workspace, programId: string): Map<string, number> {
  const rows = new Map<string, number>();
  const robot = ws.items[programId]?.program?.robot ?? null;
  const visited = new Set<string>();
  let n = 0;
  const walk = (pid: string) => {
    const prog = ws.items[pid];
    if (!prog || visited.has(prog.name)) return;
    visited.add(prog.name);
    for (const id of prog.children) {
      const ins = ws.items[id]?.instruction;
      if (!ins) continue;
      if (ins.kind === "move") rows.set(id, n++);
      else if (ins.kind === "movec") {
        n++;
        rows.set(id, n++);
      } else if (ins.kind === "tool" || ins.kind === "pause" || ins.kind === "speed" || ins.kind === "rounding") rows.set(id, n++);
      else if (ins.kind === "code" && ins.codeType === 0 && ins.text) {
        const callee = programByName(ws, ins.text);
        if (callee && (callee.program?.robot ?? null) === robot) walk(callee.id);
      }
    }
  };
  walk(programId);
  return rows;
}

 
export function circleThrough(p0: Mat, p1: Mat, p2: Mat) {
  const A = [p0[3], p0[7], p0[11]];
  const B = [p1[3], p1[7], p1[11]];
  const C = [p2[3], p2[7], p2[11]];
  const sub = (u: number[], v: number[]) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(B, A);
  const ac = sub(C, A);
  const n = cross(ab, ac);
  const nn = dot(n, n);
   
  if (nn <= 1e-12 * dot(ab, ab) * dot(ac, ac) || nn < 1e-30) return null;
  const t1 = cross(n, ab).map((x) => x * dot(ac, ac));
  const t2 = cross(ac, n).map((x) => x * dot(ab, ab));
  const center = [0, 1, 2].map((k) => A[k] + (t1[k] + t2[k]) / (2 * nn));
  const r = Math.sqrt(dot(sub(A, center), sub(A, center)));
  const e1 = sub(A, center).map((x) => x / r);
  const nz = n.map((x) => x / Math.sqrt(nn));
  const e2 = cross(nz, e1);
  const angleOf = (P: number[]) => {
    const d = sub(P, center);
    let a = Math.atan2(dot(d, e2), dot(d, e1));
    if (a < 0) a += 2 * Math.PI;
    return a;
  };
  const total = angleOf(C);
  return {
    length: r * total,
    point: (u: number) => {
      const a = total * u;
      return [0, 1, 2].map((k) => center[k] + r * (Math.cos(a) * e1[k] + Math.sin(a) * e2[k]));
    },
  };
}

 
export function sampleAt(samples: number[][], s: number): number[] {
  if (samples.length === 1) return samples[0];
  const x = Math.max(0, Math.min(1, s)) * (samples.length - 1);
  const i = Math.min(samples.length - 2, Math.floor(x));
  const f = x - i;
  return samples[i].map((v, j) => v + (samples[i + 1][j] - v) * f);
}






export function segmentJointsAt(seg: { samples: number[][]; profile?: Profile; t0: number; t1: number }, t: number, discrete = false): number[] {
  if (!seg.samples.length) return [];
  if (seg.profile && seg.profile.d > 0) {
    const s = profileAt(seg.profile, t) / seg.profile.d;
     
    if (discrete && seg.samples.length > 1) return seg.samples[Math.min(seg.samples.length - 1, Math.ceil(s * (seg.samples.length - 1) - 1e-9))];
    return sampleAt(seg.samples, s);
  }
  const dur = Math.max(1e-9, seg.t1 - seg.t0);
  return sampleAt(seg.samples, t / dur);
}

 
export function jointsAt(plan: Plan, t: number, fallback: number[]): number[] {
  let last = fallback;
  for (const s of plan.segments) {
    if (!s.samples.length || (s.robot && s.robot !== plan.robot)) continue;
    if (t <= s.t0) return s.samples[0];
    if (t <= s.t1) return segmentJointsAt(s, t - s.t0);
    last = s.samples[s.samples.length - 1];
  }
  return last;
}
