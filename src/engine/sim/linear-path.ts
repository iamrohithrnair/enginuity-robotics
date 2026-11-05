// Tracks linear and circular IK paths while detecting singularities and jumps.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { ikClosest, ikTrack, withinLimits } from "../kinematics";
import { interpolatePose, inv, mul, type Mat } from "../math";
import type { RobotModel } from "../types";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

 
export const STEP_NO_SOLUTION = 1;
export const STEP_JUMP = 10;
export const STEP_WRIST_CROSSES = 100;
export const STEP_WRIST = 1000;
export const STEP_ELBOW = 2000;
export const STEP_FRONT_BACK = 4000;
 
export const PATH_TURN_180 = 1000000;

 
export interface PathTolerances {
   
  stepMM: number;
   
  stepDeg: number;
   
  wrist: number;
   
  elbow: number;
   
  back: number;
   
  turn180: number;
   
  smooth: number;
}

export const DEFAULT_PATH_TOLERANCES: PathTolerances = { stepMM: 1, stepDeg: 1, wrist: 2.5, elbow: 2.5, back: -1, turn180: 0.5, smooth: 25 };

 
const mechType = (m: RobotModel) => Math.abs(Math.round(m.mech ?? 1));

 
const thetaOff = (m: RobotModel, i: number) => (m.joints[i]?.theta ?? 0) * DEG;

 
function internalJoint(m: RobotModel, q: number[], i: number): number {
  let v = 0;
  for (let k = 0; k < m.nq; k++) v += (m.map[i * m.nq + k] ?? 0) * (q[k] ?? 0);
  return v;
}










export function wristMeasure(m: RobotModel, q: number[]): number | null {
  switch (mechType(m)) {
    case 1:
      return q.length > 4 ? q[4] - thetaOff(m, 4) : null;
    case 2: {
      const k = m.joints[1]?.kind === "linear" || m.joints[0]?.kind === "linear" ? 2 : 1;
      return q.length > k ? q[k] - thetaOff(m, k) : null;
    }
    case 3:
    case 23:
      return q.length > 5 ? q[5] - thetaOff(m, 5) : null;
    case 6: {
      if (q.length <= 4) return null;
      const w = q[4] - thetaOff(m, 4);
      return Math.abs(w - Math.round(w / 180) * 180);
    }
    case 7:
      return q.length > 4 ? q[4] : null;
    default:
      return null;
  }
}








export function elbowMeasure(m: RobotModel, q: number[]): number | null {
  switch (mechType(m)) {
    case 1: {
      if (m.nq < 6 || m.joints.length < 4) return null;
      const r4 = m.joints[3];
      return internalJoint(m, q, 2) + thetaOff(m, 2) - (Math.atan2(r4.a, r4.d) * DEG - 90);
    }
    case 6:
      return q.length > 2 ? q[2] + thetaOff(m, 2) : null;
    default:
      return null;
  }
}






export function backMeasure(m: RobotModel, q: number[]): number | null {
  if (mechType(m) !== 1 || m.nq < 6 || m.joints.length < 4) return null;
  const t2 = (m.joints[1].theta ?? 0) + internalJoint(m, q, 1) * RAD;
  let t3 = (m.joints[2].theta ?? 0) + internalJoint(m, q, 2) * RAD;
  if (t3 > Math.PI / 2) t3 -= 2 * Math.PI;
  const t23 = t2 + t3;
  return m.joints[1].a + m.joints[3].a * Math.cos(t23) - m.joints[3].d * Math.sin(t23) + m.joints[2].a * Math.cos(t2);
}

const maxDelta = (a: number[], b: number[], n: number) => {
  let d = 0;
  for (let i = 0; i < n; i++) d = Math.max(d, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return d;
};










const holdsJ3 = (m: RobotModel) => m.nq === 7 && [3, 23].includes(Math.abs(Math.round(m.mech ?? 1)));

const frozenCache = new WeakMap<RobotModel, Map<number, RobotModel>>();

 
function withJ3Fixed(m: RobotModel, j3: number): RobotModel {
  let byValue = frozenCache.get(m);
  if (!byValue) frozenCache.set(m, (byValue = new Map()));
  const hit = byValue.get(j3);
  if (hit) return hit;
  const cols = [0, 1, 3, 4, 5, 6];
  const n = cols.length;
  const map = new Array(m.joints.length * n).fill(0);
  cols.forEach((uj, k) => {
    for (let r = 0; r < m.joints.length; r++) map[r * n + k] = m.map[r * m.nq + uj] ?? 0;
  });
  const joints = m.joints.map((j, r) => {
    const v = (m.map[r * m.nq + 2] ?? 0) * j3;
    return v === 0 ? j : j.kind === "linear" ? { ...j, d: j.d + v } : { ...j, theta: j.theta + v * RAD };
  });
   
  const frozen: RobotModel = { ...m, joints, nq: n, map, userLower: cols.map((c) => m.userLower[c]), userUpper: cols.map((c) => m.userUpper[c]), polygon: [], mech: -1 };
  byValue.set(j3, frozen);
  return frozen;
}

function trackWithJ3Held(m: RobotModel, goal: Mat, prev: number[]): number[] | null {
  const r = ikTrack(withJ3Fixed(m, prev[2]), goal, [prev[0], prev[1], prev[3], prev[4], prev[5], prev[6]]);
  return r ? [r[0], r[1], prev[2], r[2], r[3], r[4], r[5]] : null;
}





export class PathTracker {
   
  prev: number[];
   
  private wristState: number;
  private exact = true;

  constructor(
    readonly model: RobotModel,
    start: number[],
    readonly tol: PathTolerances,
    private readonly fallback?: (flangeGoal: Mat, seed: number[]) => number[] | null,
  ) {
    this.prev = start.slice(0, model.nq);
    this.wristState = wristMeasure(model, this.prev) ?? 1e6;
  }

  





  private solve(goal: Mat): number[] | null {
    const m = this.model;
    if (!this.exact) return this.fallback ? this.fallback(goal, this.prev) : null;
    if (holdsJ3(m)) {
      const held = trackWithJ3Held(m, goal, this.prev);
      if (held && maxDelta(held, this.prev, m.nq) <= this.tol.smooth) return held;
    }
    const fast = ikTrack(m, goal, this.prev);
    if (fast && maxDelta(fast, this.prev, m.nq) <= this.tol.smooth) return fast;
    const q = ikClosest(m, goal, this.prev);
    if (q || !this.fallback) return q;
     
     
    this.exact = false;
    return this.fallback(goal, this.prev);
  }

   
  step(goal: Mat): { q: number[]; code: number } {
    const { model: m, tol } = this;
    const q = this.solve(goal);
     
    if (!q) return { q: this.prev.slice(), code: STEP_NO_SOLUTION };
    let code = 0;
    if (tol.smooth < maxDelta(q, this.prev, m.nq)) code += STEP_JUMP;
    if (tol.wrist >= 0) {
      const w = wristMeasure(m, q);
      if (w !== null) {
        if (w * this.wristState < 0) {
          code += STEP_WRIST_CROSSES;
          this.wristState = -this.wristState;
        }
        if (Math.abs(w) < tol.wrist) code += STEP_WRIST;
      }
    }
    if (tol.elbow > 0) {
      const e = elbowMeasure(m, q);
      if (e !== null && Math.abs(e) < tol.elbow) code += STEP_ELBOW;
    }
    if (tol.back > 0) {
      const b = backMeasure(m, q);
      if (b !== null && Math.abs(b) < tol.back) code += STEP_FRONT_BACK;
    }
    this.prev = q;
    return { q, code };
  }
}

 
export function rotationAngleDeg(a: Mat, b: Mat): number {
  const tr = a[0] * b[0] + a[4] * b[4] + a[8] * b[8] + a[1] * b[1] + a[5] * b[5] + a[9] * b[9] + a[2] * b[2] + a[6] * b[6] + a[10] * b[10];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * DEG;
}

 
export interface PathAxes {
   
  extAt(s: number): number[];
   
  extDelta: number;
   
  flangeGoal(p: Mat, s: number): Mat;
}

export interface LinearPathInput {
  model: RobotModel;
   
  start: number[];
   
  from: Mat;
  to: Mat;
   
  tool: Mat;
  tol: PathTolerances;
  axes?: PathAxes;
   
  fallback?: (flangeGoal: Mat, seed: number[]) => number[] | null;
}

export interface LinearPathResult {
   
  samples: number[][];
   
  code: number;
   
  steps: number;
}










export function linearPath(input: LinearPathInput): LinearPathResult {
  const { model: m, from, to, tool, tol, axes } = input;
  const nq = m.nq;
  const start = input.start.slice(0, nq);
  const sample = (q: number[], s: number) => (axes ? [...q, ...axes.extAt(s)] : q.slice());
  const angle = rotationAngleDeg(from, to);
  if (!(tol.turn180 <= Math.abs(angle - 180))) return { samples: [sample(start, 0)], code: PATH_TURN_180, steps: 0 };
  const mm = Math.hypot(to[3] - from[3], to[7] - from[7], to[11] - from[11]);
  const stepMM = tol.stepMM > 0 ? tol.stepMM : 1;
  const stepDeg = tol.stepDeg > 0 ? tol.stepDeg : 1;
  let steps = Math.max(Math.trunc(mm / stepMM), Math.trunc(angle / stepDeg));
  if (axes) steps = Math.max(steps, Math.trunc(axes.extDelta / stepDeg));
  if (steps === 0) steps = 1;
  const flangeAt = (p: Mat, s: number) => (axes ? axes.flangeGoal(p, s) : mul(p, inv(tool)));
   
  const q0 = withinLimits(m, start) ? start : ikClosest(m, flangeAt(from, 0), start) ?? (input.fallback ? input.fallback(flangeAt(from, 0), start) : null);
  if (!q0) return { samples: [sample(start, 0)], code: STEP_NO_SOLUTION, steps };
  const tracker = new PathTracker(m, q0, tol, input.fallback);
  const samples = [sample(start, 0)];
  for (let k = 1; k <= steps; k++) {
    const s = k / steps;
    const r = tracker.step(flangeAt(interpolatePose(from, to, s), s));
    samples.push(sample(r.q, s));
    if (r.code) return { samples, code: r.code, steps };
  }
  return { samples, code: 0, steps };
}

type V3 = [number, number, number];
const posOf = (m: Mat): V3 => [m[3], m[7], m[11]];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vscale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

 
function circle3(a: V3, b: V3, c: V3): { center: V3; normal: V3; radius: number } | null {
  const ab = vsub(b, a);
  const ac = vsub(c, a);
  const n = vcross(ab, ac);
  const nn = vdot(n, n);
   
  if (nn <= 1e-12 * vdot(ab, ab) * vdot(ac, ac) || nn < 1e-30) return null;
  const t1 = vscale(vcross(n, ab), vdot(ac, ac));
  const t2 = vscale(vcross(ac, n), vdot(ab, ab));
  const center: V3 = [0, 1, 2].map((k) => a[k] + (t1[k] + t2[k]) / (2 * nn)) as V3;
  const radius = Math.sqrt(vdot(vsub(a, center), vsub(a, center)));
  return { center, normal: vscale(n, 1 / Math.sqrt(nn)), radius };
}

 
function angleAbout(u: V3, v: V3, n: V3): number {
  let t = Math.atan2(vdot(vcross(u, v), n), vdot(u, v));
  if (t < 0) t += 2 * Math.PI;
  return t;
}

 
function turnAbout(p: V3, c: V3, n: V3, t: number): V3 {
  const v = vsub(p, c);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const kxv = vcross(n, v);
  const kv = vdot(n, v) * (1 - cos);
  return [0, 1, 2].map((i) => c[i] + v[i] * cos + kxv[i] * sin + n[i] * kv) as V3;
}

export interface CircularPathInput {
  model: RobotModel;
  start: number[];
   
  from: Mat;
  via: Mat;
  to: Mat;
  tool: Mat;
  tol: PathTolerances;
   
  axes?: PathAxes;
  fallback?: (flangeGoal: Mat, seed: number[]) => number[] | null;
}









export function circularPath(input: CircularPathInput): (LinearPathResult & { length: number }) | null {
  const { model: m, from, via, to, tool, tol } = input;
  const a = posOf(from);
  const b = posOf(via);
  const c = posOf(to);
  const d = (u: V3, v: V3) => Math.sqrt(vdot(vsub(u, v), vsub(u, v)));
  if (d(a, b) < 1e-6 || d(b, c) < 1e-6 || d(a, c) < 1e-6) return null;
  const circ = circle3(a, b, c);
  if (!circ && d(a, b) + d(b, c) > d(a, c) * (1 + 1e-6)) return null;
  const stepMM = tol.stepMM > 0 ? tol.stepMM : 1;
  const stepDeg = tol.stepDeg > 0 ? tol.stepDeg : 1;
   
  const segments: { p0: Mat; p1: Mat; at: (t: number) => V3; length: number }[] = [];
  if (circ) {
    const t1 = angleAbout(vsub(a, circ.center), vsub(b, circ.center), circ.normal);
    const t2 = angleAbout(vsub(b, circ.center), vsub(c, circ.center), circ.normal);
    segments.push({ p0: from, p1: via, at: (t) => turnAbout(a, circ.center, circ.normal, t1 * t), length: circ.radius * t1 });
    segments.push({ p0: via, p1: to, at: (t) => turnAbout(b, circ.center, circ.normal, t2 * t), length: circ.radius * t2 });
  } else {
    segments.push({ p0: from, p1: via, at: (t) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t) as V3, length: d(a, b) });
    segments.push({ p0: via, p1: to, at: (t) => [0, 1, 2].map((k) => b[k] + (c[k] - b[k]) * t) as V3, length: d(b, c) });
  }
  const length = segments[0].length + segments[1].length;
  const { axes } = input;
  const counts = segments.map((s) => Math.max(1, Math.trunc(s.length / stepMM), Math.trunc(rotationAngleDeg(s.p0, s.p1) / stepDeg)));
  if (axes) {
     
    const need = Math.trunc(axes.extDelta / stepDeg);
    if (need > counts[0] + counts[1]) {
      counts[0] = Math.max(counts[0], Math.round((need * segments[0].length) / (length > 0 ? length : 1)));
      counts[1] = Math.max(counts[1], need - counts[0]);
    }
  }
  const steps = counts[0] + counts[1];
  const sample = (q: number[], s: number) => (axes ? [...q, ...axes.extAt(s)] : q.slice());
  const flangeAt = (p: Mat, s: number) => (axes ? axes.flangeGoal(p, s) : mul(p, inv(tool)));
  const start = input.start.slice(0, m.nq);
  const q0 = withinLimits(m, start) ? start : ikClosest(m, flangeAt(from, 0), start) ?? (input.fallback ? input.fallback(flangeAt(from, 0), start) : null);
  if (!q0) return { samples: [sample(start, 0)], code: STEP_NO_SOLUTION, steps, length };
  const tracker = new PathTracker(m, q0, tol, input.fallback);
  const samples = [sample(start, 0)];
  let done = 0;
  for (let s = 0; s < 2; s++) {
    const seg = segments[s];
    for (let k = 1; k <= counts[s]; k++) {
      const t = k / counts[s];
      const pose = interpolatePose(seg.p0, seg.p1, t);
      const p = seg.at(t);
      pose[3] = p[0];
      pose[7] = p[1];
      pose[11] = p[2];
      const frac = ++done / steps;
      const r = tracker.step(flangeAt(pose, frac));
      samples.push(sample(r.q, frac));
      if (r.code) return { samples, code: r.code, steps, length };
    }
  }
  return { samples, code: 0, steps, length };
}
