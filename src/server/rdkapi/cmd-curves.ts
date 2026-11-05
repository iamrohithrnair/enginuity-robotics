// Handles API curve geometry, projection and machining-project commands.
 
 
 
 
 
 
 
 
 
 

import { readFileSync } from "node:fs";
import { objectCurves, objectPoints } from "@/engine/curves";
import { addGeometry, FEATURE, getSelectedFeature, projectOnObject } from "@/engine/commands/curves";
import { createProject, machiningOf, openNcProgram, requireProject, setProjectInput, updateProject } from "@/engine/commands/machining";
import { MachiningError } from "@/engine/machining/project";
import { mergeParams, ncProjectNames, num } from "@/engine/machining/settings";
import type { Item } from "@/engine/types";
import { getServer } from "@/server/store";
import { ApiError, byHandle, mutate, need, ws } from "./bridge";
import { activeStation, writeItem } from "./cmd-items";
import { COMMANDS, def } from "./context";

const services = () => getServer().services;

 
function matrixRows(m: { rows: number; cols: number; data: number[] }): number[][] {
  if (m.rows < 3) return [];
  const out: number[][] = [];
  for (let j = 0; j < m.cols; j++) out.push(m.data.slice(j * m.rows, j * m.rows + Math.min(m.rows, 6)));
  return out;
}

 
function rowsMatrix(rows: number[][]): [number, number, number[]] {
  if (!rows.length) return [0, 0, []];
  return [6, rows.length, rows.flatMap((r) => [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0, r[4] ?? 0, r[5] ?? 0])];
}

function refObject(h: number): Item | undefined {
  if (!h) return undefined;
  const it = need(h);
  if (it.type !== "object") throw new ApiError(3, "Invalid item provided: the reference must be an object");
  return it;
}

 
function addOne(kind: "curve" | "points", ref: Item | undefined, points: number[][], addToRef: boolean, projection: number): Promise<Item> {
  return mutate((w, tx) => addGeometry({ ws: w, tx, services: services() }, kind, { object: ref?.id, points, addToRef, projection }));
}

def("AddWire", "TS", async (c) => {
  const m = await c.r.matrix();
  const h = await c.r.handle();
  const addToRef = (await c.r.int()) > 0;
  const projection = await c.r.int();
  await c.exec(async () => {
    const it = await addOne("curve", refObject(h), matrixRows(m), addToRef, projection);
    writeItem(c.w, it);
  });
});

def("AddWir2", "TS", async (c) => {
  const h = await c.r.handle();
  const addToRef = (await c.r.int()) > 0;
  const projection = await c.r.int();
  const n = await c.r.int();
  const list: number[][][] = [];
  for (let i = 0; i < n; i++) list.push(matrixRows(await c.r.matrix()));
  await c.exec(async () => {
    const ref = refObject(h);
     
     
    const first = await addOne("curve", ref, list[0] ?? [], addToRef, projection);
    for (const pts of list.slice(1)) {
      if (ref && !addToRef) await addOne("curve", first, projectOnObject({ ws: ws(), services: services() }, ref.id, pts, projection), true, 0);
      else await addOne("curve", first, pts, true, addToRef ? projection : 0);
    }
    writeItem(c.w, ws().items[first.id]);
  });
});

def("AddPoints", "TS", async (c) => {
  const m = await c.r.matrix();
  const h = await c.r.handle();
  const addToRef = (await c.r.int()) > 0;
  const projection = await c.r.int();
  await c.exec(async () => {
    const it = await addOne("points", refObject(h), matrixRows(m), addToRef, projection);
    writeItem(c.w, it);
  });
});

def("ProjectPoints", "MS", async (c) => {
  const m = await c.r.matrix();
  const h = await c.r.handle();
  const projection = await c.r.int();
  await c.exec(() => {
    const obj = need(h);
    const rows = matrixRows(m);
     
    const out = projectOnObject({ ws: ws(), services: services() }, obj.id, rows, projection);
    const [r, k, data] = rowsMatrix(out);
    c.w.matrix(r, k, data);
  });
});

def("G_ObjPoint", "MLS", async (c) => {
  const h = await c.r.handle();
  const type = await c.r.int();
  const id = await c.r.int();
  await c.exec(() => {
    if (type >= 10) {
       
      if (type === 10) c.w.matrix(0, 0, []);
      c.w.nullItem().int(0).int(0).int(0).line("");
      return;
    }
    const obj = need(h);
    let rows: number[][] = [];
    let name = "";
    if (type === FEATURE.CURVE) {
      const cv = objectCurves(obj)[id];
      if (cv) {
        rows = cv.points;
        name = cv.name ?? "";
      } else name = "Invalid curve id";
    } else if (type === FEATURE.POINT) {
      rows = objectPoints(obj).map((p) => [p[0], p[1], p[2], 0, 0, 0]);
      name = obj.object?.pointNames?.[id] ?? "";
    }
    const [r, k, data] = rowsMatrix(rows);
    c.w.matrix(r, k, data).line(name);
  });
});

def("G_ObjCurves", "IS", async (c) => {
  const h = await c.r.handle();
  await c.r.int();  
  await c.exec(() => {
    const curves = objectCurves(need(h));
    c.w.int(curves.length);
    for (const cv of curves) {
      const [r, k, data] = rowsMatrix(cv.points);
      c.w.matrix(r, k, data).line(cv.name ?? "");
    }
  });
});

def("G_ObjSelection", "IIIS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const sel = getSelectedFeature(need(h).id);
    c.w.int(sel ? 1 : 0).int(sel?.type ?? 0).int(sel?.id ?? 0);
  });
});

def("S_CurveColor", "S", async (c) => {
  const h = await c.r.handle();
  const id = await c.r.int();
  const color = await c.r.array();
  await c.exec(async () => {
    const obj = need(h);
    await mutate((w, tx) => {
      const cur = w.items[obj.id];
      const rgba = [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 1] as [number, number, number, number];
      const curves = objectCurves(cur).map((cv, i) => (id < 0 || i === id ? { ...cv, color: rgba } : cv));
      tx.set(cur.id, { object: { meshes: [], ...cur.object, curves } });
    });
  });
});

 

def("Add_MACHINING", "TS", async (c) => {
  const name = await c.r.line();
  const hr = await c.r.handle();
  await c.exec(async () => {
    const robot = hr ? need(hr) : undefined;
    activeStation();
    const it = await mutate((w, tx) => createProject({ ws: w, tx, services: services() }, "machining", { name, robot: robot ?? undefined }));
    writeItem(c.w, it);
  });
});

 
function parseParamString(s: string): { settings: Record<string, string>; noUpdate: boolean; normal?: number } {
  const settings: Record<string, string> = {};
  let noUpdate = false;
  let normal: number | undefined;
  for (const tok of s.split(/[\s;]+/).filter(Boolean)) {
    const [k, v] = tok.split("=");
    if (/^No_?Update$/i.test(k)) noUpdate = true;
    else if (/^NormalApproach$/i.test(k)) normal = Number(v);
    else if (v !== undefined) settings[k] = v;
  }
  return { settings, noUpdate, normal };
}

const PARAM_KEYS: Record<string, string> = {
  Optim_Turntable: "TurntableActive",
  Offset_Turntable: "TurntableOffset",
  Optim_Rail: "TrackActive",
  Offset_Rail: "TrackOffset",
};

def("S_MachiningParams", "TIS", async (c) => {
  const hp = await c.r.handle();
  const ncfile = await c.r.line();
  const hpart = await c.r.handle();
  const params = await c.r.line();
  await c.exec(async () => {
    const proj = need(hp);
    if (proj.type !== "machining") throw new ApiError(3, "Invalid item provided: not a machining project");
    const opts = parseParamString(params);
    const extra: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(opts.settings)) extra[PARAM_KEYS[k] ?? k] = /^(yes|true)$/i.test(v) ? 1 : /^(no|false)$/i.test(v) ? 0 : Number.isFinite(Number(v)) ? Number(v) : v;
    let result: { program: Item | null; ratio: number } = { program: null, ratio: 0 };
    try {
      result = await mutate((w, tx) => {
        const ctx = { ws: w, tx, services: services() };
        const m = machiningOf(w.items[proj.id]);
        tx.set(proj.id, {
          machining: {
            ...m,
            settings: mergeParams(m.settings, extra),
            ...(opts.normal !== undefined && Number.isFinite(opts.normal) ? { approach: `Normal ${opts.normal}`, retract: `Normal ${opts.normal}` } : {}),
          },
        });
        if (ncfile) {
          let text: string;
          try {
            text = readFileSync(ncfile, "utf8");
          } catch {
            throw new ApiError(3, `Failed to open file: <br>${ncfile}`);
          }
          if (!opts.noUpdate) {
            const names = ncProjectNames(ncfile);
            const r = openNcInProject(ctx, w.items[proj.id], ncfile, text, names.program);
            return r;
          }
          setProjectInput(ctx, w.items[proj.id], { nc: { file: ncfile, text } });
          return { program: null, ratio: 0 };
        }
        const part = hpart ? byHandle(hpart) : undefined;
        if (part) setProjectInput(ctx, w.items[proj.id], { object: part });
        if (opts.noUpdate) return { program: null, ratio: 0 };
        const r = updateProject(ctx, w.items[proj.id]);
        return { program: r.program, ratio: r.ratio };
      });
    } catch (e) {
      if (e instanceof MachiningError) throw new ApiError(3, e.message);
      throw e;
    }
    writeItem(c.w, result.program ? ws().items[result.program.id] : null);
    c.w.int(Math.round(result.ratio * 1000));
  });
});

 
function openNcInProject(ctx: Parameters<typeof updateProject>[0], proj: Item, file: string, text: string, programName: string) {
  setProjectInput(ctx, proj, { nc: { file, text } });
  const m = machiningOf(ctx.ws.items[proj.id]);
  if (!m.program) {
    const existing = Object.values(ctx.ws.items).find((i) => i.type === "program" && i.name === programName);
    if (existing) ctx.tx.set(proj.id, { machining: { ...m, program: existing.id } });
  }
  const r = updateProject(ctx, ctx.ws.items[proj.id]);
  if (!m.program && r.program.name !== programName) ctx.tx.set(r.program.id, { name: programName });
  return { program: ctx.ws.items[r.program.id], ratio: r.ratio };
}

 

 
async function machiningItemCommand(it: Item, name: string, value: string): Promise<string | undefined> {
  if (it.type === "object" || it.type === "tool") {
    if (name === "DeleteCurves" || (name === "Clear" && /^curve/i.test(value)) || (name === "Reset" && /^curve/i.test(value))) {
      await mutate((w, tx) => tx.set(it.id, { object: { meshes: [], ...w.items[it.id].object, curves: [] }, ...(w.items[it.id].curve ? { curve: undefined } : {}) }));
      return "OK";
    }
    if ((name === "Clear" && /^point/i.test(value)) || (name === "Reset" && /^point/i.test(value))) {
      await mutate((w, tx) => tx.set(it.id, { object: { meshes: [], ...w.items[it.id].object, points: [], pointNames: {} } }));
      return "OK";
    }
    return undefined;
  }
  if (it.type !== "machining") return undefined;
  const m = machiningOf(it);
  const json = (v: Record<string, unknown>) => JSON.stringify(v);
  const setSettings = (patch: Record<string, number | string | boolean>) =>
    mutate((w, tx) => {
      const cur = machiningOf(w.items[it.id]);
      tx.set(it.id, { machining: { ...cur, settings: { ...cur.settings, ...patch } } });
    });
  const autoUpdate = async () => {
    const cur = machiningOf(ws().items[it.id]);
    if (num(cur.settings.AutoUpdate) && cur.input) await mutate((w, tx) => updateProject({ ws: w, tx, services: services() }, w.items[it.id]));
  };
  switch (name) {
    case "Machining":
    case "ProgEvents":
    case "OptimAxes": {
      const field = name === "Machining" ? "settings" : name === "ProgEvents" ? "events" : "optimAxes";
      if (value === "") return json(m[field]);
      await mutate((w, tx) => {
        const cur = machiningOf(w.items[it.id]);
        tx.set(it.id, { machining: { ...cur, [field]: mergeParams(cur[field], value) } });
      });
      await autoUpdate();
      return "OK";
    }
    case "Approach":
    case "Retract":
    case "ApproachRetract": {
      if (value === "") return name === "Retract" ? m.retract : m.approach;
      await mutate((w, tx) => {
        const cur = machiningOf(w.items[it.id]);
        tx.set(it.id, { machining: { ...cur, ...(name !== "Retract" ? { approach: value } : {}), ...(name !== "Approach" ? { retract: value } : {}) } });
      });
      return "OK";
    }
    case "UpdatePath":
      await mutate((w, tx) => updateProject({ ws: w, tx, services: services() }, w.items[it.id]));
      return "OK";
    case "NormalApproach":
      await mutate((w, tx) => tx.set(it.id, { machining: { ...machiningOf(w.items[it.id]), approach: `Normal ${Number(value)}`, retract: `Normal ${Number(value)}` } }));
      return "OK";
    case "PathDisplay":
      if (value === "") return String(m.settings.PathDisplay ?? "Estimated");
      await setSettings({ PathDisplay: value.split(/[\s,]+/)[0] });
      return "OK";
    default: {
      const key = { PointApproach: "PointApproach", OperationSpeed: "SpeedOperation", RangeRotZ: "RotZ_Range", StepRotZ: "RotZ_Step", JoinCurveTol: "JoinCurvesTol", ApproachRetractAllCurves: "ApproachRetractAll", SelectAlgorithm: "Algorithm", OptimRail: "TrackActive", OptimTurntable: "TurntableActive", OffsetRail: "TrackOffset", OffsetTurntable: "TurntableOffset" }[name];
      if (!key) return undefined;
      if (value === "") return String(m.settings[key] ?? "");
      await setSettings({ [key]: Number(value) });
      await autoUpdate();
      return "OK";
    }
  }
}

 
const baseICMD = COMMANDS.get("ICMD");
def("ICMD", "LS", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const value = await c.r.line();
  const it = byHandle(h);
  if (it && (it.type === "machining" || it.type === "object" || it.type === "tool")) {
    let answer: string | undefined;
    try {
      answer = await c.exec(() => machiningItemCommand(it, name, value));
    } catch (e) {
      if (e instanceof MachiningError) throw new ApiError(3, e.message);
      throw e;
    }
    if (answer !== undefined) {
      c.w.line(answer);
      return;
    }
  }
  if (!baseICMD) throw new ApiError(3, "Unknown item command");
  const replay = [name, value];
  const reader = Object.create(c.r) as typeof c.r;
  reader.handle = async () => h;
  reader.line = async () => replay.shift() ?? "";
  return baseICMD.run({ ...c, r: reader });
});

export { openNcProgram, requireProject };
