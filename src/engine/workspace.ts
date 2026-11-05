// Manages station items, hierarchy traversal and robot-relative coordinate transforms.
 

import { eye, inv, mul, type Mat } from "./math";
import { fk, kinematicsReady } from "./kinematics";
import type { Item, ItemType, Workspace } from "./types";

let idCounter = 0;
export function newId(prefix = "i"): string {
  idCounter = (idCounter + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createWorkspace(): Workspace {
  return {
    rev: 0,
    items: {},
    stations: [],
    activeStation: null,
    selection: [],
    nextHandle: 1,
    stationCounter: 0,
    collisionsActive: false,
     
     
    simulationSpeed: 1,
    running: null,
  };
}

 
export function allocHandle(ws: Workspace): number {
  const h = 0x6000_0000 + ws.nextHandle * 16;
  ws.nextHandle += 1;
  return h;
}

export function makeItem(ws: Workspace, type: ItemType, name: string, extra: Partial<Item> = {}): Item {
  return {
    id: newId(type.slice(0, 3)),
    handle: allocHandle(ws),
    type,
    name,
    parent: null,
    children: [],
    visible: true,
    pose: eye(),
    ...extra,
  };
}

export const item = (ws: Workspace, id: string | null | undefined): Item | undefined => (id ? ws.items[id] : undefined);

export function byHandle(ws: Workspace, handle: number): Item | undefined {
  for (const it of Object.values(ws.items)) if (it.handle === handle) return it;
  return undefined;
}

 
export function stationOf(ws: Workspace, id: string): Item | undefined {
  let cur = ws.items[id];
  while (cur && cur.parent) cur = ws.items[cur.parent];
  return cur && cur.type === "station" ? cur : undefined;
}

export function ancestors(ws: Workspace, id: string): Item[] {
  const out: Item[] = [];
  let cur = ws.items[id];
  while (cur?.parent) {
    cur = ws.items[cur.parent];
    if (cur) out.push(cur);
  }
  return out;
}

export function isAncestor(ws: Workspace, maybeAncestor: string, id: string): boolean {
  return ancestors(ws, id).some((a) => a.id === maybeAncestor);
}

export function descendants(ws: Workspace, id: string): Item[] {
  const out: Item[] = [];
  const walk = (i: string) => {
    for (const c of ws.items[i]?.children ?? []) {
      const it = ws.items[c];
      if (!it) continue;
      out.push(it);
      walk(c);
    }
  };
  walk(id);
  return out;
}

 
export function listItems(ws: Workspace, opts: { type?: ItemType; station?: string | "all" } = {}): Item[] {
  const roots = opts.station === "all" ? ws.stations : [opts.station ?? ws.activeStation].filter(Boolean) as string[];
  const out: Item[] = [];
  for (const r of roots) {
    const st = ws.items[r];
    if (!st) continue;
    if (!opts.type || st.type === opts.type) out.push(st);
    for (const d of descendants(ws, r)) if (!opts.type || d.type === opts.type) out.push(d);
  }
  return out;
}

export function findByName(ws: Workspace, name: string, type?: ItemType): Item | undefined {
   
  const ordered = [ws.activeStation, ...ws.stations.filter((s) => s !== ws.activeStation)].filter(Boolean) as string[];
  for (const s of ordered) {
    for (const it of [ws.items[s], ...descendants(ws, s)]) {
      if (it && it.name === name && (!type || it.type === type)) return it;
    }
  }
  return undefined;
}

 
export function robotOfTool(ws: Workspace, toolId: string): Item | undefined {
  const t = ws.items[toolId];
  const p = t?.parent ? ws.items[t.parent] : undefined;
  return p?.type === "robot" ? p : undefined;
}






export function absPose(ws: Workspace, id: string, joints?: Record<string, number[]>): Mat {
  const chain: Item[] = [];
  let cur: Item | undefined = ws.items[id];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent ? ws.items[cur.parent] : undefined;
  }
  let m = eye();
  for (let i = 0; i < chain.length; i++) {
    const it = chain[i];
    if (it.type === "station") continue;
    const parent = i > 0 ? chain[i - 1] : undefined;
    if (parent?.type === "robot" && parent.robot && kinematicsReady()) {
      m = mul(m, fk(parent.robot.model, joints?.[parent.id] ?? parent.robot.joints));
    }
    m = mul(m, it.pose);
  }
  return m;
}

 
export function childFrame(ws: Workspace, parentId: string | null, joints?: Record<string, number[]>): Mat {
  const p = parentId ? ws.items[parentId] : undefined;
  if (!p || p.type === "station") return eye();
  let m = absPose(ws, parentId!, joints);
  if (p.type === "robot" && p.robot && kinematicsReady()) m = mul(m, fk(p.robot.model, joints?.[p.id] ?? p.robot.joints));
  return m;
}

 
export function flangeAbs(ws: Workspace, robotId: string, joints?: number[]): Mat {
  const r = ws.items[robotId];
  if (!r?.robot) throw new Error("Item is not a robot");
  return mul(absPose(ws, robotId), fk(r.robot.model, joints ?? r.robot.joints));
}

 
export function relPose(ws: Workspace, id: string, refId: string | null): Mat {
  const a = absPose(ws, id);
  return refId ? mul(inv(absPose(ws, refId)), a) : a;
}

 
export function robotBase(ws: Workspace, robotId: string): Item | undefined {
  const r = ws.items[robotId];
  return r?.parent ? ws.items[r.parent] : undefined;
}





export function currentRobot(ws: Workspace): Item | undefined {
  const robots = listItems(ws, { type: "robot" }).filter((r) => r.visible && r.robot);
  return robots.find((r) => (r.robot?.model.nq ?? 0) > 3) ?? robots[0];
}






export function newFrameOffset(ws: Workspace, stationId: string, spacing: number, exclude?: string): number {
  if (!(spacing > 0)) return 0;
  let y = 0;
  for (const c of ws.items[stationId]?.children ?? []) {
    if (c === exclude) continue;
    const it = ws.items[c];
    if (!it || it.type === "program" || it.type === "python" || it.type === "notes" || it.type === "folder" || it.type === "machining") continue;
    if (Math.abs(it.pose[3]) > spacing) continue;
    y = Math.max(y, it.pose[7] + spacing);
  }
  return y;
}

 
export function firstRobot(ws: Workspace, stationId?: string | null): Item | undefined {
  return listItems(ws, { type: "robot", station: stationId ?? undefined })[0];
}

export function activeToolOf(ws: Workspace, robotId: string): Item | undefined {
  const r = ws.items[robotId];
  const id = r?.robot?.activeTool;
  if (id && ws.items[id]) return ws.items[id];
  return r?.children.map((c) => ws.items[c]).find((c) => c?.type === "tool");
}






export function toolPose(ws: Workspace, robotId: string): Mat {
  const tcp = ws.items[robotId]?.robot?.tcp;
  if (tcp && tcp.length === 16) return tcp;
  return activeToolOf(ws, robotId)?.pose ?? eye();
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}
