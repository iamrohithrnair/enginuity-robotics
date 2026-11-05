// Analyzes triangle meshes to detect primitive colliders and transformed bounds.
 
 
 

import type { GeometryStore } from "../registry";

export type Vec3 = [number, number, number];

 
export type Primitive =
  | { kind: "box"; center: Vec3; half: Vec3 }
  | { kind: "sphere"; center: Vec3; radius: number }
  | { kind: "cylinder"; center: Vec3; axis: 0 | 1 | 2; radius: number; halfHeight: number };

export interface MeshInfo {
   
  vertices: Float32Array;
   
  indices: Uint32Array;
   
  min: Vec3;
  max: Vec3;
  triangles: number;
  primitive: Primitive | null;
}

const caches = new WeakMap<GeometryStore, Map<string, MeshInfo | null>>();

 
export function meshInfo(store: GeometryStore, id: string): MeshInfo | null {
  let cache = caches.get(store);
  if (!cache) {
    cache = new Map();
    caches.set(store, cache);
  }
  if (cache.has(id)) return cache.get(id)!;
  const tri = store.get(id);
  const info = tri && tri.length >= 9 ? analyse(tri) : null;
  cache.set(id, info);
  return info;
}

 
export function weld(tri: Float32Array): { vertices: Float32Array; indices: Uint32Array; count: number } {
  const n = Math.floor(tri.length / 9) * 3;
   
  const src = tri.byteOffset % 4 === 0 ? tri : tri.slice();
  const bits = new Uint32Array(src.buffer, src.byteOffset, n * 3);
  let cap = 16;
  while (cap < n * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const outBits = new Uint32Array(n * 3);
  const indices = new Uint32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = bits[i * 3];
    const b = bits[i * 3 + 1];
    const c = bits[i * 3 + 2];
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mask;
    for (;;) {
      const j = table[h];
      if (j < 0) {
        table[h] = m;
        outBits[m * 3] = a;
        outBits[m * 3 + 1] = b;
        outBits[m * 3 + 2] = c;
        indices[i] = m++;
        break;
      }
      if (outBits[j * 3] === a && outBits[j * 3 + 1] === b && outBits[j * 3 + 2] === c) {
        indices[i] = j;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return { vertices: new Float32Array(outBits.buffer, 0, m * 3).slice(), indices, count: m };
}

function analyse(tri: Float32Array): MeshInfo {
  const { vertices: mm, indices, count } = weld(tri);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = mm[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const primitive = detectPrimitive(mm, count, min, max);
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) vertices[i] = mm[i] * 0.001;
  return { vertices, indices, min, max, triangles: indices.length / 3, primitive };
}







export function detectPrimitive(v: Float32Array, n: number, min: Vec3, max: Vec3): Primitive | null {
  const ext: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size = Math.max(ext[0], ext[1], ext[2]);
  if (!(size > 0) || ext.some((e) => !(e > size * 1e-4))) return null;
  const eps = size * 1e-5 + 1e-6;
  const at = (x: number, a: number) => Math.abs(x - a) <= eps;
  if (n === 8) {
    let ok = true;
    for (let i = 0; i < 8 && ok; i++) for (let k = 0; k < 3 && ok; k++) ok = at(v[i * 3 + k], min[k]) || at(v[i * 3 + k], max[k]);
    if (ok) return { kind: "box", center: c, half: [ext[0] / 2, ext[1] / 2, ext[2] / 2] };
  }
   
  if (n >= 20 && Math.abs(ext[0] - ext[1]) <= eps * 10 && Math.abs(ext[1] - ext[2]) <= eps * 10) {
    const r = size / 2;
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = Math.abs(Math.hypot(v[i * 3] - c[0], v[i * 3 + 1] - c[1], v[i * 3 + 2] - c[2]) - r) <= r * 2e-3;
    if (ok) return { kind: "sphere", center: c, radius: r };
  }
   
  for (const axis of [2, 0, 1] as const) {
    const u = (axis + 1) % 3;
    const w = (axis + 2) % 3;
    if (Math.abs(ext[u] - ext[w]) > Math.max(ext[u], ext[w]) * 2e-3) continue;
    const R = Math.max(ext[u], ext[w]) / 2;
    let ok = true;
    let rim = 0;
    for (let i = 0; i < n && ok; i++) {
      const p = v[i * 3 + axis];
      if (!at(p, min[axis]) && !at(p, max[axis])) {
        ok = false;
        break;
      }
      const r = Math.hypot(v[i * 3 + u] - c[u], v[i * 3 + w] - c[w]);
      if (Math.abs(r - R) <= R * 2e-3) rim++;
      else if (r > R * 2e-3) ok = false;
    }
    if (ok && rim >= 32) return { kind: "cylinder", center: c, axis, radius: R, halfHeight: ext[axis] / 2 };
  }
  return null;
}

 
export function transformedBox(min: Vec3, max: Vec3, m: number[]): { min: Vec3; max: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? max[0] : min[0];
    const y = i & 2 ? max[1] : min[1];
    const z = i & 4 ? max[2] : min[2];
    for (let k = 0; k < 3; k++) {
      const t = m[k * 4] * x + m[k * 4 + 1] * y + m[k * 4 + 2] * z + m[k * 4 + 3];
      if (t < lo[k]) lo[k] = t;
      if (t > hi[k]) hi[k] = t;
    }
  }
  return { min: lo, max: hi };
}
