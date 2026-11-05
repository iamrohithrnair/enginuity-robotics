// Indexes triangle meshes for ray casting and closest-point projection.
 
 
 
 
 
 
 
 

import type { GeometryStore } from "../registry";
import type { MeshRef } from "../types";

export type Vec3 = [number, number, number];

export interface MeshHit {
  point: Vec3;
  normal: Vec3;
   
  t: number;
  triangle: number;
}

interface Node {
  min: Vec3;
  max: Vec3;
   
  tris?: number[];
  left?: Node;
  right?: Node;
}

export interface MeshIndex {
   
  tri: Float32Array;
   
  fn: Float32Array;
  root: Node | null;
  count: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

function vtx(tri: Float32Array, t: number, k: number): Vec3 {
  const o = t * 9 + k * 3;
  return [tri[o], tri[o + 1], tri[o + 2]];
}

 
export function buildIndex(tri: Float32Array, vertexNormals?: Float32Array): MeshIndex {
  const count = Math.floor(tri.length / 9);
  const fn = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    const a = vtx(tri, t, 0);
    let n = norm(cross(sub(vtx(tri, t, 1), a), sub(vtx(tri, t, 2), a)));
    if (vertexNormals && vertexNormals.length >= (t + 1) * 9) {
      const o = t * 9;
      const avg: Vec3 = [
        vertexNormals[o] + vertexNormals[o + 3] + vertexNormals[o + 6],
        vertexNormals[o + 1] + vertexNormals[o + 4] + vertexNormals[o + 7],
        vertexNormals[o + 2] + vertexNormals[o + 5] + vertexNormals[o + 8],
      ];
      if (dot(avg, n) < 0) n = [-n[0], -n[1], -n[2]];
    }
    fn.set(n, t * 3);
  }
  const ids = Array.from({ length: count }, (_, i) => i);
  const centroid = (t: number): Vec3 => {
    const o = t * 9;
    return [(tri[o] + tri[o + 3] + tri[o + 6]) / 3, (tri[o + 1] + tri[o + 4] + tri[o + 7]) / 3, (tri[o + 2] + tri[o + 5] + tri[o + 8]) / 3];
  };
  const cents = ids.map(centroid);
  const build = (list: number[], depth: number): Node => {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const t of list) {
      const o = t * 9;
      for (let k = 0; k < 9; k += 3) {
        for (let a = 0; a < 3; a++) {
          const v = tri[o + k + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }
    }
    if (list.length <= 8 || depth > 40) return { min, max, tris: list };
    const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    const sorted = list.slice().sort((p, q) => cents[p][axis] - cents[q][axis]);
    const mid = sorted.length >> 1;
    return { min, max, left: build(sorted.slice(0, mid), depth + 1), right: build(sorted.slice(mid), depth + 1) };
  };
  return { tri, fn, root: count ? build(ids, 0) : null, count };
}

const index = new Map<string, MeshIndex>();

 
export function meshIndex(store: GeometryStore, meshes: MeshRef[]): MeshIndex {
  const key = meshes.map((m) => m.geometry).join("|");
  const hit = index.get(key);
  if (hit) return hit;
  const parts = meshes.map((m) => store.get(m.geometry)).filter((g): g is Float32Array => !!g);
  const normals = meshes.map((m) => (m.normals ? store.get(m.normals) : undefined));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const tri = new Float32Array(total);
  const vn = new Float32Array(total);
  let o = 0;
  let haveNormals = false;
  meshes.forEach((m, i) => {
    const g = store.get(m.geometry);
    if (!g) return;
    tri.set(g, o);
    const n = normals[i];
    if (n && n.length === g.length) {
      vn.set(n, o);
      haveNormals = true;
    }
    o += g.length;
  });
  const built = buildIndex(tri, haveNormals ? vn : undefined);
  if (index.size > 64) index.delete(index.keys().next().value!);
  index.set(key, built);
  return built;
}

function rayBox(o: Vec3, inv: Vec3, n: Node, tMax: number): boolean {
  let t0 = 0;
  let t1 = tMax;
  for (let a = 0; a < 3; a++) {
    let ta = (n.min[a] - o[a]) * inv[a];
    let tb = (n.max[a] - o[a]) * inv[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (Number.isNaN(ta) || Number.isNaN(tb)) continue;  
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

 
export function rayCast(ix: MeshIndex, o: Vec3, d: Vec3): MeshHit | null {
  if (!ix.root) return null;
  const inv: Vec3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  let best: MeshHit | null = null;
  const stack: Node[] = [ix.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (!rayBox(o, inv, n, best ? best.t : Infinity)) continue;
    if (n.tris) {
      for (const t of n.tris) {
        const a = vtx(ix.tri, t, 0);
        const e1 = sub(vtx(ix.tri, t, 1), a);
        const e2 = sub(vtx(ix.tri, t, 2), a);
        const p = cross(d, e2);
        const det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const s = sub(o, a);
        const u = dot(s, p) / det;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const q = cross(s, e1);
        const v = dot(d, q) / det;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const tt = dot(e2, q) / det;
        if (tt < -1e-9 || (best && (tt > best.t + 1e-9 || (tt >= best.t - 1e-9 && t > best.triangle)))) continue;
        best = { t: Math.max(0, tt), point: [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt], normal: [ix.fn[t * 3], ix.fn[t * 3 + 1], ix.fn[t * 3 + 2]], triangle: t };
      }
    } else {
      stack.push(n.left!, n.right!);
    }
  }
  return best;
}

 
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

function boxDist2(p: Vec3, n: Node): number {
  let s = 0;
  for (let a = 0; a < 3; a++) {
    const v = p[a] < n.min[a] ? n.min[a] - p[a] : p[a] > n.max[a] ? p[a] - n.max[a] : 0;
    s += v * v;
  }
  return s;
}

 
export function closestPoint(ix: MeshIndex, p: Vec3): MeshHit | null {
  if (!ix.root) return null;
  let best: MeshHit | null = null;
  const stack: Node[] = [ix.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (best && boxDist2(p, n) > best.t + 1e-9) continue;
    if (n.tris) {
      for (const t of n.tris) {
        const q = closestOnTriangle(p, vtx(ix.tri, t, 0), vtx(ix.tri, t, 1), vtx(ix.tri, t, 2));
        const d = sub(p, q);
        const d2 = dot(d, d);
         
         
        if (!best || d2 < best.t - 1e-9 || (d2 <= best.t + 1e-9 && t < best.triangle)) best = { t: d2, point: q, normal: [ix.fn[t * 3], ix.fn[t * 3 + 1], ix.fn[t * 3 + 2]], triangle: t };
      }
    } else {
       
      const dl = boxDist2(p, n.left!);
      const dr = boxDist2(p, n.right!);
      if (dl < dr) stack.push(n.right!, n.left!);
      else stack.push(n.left!, n.right!);
    }
  }
  return best;
}
