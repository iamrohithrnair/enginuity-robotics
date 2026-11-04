 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { ikClosest, withinLimits } from "../kinematics";
import { interpolatePose, inv, mul, type Mat } from "../math";
import { linearPath, PathTracker, rotationAngleDeg, STEP_NO_SOLUTION, type PathTolerances } from "../sim/linear-path";
import type { RobotModel } from "../types";

type V3 = [number, number, number];

 
export const ARC_INVALID = 100000000;

export interface MoveCheck {
   
  code: number;
   
  samples: number[][];
}

 
export function linearCheck(model: RobotModel, start: number[], from: Mat, to: Mat, tool: Mat, tol: PathTolerances): MoveCheck {
  const r = linearPath({ model, start, from, to, tool, tol });
  return { code: r.code, samples: r.samples };
}

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: readonly number[]) => Math.sqrt(dot(a, a));
const position = (m: Mat): V3 => [m[3], m[7], m[11]];
const DEG = 180 / Math.PI;






export function circle3(p1: V3, p2: V3, p3: V3): { center: V3; axis: V3; radius: number } | null {
  const u = sub(p1, p2);
  const v = sub(p2, p3);
  const n = cross(u, v);
  const nl = norm(n);
  const cosUV = dot(u, v) / (norm(u) * norm(v));
  if (Math.acos(Math.max(-1, Math.min(1, cosUV))) * DEG < 1e-6 || nl < 1e-10) return null;
  const axis: V3 = [n[0] / nl, n[1] / nl, n[2] / nl];
   
  const m1: V3 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];
  const m2: V3 = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2, (p2[2] + p3[2]) / 2];
  const rows = [u, v, axis];
  const rhs = [dot(u, m1), dot(v, m2), dot(axis, p1)];
  const det = dot(rows[0], cross(rows[1], rows[2]));
  if (Math.abs(det) < 1e-300) return null;
  const c1 = cross(rows[1], rows[2]);
  const c2 = cross(rows[2], rows[0]);
  const c3 = cross(rows[0], rows[1]);
  const center: V3 = [0, 1, 2].map((i) => (rhs[0] * c1[i] + rhs[1] * c2[i] + rhs[2] * c3[i]) / det) as V3;
  return { center, axis, radius: norm(sub(p1, center)) };
}

 
function angleAbout(u: V3, v: V3, axis: V3): number {
  return Math.atan2(dot(cross(u, v), axis) / (norm(u) * norm(v)), dot(u, v) / (norm(u) * norm(v))) * DEG;
}

 
function turnPoint(p: V3, center: V3, axis: V3, deg: number): V3 {
  const a = deg / DEG;
  const r = sub(p, center);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = cross(axis, r);
  const d = dot(axis, r) * (1 - c);
  return [center[0] + r[0] * c + k[0] * s + axis[0] * d, center[1] + r[1] * c + k[1] * s + axis[1] * d, center[2] + r[2] * c + k[2] * s + axis[2] * d];
}

 
export function arcCheck(model: RobotModel, start: number[], p1: Mat, p2: Mat, p3: Mat, tool: Mat, tol: PathTolerances): MoveCheck {
  const a = position(p1);
  const b = position(p2);
  const c = position(p3);
  const fail = (code: number): MoveCheck => ({ code, samples: [start.slice(0, model.nq)] });
  if (norm(sub(a, b)) < 0.001 || norm(sub(b, c)) < 0.001 || norm(sub(a, c)) < 0.001) return fail(ARC_INVALID);
  const circle = circle3(a, b, c);
  if (!circle) return fail(ARC_INVALID);
  const { center, axis, radius } = circle;
  const wrap = (deg: number) => {
    while (deg < 0) deg += 360;
    return deg;
  };
  const a1 = wrap(angleAbout(sub(a, center), sub(b, center), axis));
  const a2 = wrap(angleAbout(sub(b, center), sub(c, center), axis));
  const stepMM = tol.stepMM > 0 ? tol.stepMM : 1;
  const stepDeg = tol.stepDeg > 0 ? tol.stepDeg : 1;
  const steps = (arcDeg: number, rotDeg: number) => Math.max(Math.trunc((arcDeg * radius * 2 * Math.PI) / 360 / stepMM), Math.trunc(rotDeg / stepDeg)) || 1;
  const n1 = steps(a1, rotationAngleDeg(p1, p2));
  const n2 = steps(a2, rotationAngleDeg(p2, p3));
  const toolInv = inv(tool);
   
  const q0 = withinLimits(model, start) ? start.slice(0, model.nq) : ikClosest(model, mul(p1, toolInv), start);
  if (!q0) return fail(STEP_NO_SOLUTION);
  const tracker = new PathTracker(model, q0, tol);
  const samples = [start.slice(0, model.nq)];
  const segment = (from: Mat, to: Mat, p: V3, arcDeg: number, n: number) => {
    for (let k = 1; k <= n; k++) {
      const pose = interpolatePose(from, to, k / n);
      const q = turnPoint(p, center, axis, (arcDeg * k) / n);
      pose[3] = q[0];
      pose[7] = q[1];
      pose[11] = q[2];
      const r = tracker.step(mul(pose, toolInv));
      samples.push(r.q);
      if (r.code) return r.code;
    }
    return 0;
  };
  const code = segment(p1, p2, a, a1, n1) || segment(p2, p3, b, a2, n2);
  return { code, samples };
}
