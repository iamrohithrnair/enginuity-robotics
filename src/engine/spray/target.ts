// Builds spray-target geometry and casts particle segments against triangles.
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import type { Vec3 } from "./options";

const f = Math.fround;

 
export const NO_HIT = 1.5e7;

interface Node {
  min: Vec3;
  max: Vec3;
  tris?: Int32Array;
  left?: Node;
  right?: Node;
}

export interface SprayShape {
   
  tri: Float32Array;
  count: number;
   
  box: Float32Array;
  root: Node | null;
}

export interface SprayTarget {
   
  shapes: SprayShape[];
   
  box: Float32Array | null;
   
  triangles: number;
}

export interface SegmentHit {
   
  d: number;
  point: Vec3;
}

 
export function boxTriangles(min: Vec3, max: Vec3): Float32Array {
  const c = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const faces = [
    [0, 2, 3], [0, 3, 1],  
    [4, 5, 7], [4, 7, 6],  
    [0, 1, 5], [0, 5, 4],  
    [2, 6, 7], [2, 7, 3],  
    [0, 4, 6], [0, 6, 2],  
    [1, 3, 7], [1, 7, 5],  
  ];
  const out = new Float32Array(12 * 9);
  faces.forEach((fc, k) => fc.forEach((v, j) => out.set(c(v), k * 9 + j * 3)));
  return out;
}

function bounds(tri: Float32Array, ids?: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const n = ids ? ids.length : tri.length / 9;
  for (let k = 0; k < n; k++) {
    const o = (ids ? ids[k] : k) * 9;
    for (let j = 0; j < 9; j += 3)
      for (let a = 0; a < 3; a++) {
        const v = tri[o + j + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
  }
  return { min, max };
}

function buildNode(tri: Float32Array, ids: Int32Array, cents: Float32Array, depth: number): Node {
  const { min, max } = bounds(tri, ids);
  if (ids.length <= 8 || depth > 32) return { min, max, tris: ids };
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
  const sorted = Array.from(ids).sort((p, q) => cents[p * 3 + axis] - cents[q * 3 + axis]);
  const mid = sorted.length >> 1;
  return {
    min,
    max,
    left: buildNode(tri, Int32Array.from(sorted.slice(0, mid)), cents, depth + 1),
    right: buildNode(tri, Int32Array.from(sorted.slice(mid)), cents, depth + 1),
  };
}

 
export function buildShape(tri: Float32Array): SprayShape {
  const count = Math.floor(tri.length / 9);
  const cents = new Float32Array(count * 3);
  for (let t = 0; t < count; t++)
    for (let a = 0; a < 3; a++) cents[t * 3 + a] = (tri[t * 9 + a] + tri[t * 9 + 3 + a] + tri[t * 9 + 6 + a]) / 3;
  const { min, max } = bounds(tri);
  return {
    tri,
    count,
    box: boxTriangles(min, max),
    root: count ? buildNode(tri, Int32Array.from({ length: count }, (_, i) => i), cents, 0) : null,
  };
}

 
export function buildTarget(parts: { tri: Float32Array; alpha: number }[]): SprayTarget {
  let triangles = 0;
  const all: Float32Array[] = [];
  const shapes: SprayShape[] = [];
  for (const p of parts) {
    const n = Math.floor(p.tri.length / 9);
    triangles += n;
    if (!n) continue;
    all.push(p.tri);
     
     
    if (p.alpha >= 0.5) shapes.push(buildShape(p.tri));
  }
  let box: Float32Array | null = null;
  if (all.length) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const t of all) {
      const b = bounds(t);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], b.min[a]);
        max[a] = Math.max(max[a], b.max[a]);
      }
    }
    box = boxTriangles(min, max);
  }
  return { shapes, box, triangles };
}






export function segmentTriangle(p1: Vec3, p2: Vec3, t: Float32Array, o: number, out: Vec3): number {
  const v0x = t[o];
  const v0y = t[o + 1];
  const v0z = t[o + 2];
  const ux = f(t[o + 3] - v0x);
  const uy = f(t[o + 4] - v0y);
  const uz = f(t[o + 5] - v0z);
  const vx = f(t[o + 6] - v0x);
  const vy = f(t[o + 7] - v0y);
  const vz = f(t[o + 8] - v0z);
  const nx = f(-f(uz * vy) + f(vz * uy));
  const ny = f(-f(ux * vz) + f(vx * uz));
  const nz = f(-f(uy * vx) + f(vy * ux));
  if (f(f(f(ny * ny) + f(nx * nx)) + f(nz * nz)) < 1e-6) return -1;
  const p1x = p1[0];
  const p1y = p1[1];
  const p1z = p1[2];
  const dx = f(p2[0] - p1x);
  const dy = f(p2[1] - p1y);
  const dz = f(p2[2] - p1z);
  const a = f(f(f(ny * f(p1y - v0y)) + f(f(p1x - v0x) * nx)) + f(f(p1z - v0z) * nz));
  const b = f(f(f(ny * dy) + f(dx * nx)) + f(dz * nz));
  if (Math.abs(b) < 1e-6) return a !== 0 ? 0 : 2;
  const r = f(-a / b);
  if (!(r >= 0 && r <= 1)) return 0;
  const ix = f(p1x + f(dx * r));
  const iy = f(p1y + f(dy * r));
  const iz = f(p1z + f(dz * r));
  out[0] = ix;
  out[1] = iy;
  out[2] = iz;
  const uu = f(f(f(uy * uy) + f(ux * ux)) + f(uz * uz));
  const uv = f(f(f(uy * vy) + f(vx * ux)) + f(vz * uz));
  const vv = f(f(f(vy * vy) + f(vx * vx)) + f(vz * vz));
  const den = f(-f(vv * uu) + f(uv * uv));
  if (Math.abs(den) < 1e-6) return 0;
  const wx = f(ix - v0x);
  const wy = f(iy - v0y);
  const wz = f(iz - v0z);
  const wu = f(f(f(uy * wy) + f(ux * wx)) + f(uz * wz));
  const wv = f(f(f(vy * wy) + f(vx * wx)) + f(vz * wz));
  const inv = f(1 / den);
  const s = f(inv * f(-f(wu * vv) + f(wv * uv)));
  if (!(s > 0 && s < 1)) return 0;
  const tt = f(inv * f(-f(wv * uu) + f(wu * uv)));
  return f(s + tt) < 1 && tt > 0 ? 1 : 0;
}

 
function crossesBox(p1: Vec3, p2: Vec3, box: Float32Array): boolean {
  const tmp: Vec3 = [0, 0, 0];
  for (let k = 0; k < 12; k++) if (segmentTriangle(p1, p2, box, k * 9, tmp) === 1) return true;
  return false;
}

 
function segmentBox(p1: Vec3, p2: Vec3, min: Vec3, max: Vec3): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let a = 0; a < 3; a++) {
    const m = 1e-3 * (1 + Math.abs(min[a]) + Math.abs(max[a]));
    const lo = min[a] - m;
    const hi = max[a] + m;
    const d = p2[a] - p1[a];
    if (Math.abs(d) < 1e-12) {
      if (p1[a] < lo || p1[a] > hi) return false;
      continue;
    }
    let ta = (lo - p1[a]) / d;
    let tb = (hi - p1[a]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

 
function castShape(sh: SprayShape, p1: Vec3, p2: Vec3): { d: number; tri: number; point: Vec3 } | null {
  if (!sh.root || !crossesBox(p1, p2, sh.box)) return null;
  let best: { d: number; tri: number; point: Vec3 } | null = null;
  const tmp: Vec3 = [0, 0, 0];
  const stack: Node[] = [sh.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (!segmentBox(p1, p2, n.min, n.max)) continue;
    if (n.tris) {
      for (const t of n.tris) {
        if (segmentTriangle(p1, p2, sh.tri, t * 9, tmp) !== 1) continue;
        const ey = f(p1[1] - tmp[1]);
        const ex = f(p1[0] - tmp[0]);
        const ez = f(p1[2] - tmp[2]);
        const d = f(Math.sqrt(f(f(f(ey * ey) + f(ex * ex)) + f(ez * ez))));
        if (!best || d < best.d || (d === best.d && t < best.tri)) best = { d, tri: t, point: [tmp[0], tmp[1], tmp[2]] };
      }
    } else {
      stack.push(n.left!, n.right!);
    }
  }
  return best;
}

 
export function castSegment(target: SprayTarget, p1: Vec3, p2: Vec3): SegmentHit | null {
  if (!target.box || !crossesBox(p1, p2, target.box)) return null;
  let best: SegmentHit | null = null;
  for (const sh of target.shapes) {
    const h = castShape(sh, p1, p2);
     
    if (h && (!best || h.d < best.d)) best = { d: h.d, point: h.point };
  }
  return best;
}
