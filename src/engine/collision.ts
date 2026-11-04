 
 
 
 
 
 

import { collide, fk, linkFrames, meshCreate } from "./kinematics";
import { mul, type Mat } from "./math";
import type { GeometryStore } from "./registry";
import type { CollisionMapData, Item, MeshRef, Workspace } from "./types";
import { absPose, descendants, stationOf } from "./workspace";

 
const meshIds = new WeakMap<GeometryStore, Map<string, number>>();

 
export function meshId(store: GeometryStore, ref: MeshRef): number | null {
  let ids = meshIds.get(store);
  if (!ids) meshIds.set(store, (ids = new Map()));
  const hit = ids.get(ref.geometry);
  if (hit) return hit;
  const tri = store.get(ref.geometry);
  if (!tri || tri.length < 9) return null;
  const id = meshCreate(tri);
  ids.set(ref.geometry, id);
  return id;
}

export interface Body {
   
  item: string;
  label: string;
   
  link?: number;
  pose: Mat;
  meshes: number[];
}

 
function childFrameOf(ws: Workspace, parentId: string | null, jointOverride?: Record<string, number[]>): Mat {
  const p = parentId ? ws.items[parentId] : undefined;
  if (!p || p.type === "station") return absPose(ws, parentId ?? "");
  if (p.type === "robot" && p.robot) return mul(absPose(ws, p.id), fk(p.robot.model, jointOverride?.[p.id] ?? p.robot.joints));
  return absPose(ws, p.id);
}

 
export function collectBodies(ws: Workspace, store: GeometryStore, stationId: string, jointOverride?: Record<string, number[]>): Body[] {
  const out: Body[] = [];
  for (const it of descendants(ws, stationId)) {
    if (!it.visible) continue;
    if (it.type === "robot" && it.robot) {
      const base = absPose(ws, it.id);
      const frames = linkFrames(it.robot.model, jointOverride?.[it.id] ?? it.robot.joints);
      it.robot.links.forEach((meshes, li) => {
        const ids = meshes.map((m) => meshId(store, m)).filter((x): x is number => x !== null);
         
         
        if (ids.length && frames[li]) out.push({ item: it.id, label: `${it.name} link ${li}`, link: li, pose: mul(base, frames[li]), meshes: ids });
      });
    } else if ((it.type === "object" && it.object) || (it.type === "tool" && it.tool)) {
      const meshes = it.object?.meshes ?? it.tool?.meshes ?? [];
      const ids = meshes.map((m) => meshId(store, m)).filter((x): x is number => x !== null);
       
       
       
      const pose = it.type === "tool" ? childFrameOf(ws, it.parent, jointOverride) : absPose(ws, it.id, jointOverride);
      if (ids.length) out.push({ item: it.id, label: it.name, pose, meshes: ids });
    }
  }
  return out;
}

 
function robotOf(ws: Workspace, it: Item | undefined): string | undefined {
  let cur = it;
  while (cur && cur.type !== "robot") cur = cur.parent ? ws.items[cur.parent] : undefined;
  return cur?.id;
}

 
export const pairKey = (a: string, la: number, b: string, lb: number) => {
  const x = `${a}#${la}`;
  const y = `${b}#${lb}`;
  return x < y ? `${x}|${y}` : `${y}|${x}`;
};

export interface CollisionMap {
  mode: CollisionMapData["mode"];
  overrides: Map<string, boolean>;
}






function resolveId(ws: Workspace, stationId: string, id: string, cache: Map<string, string | null>): string | null {
  if (ws.items[id]) return id;
  if (cache.has(id)) return cache.get(id)!;
  const hit = descendants(ws, stationId).find((it) => it.id.startsWith(`${id}_`))?.id ?? null;
  cache.set(id, hit);
  return hit;
}

 
export function collisionMapOf(ws: Workspace, stationId: string | null | undefined): CollisionMap {
  const st = stationId ? ws.items[stationId] : undefined;
  const data = st?.collisionMap;
  const overrides = new Map<string, boolean>();
  if (st && data) {
    const cache = new Map<string, string | null>();
    for (const [a, la, b, lb, on] of data.pairs) {
      const ia = resolveId(ws, st.id, a, cache);
      const ib = resolveId(ws, st.id, b, cache);
      if (ia && ib) overrides.set(pairKey(ia, la, ib, lb), on);
    }
  }
  return { mode: data?.mode ?? "default", overrides };
}

 
export function stationIdFor(ws: Workspace, itemId?: string | null): string | null {
  return (itemId ? stationOf(ws, itemId)?.id : undefined) ?? ws.activeStation;
}





export interface MapBody {
  id: string;
  link: number;
  kind: "link" | "tool" | "object";
  robot?: string;
}






export function mapBodies(ws: Workspace, stationId: string): MapBody[] {
  const out: MapBody[] = [];
  const walk = (id: string, robot?: string) => {
    const it = ws.items[id];
    if (!it || it.type === "instruction") return;
    if (it.type === "robot" && it.robot) {
      for (let l = 0; l <= it.robot.model.joints.length; l++) out.push({ id: it.id, link: l, kind: "link", robot: it.id });
      for (const k of it.children) walk(k, it.id);
      return;
    }
    if (it.type === "tool") out.push({ id: it.id, link: 0, kind: "tool", robot });
    else if (it.type === "object") out.push({ id: it.id, link: 0, kind: "object", robot });
    for (const k of it.children) walk(k, it.type === "tool" ? robot : undefined);
  };
  for (const k of ws.items[stationId]?.children ?? []) walk(k);
  return out;
}

 
export function bodyOf(ws: Workspace, id: string, link?: number): MapBody {
  const it = ws.items[id];
  const kind: MapBody["kind"] = it?.type === "robot" ? "link" : it?.type === "tool" ? "tool" : "object";
  return { id, link: link ?? 0, kind, robot: robotOf(ws, it) };
}









export function pairActive(ws: Workspace, A: MapBody, B: MapBody, map: CollisionMap): boolean {
  if (A.id === B.id && A.link === B.link) return false;
  const o = map.overrides.get(pairKey(A.id, A.link, B.id, B.link));
  if (o !== undefined) return o;
  if (map.mode === "none") return false;
  if (map.mode === "all") return true;
  if (A.kind === "link" && B.kind === "link") return A.id === B.id ? Math.abs(A.link - B.link) >= 2 : A.link >= 1 && B.link >= 1;
  if (A.kind === "link" || B.kind === "link") {
    const link = A.kind === "link" ? A : B;
    const other = A.kind === "link" ? B : A;
    if (other.kind === "tool" && other.robot === link.robot) return true;
    return link.link >= 1;
  }
  if (A.kind === "object" && B.kind === "object") return false;
  if (A.kind === "tool" && B.kind === "tool") return A.robot !== B.robot || !A.robot;
  const tool = A.kind === "tool" ? A : B;
  const obj = A.kind === "tool" ? B : A;
   
  return ws.items[obj.id]?.parent !== tool.id;
}

export interface CollisionPair {
  a: string;
  b: string;
  labelA: string;
  labelB: string;
  linkA?: number;
  linkB?: number;
}

 
export function checkCollisions(ws: Workspace, store: GeometryStore, stationId: string, clearance = 0, jointOverride?: Record<string, number[]>): CollisionPair[] {
  const bodies = collectBodies(ws, store, stationId, jointOverride);
  const map = collisionMapOf(ws, stationId);
  const kinds = bodies.map((b) => bodyOf(ws, b.item, b.link));
  const pairs: CollisionPair[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i];
      const B = bodies[j];
      if (!pairActive(ws, kinds[i], kinds[j], map)) continue;
      let hit = false;
      for (const ma of A.meshes) {
        for (const mb of B.meshes) {
          if (collide(ma, A.pose, mb, B.pose, clearance)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) pairs.push({ a: A.item, b: B.item, labelA: A.label, labelB: B.label, linkA: A.link, linkB: B.link });
    }
  }
  return pairs;
}

 
export function activeMapPairs(ws: Workspace, stationId: string): [MapBody, MapBody][] {
  const bodies = mapBodies(ws, stationId);
  const map = collisionMapOf(ws, stationId);
  const out: [MapBody, MapBody][] = [];
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) if (pairActive(ws, bodies[i], bodies[j], map)) out.push([bodies[i], bodies[j]]);
  return out;
}
