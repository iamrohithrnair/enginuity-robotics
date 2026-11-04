 
 

import { eye, type Mat } from "@/engine/math";
import type { Item, MeshRef } from "@/engine/types";
import { makeItem } from "@/engine/workspace";
import { getServer } from "@/server/store";
import { ApiError, byHandle, cmd, mutate, need, ws } from "./bridge";
import { def, type Ctx } from "./context";
import { activeStation, writeItem } from "./cmd-items";

const SHAPE_ERROR = "Invalid shape, a 3xN (or 6xN) list of points must be provided (N must be multiple of 3)";
const DEFAULT_SHAPE_COLOR: MeshRef["color"] = [0.55, 0.62, 0.78, 1];

const isShape = (it: Item | undefined) => it?.type === "object" || it?.type === "tool";

 

def("Scale", "S", async (c) => {
  const h = await c.r.handle();
  const s = await c.r.array();
  await c.exec(async () => {
    const it = need(h);
    await cmd("object.scale", { item: it.id, scale: s.length >= 3 ? s.slice(0, 3) : (s[0] ?? 1) });
  });
});

 
def("TrScale", "IS", async (c) => {
  const h = await c.r.handle();
  const s = await c.r.array();
  const pre = await c.r.pose();
  const post = await c.r.pose();
  await c.exec(async () => {
    const it = need(h, (w) => w.int(0));
    await cmd("object.scale", { item: it.id, scale: s.length >= 3 ? s.slice(0, 3) : (s[0] ?? 1), pre, post });
    c.w.int(1);
  });
});

 

def("MergeItems", "TS", async (c) => {
  const n = await c.r.int();
  const handles: number[] = [];
  for (let i = 0; i < n; i++) handles.push(await c.r.handle());
  await c.exec(async () => {
    const items = handles.map((h) => byHandle(h)).filter((it): it is Item => !!it);
    if (!items.length) {
      writeItem(c.w, null);
      return;
    }
    if (items.length === 1) {
      writeItem(c.w, items[0]);
      return;
    }
    const res = await cmd<{ id: string }>("object.merge", { items: items.map((it) => it.id) });
    writeItem(c.w, ws().items[res.id]);
  });
});

 
def("CopyFaces", "S", async (c) => {
  const hFrom = await c.r.handle();
  const hTo = await c.r.handle();
  const pose = await c.r.pose();
  await c.exec(async () => {
    const from = need(hFrom);
    const to = need(hTo);
    await cmd("object.addGeometry", { item: to.id, from: from.id, pose });
  });
});

 

 
def("Recolor", "S", async (c) => {
  const h = await c.r.handle();
  const v = await c.r.array();
  await c.exec(async () => {
    const it = need(h);
    const tolerance = v[0] ?? 0.1;
    const from = v.length >= 5 ? v.slice(1, 5) : undefined;
    const to = v.length >= 9 ? v.slice(5, 9) : v.slice(Math.max(1, v.length - 4));
    if (to.length < 3) throw new ApiError(2, "Invalid color");
    await cmd("object.recolor", { item: it.id, to, ...(from ? { from, tolerance } : {}) });
  });
});

def("S_ShapeColor", "S", async (c) => {
  const h = await c.r.handle();
  const shape = await c.r.int();
  const color = await c.r.array();
  await c.exec(async () => {
    const it = need(h);
    if (color.length < 3) throw new ApiError(2, "Invalid color");
    await cmd("object.setShapeColor", { item: it.id, shape, color: color.slice(0, 4) });
  });
});

 
export function parseColorName(s: string): number[] | null {
  const t = s.trim().toLowerCase();
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#008000",
    lime: "#00ff00",
    blue: "#0000ff",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    gray: "#808080",
    grey: "#808080",
    orange: "#ffa500",
    transparent: "#00000000",
  };
  const hex = named[t] ?? t;
  const m = /^#([0-9a-f]+)$/.exec(hex);
  if (!m) return null;
  const d = m[1];
  const byte = (i: number, n = 2) => parseInt(d.slice(i, i + n), 16) / (n === 1 ? 15 : 255);
  if (t === "transparent") return [0, 0, 0, 0];
  if (d.length === 3) return [byte(0, 1), byte(1, 1), byte(2, 1), 1];
  if (d.length === 6) return [byte(0), byte(2), byte(4), 1];
  if (d.length === 8) return [byte(2), byte(4), byte(6), byte(0)];
  return null;
}

async function setColors(list: { h: number; color: number[] | null }[]) {
  for (const { h, color } of list) {
    const it = byHandle(h);
    if (!it) throw new ApiError(2, "Set_ColorList(): Invalid item provided");
    if (!color || color.length < 3) continue;
    const v = color.slice(0, 4).map((x) => Math.max(0, Math.min(1, x)));
    await cmd("item.setColor", { item: it.id, color: v });
  }
}

 
def("S_ColorList", "S", async (c) => {
  const n = await c.r.int();
  const list: { h: number; color: number[] | null }[] = [];
  for (let i = 0; i < n; i++) list.push({ h: await c.r.handle(), color: parseColorName(await c.r.line()) });
  await c.exec(() => setColors(list));
});

 
def("S_ColorList2", "S", async (c) => {
  const n = await c.r.int();
  const list: { h: number; color: number[] | null }[] = [];
  for (let i = 0; i < n; i++) list.push({ h: await c.r.handle(), color: await c.r.array() });
  await c.exec(() => setColors(list));
});

 

 
def("S_Hgeo2", "S", async (c) => {
  const h = await c.r.handle();
  const pose = await c.r.pose();
  const apply = await c.r.int();
  await c.exec(async () => {
    const it = need(h);
    await cmd("object.setGeometryPose", { item: it.id, pose, apply: apply !== 0 });
  });
});

 
def("S_Hgeom", "S", async (c) => {
  const h = await c.r.handle();
  const pose = await c.r.pose();
  await c.exec(async () => {
    const it = need(h);
    if (!isShape(it)) throw new ApiError(1);
    await cmd("object.setGeometryPose", { item: it.id, pose, apply: false });
  });
});

def("G_Hgeom", "HS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = need(h, (w) => w.pose(eye()));
    if (!isShape(it)) {
      c.w.pose(eye());
      return;
    }
    const res = await cmd<{ pose: Mat }>("object.geometryPose", { item: it.id });
    c.w.pose(res.pose);
  });
});

 

export interface ShapeIn {
  rows: number;
  cols: number;
  data: number[];
  color: number[];
}

 
function shapeMesh(s: ShapeIn): MeshRef {
  const store = getServer().services.geometry;
  const n = s.cols - (s.cols % 3);
  const tri = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) tri[k * 3 + j] = s.data[k * s.rows + j];
  const mesh: MeshRef = {
    geometry: store.put(tri),
    color: s.color.length >= 3 ? [s.color[0], s.color[1], s.color[2], s.color[3] ?? 1] : [...DEFAULT_SHAPE_COLOR],
  };
  if (s.rows >= 6) {
    const nrm = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) nrm[k * 3 + j] = s.data[k * s.rows + 3 + j];
    mesh.normals = store.put(nrm);
  }
  return mesh;
}






export async function addShapes(addTo: Item | undefined, override: boolean, shapes: ShapeIn[]): Promise<Item | null> {
  for (const s of shapes) if (s.rows < 3 || s.cols < 3) throw new ApiError(2, SHAPE_ERROR, (w) => w.nullItem());
  if (addTo && !isShape(addTo)) return null;
  const meshes = shapes.map(shapeMesh);
  return mutate((w, tx) => {
    if (!addTo) {
      const it = makeItem(w, "object", "Shape", { object: { meshes } });
      tx.add(it, activeStation().id);
      return it;
    }
    const cur = w.items[addTo.id];
    const old = (cur.type === "tool" ? cur.tool?.meshes : cur.object?.meshes) ?? [];
    const next = override ? meshes : [...old, ...meshes];
    tx.set(cur.id, cur.type === "tool" ? { tool: { ...cur.tool!, meshes: next } } : { object: { ...cur.object!, meshes: next } });
    return w.items[cur.id];
  });
}

def("AddShape2", "TS", async (c) => {
  const pts = await c.r.matrix();
  const h = await c.r.handle();
  const override = await c.r.int();
  await c.exec(async () => {
    const addTo = h ? need(h) : undefined;
    writeItem(c.w, await addShapes(addTo, override !== 0, [{ ...pts, color: [] }]));
  });
});

 
def("AddShape3", "TS", async (c) => {
  const pts = await c.r.matrix();
  const h = await c.r.handle();
  const override = await c.r.int();
  const color = await c.r.array();
  await c.exec(async () => {
    const addTo = h ? need(h) : undefined;
    writeItem(c.w, await addShapes(addTo, override !== 0, [{ ...pts, color }]));
  });
});

async function addShapeList(c: Ctx, floats: boolean) {
  const h = await c.r.handle();
  const override = await c.r.int();
  const n = await c.r.int();
  const shapes: ShapeIn[] = [];
  for (let i = 0; i < n; i++) {
    const m = floats ? await c.r.matrixF() : await c.r.matrix();
    const color = floats ? await c.r.arrayF() : await c.r.array();
    shapes.push({ ...m, color });
  }
  await c.exec(async () => {
    const addTo = h ? need(h) : undefined;
    writeItem(c.w, await addShapes(addTo, override !== 0, shapes));
  });
}

 
def("AddShape4", "TS", (c) => addShapeList(c, false));
def("AddShape5", "TS", (c) => addShapeList(c, true));

 

 
def("IsInside", "IS", async (c) => {
  const hIn = await c.r.handle();
  const hOut = await c.r.handle();
  await c.exec(async () => {
    const inner = byHandle(hIn);
    const outer = byHandle(hOut);
    const ok = inner && outer && isShape(outer) && (inner.type === "object" || inner.type === "tool" || inner.type === "target");
    if (!ok) throw new ApiError(1, "", (w) => w.int(-1));
    const res = await cmd<{ inside: boolean }>("object.isInside", { inner: inner.id, outer: outer.id });
    c.w.int(res.inside ? 1 : 0);
  });
});

 

 
function faceNormals(tri: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 < tri.length; i += 9) {
    const u = [tri[i + 3] - tri[i], tri[i + 4] - tri[i + 1], tri[i + 5] - tri[i + 2]];
    const v = [tri[i + 6] - tri[i], tri[i + 7] - tri[i + 1], tri[i + 8] - tri[i + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++) out.push(n[0] / l, n[1] / l, n[2] / l);
  }
  return out;
}






def("G_Gen_Mat", "IS", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  await c.r.matrix();
  await c.exec(() => {
    const it = byHandle(h);
    const key = name.trim();
    if (key === "Meshes" && it?.type === "object") {
      const store = getServer().services.geometry;
      const meshes = it.object?.meshes ?? [];
      c.w.int(meshes.length * 2);
      for (const m of meshes) {
        c.w.matrix(4, 1, [...m.color]);
        const tri = store.get(m.geometry) ?? new Float32Array(0);
        const nrm = m.normals ? store.get(m.normals) : undefined;
        const normals = nrm && nrm.length === tri.length ? Array.from(nrm) : faceNormals(tri);
        const nv = Math.floor(tri.length / 3);
        const data: number[] = [];
        for (let k = 0; k < nv; k++) data.push(tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2], normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]);
        c.w.matrix(6, nv, data);
      }
      return;
    }
    if (key === "ProgSlider") throw new ApiError(2, "Invalid item or no slider open", (w) => w.int(0));
    throw new ApiError(2, `Unknown generic parameter ${name}`, (w) => w.int(0));
  });
});
