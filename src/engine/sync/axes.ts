// Combines robot and external-axis joints and resolves synchronized transforms.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { fk } from "../kinematics";
import { eye, mul, type Mat } from "../math";
import type { Item, Workspace } from "../types";

 
export const MAX_SYNC_JOINTS = 12;

export interface SyncAxis {
  item: Item;
   
  nq: number;
   
  side: "robot" | "part";
   
  at: number;
}

 
function isAncestor(ws: Workspace, ancestorId: string, id: string): boolean {
  let cur = ws.items[id]?.parent ? ws.items[ws.items[id].parent!] : undefined;
  for (let guard = 0; cur && guard < 10_000; guard++) {
    if (cur.id === ancestorId) return true;
    cur = cur.parent ? ws.items[cur.parent] : undefined;
  }
  return false;
}





export function syncAxes(ws: Workspace, robot: Item | undefined): SyncAxis[] {
  const rd = robot?.robot;
  if (!robot || !rd?.sync?.length) return [];
  const nq = rd.model.nq;
  const listed = rd.sync.map((id) => ws.items[id]).filter((it): it is Item => !!it?.robot && it.id !== robot.id && !isAncestor(ws, robot.id, it.id));
   
  const keep = new Set<Item>();
  let total = nq;
  for (let i = listed.length - 1; i >= 0; i--) {
    const n = listed[i].robot!.model.nq;
    if (total + n > MAX_SYNC_JOINTS) continue;
    total += n;
    keep.add(listed[i]);
  }
  const out: SyncAxis[] = [];
  let at = nq;
  for (const item of listed) {
    if (!keep.has(item)) continue;
    const n = item.robot!.model.nq;
    out.push({ item, nq: n, side: isAncestor(ws, item.id, robot.id) ? "robot" : "part", at });
    at += n;
  }
  return out;
}

 
export function syncDof(ws: Workspace, robot: Item): number {
  return robot.robot!.model.nq + syncAxes(ws, robot).reduce((n, a) => n + a.nq, 0);
}

 
export function combinedJoints(ws: Workspace, robot: Item, own?: number[]): number[] {
  const rd = robot.robot!;
  const q = (own ?? rd.joints).slice(0, rd.model.nq);
  for (const a of syncAxes(ws, robot)) for (let k = 0; k < a.nq; k++) q.push(a.item.robot!.joints[k] ?? 0);
  return q;
}






export function splitJoints(ws: Workspace, robot: Item, q: number[]): [string, number[]][] {
  const rd = robot.robot!;
  const out: [string, number[]][] = [[robot.id, q.slice(0, rd.model.nq)]];
  for (const a of syncAxes(ws, robot)) {
    const cur = a.item.robot!.joints;
    out.push([a.item.id, Array.from({ length: a.nq }, (_, k) => (Number.isFinite(q[a.at + k]) ? q[a.at + k] : cur[k] ?? 0))]);
  }
  return out;
}





export function jointsByItem(ws: Workspace, robotId: string, q: number[]): [string, number[]][] {
  const robot = ws.items[robotId];
  if (!robot?.robot || q.length <= robot.robot.model.nq || !syncAxes(ws, robot).length) return [[robotId, q]];
  return splitJoints(ws, robot, q);
}





export function commitJoints(ws: Workspace, tx: { set(id: string, patch: Partial<Item>): unknown }, robotId: string, q: number[]): void {
  for (const [id, j] of jointsByItem(ws, robotId, q)) tx.set(id, { robot: { ...ws.items[id].robot!, joints: j.slice() } });
}

 
export const jointOverridesOf = (ws: Workspace, robotId: string, q: number[]): Record<string, number[]> => Object.fromEntries(jointsByItem(ws, robotId, q));

 
export function syncItemIds(ws: Workspace, robotId: string): string[] {
  return [robotId, ...syncAxes(ws, ws.items[robotId]).map((a) => a.item.id)];
}

 
export function jointOverrides(ws: Workspace, robot: Item, q: number[]): Map<string, number[]> {
  return new Map(splitJoints(ws, robot, q));
}

 
export function absPoseWith(ws: Workspace, id: string, over: Map<string, number[]>): Mat {
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
    if (parent?.type === "robot" && parent.robot) m = mul(m, fk(parent.robot.model, over.get(parent.id) ?? parent.robot.joints));
    m = mul(m, it.pose);
  }
  return m;
}

 
export function flangeWith(ws: Workspace, id: string, over: Map<string, number[]>): Mat {
  const it = ws.items[id];
  return mul(absPoseWith(ws, id, over), fk(it.robot!.model, over.get(id) ?? it.robot!.joints));
}






export function syncBaseAbs(ws: Workspace, robot: Item, over: Map<string, number[]>, axes = syncAxes(ws, robot)): Mat {
   
  const last = axes.at(-1);
  if (!last) return absPoseWith(ws, robot.id, over);
  return last.side === "robot" ? absPoseWith(ws, last.item.id, over) : flangeWith(ws, last.item.id, over);
}
