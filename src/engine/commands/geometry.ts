 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { eye, inv, mul, type Mat } from "../math";
import type { GeometryStore } from "../registry";
import type { Item, MeshRef, Workspace } from "../types";
import { absPose, childFrame } from "../workspace";
import { CommandError, defineCommand, ItemRef } from "../registry";
import { deleteItems } from "./items";

const Pose = z.array(z.number()).length(16);
const Color = z.array(z.number()).min(3).max(4);

 
function meshesOf(it: Item): MeshRef[] {
  return it.object?.meshes ?? it.tool?.meshes ?? it.robot?.links.flat() ?? [];
}

 
function geometryFrame(ws: Workspace, it: Item): Mat {
  if (it.type === "tool") return it.parent ? childFrame(ws, it.parent) : absPose(ws, it.id);
  return absPose(ws, it.id);
}

const isUniform = (m: Mat) => {
  const n = (c: number) => Math.hypot(m[c], m[4 + c], m[8 + c]);
  const a = n(0);
  return Math.abs(n(1) - a) < 1e-9 && Math.abs(n(2) - a) < 1e-9;
};

 
export function transformMesh(store: GeometryStore, ref: MeshRef, m: Mat): MeshRef {
  const tri = store.get(ref.geometry);
  if (!tri) return ref;
  const out = new Float32Array(tri.length);
  for (let i = 0; i + 2 < tri.length; i += 3) {
    const x = tri[i];
    const y = tri[i + 1];
    const z = tri[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  const next: MeshRef = { geometry: store.put(out), color: [...ref.color] as MeshRef["color"] };
  const nrm = ref.normals ? store.get(ref.normals) : undefined;
  if (nrm && isUniform(m)) {
    const s = Math.hypot(m[0], m[4], m[8]) || 1;
    const n = new Float32Array(nrm.length);
    for (let i = 0; i + 2 < nrm.length; i += 3) {
      n[i] = (m[0] * nrm[i] + m[1] * nrm[i + 1] + m[2] * nrm[i + 2]) / s;
      n[i + 1] = (m[4] * nrm[i] + m[5] * nrm[i + 1] + m[6] * nrm[i + 2]) / s;
      n[i + 2] = (m[8] * nrm[i] + m[9] * nrm[i + 1] + m[10] * nrm[i + 2]) / s;
    }
    next.normals = store.put(n);
  }
  return next;
}

const scaleMat = (s: number[]): Mat => [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1];

function requireShape(ws: Workspace, ref: string | number, what = "item"): Item {
  const it = requireRef(ws, ref, what);
  if (it.type !== "object" && it.type !== "tool") throw new CommandError(`${it.name} is not an object or a tool`);
  return it;
}

function setMeshes(it: Item, meshes: MeshRef[], extra: Record<string, unknown> = {}): Partial<Item> {
  if (it.type === "tool") return { tool: { ...it.tool!, meshes, ...extra } };
  return { object: { ...it.object!, meshes, ...extra } };
}

defineCommand({
  name: "object.scale",
  title: "Scale",
  description:
    "Scale the geometry of an object or tool (uniform number or per-axis [x, y, z]); with `pre`/`post` poses the scaling is applied as post · S · pre (post defaults to pre⁻¹), like Item.Scale. A robot accepts a uniform scale: its kinematics and links grow or shrink together.",
  category: "item",
  spec: "API Scale / TrScale (FUN_10033885c, FUN_100338980)",
  schema: z.object({ item: ItemRef, scale: z.union([z.number(), z.array(z.number()).length(3)]), pre: Pose.optional(), post: Pose.optional() }),
  run({ ws, tx, services }, p) {
    const it = requireRef(ws, p.item);
    const s = typeof p.scale === "number" ? [p.scale, p.scale, p.scale] : p.scale;
    if (s.some((v) => !(Math.abs(v) > 1e-12))) throw new CommandError("Invalid scale");
    if (it.type === "robot" && it.robot) {
      if (Math.abs(s[0] - s[1]) > 1e-12 || Math.abs(s[0] - s[2]) > 1e-12) throw new CommandError("A robot can only be scaled uniformly");
      const k = s[0];
      const rd = it.robot;
      const scaleT = (m: Mat): Mat => m.map((v, i) => (i === 3 || i === 7 || i === 11 ? v * k : v)) as Mat;
      const model = { ...rd.model, base: scaleT(rd.model.base), flange: scaleT(rd.model.flange), joints: rd.model.joints.map((j) => ({ ...j, a: j.a * k, d: j.d * k })) };
      const links = rd.links.map((meshes) => meshes.map((m) => transformMesh(services.geometry, m, scaleMat([k, k, k]))));
      tx.set(it.id, { robot: { ...rd, model, links } });
      tx.split(`Scale: ${it.name}`);
      return { ok: true };
    }
    const shape = requireShape(ws, p.item);
    const pre = p.pre ?? eye();
    const post = p.post ?? inv(pre);
    const m = mul(mul(post, scaleMat(s)), pre);
    tx.set(shape.id, setMeshes(shape, meshesOf(shape).map((r) => transformMesh(services.geometry, r, m))));
    tx.split(`Scale: ${shape.name}`);
    return { ok: true };
  },
});

defineCommand({
  name: "object.merge",
  title: "Merge Objects",
  description:
    "Merge objects (and tools) into the first one: their geometry moves into the first item's frame keeping its place in the station, and the merged items are deleted (MergeItems). Returns the resulting item.",
  category: "item",
  spec: "API MergeItems (FUN_1003431bc)",
  schema: z.object({ items: z.array(ItemRef).min(1) }),
  run(ctx, p) {
    const { ws, tx, services } = ctx;
    const items = p.items.map((r) => requireShape(ws, r));
    const first = items[0];
    const toFirst = inv(geometryFrame(ws, first));
    const meshes = [...meshesOf(first)];
    for (const other of items.slice(1)) {
      if (other.id === first.id) continue;
      const m = mul(toFirst, geometryFrame(ws, other));
      meshes.push(...meshesOf(other).map((r) => transformMesh(services.geometry, r, m)));
    }
    tx.set(first.id, setMeshes(first, meshes));
    tx.split(`Merge: ${first.name}`);
    const rest = items.slice(1).filter((it) => it.id !== first.id && ws.items[it.id]);
    if (rest.length) deleteItems(ctx, rest.map((it) => it.id));
    return { id: first.id, name: first.name, handle: first.handle, meshes: meshes.length };
  },
});

const dist4 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], (a[3] ?? 1) - (b[3] ?? 1));
const rgba = (c: number[]): MeshRef["color"] => [c[0], c[1], c[2], c[3] ?? 1];

defineCommand({
  name: "object.recolor",
  title: "Recolor",
  description:
    "Recolor the geometry of an item: every shape whose RGBA colour is within `tolerance` (4D distance) of `from` takes the colour `to`. Without `from` every shape is recoloured (Item.Recolor).",
  category: "item",
  spec: "API Recolor (FUN_1003379dc)",
  schema: z.object({ item: ItemRef, to: Color, from: Color.optional(), tolerance: z.number().optional() }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.item);
     
    const from = p.from ?? [0, 0, 0, 0];
    const tol = p.tolerance ?? (p.from ? 0.1 : 2);
    const to = rgba(p.to);
    let changed = 0;
    const recolor = (m: MeshRef): MeshRef => {
      if (dist4(m.color, from) > tol) return m;
      changed += 1;
      return { ...m, color: [...to] as MeshRef["color"] };
    };
    if (it.robot) tx.set(it.id, { robot: { ...it.robot, links: it.robot.links.map((l) => l.map(recolor)) } });
    else if (it.object || it.tool) tx.set(it.id, setMeshes(it, meshesOf(it).map(recolor)));
    else throw new CommandError(`${it.name} has no geometry`);
    tx.split(`Color: ${it.name}`);
    return { recolored: changed };
  },
});

defineCommand({
  name: "object.setShapeColor",
  title: "Set Shape Color",
  description: "Set the colour of one shape (mesh index, 0 = first) of an object or tool; three values keep its transparency (setColorShape).",
  category: "item",
  spec: "API S_ShapeColor (FUN_100338338)",
  schema: z.object({ item: ItemRef, shape: z.number().int(), color: Color }),
  run({ ws, tx }, p) {
    const it = requireShape(ws, p.item);
    const meshes = meshesOf(it);
     
    if (p.shape < 0 || p.shape >= meshes.length) return { changed: false };
    const next = meshes.map((m, i) => (i === p.shape ? { ...m, color: (p.color.length === 3 ? [p.color[0], p.color[1], p.color[2], m.color[3]] : rgba(p.color)) as MeshRef["color"] } : m));
    tx.set(it.id, setMeshes(it, next));
    tx.split(`Color: ${it.name}`);
    return { changed: true };
  },
});

defineCommand({
  name: "object.setGeometryPose",
  title: "Set Geometry Pose",
  description:
    "Move an object's or tool's geometry relative to its own frame. apply=false sets the geometry pose (GeometryPose() returns it); apply=true transforms the geometry data by `pose` and keeps the geometry pose (setGeometryPose).",
  category: "item",
  spec: "API S_Hgeo2 (FUN_100338b9c)",
  schema: z.object({ item: ItemRef, pose: Pose, apply: z.boolean().default(false) }),
  run({ ws, tx, services }, p) {
    const it = requireShape(ws, p.item);
    const data = it.object ?? it.tool!;
    const old = data.geometryPose ?? eye();
    const m = p.apply ? p.pose : mul(p.pose, inv(old));
    const meshes = meshesOf(it).map((r) => transformMesh(services.geometry, r, m));
    tx.set(it.id, setMeshes(it, meshes, p.apply ? {} : { geometryPose: p.pose.slice() as Mat }));
    tx.split(`Move geometry: ${it.name}`);
    return { ok: true };
  },
});

defineCommand({
  name: "object.geometryPose",
  title: "Geometry Pose",
  description: "Pose of an object's or tool's geometry relative to its frame (identity unless set with object.setGeometryPose).",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "API G_Hgeom (FUN_100338cbc)",
  schema: z.object({ item: ItemRef }),
  run({ ws }, p) {
    const it = requireShape(ws, p.item);
    return { pose: (it.object ?? it.tool!).geometryPose ?? eye() };
  },
});

defineCommand({
  name: "object.addGeometry",
  title: "Add Geometry",
  description: "Copy the geometry of `from` into an object or tool, placed at `pose` relative to the receiving item (Item.AddGeometry).",
  category: "item",
  spec: "API CopyFaces (FUN_1003211cc)",
  schema: z.object({ item: ItemRef, from: ItemRef, pose: Pose.default(eye()) }),
  run({ ws, tx, services }, p) {
    const it = requireShape(ws, p.item);
    const from = requireRef(ws, p.from);
    const add = meshesOf(from).map((r) => transformMesh(services.geometry, r, p.pose as Mat));
    if (!add.length) throw new CommandError(`${from.name} has no geometry`);
    tx.set(it.id, setMeshes(it, [...meshesOf(it), ...add]));
    tx.split(`Add geometry: ${it.name}`);
    return { added: add.length };
  },
});

 

 
function worldVertices(ws: Workspace, store: GeometryStore, it: Item): number[][] {
  const m = geometryFrame(ws, it);
  const out: number[][] = [];
  for (const ref of meshesOf(it)) {
    const tri = store.get(ref.geometry);
    if (!tri) continue;
    for (let i = 0; i + 2 < tri.length; i += 3) out.push([m[0] * tri[i] + m[1] * tri[i + 1] + m[2] * tri[i + 2] + m[3], m[4] * tri[i] + m[5] * tri[i + 1] + m[6] * tri[i + 2] + m[7], m[8] * tri[i] + m[9] * tri[i + 1] + m[10] * tri[i + 2] + m[11]]);
  }
  return out;
}

 
const RAYS = [
  [0.8122, 0.4237, 0.4013],
  [-0.3127, 0.8731, 0.3741],
  [0.2219, -0.3461, 0.9116],
].map((v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l);
});

 
function insideMesh(p: number[], tris: Float32Array[]): boolean {
  let votes = 0;
  for (const d of RAYS) if (rayParity(p, d, tris)) votes += 1;
  return votes >= 2;
}

function rayParity(p: number[], d: number[], tris: Float32Array[]): boolean {
  let hits = 0;
  for (const tri of tris) {
    for (let i = 0; i + 8 < tri.length; i += 9) {
      const e1 = [tri[i + 3] - tri[i], tri[i + 4] - tri[i + 1], tri[i + 5] - tri[i + 2]];
      const e2 = [tri[i + 6] - tri[i], tri[i + 7] - tri[i + 1], tri[i + 8] - tri[i + 2]];
      const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(a) < 1e-12) continue;
      const f = 1 / a;
      const s = [p[0] - tri[i], p[1] - tri[i + 1], p[2] - tri[i + 2]];
      const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
      if (v < 0 || u + v > 1) continue;
      if (f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) > 1e-9) hits += 1;
    }
  }
  return hits % 2 === 1;
}





export function isInside(ws: Workspace, store: GeometryStore, inner: Item, outer: Item): boolean {
  const pts = inner.type === "target" ? [[absPose(ws, inner.id)[3], absPose(ws, inner.id)[7], absPose(ws, inner.id)[11]]] : worldVertices(ws, store, inner);
  if (!pts.length) return false;
  const toLocal = inv(geometryFrame(ws, outer));
  const tris = meshesOf(outer).map((r) => store.get(r.geometry)).filter((t): t is Float32Array => !!t);
  if (!tris.length) return false;
   
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let i = 0; i + 2 < t.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], t[i + k]);
    hi[k] = Math.max(hi[k], t[i + k]);
  }
  for (const w of pts) {
    const p = [toLocal[0] * w[0] + toLocal[1] * w[1] + toLocal[2] * w[2] + toLocal[3], toLocal[4] * w[0] + toLocal[5] * w[1] + toLocal[6] * w[2] + toLocal[7], toLocal[8] * w[0] + toLocal[9] * w[1] + toLocal[10] * w[2] + toLocal[11]];
    if (p.some((v, k) => v < lo[k] || v > hi[k])) return false;
    if (!insideMesh(p, tris)) return false;
  }
  return true;
}

defineCommand({
  name: "object.isInside",
  title: "Is Inside",
  description: "Whether an object, tool or target lies completely inside the closed geometry of an object or tool (IsInside).",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "API IsInside (FUN_10033c080)",
  schema: z.object({ inner: ItemRef, outer: ItemRef }),
  run({ ws, services }, p) {
    const inner = requireRef(ws, p.inner);
    const outer = requireShape(ws, p.outer, "outer");
    if (inner.type !== "object" && inner.type !== "tool" && inner.type !== "target") throw new CommandError(`${inner.name} must be an object, a tool or a target`);
    return { inside: isInside(ws, services.geometry, inner, outer) };
  },
});
