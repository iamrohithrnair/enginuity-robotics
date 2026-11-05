// Builds convex-hull faces and support samples for collision geometry.
 
 
 
 
 
 
 
 
 
 
 
 

import type { Vec3 } from "./geometry";

export interface Hull {
   
  vertices: Float32Array;
   
  indices: Uint32Array;
}

 
const MERGE_DOT = 1 - Math.sqrt(1.1920929e-7);
 
const TILT = Math.tan((2.5 * Math.PI) / 180);

interface Face {
  normal: Vec3;
  verts: number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

 
export function hullFaces(h: Hull): Face[] {
  const v = (i: number): Vec3 => [h.vertices[i * 3], h.vertices[i * 3 + 1], h.vertices[i * 3 + 2]];
  const nt = Math.floor(h.indices.length / 3);
  const normals: Vec3[] = [];
  for (let t = 0; t < nt; t++) {
    const a = v(h.indices[t * 3]);
    const n = cross(sub(v(h.indices[t * 3 + 1]), a), sub(v(h.indices[t * 3 + 2]), a));
    const l = len(n) || 1;
    normals.push([n[0] / l, n[1] / l, n[2] / l]);
  }
  const parent = Array.from({ length: nt }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges = new Map<string, number>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = h.indices[t * 3 + k];
      const b = h.indices[t * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const other = edges.get(key);
      if (other === undefined) edges.set(key, t);
      else if (dot(normals[t], normals[other]) > MERGE_DOT) parent[find(t)] = find(other);
    }
  }
  const groups = new Map<number, { normal: Vec3; verts: Set<number> }>();
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    const g = groups.get(r) ?? { normal: normals[r], verts: new Set<number>() };
    for (let k = 0; k < 3; k++) g.verts.add(h.indices[t * 3 + k]);
    groups.set(r, g);
  }
  return [...groups.values()].map((g) => ({ normal: g.normal, verts: [...g.verts] }));
}

 
export function largestQuad(points: Vec3[], normal: Vec3): number[] {
  const n = points.length;
  if (n <= 4) return points.map((_, i) => i);
  let a = 0;
  let b = 1;
  let best = -1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = len(sub(points[i], points[j]));
      if (d > best) {
        best = d;
        a = i;
        b = j;
      }
    }
  const ab = sub(points[b], points[a]);
  let left = -1;
  let right = -1;
  let lMax = 0;
  let rMax = 0;
  for (let i = 0; i < n; i++) {
    if (i === a || i === b) continue;
    const s = dot(cross(ab, sub(points[i], points[a])), normal);
    if (s > lMax) {
      lMax = s;
      left = i;
    } else if (-s > rMax) {
      rMax = -s;
      right = i;
    }
  }
  return [a, b, left, right].filter((i) => i >= 0);
}

 
function segDist(p: Vec3, a: Vec3, b: Vec3) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}





export function quadrangulate(h: Hull): Float32Array | null {
  const faces = hullFaces(h).filter((f) => f.verts.length > 4);
  if (!faces.length) return null;
  const pts = h.vertices.slice();
  const p = (i: number): Vec3 => [h.vertices[i * 3], h.vertices[i * 3 + 1], h.vertices[i * 3 + 2]];
  for (const f of faces) {
    const fp = f.verts.map(p);
    const quad = largestQuad(fp, f.normal).map((i) => f.verts[i]);
    const corners = quad.map(p);
     
    const c: Vec3 = corners.reduce((s, q) => [s[0] + q[0] / corners.length, s[1] + q[1] / corners.length, s[2] + q[2] / corners.length], [0, 0, 0] as Vec3);
    const u = sub(corners[0], c);
    const w = cross(f.normal, u);
    const ordered = corners.slice().sort((x, y) => Math.atan2(dot(sub(x, c), w), dot(sub(x, c), u)) - Math.atan2(dot(sub(y, c), w), dot(sub(y, c), u)));
    const rest = f.verts.filter((i) => !quad.includes(i));
    let far = 0;
    for (const i of rest) far = Math.max(far, Math.min(...ordered.map((q, k) => segDist(p(i), q, ordered[(k + 1) % ordered.length]))));
    const depth = Math.min(0.003, Math.max(0.0002, far * TILT));
    for (const i of rest) for (let k = 0; k < 3; k++) pts[i * 3 + k] -= f.normal[k] * depth;
  }
  return pts;
}

 
export function sphereDirections(k: number): Float64Array {
  const out = new Float64Array(k * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < k; i++) {
    const y = 1 - (2 * (i + 0.5)) / k;
    const r = Math.sqrt(1 - y * y);
    out[i * 3] = Math.cos(golden * i) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(golden * i) * r;
  }
  return out;
}









export function supportPoints(v: Float32Array, k: number): Float32Array {
  const n = Math.floor(v.length / 3);
  const dirs = sphereDirections(k);
  const best = new Float64Array(k).fill(-Infinity);
  const idx = new Int32Array(k).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = v[i * 3];
    const y = v[i * 3 + 1];
    const z = v[i * 3 + 2];
    for (let d = 0; d < k; d++) {
      const s = x * dirs[d * 3] + y * dirs[d * 3 + 1] + z * dirs[d * 3 + 2];
      if (s > best[d]) {
        best[d] = s;
        idx[d] = i;
      }
    }
  }
  const keep = new Set<number>();
  for (const i of idx) if (i >= 0) keep.add(i);
   
  for (let a = 0; a < 3; a++) {
    let lo = 0;
    let hi = 0;
    for (let i = 1; i < n; i++) {
      if (v[i * 3 + a] < v[lo * 3 + a]) lo = i;
      if (v[i * 3 + a] > v[hi * 3 + a]) hi = i;
    }
    keep.add(lo);
    keep.add(hi);
  }
  const out = new Float32Array(keep.size * 3);
  let o = 0;
  for (const i of keep) {
    out[o++] = v[i * 3];
    out[o++] = v[i * 3 + 1];
    out[o++] = v[i * 3 + 2];
  }
  return out;
}
