 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { objectCurves, objectMesh, objectPoints, PROJECTION, projectRows, transformRows } from "../curves";
import { DEG, inv, type Mat } from "../math";
import { CommandError, defineCommand, ItemRef, type CmdCtx } from "../registry";
import type { Item, ObjectCurve } from "../types";
import { makeItem } from "../workspace";
import { parseClipboardMatrix } from "./edit";
import { registerFileHandler } from "./files";
import { activeStationId } from "./items";

export const Rows = z
  .array(z.array(z.number()).min(3))
  .min(1)
  .describe("points as [x,y,z] or [x,y,z,i,j,k] rows in mm; ijk is the outward surface normal (projection runs along -ijk)");
export const Projection = z
  .number()
  .int()
  .min(0)
  .max(5)
  .default(PROJECTION.ALONG_NORMAL_RECALC)
  .describe("0 none, 1 closest surface point, 2 along -normal, 3 along -normal and recalculate normals (default), 4 closest point and recalculate normals, 5 recalculate normals only");

type Ctx = Pick<CmdCtx, "ws" | "tx" | "services">;

export function requireObject(ws: CmdCtx["ws"], ref: string | number): Item {
  const it = requireRef(ws, ref, "object");
  if (it.type !== "object") throw new CommandError(`${it.name} is not an object`);
  return it;
}

 
function setGeometry(ctx: Ctx, obj: Item, patch: { curves?: ObjectCurve[]; points?: number[][]; pointNames?: Record<number, string> }) {
  const object = { meshes: [], ...obj.object, ...patch };
  if (patch.curves === undefined && obj.curve && !obj.object?.curves) object.curves = objectCurves(obj);
  ctx.tx.set(obj.id, { object, ...(obj.curve ? { curve: undefined } : {}) });
}

function rows6(rows: number[][]): number[][] {
  return rows.map((r) => (r.length >= 6 ? r.slice(0, 6) : [r[0], r[1], r[2], 0, 0, 0]));
}





export function addGeometry(ctx: Ctx, kind: "curve" | "points", p: { object?: string | number; points: number[][]; addToRef?: boolean; projection?: number; name?: string }): Item {
  const { ws, tx, services } = ctx;
  const ref = p.object !== undefined && p.object !== null ? requireObject(ws, p.object) : undefined;
  if (p.addToRef && !ref) throw new CommandError("A reference object is required to add geometry to it");
  const projection = p.projection ?? PROJECTION.ALONG_NORMAL_RECALC;
  let holder: Item;
  let rows: number[][];
  if (ref) {
     
    const inRef = projectRows(objectMesh(services.geometry, ref), transformRows(inv(ref.pose), p.points), projection);
    if (p.addToRef) {
      holder = ref;
      rows = inRef;
    } else {
      holder = makeItem(ws, "object", kind === "curve" ? "Curve" : "Points", { object: { meshes: [] } });
      tx.add(holder, ref.parent ?? activeStationId(ws));
      rows = transformRows(ref.pose, inRef);
    }
  } else {
    holder = makeItem(ws, "object", kind === "curve" ? "Curve" : "Points", { object: { meshes: [] } });
    tx.add(holder, activeStationId(ws));
    rows = projectRows(null, p.points, PROJECTION.NONE);
  }
  const cur = ws.items[holder.id];
  if (kind === "curve") setGeometry(ctx, cur, { curves: [...objectCurves(cur), { points: rows6(rows), ...(p.name ? { name: p.name } : {}) }] });
  else setGeometry(ctx, cur, { points: [...objectPoints(cur), ...rows.map((r) => r.slice(0, 3))] });
  return ws.items[holder.id];
}

const AddSchema = z.object({
  object: ItemRef.optional().describe("reference object: geometry is projected onto it; points are given in its parent frame"),
  points: Rows,
  addToRef: z.boolean().default(false).describe("true: add to the reference object; false: create a new object next to it"),
  projection: Projection,
  name: z.string().optional().describe("curve name (optional)"),
});

defineCommand({
  name: "object.addCurve",
  title: "Add Curve",
  description:
    "Add a curve (polyline with normals) to an object or as a new object named 'Curve' (API AddCurve). With a reference object the points are projected onto its surface (default: along -normal, normals recalculated) and are given in the reference's parent frame. Curves feed curve follow / welding projects.",
  category: "item",
  spec: "R-SLF-38 (AddWire/AddWir2)",
  schema: AddSchema,
  run(ctx, p) {
    const obj = addGeometry(ctx, "curve", p);
    ctx.undoLabel = `Add curve: ${obj.name}`;
    return { id: obj.id, name: obj.name, handle: obj.handle, curves: objectCurves(obj).length };
  },
});

defineCommand({
  name: "object.addPoints",
  title: "Add Points",
  description:
    "Add a list of points to an object or as a new object named 'Points' (API AddPoints). With a reference object the points are projected onto its surface first. Points feed point follow projects (drilling, spot welding).",
  category: "item",
  spec: "R-SLF-38 (AddPoints)",
  schema: AddSchema,
  run(ctx, p) {
    const obj = addGeometry(ctx, "points", p);
    ctx.undoLabel = `Add points: ${obj.name}`;
    return { id: obj.id, name: obj.name, handle: obj.handle, points: objectPoints(obj).length };
  },
});

 
export function projectOnObject(ctx: Pick<CmdCtx, "ws" | "services">, objectRef: string | number, points: number[][], projection: number): number[][] {
  const obj = requireObject(ctx.ws, objectRef);
  const inObj = projectRows(objectMesh(ctx.services.geometry, obj), transformRows(inv(obj.pose), points), projection);
  return transformRows(obj.pose, inObj);
}

defineCommand({
  name: "object.projectPoints",
  title: "Project Points",
  description: "Project points onto an object's surface without adding them (API ProjectPoints). Points are given and returned in the object's parent frame as [x,y,z,i,j,k] rows.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-SLF-38 (ProjectPoints)",
  schema: z.object({ object: ItemRef, points: Rows, projection: Projection }),
  run(ctx, p) {
    return { points: projectOnObject(ctx, p.object, p.points, p.projection) };
  },
});

defineCommand({
  name: "object.curves",
  title: "Object Curves and Points",
  description: "List an object's curves (with names, point rows in object coordinates and length) and its points (API GetCurves / GetPoints).",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ object: ItemRef }),
  run({ ws }, p) {
    const obj = requireObject(ws, p.object);
    return {
      curves: objectCurves(obj).map((c, i) => ({ index: i, name: c.name ?? "", points: c.points, color: c.color })),
      points: objectPoints(obj),
      pointNames: obj.object?.pointNames ?? {},
    };
  },
});

defineCommand({
  name: "object.deleteCurves",
  title: "Delete Curves",
  description: "Delete one curve of an object (curve index) or all of them ('Delete Curve' / 'Delete All Curves', API DeleteCurves).",
  category: "item",
  schema: z.object({ object: ItemRef, curve: z.number().int().min(0).optional() }),
  run(ctx, p) {
    const obj = requireObject(ctx.ws, p.object);
    const list = objectCurves(obj);
    if (p.curve !== undefined && !list[p.curve]) throw new CommandError("Invalid curve id");
    setGeometry(ctx, obj, { curves: p.curve === undefined ? [] : list.filter((_, i) => i !== p.curve) });
    ctx.undoLabel = p.curve === undefined ? `Delete all curves: ${obj.name}` : `Delete curve: ${obj.name}`;
    return { curves: p.curve === undefined ? 0 : list.length - 1 };
  },
});

defineCommand({
  name: "object.deletePoints",
  title: "Delete Points",
  description: "Delete one point of an object (point index) or all of them ('Delete Point' / 'Delete All Points').",
  category: "item",
  schema: z.object({ object: ItemRef, point: z.number().int().min(0).optional() }),
  run(ctx, p) {
    const obj = requireObject(ctx.ws, p.object);
    const pts = objectPoints(obj);
    if (p.point !== undefined && !pts[p.point]) throw new CommandError("Invalid point id");
    const names = { ...(obj.object?.pointNames ?? {}) };
    if (p.point !== undefined) {
      const shifted: Record<number, string> = {};
      for (const [k, v] of Object.entries(names)) {
        const i = Number(k);
        if (i < p.point) shifted[i] = v;
        else if (i > p.point) shifted[i - 1] = v;
      }
      setGeometry(ctx, obj, { points: pts.filter((_, i) => i !== p.point), pointNames: shifted });
    } else setGeometry(ctx, obj, { points: [], pointNames: {} });
    ctx.undoLabel = p.point === undefined ? `Delete all points: ${obj.name}` : `Delete point: ${obj.name}`;
    return { points: p.point === undefined ? 0 : pts.length - 1 };
  },
});

 

const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: number[]) => {
  const l = len3(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

 
function tangent(pts: number[][], i: number): number[] {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  return unit3(sub3(b, a));
}

 
function rotateAbout(v: number[], k: number[], ang: number): number[] {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((j) => v[j] * c + x[j] * s + k[j] * kv * (1 - c));
}

 
export function resample(pts: number[][], spacing: number): number[][] {
  if (pts.length < 2 || !(spacing > 0)) return pts.map((p) => p.slice());
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = len3(sub3(pts[i], pts[i - 1]));
    seg.push(l);
    total += l;
  }
  const n = Math.max(1, Math.round(total / spacing));
  const out: number[][] = [];
  let k = 0;
  let acc = 0;
  for (let s = 0; s <= n; s++) {
    const d = (total * s) / n;
    while (k < seg.length - 1 && acc + seg[k] < d - 1e-9) acc += seg[k++];
    const t = seg[k] > 0 ? Math.min(1, Math.max(0, (d - acc) / seg[k])) : 0;
    const a = pts[k];
    const b = pts[k + 1];
    const p = [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t);
    const nn = unit3([0, 1, 2].map((j) => (a[3 + j] ?? 0) + ((b[3 + j] ?? 0) - (a[3 + j] ?? 0)) * t));
    out.push([...p, ...nn]);
  }
  return out;
}

 
function cornerIndices(pts: number[][], deg: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = unit3(sub3(pts[i], pts[i - 1]));
    const b = unit3(sub3(pts[i + 1], pts[i]));
    const cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > deg * DEG) out.push(i);
  }
  return out;
}

function splitAt(pts: number[][], idx: number[]): number[][][] {
  const out: number[][][] = [];
  let start = 0;
  for (const i of [...idx].sort((a, b) => a - b)) {
    if (i <= start || i >= pts.length - 1) continue;
    out.push(pts.slice(start, i + 1));
    start = i;
  }
  out.push(pts.slice(start));
  return out.filter((c) => c.length > 1);
}

 
function halfway(pts: number[][]): { pts: number[][]; at: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += len3(sub3(pts[i], pts[i - 1]));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = len3(sub3(pts[i], pts[i - 1]));
    if (acc + l >= total / 2 - 1e-9) {
      const t = l > 0 ? (total / 2 - acc) / l : 0;
      if (t < 1e-6) return { pts, at: i - 1 };
      if (t > 1 - 1e-6) return { pts, at: i };
      const a = pts[i - 1];
      const b = pts[i];
      const mid = [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t).concat(unit3([0, 1, 2].map((j) => (a[3 + j] ?? 0) + ((b[3 + j] ?? 0) - (a[3 + j] ?? 0)) * t)));
      return { pts: [...pts.slice(0, i), mid, ...pts.slice(i)], at: i };
    }
    acc += l;
  }
  return { pts, at: pts.length - 1 };
}

 
function nearestOnCurve(pts: number[][], p: number[]): { seg: number; t: number; point: number[] } {
  let best = { seg: 0, t: 0, point: pts[0], d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const ab = sub3(pts[i], a);
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0;
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = len3(sub3(p, q));
    if (d < best.d) best = { seg: i - 1, t, point: q, d };
  }
  return best;
}

defineCommand({
  name: "object.editCurve",
  title: "Edit Curve",
  description:
    "Edit one curve of an object (object context menu on a curve): flip normals, tilt normals around the tangent (angle, deg), split at a point index, split in corners (angle threshold, deg), split in half, split here (at the closest location to `at`, object coordinates), split ends (separate pieces farther apart than `tolerance` mm), set point spacing (mm), rename, extract its points to the object's point list, delete one curve point, or reverse its direction.",
  category: "item",
  schema: z.object({
    object: ItemRef,
    curve: z.number().int().min(0),
    op: z.enum(["flipNormals", "tiltNormals", "split", "splitCorners", "splitHalf", "splitHere", "splitEnds", "spacing", "rename", "extractPoints", "deletePoint", "reverse"]),
    angle: z.number().optional().describe("tiltNormals: rotation (deg); splitCorners: corner angle threshold (deg, default 30)"),
    point: z.number().int().min(0).optional().describe("split / deletePoint: point index on the curve"),
    at: z.array(z.number()).length(3).optional().describe("splitHere: location in object coordinates"),
    spacing: z.number().positive().optional().describe("spacing: distance between points (mm)"),
    tolerance: z.number().positive().optional().describe("splitEnds: gap that separates pieces (mm, default 0.5)"),
    name: z.string().optional().describe("rename: new curve name"),
  }),
  run(ctx, p) {
    const obj = requireObject(ctx.ws, p.object);
    const curves = objectCurves(obj).map((c) => ({ ...c, points: c.points.map((r) => r.slice()) }));
    const c = curves[p.curve];
    if (!c) throw new CommandError("Invalid curve id");
    let replace: ObjectCurve[] | null = null;
    let points: number[][] | undefined;
    switch (p.op) {
      case "flipNormals":
        c.points = c.points.map((r) => [r[0], r[1], r[2], -(r[3] ?? 0), -(r[4] ?? 0), -(r[5] ?? 0)]);
        break;
      case "tiltNormals": {
        const ang = (p.angle ?? 0) * DEG;
        c.points = c.points.map((r, i) => [r[0], r[1], r[2], ...rotateAbout([r[3] ?? 0, r[4] ?? 0, r[5] ?? 0], tangent(c.points, i), ang)]);
        break;
      }
      case "split":
        if (p.point === undefined) throw new CommandError("Select a curve point to split the curve");
        replace = splitAt(c.points, [p.point]).map((pts) => ({ ...c, points: pts }));
        break;
      case "splitCorners":
        replace = splitAt(c.points, cornerIndices(c.points, p.angle ?? 30)).map((pts) => ({ ...c, points: pts }));
        break;
      case "splitHalf": {
        const h = halfway(c.points);
        replace = splitAt(h.pts, [h.at]).map((pts) => ({ ...c, points: pts }));
        break;
      }
      case "splitHere": {
        if (!p.at) throw new CommandError("Pick a location on the curve");
        const n = nearestOnCurve(c.points, p.at);
        const a = c.points[n.seg];
        const b = c.points[n.seg + 1];
        const nn = unit3([0, 1, 2].map((j) => (a[3 + j] ?? 0) + ((b[3 + j] ?? 0) - (a[3 + j] ?? 0)) * n.t));
        const pts = n.t <= 1e-6 ? c.points : n.t >= 1 - 1e-6 ? c.points : [...c.points.slice(0, n.seg + 1), [...n.point, ...nn], ...c.points.slice(n.seg + 1)];
        const at = n.t <= 1e-6 ? n.seg : n.seg + 1;
        replace = splitAt(pts, [at]).map((q) => ({ ...c, points: q }));
        break;
      }
      case "splitEnds": {
        const tol = p.tolerance ?? 0.5;
        const idx: number[] = [];
        const pieces: number[][][] = [];
        let start = 0;
        for (let i = 1; i < c.points.length; i++) {
          if (len3(sub3(c.points[i], c.points[i - 1])) > tol) {
            pieces.push(c.points.slice(start, i));
            start = i;
            idx.push(i);
          }
        }
        pieces.push(c.points.slice(start));
        replace = pieces.filter((q) => q.length > 1).map((q) => ({ ...c, points: q }));
        break;
      }
      case "spacing":
        if (!p.spacing) throw new CommandError("Provide the point spacing (mm)");
        c.points = resample(c.points, p.spacing);
        break;
      case "rename":
        c.name = p.name ?? "";
        break;
      case "extractPoints":
        points = [...objectPoints(obj), ...c.points.map((r) => r.slice(0, 3))];
        break;
      case "deletePoint":
        if (p.point === undefined || !c.points[p.point]) throw new CommandError("Invalid point id");
        c.points.splice(p.point, 1);
        if (c.points.length < 2) replace = [];
        break;
      case "reverse":
        c.points.reverse();
        break;
    }
    const next = replace ? [...curves.slice(0, p.curve), ...replace, ...curves.slice(p.curve + 1)] : curves;
    setGeometry(ctx, obj, { curves: next, ...(points ? { points } : {}) });
    ctx.undoLabel = `Modify curve: ${obj.name}`;
    return { curves: next.length, points: points?.length ?? objectPoints(obj).length };
  },
});

defineCommand({
  name: "object.renamePoint",
  title: "Rename Point",
  description: "Name one point of an object's point list ('Rename Point').",
  category: "item",
  schema: z.object({ object: ItemRef, point: z.number().int().min(0), name: z.string() }),
  run(ctx, p) {
    const obj = requireObject(ctx.ws, p.object);
    if (!objectPoints(obj)[p.point]) throw new CommandError("Invalid point id");
    setGeometry(ctx, obj, { pointNames: { ...(obj.object?.pointNames ?? {}), [p.point]: p.name } });
    ctx.undoLabel = `Rename point: ${obj.name}`;
    return { point: p.point, name: p.name };
  },
});

defineCommand({
  name: "object.setCurveColor",
  title: "Curve Color",
  description: "Set the color of one curve (index) or of all curves (-1) of an object (API setColorCurve). RGBA in 0..1.",
  category: "item",
  schema: z.object({ object: ItemRef, curve: z.number().int().min(-1).default(-1), color: z.array(z.number()).min(3).max(4) }),
  run(ctx, p) {
    const obj = requireObject(ctx.ws, p.object);
    const color = [p.color[0], p.color[1], p.color[2], p.color[3] ?? 1] as [number, number, number, number];
    const curves = objectCurves(obj).map((c, i) => (p.curve < 0 || i === p.curve ? { ...c, color } : c));
    if (p.curve >= 0 && !objectCurves(obj)[p.curve]) throw new CommandError("Invalid curve id");
    setGeometry(ctx, obj, { curves });
    ctx.undoLabel = `Change color: ${obj.name}`;
    return { curves: curves.length };
  },
});

const fmtNum = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
};

 
export function curvesToText(curves: ObjectCurve[]): string {
  if (curves.length === 1) return curves[0].points.map((r) => r.slice(0, 6).map(fmtNum).join(",")).join("\n") + "\n";
  const lines: string[] = [];
  for (const c of curves) c.points.forEach((r, i) => lines.push([...r.slice(0, 6), i === 0 ? 1 : 0].map(fmtNum).join(",")));
  return lines.join("\n") + "\n";
}

defineCommand({
  name: "object.exportCurves",
  title: "Export Curves",
  description: "Export one curve ('Export Curve') or all curves ('Export Curves') of an object as CSV text (x,y,z,i,j,k; several curves add a 7th column that marks the first point of each curve, the format Import Curve reads).",
  category: "item",
  readonly: true,
  undoable: false,
  schema: z.object({ object: ItemRef, curve: z.number().int().min(0).optional() }),
  run({ ws }, p) {
    const obj = requireObject(ws, p.object);
    const list = objectCurves(obj);
    if (!list.length) throw new CommandError("No curve found");
    if (p.curve !== undefined && !list[p.curve]) throw new CommandError("Invalid curve id");
    const chosen = p.curve === undefined ? list : [list[p.curve]];
    const base = p.curve === undefined ? obj.name : list[p.curve].name || `${obj.name} curve ${p.curve + 1}`;
    return { fileName: `${base}.csv`, text: curvesToText(chosen), curves: chosen.length };
  },
});

 

 
export function fileBaseName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

 
function importTarget(ctx: Ctx, objectRef: string | number | undefined, fileName: string): { obj: Item; created: boolean } {
  const { ws, tx } = ctx;
  if (objectRef !== undefined) return { obj: requireObject(ws, objectRef), created: false };
  const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "object");
  if (sel && ws.selection.length === 1) return { obj: sel, created: false };
  const obj = makeItem(ws, "object", fileBaseName(fileName), { object: { meshes: [] } });
  tx.add(obj, activeStationId(ws));
  return { obj, created: true };
}

export function importPoints(ctx: Ctx, p: { text: string; fileName: string; object?: string | number }) {
  const rows = parseClipboardMatrix(p.text).filter((r) => r.length >= 3);
  if (!rows.length) throw new CommandError("No points found (only text format is accepted)");
  const { obj, created } = importTarget(ctx, p.object, p.fileName);
  setGeometry(ctx, ctx.ws.items[obj.id], { points: [...objectPoints(ctx.ws.items[obj.id]), ...rows.map((r) => r.slice(0, 3))] });
  return { id: obj.id, name: ctx.ws.items[obj.id].name, created, points: rows.length };
}






export function splitCurveTable(rows: number[][]): { curves: number[][][]; points: number[][] } {
  const seven = rows.length > 0 && rows.every((r) => r.length >= 7);
  if (!seven) return { curves: rows.length ? [rows6(rows)] : [], points: [] };
  const groups: number[][][] = [];
  for (const r of rows) {
    if (r[6] > 0 || !groups.length) groups.push([]);
    groups[groups.length - 1].push(r);
  }
  return { curves: groups.filter((g) => g.length > 1).map(rows6), points: groups.filter((g) => g.length === 1).map((g) => g[0].slice(0, 3)) };
}

export function importCurve(ctx: Ctx, p: { text: string; fileName: string; object?: string | number }) {
  const rows = parseClipboardMatrix(p.text)
    .filter((r) => r.length >= 3)
    .map((r) => r.slice(0, 7));
  const { curves, points } = splitCurveTable(rows);
  if (!curves.length && !points.length) throw new CommandError("No curve found (only text format is accepted)");
  const { obj, created } = importTarget(ctx, p.object, p.fileName);
  const cur = ctx.ws.items[obj.id];
  setGeometry(ctx, cur, { curves: [...objectCurves(cur), ...curves.map((pts) => ({ points: pts }))], points: [...objectPoints(cur), ...points] });
  return { id: obj.id, name: ctx.ws.items[obj.id].name, created, curves: curves.length, points: points.length };
}

const ImportSchema = z.object({
  text: z.string().describe("file contents: numbers separated by commas, spaces, tabs or semicolons; one point per line"),
  fileName: z.string().default("Imported.csv").describe("file name (a new object is named after it)"),
  object: ItemRef.optional().describe("object that receives the geometry (default: the selected object, else a new object at the station root)"),
});

defineCommand({
  name: "object.importPoints",
  title: "Import Points",
  description: "Import points from a CSV/TXT table (x,y,z per line, object coordinates) into the selected object or a new object named after the file (Utilities ▸ Import Points).",
  category: "tools",
  spec: "B-UTIL-18",
  schema: ImportSchema,
  run(ctx, p) {
    const r = importPoints(ctx, p);
    ctx.undoLabel = `Import points: ${r.name}`;
    return r;
  },
});

defineCommand({
  name: "object.importCurve",
  title: "Import Curve",
  description:
    "Import curves from a CSV/TXT table (x,y,z[,i,j,k] per line, object coordinates) into the selected object or a new object named after the file (Utilities ▸ Import Curve). With 7 columns a 7th value > 0 starts a new curve and single rows become points.",
  category: "tools",
  spec: "B-UTIL-19",
  schema: ImportSchema,
  run(ctx, p) {
    const r = importCurve(ctx, p);
    ctx.undoLabel = `Import curve: ${r.name}`;
    return r;
  },
});

 
registerFileHandler(["csv", "txt"], (ctx, file) => importCurve(ctx, { text: new TextDecoder().decode(file.bytes), fileName: file.name }));

 

 
const selectedFeature = new Map<string, { type: number; id: number }>();
export const FEATURE = { NONE: 0, SURFACE: 1, CURVE: 2, POINT: 3 } as const;

export function getSelectedFeature(objectId: string): { type: number; id: number } | undefined {
  return selectedFeature.get(objectId);
}

defineCommand({
  name: "object.selectFeature",
  title: "Select Curve or Point",
  description: "Select a feature of an object (surface, curve index or point index), as when clicking it in the 3D view; the API's SelectedFeature reports it.",
  category: "item",
  undoable: false,
  readonly: true,
  schema: z.object({ object: ItemRef, feature: z.enum(["none", "surface", "curve", "point"]), id: z.number().int().min(0).default(0) }),
  run({ ws }, p) {
    const obj = requireObject(ws, p.object);
    const type = FEATURE[p.feature.toUpperCase() as keyof typeof FEATURE];
    if (type === FEATURE.NONE) selectedFeature.delete(obj.id);
    else selectedFeature.set(obj.id, { type, id: p.id });
    return { object: obj.name, feature: p.feature, id: p.id };
  },
});

 
export function curveRowsAbs(objAbs: Mat, rows: number[][]): number[][] {
  return transformRows(objAbs, rows);
}

