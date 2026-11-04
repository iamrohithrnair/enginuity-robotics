 
 
 
 
 
 
 
 
 
 
 
 
 

import { fk, linkFrames } from "./kinematics";
import { mul, type Mat } from "./math";
import type { RobotModel } from "./types";

export const ENVELOPE_J1_STEPS = 61;
export const ENVELOPE_CONTOUR = 73;

 
export const WORKSPACE_MODE_LABELS = ["Do not show", "Show for wrist center", "Show for robot flange", "Show for current tool"] as const;





export function resampleClosed(poly: [number, number][], n: number): [number, number][] {
  const pts = poly.length && (poly[0][0] !== poly[poly.length - 1][0] || poly[0][1] !== poly[poly.length - 1][1]) ? [...poly, poly[0]] : poly;
  const sides = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = sides.reduce((a, b) => a + b, 0);
  if (!total || sides.length >= n) return Array.from({ length: n }, (_, k) => [...(pts[Math.min(k, pts.length - 1)] ?? [0, 0])] as [number, number]);
   
  const budget = n - 1 - sides.length;
  const exact = sides.map((d) => (d / total) * budget);
  const seg = exact.map((x) => 1 + Math.floor(x));
  let left = n - 1 - seg.reduce((a, b) => a + b, 0);
  for (const i of exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map((x) => x[1])) {
    if (left-- <= 0) break;
    seg[i]++;
  }
  const out: [number, number][] = [];
  sides.forEach((_, i) => {
    for (let k = 0; k < seg[i]; k++) {
      const t = k / seg[i];
      out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
    }
  });
  out.push([pts[0][0], pts[0][1]]);
  return out;
}

 
export function j23Boundary(model: RobotModel): [number, number][] {
  const lo = model.userLower;
  const hi = model.userUpper;
  if (model.polygon?.length >= 3) return resampleClosed(model.polygon, ENVELOPE_CONTOUR);
  const rect: [number, number][] = [
    [lo[1] ?? 0, lo[2] ?? 0],
    [hi[1] ?? 0, lo[2] ?? 0],
    [hi[1] ?? 0, hi[2] ?? 0],
    [lo[1] ?? 0, hi[2] ?? 0],
  ];
  return resampleClosed(rect, ENVELOPE_CONTOUR);
}

export interface Envelope {
   
  rows: number;
  cols: number;
   
  points: Float32Array;
   
  closed: boolean;
}





export function workspaceEnvelope(model: RobotModel, mode: 1 | 2 | 3, base: Mat, tool: Mat): Envelope {
  const nq = model.nq;
  const lo1 = model.userLower[0] ?? 0;
  const hi1 = model.userUpper[0] ?? 0;
  const span = Math.min(360, Math.max(0, hi1 - lo1));
  const mid1 = (lo1 + hi1) / 2;
  const a1 = mid1 - span / 2;
  const closed = span >= 359.999;
  const rows = ENVELOPE_J1_STEPS;
  const contour = nq >= 3 ? j23Boundary(model) : nq === 2 ? resampleClosed([[model.userLower[1], 0], [model.userUpper[1], 0]], ENVELOPE_CONTOUR) : [[0, 0] as [number, number]];
  const cols = contour.length;
  const points = new Float32Array(rows * cols * 3);
  const q = new Array(nq).fill(0);
  for (let i = 0; i < rows; i++) {
    q[0] = a1 + (span * i) / (rows - 1);
    for (let j = 0; j < cols; j++) {
      if (nq >= 2) q[1] = contour[j][0];
      if (nq >= 3) q[2] = contour[j][1];
      let t: Mat;
      if (mode === 1) {
         
        const f = linkFrames(model, q);
        t = mul(base, f[Math.min(5, f.length - 2)]);
      } else t = mode === 3 ? mul(mul(base, fk(model, q)), tool) : mul(base, fk(model, q));
      points.set([t[3], t[7], t[11]], (i * cols + j) * 3);
    }
  }
  return { rows, cols, points, closed };
}

 
export function envelopeIndices(e: Envelope): Uint32Array {
  const idx: number[] = [];
  for (let i = 0; i < e.rows - 1; i++)
    for (let j = 0; j < e.cols - 1; j++) {
      const a = i * e.cols + j;
      const b = a + e.cols;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return Uint32Array.from(idx);
}
