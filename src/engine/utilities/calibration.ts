 
 
 
 
 
 
 
 
 
 

import { inv, mul, type Mat } from "../math";
import { add, cross, dot, fitPlane, lstsq, norm, scale, sub, symEigen, unit, type Vec3 } from "./linalg";

export const CALIBRATE_TCP_BY_POINT = 0;
export const CALIBRATE_TCP_BY_PLANE = 1;
export const CALIBRATE_TCP_BY_PLANE_SCARA = 4;
export const CALIBRATE_FRAME_3P_P1_ON_X = 0;
export const CALIBRATE_FRAME_3P_P1_ORIGIN = 1;
export const CALIBRATE_FRAME_6P = 2;
export const CALIBRATE_TURNTABLE = 3;
export const CALIBRATE_TURNTABLE_2X = 4;

 
export const CALIB_MSG = {
  unable: "Unable to calibrate with current data",
  tcpApiFail: "Can't calculate the TCP. Increase the number of points and/or orientations.",
  frameApiFail: "Can't calculate the frame. Increase the number of points.",
  tcpApiSize: "Invalid parameters, a 6xN matrix of positions should be provided (N>=3).",
  framePoints: "Invalid points! Size must be 3xN. ",
  robotForJoints: "Robot item must be provided to calibrate by joints! ",
  outsideLimits: (i: number) => `Configuration ${i} is outside joint limits. `,
  closeConfigs: ". Warning: configurations are very close.",
  fewPoints: "Use more than 3 points to get an error estimate",
  framePointsClose: "Cannot calculate frame with current input. Points are too close.",
  invalidMethod: "Invalid calibration Method or robot not provided. ",
} as const;

const pos = (m: Mat): Vec3 => [m[3], m[7], m[11]];
const rot = (m: Mat, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
];

 
export function rotationAngleDeg(m: Mat): number {
  const c = Math.max(-1, Math.min(1, (m[0] + m[5] + m[10] - 1) * 0.5));
  let a = Math.acos(c);
  if (a >= 1e-6 && Math.abs(Math.sin(a)) < 1e-6) a = Math.PI;
  return (a * 180) / Math.PI;
}

 
export function errorStats(e: number[]): [number, number, number] {
  if (!e.length) return [0, 0, 0];
  const mean = e.reduce((s, v) => s + v, 0) / e.length;
  const std = e.length < 2 ? 0 : Math.sqrt(e.reduce((s, v) => s + (v - mean) ** 2, 0) / (e.length - 1));
  return [mean, std, Math.max(...e)];
}

export interface TcpCalibration {
  ok: boolean;
   
  tcp: Vec3;
   
  point: Vec3;
   
  stats: [number, number, number];
  errors: number[];
   
  pairs: number;
  skipped: number;
   
  planeAngles?: [number, number];
}

const failed = (n: number): TcpCalibration => ({ ok: false, tcp: [0, 0, 0], point: [0, 0, 0], stats: [0, 0, 0], errors: new Array(n).fill(0), pairs: 0, skipped: 0 });

 
export function tcpByPoint(flanges: Mat[], minAngleDeg = 5): TcpCalibration {
  const n = flanges.length;
  const rows: number[][] = [];
  const b: number[] = [];
  let pairs = 0;
  let skipped = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const angle = rotationAngleDeg(mul(inv(flanges[i]), flanges[j]));
      if (angle < minAngleDeg) {
        skipped++;
        continue;
      }
      pairs++;
      const Ri = flanges[i];
      const Rj = flanges[j];
      const dp = sub(pos(Rj), pos(Ri));
      for (let r = 0; r < 3; r++) {
        rows.push([Ri[r * 4] - Rj[r * 4], Ri[r * 4 + 1] - Rj[r * 4 + 1], Ri[r * 4 + 2] - Rj[r * 4 + 2]]);
        b.push(dp[r]);
      }
    }
  if (pairs < 3) return { ...failed(n), pairs, skipped };
  const t = lstsq(rows, b).x as Vec3;
  const q = flanges.map((f) => add(rot(f, t), pos(f)));
  const s = scale(q.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]), 1 / n);
  const errors = q.map((p) => norm(sub(p, s)));
  return { ok: true, tcp: t, point: s, stats: errorStats(errors), errors, pairs, skipped };
}







export function tcpByPlane(flanges: Mat[], plane: Mat, opts: { scara?: boolean } = {}): TcpCalibration {
  const n = flanges.length;
  if (n < 4) return failed(n);
  const nz: Vec3 = [plane[2], plane[6], plane[10]];
  const rows: number[][] = [];
  const b: number[] = [];
  for (const f of flanges) {
    const nr = [0, 1, 2].map((k) => nz[0] * f[k] + nz[1] * f[4 + k] + nz[2] * f[8 + k]);
    rows.push([nr[0], nr[1], nr[2], -1]);
    b.push(-dot(nz, pos(f)));
  }
  const { x, rank } = lstsq(rows, b, opts.scara ? 1e-6 : 1e-12);
  if (rank < (opts.scara ? 3 : 4)) return failed(n);
  const t: Vec3 = [x[0], x[1], x[2]];
  const d = x[3];
  const q = flanges.map((f) => add(rot(f, t), pos(f)));
  const errors = q.map((p) => Math.abs(dot(nz, p) - d));
   
  let planeAngles: [number, number] = [0, 0];
  if (n >= 3) {
    let { normal } = fitPlane(q);
    if (dot(normal, nz) < 0) normal = scale(normal, -1);
    const local = rot(inv(plane), normal);
    planeAngles = [(Math.atan2(-local[1], local[2]) * 180) / Math.PI, (Math.atan2(local[0], local[2]) * 180) / Math.PI];
  }
  return { ok: true, tcp: t, point: [d, planeAngles[0], planeAngles[1]], stats: errorStats(errors), errors, pairs: n, skipped: 0, planeAngles };
}

export interface FrameCalibration {
  ok: boolean;
   
  pose: Mat;
   
  stats: number[];
   
  degenerate?: boolean;
   
  radius?: number;
  planarErrors?: number[];
  circularErrors?: number[];
}

const frameOf = (x: Vec3, y: Vec3, z: Vec3, o: Vec3): Mat => [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2], 0, 0, 0, 1];
const eye = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const noFrame = (): FrameCalibration => ({ ok: false, pose: eye(), stats: [] });

 
const projectOnLine = (p: Vec3, o: Vec3, u: Vec3): Vec3 => add(o, scale(u, dot(sub(p, o), u)));
 
const projectOnPlane = (p: Vec3, o: Vec3, nrm: Vec3): Vec3 => sub(p, scale(nrm, dot(sub(p, o), nrm)));

 
export function frameFromPoints(points: Vec3[], method: number): FrameCalibration {
  if (points.length < 3) return noFrame();
  const [p1, p2, p3] = points;
  if (method === CALIBRATE_FRAME_3P_P1_ON_X || method === CALIBRATE_FRAME_3P_P1_ORIGIN) {
     
     
    const degenerate = (): FrameCalibration => (method === CALIBRATE_FRAME_3P_P1_ORIGIN ? { ok: true, pose: eye(), stats: [], degenerate: true } : { ...noFrame(), degenerate: true });
    if (norm(sub(p1, p2)) < 1 || norm(sub(p1, p3)) < 1) return degenerate();
    const v = sub(p2, p1);
    const x = unit(v);
    const c = cross(v, sub(p3, p1));
    if (norm(c) < 0.1) return degenerate();
    const z = unit(c);
    const y = cross(z, x);
    const o = method === CALIBRATE_FRAME_3P_P1_ORIGIN ? p1 : projectOnLine(p3, p1, x);
    return { ok: true, pose: frameOf(x, y, z, o), stats: [] };
  }
  if (method === CALIBRATE_FRAME_6P) {
    if (points.length < 6) return noFrame();
    const c = cross(sub(p2, p1), sub(p3, p1));
    if (norm(c) < 0.1) return { ...noFrame(), degenerate: true };
    const z = unit(c);
    const q4 = projectOnPlane(points[3], p1, z);
    const q5 = projectOnPlane(points[4], p1, z);
    const dx = sub(q5, q4);
    if (norm(dx) < 0.1) return { ...noFrame(), degenerate: true };
    const x = unit(dx);
    const o = projectOnLine(points[5], q4, x);
    return { ok: true, pose: frameOf(x, cross(z, x), z, o), stats: [] };
  }
  if (method === CALIBRATE_TURNTABLE) return turntableFrame(points);
  if (method === CALIBRATE_TURNTABLE_2X) return turntable2Frame(points);
  return noFrame();
}

export interface CircleFit {
  ok: boolean;
  center: Vec3;
   
  normal: Vec3;
  radius: number;
   
  planarErrors: number[];
  circularErrors: number[];
   
  sigma: number;
}

const noCircle = (n: number): CircleFit => ({ ok: false, center: [0, 0, 0], normal: [0, 0, 1], radius: 0, planarErrors: new Array(n).fill(0), circularErrors: new Array(n).fill(0), sigma: 0 });

 
function circle3(p1: Vec3, p2: Vec3, p3: Vec3): { center: Vec3; normal: Vec3; radius: number } | null {
  const a = sub(p2, p1);
  const b = sub(p3, p1);
  const c = cross(a, b);
  const c2 = dot(c, c);
  if (c2 < 1e-12 * dot(a, a) * dot(b, b) || c2 === 0) return null;
   
  const center = add(p1, scale(add(scale(cross(c, a), dot(b, b)), scale(cross(b, c), dot(a, a))), 1 / (2 * c2)));
  return { center, normal: unit(c), radius: norm(sub(p1, center)) };
}






export function fitCircle3D(points: Vec3[]): CircleFit {
  const n = points.length;
  if (n < 3) return noCircle(n);
  const init = circle3(points[0], points[1], points[2]);
  if (!init) return noCircle(n);
  let { center, normal, radius } = init;
  const residuals = (c: Vec3, nz: Vec3, r: number) =>
    points.map((p) => {
      const v = sub(p, c);
      const h = dot(v, nz);
      return { v, h, rho: norm(sub(v, scale(nz, h))), r };
    });
  if (n >= 4) {
    for (let it = 0; it < 100; it++) {
      const u = unit(Math.abs(normal[0]) < 0.9 ? cross(normal, [1, 0, 0]) : cross(normal, [0, 1, 0]));
      const w = cross(normal, u);
      const rows: number[][] = [];
      const b: number[] = [];
      for (const { v, h, rho } of residuals(center, normal, radius)) {
         
        rows.push([-normal[0], -normal[1], -normal[2], dot(v, u), dot(v, w), 0]);
        b.push(-h);
         
        const q = sub(v, scale(normal, h));
        const qh = rho > 1e-12 ? scale(q, 1 / rho) : ([0, 0, 0] as Vec3);
        const k = rho > 1e-12 ? -h / rho : 0;
        rows.push([-qh[0], -qh[1], -qh[2], k * dot(v, u), k * dot(v, w), -1]);
        b.push(-(rho - radius));
      }
      const { x } = lstsq(rows, b);
      center = add(center, [x[0], x[1], x[2]]);
      normal = unit(add(normal, add(scale(u, x[3]), scale(w, x[4]))));
      radius += x[5];
      if (Math.hypot(x[0], x[1], x[2], x[5]) <= 1e-12 * Math.max(1, radius) && Math.hypot(x[3], x[4]) <= 1e-15) break;
    }
  }
  if (!(radius > 0) || !Number.isFinite(radius)) return noCircle(n);
  const res = residuals(center, normal, radius);
  const planarErrors = res.map((e) => Math.abs(e.h));
  const circularErrors = res.map((e) => Math.abs(e.rho - radius));
  const ss = res.reduce((s, e) => s + e.h * e.h + (e.rho - radius) ** 2, 0);
  const sigma = n >= 4 ? Math.sqrt(ss / (2 * n - 6)) : 0;
  return { ok: true, center, normal, radius, planarErrors, circularErrors, sigma };
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const max = (a: number[]) => (a.length ? Math.max(...a) : 0);

 
const circleStats = (c: CircleFit) => [mean(c.circularErrors), mean(c.planarErrors), c.sigma, max(c.circularErrors), max(c.planarErrors), c.radius];






export function turntableFrame(points: Vec3[]): FrameCalibration {
  const c = fitCircle3D(points);
  if (!c.ok) return noFrame();
  const xdir = sub(projectOnPlane(points[0], c.center, c.normal), c.center);
  if (norm(xdir) < 1e-9) return noFrame();
  const x = unit(xdir);
  return {
    ok: true,
    pose: frameOf(x, cross(c.normal, x), c.normal, c.center),
    stats: circleStats(c),
    radius: c.radius,
    planarErrors: c.planarErrors,
    circularErrors: c.circularErrors,
  };
}











export function turntable2Frame(points: Vec3[]): FrameCalibration & { axisDistance?: number; axisAngle?: number } {
  const n = points.length;
  if (n < 6) return noFrame();
  let best: { c1: CircleFit; c2: CircleFit; score: number } | null = null;
  for (let k = 3; k <= n - 3; k++) {
    const c1 = fitCircle3D(points.slice(0, k));
    const c2 = fitCircle3D(points.slice(k));
    if (!c1.ok || !c2.ok) continue;
    const score = c1.sigma ** 2 + c2.sigma ** 2;
    if (!best || score <= best.score) best = { c1, c2, score };
  }
  if (!best) return noFrame();
  const { c1, c2 } = best;
  const n1 = c1.normal;
  const n2 = c2.normal;
  const cr = cross(n1, n2);
  const angle = (Math.acos(Math.max(-1, Math.min(1, dot(n1, n2)))) * 180) / Math.PI;
  let origin: Vec3;
  let foot1: Vec3;
  let distance: number;
  if (norm(cr) <= 1e-7 || angle < 1 || Math.abs(angle - 180) < 1) {
     
    const t = dot(sub(c1.center, c2.center), n1) / dot(n2, n1);
    origin = add(c2.center, scale(n2, t));
    foot1 = c1.center;
    distance = norm(sub(origin, c1.center));
  } else {
     
    const w0 = sub(c1.center, c2.center);
    const b = dot(n1, n2);
    const d = dot(n1, w0);
    const e = dot(n2, w0);
    const den = 1 - b * b;
    const s = (b * e - d) / den;
    const t = (e - b * d) / den;
    foot1 = add(c1.center, scale(n1, s));
    origin = add(c2.center, scale(n2, t));
    distance = Math.abs(dot(sub(c2.center, c1.center), unit(cr)));
  }
  if (norm(cr) < 1e-15) return noFrame();
  const x = unit(cr);
  const y = cross(n2, x);
  const stats = [...circleStats(c1), ...circleStats(c2), distance, angle, ...foot1, ...n1, 0];
  return { ok: true, pose: frameOf(x, y, n2, origin), stats, axisDistance: distance, axisAngle: angle };
}

 
export { symEigen };
