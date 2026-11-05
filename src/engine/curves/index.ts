// Transforms and projects object curve and point rows between frames.
 
 
 
 
 
 
 
 
 
 
 
 
 

import { mul, type Mat } from "../math";
import type { GeometryStore } from "../registry";
import type { Item, ObjectCurve } from "../types";
import { closestPoint, meshIndex, norm, rayCast, type MeshIndex, type Vec3 } from "./mesh";

export const PROJECTION = { NONE: 0, CLOSEST: 1, ALONG_NORMAL: 2, ALONG_NORMAL_RECALC: 3, CLOSEST_RECALC: 4, RECALC: 5 } as const;

 
export function projectRows(ix: MeshIndex | null, rows: number[][], type: number): number[][] {
  return rows.map((r) => {
    const p: Vec3 = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0];
    if (r.length < 6) return [...p, 0, 0, 1];
    const n: Vec3 = [r[3], r[4], r[5]];
    if (!ix || !ix.root || type === PROJECTION.NONE) return [...p, ...n];
    switch (type) {
      case PROJECTION.CLOSEST:
      case PROJECTION.CLOSEST_RECALC: {
        const h = closestPoint(ix, p);
        if (!h) return [...p, ...n];
        return [...h.point, ...(type === PROJECTION.CLOSEST_RECALC ? h.normal : n)];
      }
      case PROJECTION.ALONG_NORMAL:
      case PROJECTION.ALONG_NORMAL_RECALC: {
        const d = norm([-n[0], -n[1], -n[2]]);
        if (d[0] === 0 && d[1] === 0 && d[2] === 0) return [...p, ...n];
        const h = rayCast(ix, p, d);
        if (!h) return [...p, ...n];
        return [...h.point, ...(type === PROJECTION.ALONG_NORMAL_RECALC ? h.normal : n)];
      }
      case PROJECTION.RECALC: {
        const h = closestPoint(ix, p);
        return [...p, ...(h ? h.normal : n)];
      }
      default:
        return [...p, ...n];
    }
  });
}

 
export function transformRows(m: Mat, rows: number[][]): number[][] {
  return rows.map((r) => {
    const x = r[0] ?? 0;
    const y = r[1] ?? 0;
    const z = r[2] ?? 0;
    const p = [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
    if (r.length < 6) return p;
    const [i, j, k] = [r[3], r[4], r[5]];
    return [...p, m[0] * i + m[1] * j + m[2] * k, m[4] * i + m[5] * j + m[6] * k, m[8] * i + m[9] * j + m[10] * k];
  });
}

 
export function objectMesh(store: GeometryStore, it: Item | undefined): MeshIndex | null {
  const meshes = it?.object?.meshes ?? it?.tool?.meshes ?? [];
  if (!meshes.length) return null;
  const ix = meshIndex(store, meshes);
  return ix.count ? ix : null;
}





export function objectCurves(it: Item | undefined): ObjectCurve[] {
  if (!it) return [];
  const list = it.object?.curves ?? [];
  if (it.curve?.points?.length && !it.object?.curves) return [{ points: it.curve.points }, ...list];
  return list;
}

export function objectPoints(it: Item | undefined): number[][] {
  return it?.object?.points ?? [];
}

 
export function polylineLength(points: number[][]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  return l;
}

 
export function rowsBetween(objAbs: Mat, toFrameAbsInv: Mat, rows: number[][]): number[][] {
  return transformRows(mul(toFrameAbsInv, objAbs), rows);
}
