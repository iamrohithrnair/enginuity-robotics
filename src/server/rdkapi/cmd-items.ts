 

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Tx } from "@/engine/tx";
import type { Item, Workspace } from "@/engine/types";
import { allocHandle, descendants, makeItem, newId } from "@/engine/workspace";
import { snapshotStation } from "@/engine/commands/station";
import { isStationFile, stationFileName } from "@/engine/stationFile";
import { getStationParam, stationParamList } from "@/engine/stationParams";
import { DATA_DIR, getServer } from "@/server/store";
import { ApiError, byHandle, cmd, itemByName, matchesType, mutate, need, stationItems, typeCode, ws } from "./bridge";
import type { WireWriter } from "./codec";
import { apiState, def } from "./context";

export const writeItem = (w: WireWriter, it: Item | undefined | null) => (it ? w.item(it.handle, typeCode(it)) : w.nullItem());

 
export function activeStation(): Item {
  const w = ws();
  const st = w.activeStation ? w.items[w.activeStation] : undefined;
  if (!st) throw new ApiError(3, "No active station");
  return st;
}

 
export function created(res: { id?: unknown } | null | undefined): Item {
  const id = typeof res?.id === "string" ? res.id : undefined;
  const it = id ? ws().items[id] : undefined;
  if (!it) throw new ApiError(3, "Item was not created");
  return it;
}

 

def("NewStation", "TS", async (c) => {
  const name = await c.r.line();
  await c.exec(async () => {
     
    const res = await cmd("station.new", { name });
    writeItem(c.w, created(res));
  });
});

def("G_ActiveStn", "TS", async (c) => {
  await c.exec(() => {
    writeItem(c.w, activeStation());
  });
});

def("S_ActiveStn", "S", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    const st = need(h);
    if (st.type !== "station") throw new ApiError(1);
    await cmd("station.setActive", { station: st.id });
  });
});

def("G_AllStn", "IS", async (c) => {
  await c.exec(() => {
    const w = ws();
    const sts = w.stations.map((s) => w.items[s]).filter(Boolean);
    c.w.int(sts.length);
    for (const st of sts) writeItem(c.w, st);
  });
});

def("RemoveStn", "S", async (c) => {
  await c.exec(async () => {
    await cmd("station.close", { station: activeStation().id });
  });
});

 

function listReply(c: { w: WireWriter }, items: Item[], names: boolean) {
  c.w.int(items.length);
  for (const it of items) {
    if (names) c.w.line(it.name);
    else writeItem(c.w, it);
  }
}

def("G_List_Items", "IS", async (c) => {
  await c.exec(() => listReply(c, stationItems(), true));
});

def("G_List_Items_ptr", "IS", async (c) => {
  await c.exec(() => listReply(c, stationItems(), false));
});

def("G_List_Items_Type", "IS", async (c) => {
  const type = await c.r.int();
  await c.exec(() => listReply(c, stationItems().filter((it) => matchesType(it, type)), true));
});

def("G_List_Items_Type_ptr", "IS", async (c) => {
  const type = await c.r.int();
  await c.exec(() => listReply(c, stationItems().filter((it) => matchesType(it, type)), false));
});

def("G_Item", "TS", async (c) => {
  const name = await c.r.line();
  await c.exec(() => {
     
    writeItem(c.w, itemByName(name));
  });
});

def("G_Item2", "TS", async (c) => {
  const name = await c.r.line();
  const type = await c.r.int();
  await c.exec(() => {
    writeItem(c.w, itemByName(name, type));
  });
});

def("G_Item_Type", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
     
     
    c.w.int(typeCode(byHandle(h)));
  });
});

def("G_Name", "LS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h, (w) => w.line("(unavailable)"));
    c.w.line(it.name);
  });
});

def("S_Name", "S", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  await c.exec(async () => {
    const it = need(h);
     
    await cmd("item.rename", { item: it.id, name });
  });
});

def("G_Parent", "TS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    writeItem(c.w, it.parent ? ws().items[it.parent] : undefined);
  });
});

def("G_Childs", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
     
    const kids = it.children.map((k) => ws().items[k]).filter((k) => k && k.type !== "instruction");
    c.w.int(kids.length);
    for (const k of kids) writeItem(c.w, k);
  });
});

async function setParent(c: Parameters<Parameters<typeof def>[2]>[0], keepAbsolute: boolean) {
  const h = await c.r.handle();
  const hp = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    const parent = need(hp);
     
    await cmd("item.setParent", { item: it.id, parent: parent.id, keepAbsolute });
  });
}

def("S_Parent", "S", (c) => setParent(c, false));
def("S_Parent_Static", "S", (c) => setParent(c, true));

def("G_Visible", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.int(need(h).visible ? 1 : 0);
  });
});











export function frameDisplayParams(it: Item, vf: number): Record<string, string> | null {
  const on = vf >= 1 || vf <= -3 ? "1" : "0";
  if (it.type === "object") return { ShowFrame: on };
  if (it.type === "tool") return { ShowTCP: on };
  if (it.type !== "robot") return null;
  if (vf === -3 || vf === -2) {
    const v = vf === -3 ? "1" : "0";
    return { ShowFrame: v, ShowFlange: v, ShowToolFrame: v };
  }
  if (vf < 0) return null;
  const b0 = vf & 1 ? "1" : "0";
  return { ShowFrame: b0, ShowFlange: b0, ShowToolFrame: b0, ShowLinks: String(vf >>> 0) };
}

async function setVisibleFlags(it: Item, visible: number, vf: number) {
   
  await cmd("item.setVisible", { items: [it.id], visible: visible !== 0 });
  const params = frameDisplayParams(it, vf);
  if (params) {
    await mutate((w, tx) => {
      const cur = w.items[it.id];
      if (cur) tx.set(it.id, { params: { ...(cur.params ?? {}), ...params } });
    });
  }
}

def("S_Visible", "S", async (c) => {
  const h = await c.r.handle();
  const visible = await c.r.int();
  const vf = await c.r.int();
  await c.exec(async () => {
    await setVisibleFlags(need(h), visible, vf);
  });
});

 
 
def("S_VisibleList", "S", async (c) => {
  const n = await c.r.int();
  const rows: [number, number, number][] = [];
  for (let i = 0; i < n; i++) rows.push([await c.r.handle(), await c.r.int(), await c.r.int()]);
  await c.exec(async () => {
    for (const [h, visible, vf] of rows) {
      const it = byHandle(h);
      if (it) await setVisibleFlags(it, visible, vf);
    }
  });
});

const DEFAULT_COLOR = [0.55, 0.62, 0.78, 1];

def("G_Color", "AS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    const col = it.color ?? it.object?.meshes[0]?.color ?? it.tool?.meshes[0]?.color ?? it.robot?.links.flat()[0]?.color ?? DEFAULT_COLOR;
    c.w.array([...col]);
  });
});

def("S_Color", "S", async (c) => {
  const h = await c.r.handle();
  const col = await c.r.array();
  await c.exec(async () => {
    const it = need(h);
    const v = col.slice(0, 4).map((x) => Math.max(0, Math.min(1, x)));
    while (v.length < 3) v.push(0);
    await cmd("item.setColor", { item: it.id, color: v });
  });
});

 

def("Add_FRAME", "TS", async (c) => {
  const name = await c.r.line();
  const hp = await c.r.handle();
  await c.exec(async () => {
    const parent = hp ? need(hp).id : undefined;
     
    const res = await cmd("item.addFrame", { name: name === "" ? undefined : name, parent });
    writeItem(c.w, created(res));
  });
});

let localFilesPatched = false;






function ensureLocalFiles() {
  if (localFilesPatched) return;
  const lib = getServer().services.library;
  if (!lib) return;
  const original = lib.load.bind(lib);
  lib.load = async (file, kind) => {
    if (path.isAbsolute(file) && existsSync(file)) {
      return { bytes: new Uint8Array(readFileSync(file)), url: `file://${file}` };
    }
    return original(file, kind);
  };
  localFilesPatched = true;
}

def("Add", "TS", async (c) => {
  const file = await c.r.line();
  const hp = await c.r.handle();
  await c.exec(async () => {
    const full = path.resolve(file);
    if (!existsSync(full)) throw new ApiError(2, `File doesn't exist: ${file}`);
    const parent = hp ? need(hp) : undefined;
    const ext = path.extname(full).toLowerCase();
    if (isStationFile(full)) {
      const res = await cmd<{ id?: string; station?: string }>("station.open", { path: full });
      const st = ws().items[(res.id ?? res.station ?? "") as string] ?? activeStation();
      writeItem(c.w, st);
      return;
    }
    if (ext === ".rdk" || ext === ".rdka") {
       
      const bytes = readFileSync(full);
      const res = await cmd<{ id?: string; station?: string }>("station.openRdk", { base64: bytes.toString("base64"), name: path.basename(full).replace(/\.rdka?$/i, "") });
      const st = ws().items[(res.id ?? res.station ?? "") as string] ?? activeStation();
      writeItem(c.w, st);
      return;
    }
    if (ext === ".py") {
       
      const res = await cmd("python.add", { name: path.basename(full).replace(/\.py$/i, ""), code: readFileSync(full, "utf8") });
      writeItem(c.w, created(res));
      return;
    }
    ensureLocalFiles();
    const kind = ext === ".robot" ? "robot" : ext === ".tool" ? "tool" : "object";
    const params: Record<string, unknown> = { file: full, kind };
    if (parent) {
      if (kind === "tool") {
        if (parent.type === "robot") params.robot = parent.id;
      } else params.parent = parent.id;
    }
    const res = await cmd("library.load", params);
    const it = created(res);
     
    const stem = path.basename(full).replace(/\.[^.]+$/, "");
    if (kind !== "robot" && it.name.includes("/")) {
      await mutate((w, tx) => {
        if (w.items[it.id]) tx.set(it.id, { name: stem });
      });
    }
    writeItem(c.w, it);
  });
});

 
def("Add_MACHINING", "TS", async (c) => {
  const name = await c.r.line();
  const hr = await c.r.handle();
  await c.exec(async () => {
    const robot = hr ? need(hr) : undefined;
    const st = activeStation();
    const it = await mutate((w, tx) => {
      const m = makeItem(w, "machining", name, { params: robot ? { Robot: String(robot.handle) } : {} });
      tx.add(m, st.id);
      return m;
    });
    writeItem(c.w, it);
  });
});

 

def("Copy2", "S", async (c) => {
  const h = await c.r.handle();
  const copyChilds = await c.r.int();
  await c.exec(() => {
    const it = need(h);
    const w = ws();
    const items = [structuredClone(it)];
    if (copyChilds) items.push(...descendants(w, it.id).map((d) => structuredClone(d)));
    else items[0].children = [];
    apiState().copyBuffer = { roots: [it.id], items };
  });
});

 
function pasteOnce(w: Workspace, tx: Tx, parentId: string): Item[] {
  const buf = apiState().copyBuffer;
  if (!buf) return [];
  const byId = new Map(buf.items.map((i) => [i.id, i]));
  const map = new Map<string, string>();
  for (const i of buf.items) map.set(i.id, newId(i.type.slice(0, 3)));
  const remap = (id: string | null | undefined) => (id && map.has(id) ? map.get(id)! : id ?? null);
  const out: Item[] = [];
  const cloneRec = (srcId: string, parent: string) => {
    const src = byId.get(srcId)!;
    const copy: Item = structuredClone(src);
    copy.id = map.get(src.id)!;
    copy.handle = allocHandle(w);
    copy.children = [];
    if (copy.target) copy.target = { ...copy.target, robot: remap(copy.target.robot) };
    if (copy.program) copy.program = { ...copy.program, robot: remap(copy.program.robot) };
    if (copy.robot) copy.robot = { ...copy.robot, activeTool: remap(copy.robot.activeTool), activeFrame: remap(copy.robot.activeFrame) };
    if (copy.instruction) {
      const ins = copy.instruction;
      copy.instruction = { ...ins, target: remap(ins.target), target2: remap(ins.target2), frame: remap(ins.frame), tool: remap(ins.tool), robot: remap(ins.robot) };
    }
    tx.add(copy, parent);
    for (const k of src.children) if (byId.has(k)) cloneRec(k, copy.id);
    return copy;
  };
  for (const r of buf.roots) if (byId.has(r)) out.push(cloneRec(r, parentId));
  return out;
}

function pasteTarget(hp: number): string {
  const st = activeStation();
  if (!hp) return st.id;
  const p = need(hp);
   
  if (p.type === "program" || p.type === "instruction") return st.id;
  return p.id;
}

function checkStationPaste(parentId: string) {
  const buf = apiState().copyBuffer;
  const root = buf?.items.find((i) => i.id === buf.roots[0]);
  if (root?.type === "station" && ws().items[parentId]?.type !== "station") {
    throw new ApiError(3, "A station can only be pasted to another station");
  }
}

def("Paste", "TS", async (c) => {
  const hp = await c.r.handle();
  await c.exec(async () => {
    const parentId = pasteTarget(hp);
    checkStationPaste(parentId);
    const items = await mutate((w, tx) => pasteOnce(w, tx, parentId));
    writeItem(c.w, items[0]);
  });
});

def("PastN", "IS", async (c) => {
  const hp = await c.r.handle();
  const n = await c.r.int();
  await c.exec(async () => {
    const parentId = pasteTarget(hp);
    checkStationPaste(parentId);
    const items = await mutate((w, tx) => {
      const all: Item[] = [];
      for (let i = 0; i < Math.max(0, n); i++) all.push(...pasteOnce(w, tx, parentId));
      return all;
    });
    c.w.int(items.length);
    for (const it of items) writeItem(c.w, it);
  });
});

 

async function deleteItems(items: Item[]) {
  const stations = items.filter((i) => i.type === "station");
  const others = items.filter((i) => i.type !== "station");
  if (others.length) await cmd("item.delete", { items: others.map((i) => i.id) });
   
  for (const st of stations) await cmd("station.close", { station: st.id });
  for (const it of items) apiState().insRef.delete(it.id);
}

def("Remove", "S", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    await deleteItems([need(h)]);
  });
});

def("RemoveLst", "S", async (c) => {
  const n = await c.r.int();
  const hs: number[] = [];
  for (let i = 0; i < n; i++) hs.push(await c.r.handle());
  await c.exec(async () => {
    const items = hs.map((h) => byHandle(h)).filter((i): i is Item => !!i);
    if (items.length !== hs.length) throw new ApiError(1);
    await deleteItems(items);
  });
});

 

def("G_Selection", "IS", async (c) => {
  await c.exec(() => {
    const w = ws();
    const sel = w.selection.map((s) => w.items[s]).filter(Boolean);
    c.w.int(sel.length);
    for (const it of sel) writeItem(c.w, it);
  });
});

def("S_Selection", "S", async (c) => {
  const n = await c.r.int();
  const hs: number[] = [];
  for (let i = 0; i < n; i++) hs.push(await c.r.handle());
  await c.exec(async () => {
    const ids = hs.map((h) => byHandle(h)?.id).filter((x): x is string => !!x);
    await cmd("edit.select", { items: ids, mode: "replace" });
  });
});

 

 
function builtinParam(name: string): string | undefined {
  switch (name) {
    case "PATH_LIBRARY": {
      const dir = path.join(DATA_DIR, "library");
      mkdirSync(dir, { recursive: true });
      return `${dir}/`;
    }
    case "PATH_OPENSTATION":
      return path.join(DATA_DIR, "stations");
    case "FILE_OPENSTATION":
      return stationFileName(activeStation().name);
    case "PATH_DESKTOP":
      return path.join(os.homedir(), "Desktop");
    default:
      return undefined;
  }
}

def("G_Param", "LS", async (c) => {
  const name = await c.r.line();
  return c.exec(() => {
     
    const v = builtinParam(name) ?? getStationParam(ws(), name);
    if (v === undefined) {
       
      c.w.line(`UNKNOWN ${name}`);
      c.w.status(2, `Invalid/unknown parameter to get: ${name}`);
      return "raw" as const;
    }
    c.w.line(v);
    return undefined;
  });
});

def("S_Param", "S", async (c) => {
  const name = await c.r.line();
  const value = await c.r.line();
  await c.exec(async () => {
    await cmd("station.setParam", { key: name, value });
  });
});

def("G_Params", "IS", async (c) => {
  await c.exec(() => {
    const entries = stationParamList(ws());
    c.w.int(entries.length);
    for (const [k, v] of entries) c.w.line(k).line(v);
  });
});

function stationData(): Map<string, Buffer> {
  const st = activeStation().id;
  const all = apiState().dataParams;
   
  if (!all.has(st)) all.set(st, new Map((activeStation().rdk?.dataParams ?? []).map(([k, v]) => [k, Buffer.from(v, "base64")] as [string, Buffer])));
  return all.get(st)!;
}

def("G_DataParam", "BS", async (c) => {
  const name = await c.r.line();
  await c.exec(() => {
    c.w.bytes(stationData().get(name) ?? Buffer.alloc(0));
  });
});

def("S_DataParam", "S", async (c) => {
  const name = await c.r.line();
  const data = await c.r.bytes();
  await c.exec(() => {
    stationData().set(name, data);
  });
});

def("G_ItmDataParam", "BS", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  await c.exec(() => {
    const it = need(h);
    c.w.bytes(apiState().itemData.get(it.id)?.get(name) ?? Buffer.alloc(0));
  });
});

def("S_ItmDataParam", "S", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const data = await c.r.bytes();
  await c.exec(() => {
    const it = need(h);
    const all = apiState().itemData;
    if (!all.has(it.id)) all.set(it.id, new Map());
    all.get(it.id)!.set(name, data);
  });
});

def("G_Item_Rights", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.int(apiState().itemFlags.get(need(h).id) ?? -1);
  });
});

def("S_Item_Rights", "S", async (c) => {
  const h = await c.r.handle();
  const flags = await c.r.int();
  await c.exec(() => {
    apiState().itemFlags.set(need(h).id, flags);
  });
});

 
const setAppRights: Parameters<typeof def>[2] = async (c) => {
  const flags = await c.r.int();
  await c.exec(() => {
    apiState().rdkFlags = flags;
  });
};
def("S_App_Rights", "S", setAppRights);
 
def("S_RoboDK_Rights", "S", setAppRights);

 

def("Save", "S", async (c) => {
  const file = await c.r.line();
  const h = await c.r.handle();
  await c.exec(() => {
    const st = h ? need(h) : activeStation();
    const station = st.type === "station" ? st : activeStation();
    const target = path.resolve(file);
    mkdirSync(path.dirname(target), { recursive: true });
     
    writeFileSync(target, JSON.stringify(snapshotStation(ws(), station.id)));
  });
});
