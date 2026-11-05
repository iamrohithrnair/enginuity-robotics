// Constructs tool orientations and candidate frames along machining paths.
 
 
 
 
 
 
 
 
 
 
 
 

import { mul, type Mat } from "../math";
import { APT, projectOnPlane, type AptCol, type V3 } from "./apt";

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

 
const rot = (m: Mat, v: readonly number[]): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]];
 
const apply = (m: Mat, p: readonly number[]): V3 => {
  const r = rot(m, p);
  return [r[0] + m[3], r[1] + m[7], r[2] + m[11]];
};
const frame = (x: V3, y: V3, z: V3, p: V3): Mat => [x[0], y[0], z[0], p[0], x[1], y[1], z[1], p[1], x[2], y[2], z[2], p[2], 0, 0, 0, 1];

 
function toolZ(m: Mat, col: AptCol): V3 {
  const n = rot(m, [col[4], col[5], col[6]]);
  const z: V3 = [-n[0], -n[1], -n[2]];
  const l = Math.sqrt(z[1] * z[1] + z[0] * z[0] + z[2] * z[2]);
  return [z[0] / l, z[1] / l, z[2] / l];
}






export function frameMinChange(tol: number, col: AptCol, m: Mat, a: V3, b: V3): Mat {
  const p = apply(m, [col[1], col[2], col[3]]);
  const z = toolZ(m, col);
  const c = dot(z, a);
  let ang = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
  if (ang > Math.PI / 2) ang = Math.PI - ang;
  const x0 = ang <= tol ? b : a;
  const yr = cross(z, x0);
  const yl = Math.sqrt(yr[1] * yr[1] + yr[0] * yr[0] + yr[2] * yr[2]);
  const y: V3 = [yr[0] / yl, yr[1] / yl, yr[2] / yl];
  return frame(cross(y, z), y, z, p);
}

 
export function frameFollowPath(col: AptCol, m: Mat, t: readonly number[]): Mat {
  const p = apply(m, [col[1], col[2], col[3]]);
  const z = toolZ(m, col);
  const tt = rot(m, t);
  const yr = cross(z, tt);
  const r = 1 / Math.sqrt(yr[1] * yr[1] + yr[0] * yr[0] + yr[2] * yr[2]);
  const y: V3 = [yr[0] * r, yr[1] * r, yr[2] * r];
  return frame(cross(y, z), y, z, p);
}

 
export function targetColumns(apt: AptCol[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < apt.length; i++) {
    const t = apt[i][0];
    if (t === APT.move) out.push(i);
    else if (t === APT.arcVia) {
      out.push(i);
      if (i + 1 < apt.length) out.push(i + 1);
      i++;
    }
  }
  return out;
}








export function pathTangents(apt: AptCol[], targets: number[]): { t: V3[]; defined: boolean[] } {
  const n = targets.length;
  const pt = (k: number) => apt[targets[Math.min(k, n - 1)]];
  let t: V3 = [0, 0, 1];
  if (n > 1) {
    const c0 = pt(0);
    const nl = Math.sqrt(c0[5] * c0[5] + c0[4] * c0[4] + c0[6] * c0[6]);
    const n0: V3 = [c0[4] / nl, c0[5] / nl, c0[6] / nl];
    let d = 0;
    let v: V3 = [0, 0, 1];
    for (let k = 1; k < n; k++) {
      const q = projectOnPlane([pt(k)[1], pt(k)[2], pt(k)[3]], [c0[1], c0[2], c0[3]], n0);
      v = sub([c0[1], c0[2], c0[3]], q);
      d = Math.sqrt(v[1] * v[1] + v[0] * v[0] + v[2] * v[2]);
      if (!(d < 0.1)) break;
    }
    if (d >= 0.1) t = [v[0] / d, v[1] / d, v[2] / d];
  }
  const out: V3[] = [];
  const defined: boolean[] = [];
  for (let k = 0; k < n; k++) {
    const c = pt(k);
    const next = pt(k + 1);
    const nl = Math.sqrt(c[5] * c[5] + c[4] * c[4] + c[6] * c[6]);
    const q = projectOnPlane([next[1], next[2], next[3]], [c[1], c[2], c[3]], [c[4] / nl, c[5] / nl, c[6] / nl]);
    const dv = sub(q, [c[1], c[2], c[3]]);
    const d = Math.sqrt(dv[1] * dv[1] + dv[0] * dv[0] + dv[2] * dv[2]);
    if (d > 0.1) t = [-dv[0] / d, -dv[1] / d, -dv[2] / d];
    defined.push(d > 0.1);
    out.push(t);
  }
  return { t: out, defined };
}

 
export function rotZCandidates(range: number, step: number): number[] {
  const deg = [0];
  if (step > 0) for (let a = step; a <= range; a = step + a) deg.push(a, -a);
  return deg.map((d) => (d * Math.PI) / 180);
}

 
const rotzDeg = (deg: number) => rotz((deg * Math.PI) / 180);

 
export function rotz(theta: number): Mat {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export interface FrameOpts {
   
  m: Mat;
  pathToTool: Mat;
  algorithm: number;
  orientX: V3;
  orientX2: V3;
   
  orientTol: number;
  




  follow?: { angle: number; step: number; realign: number };
}

 
function xAngle(a: Mat, b: Mat): number {
  const u: V3 = [a[0], a[4], a[8]];
  const v: V3 = [b[0], b[4], b[8]];
  const lu = Math.sqrt(u[1] * u[1] + u[0] * u[0] + u[2] * u[2]);
  const lv = Math.sqrt(v[1] * v[1] + v[0] * v[0] + v[2] * v[2]);
  const c = (u[0] / lu) * (v[0] / lv) + (u[1] / lu) * (v[1] / lv) + (u[2] / lu) * (v[2] / lv);
  return (Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) * 180) / Math.PI;
}

 
export function pointFrames(apt: AptCol[], targets: number[], o: FrameOpts): Mat[] {
  let tol = o.orientTol > 2 * Math.PI ? o.orientTol - 2 * Math.PI : o.orientTol;
  if (tol <= 0) tol = 0.03490658503988659;
  const unit = (v: V3): V3 => {
    const l = Math.sqrt(v[1] * v[1] + v[0] * v[0] + v[2] * v[2]);
    return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : v;
  };
  if (o.algorithm === 1 || o.algorithm === 3) {
     
     
     
    const { t: tangents, defined } = pathTangents(apt, targets);
    const follow = o.follow ?? { angle: 99999, step: 0, realign: -1 };
    let work = o.pathToTool;
    let prev: Mat | null = null;
    return targets.map((c, k) => {
      let f = mul(frameFollowPath(apt[c], o.m, tangents[k]), work);
      if (prev) {
        const ang = xAngle(f, prev);
         
        const px: V3 = [prev[0], prev[4], prev[8]];
        const cx: V3 = [f[0], f[4], f[8]];
        const pz: V3 = [prev[2], prev[6], prev[10]];
        let a = dot(cross(px, cx), pz) >= 0 ? ang : -ang;
        if (apt[c][0] === APT.move && follow.angle <= Math.abs(ang)) {
          if (follow.step > 0.5) a = follow.step * Math.round(a / follow.step);
          const turn = rotzDeg(-a);
          f = mul(f, turn);
          work = mul(work, turn);
        }
        if (follow.realign >= 0 && Math.abs(a) < follow.realign && defined[k]) work = o.pathToTool;
      }
      prev = f;
      return f;
    });
  }
  const a = unit(o.orientX);
  const b = unit(o.orientX2);
  return targets.map((c) => mul(frameMinChange(tol, apt[c], o.m, a, b), o.pathToTool));
}
