// Resolves simulation events, conveyor motion, object copies and waits.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { meshId } from "../collision";
import { collide, fk, kinematicsReady } from "../kinematics";
import { eye, inv, mul, type Mat } from "../math";
import type { GeometryStore } from "../registry";
import type { Tx } from "../tx";
import type { InstructionData, Item, Workspace } from "../types";
import { allocHandle, descendants, newId, stationOf } from "../workspace";

type EventData = NonNullable<InstructionData["event"]>;

 
export type LiveJoints = Record<string, number[]>;

 
export const EVENT_BEHAVIOR: Partial<Record<EventData["action"], number>> = {
  attach: 0,
  detach: 1,
  "detach-all": 1,
  show: 2,
  hide: 3,
  move: 4,
  home: 6,
  conveyor: 7,
  create: 8,
  remove: 9,
  wait: 10,
};

const jointsOf = (r: Item, live?: LiveJoints) => live?.[r.id] ?? r.robot!.joints;

 
export function liveAbsPose(ws: Workspace, id: string, live?: LiveJoints): Mat {
  const chain: Item[] = [];
  for (let cur: Item | undefined = ws.items[id]; cur; cur = cur.parent ? ws.items[cur.parent] : undefined) chain.unshift(cur);
  let m = eye();
  for (let i = 0; i < chain.length; i++) {
    const it = chain[i];
    if (it.type === "station") continue;
    const parent = i > 0 ? chain[i - 1] : undefined;
     
    if (parent?.type === "robot" && parent.robot && kinematicsReady()) m = mul(m, fk(parent.robot.model, jointsOf(parent, live)));
    m = mul(m, it.pose);
  }
  return m;
}

 
export function liveChildFrame(ws: Workspace, parentId: string | null | undefined, live?: LiveJoints): Mat {
  const p = parentId ? ws.items[parentId] : undefined;
  if (!p || p.type === "station") return eye();
  const m = liveAbsPose(ws, p.id, live);
  return p.type === "robot" && p.robot && kinematicsReady() ? mul(m, fk(p.robot.model, jointsOf(p, live))) : m;
}

 
export function isUnder(ws: Workspace, id: string, root: string): boolean {
  for (let cur: string | null = id; cur; cur = ws.items[cur]?.parent ?? null) if (cur === root) return true;
  return false;
}

 

 
export function conveyorOf(ws: Workspace, ev: EventData): Item | undefined {
  return (ev.objects ?? []).map((id) => ws.items[id]).find((it): it is Item => it?.type === "robot" && !!it.robot);
}

 
export function conveyorGoal(start: number[], movement: number): number[] {
  return start.map((v) => v + movement);
}

 
export function invalidStartText(program: string, instruction: string, joints: number[]): string {
  const desc = `Start robot joints are invalid:<br>${joints.map((v) => v.toFixed(3)).join(", ")}`;
  return `Movement at instruction<br><strong>${program}:${instruction}</strong><br>is not possible.<br><br>Description:<br>${desc}`;
}

 

 
function cloneTree(ws: Workspace, tx: Tx, rootId: string, parentId: string): Item {
   
  const snap = [ws.items[rootId], ...descendants(ws, rootId)].map((it) => structuredClone(it));
  const map = new Map<string, string>(snap.map((it) => [it.id, newId(it.type.slice(0, 3))]));
  const inside = (id: string | null | undefined) => (id && map.has(id) ? map.get(id)! : id ?? null);
  let root: Item | null = null;
  for (const it of snap) {
    const copy: Item = { ...it, id: map.get(it.id)!, handle: allocHandle(ws), children: [] };
    if (copy.robot) copy.robot = { ...copy.robot, activeTool: inside(copy.robot.activeTool), activeFrame: inside(copy.robot.activeFrame) };
    if (copy.target) copy.target = { ...copy.target, robot: inside(copy.target.robot) };
    if (copy.program) copy.program = { ...copy.program, robot: inside(copy.program.robot) };
    tx.add(copy, it.id === rootId ? parentId : map.get(it.parent!)!);
    root ??= copy;
  }
  return root!;
}





export function createCopies(ws: Workspace, tx: Tx, ev: EventData, live?: LiveJoints): Item[] {
  const frame = ev.frame ? ws.items[ev.frame] : undefined;
  if (!frame) return [];
   
  const dest = frame.type === "program" || frame.type === "instruction" ? stationOf(ws, frame.id) ?? frame : frame;
  const made: Item[] = [];
  for (const id of ev.objects ?? []) {
    const src = ws.items[id];
    if (!src || src.type === "station") continue;
    const abs = liveAbsPose(ws, src.id, live);
    const copy = cloneTree(ws, tx, src.id, dest.id);
    tx.set(copy.id, { pose: mul(inv(liveChildFrame(ws, dest.id, live)), abs), visible: true, ...(copy.locked ? { locked: false } : {}) });
    made.push(ws.items[copy.id]);
  }
  return made;
}

 

 
export function triangleCount(store: GeometryStore, it: Item): number {
  let n = 0;
  for (const m of it.object?.meshes ?? it.tool?.meshes ?? []) n += Math.floor((store.get(m.geometry)?.length ?? 0) / 9);
  return n;
}





export function similarObjects(ws: Workspace, store: GeometryStore, ev: EventData, stationId: string): Item[] {
  const listed = new Set(ev.objects ?? []);
  const candidates = descendants(ws, stationId).filter((it) => it.type === "object" && !listed.has(it.id));
  const out: Item[] = [];
  for (const id of ev.objects ?? []) {
    const o = ws.items[id];
    if (!o || o.type !== "object") continue;
    const size = triangleCount(store, o);
    for (const c of candidates) if (!c.locked && c.name === o.name && !out.includes(c) && triangleCount(store, c) === size) out.push(c);
  }
  return out;
}

 

const meshesOf = (it: Item) => it.object?.meshes ?? it.tool?.meshes ?? [];

 
const geometryPose = (ws: Workspace, it: Item, live?: LiveJoints) => (it.type === "tool" ? liveChildFrame(ws, it.parent, live) : liveAbsPose(ws, it.id, live));

 
const bounds = new WeakMap<GeometryStore, Map<string, number[] | null>>();
function boundsOf(store: GeometryStore, geometry: string): number[] | null {
  let localBounds = bounds.get(store);
  if (!localBounds) bounds.set(store, (localBounds = new Map()));
  if (localBounds.has(geometry)) return localBounds.get(geometry)!;
  const t = store.get(geometry);
  let b: number[] | null = null;
  if (t && t.length >= 9) {
    b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < t.length; i += 3)
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], t[i + k]);
        b[k + 3] = Math.max(b[k + 3], t[i + k]);
      }
  }
  localBounds.set(geometry, b);
  return b;
}

 
function worldBox(store: GeometryStore, it: Item, pose: Mat): number[] | null {
  let out: number[] | null = null;
  for (const m of meshesOf(it)) {
    const b = boundsOf(store, m.geometry);
    if (!b) continue;
    out ??= [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const p = [c & 1 ? b[3] : b[0], c & 2 ? b[4] : b[1], c & 4 ? b[5] : b[2]];
      for (let r = 0; r < 3; r++) {
        const v = pose[r * 4] * p[0] + pose[r * 4 + 1] * p[1] + pose[r * 4 + 2] * p[2] + pose[r * 4 + 3];
        out[r] = Math.min(out[r], v);
        out[r + 3] = Math.max(out[r + 3], v);
      }
    }
  }
  return out;
}

 
const boxesMeet = (a: number[], b: number[]) => a[0] <= b[3] + 1e-3 && b[0] <= a[3] + 1e-3 && a[1] <= b[4] + 1e-3 && b[1] <= a[4] + 1e-3 && a[2] <= b[5] + 1e-3 && b[2] <= a[5] + 1e-3;






export function touchingObject(ws: Workspace, store: GeometryStore, sensor: Item, live?: LiveJoints): Item | null {
  const st = stationOf(ws, sensor.id);
  if (!st) return null;
  const mine = meshesOf(sensor)
    .map((m) => meshId(store, m))
    .filter((x): x is number => x !== null);
  if (!mine.length) return null;
  const at = geometryPose(ws, sensor, live);
  const box = worldBox(store, sensor, at);
  for (const it of descendants(ws, st.id)) {
    if (it.type !== "object" || it.id === sensor.id || it.locked) continue;
    const pose = liveAbsPose(ws, it.id, live);
     
    const other = worldBox(store, it, pose);
    if (!box || !other || !boxesMeet(box, other)) continue;
    const theirs = meshesOf(it)
      .map((m) => meshId(store, m))
      .filter((x): x is number => x !== null);
    if (mine.some((a) => theirs.some((b) => collide(a, at, b, pose, 0)))) return it;
  }
  return null;
}

 
export interface WaitStep {
   
  done: boolean;
  sensor?: string;
  detected?: string;
   
  removed?: string;
  moved?: string;
   
  stopRobot?: string;
}






export function waitStep(ws: Workspace, tx: Tx | null, store: GeometryStore, ev: EventData, live?: LiveJoints): WaitStep {
  for (const id of ev.objects ?? []) {
    const sensor = ws.items[id];
    if (!sensor || (sensor.type !== "object" && sensor.type !== "tool")) continue;
    const hit = touchingObject(ws, store, sensor, live);
    if (!hit) continue;
    const base = { done: true, sensor: sensor.name, detected: hit.name };
    const mode = ev.option ?? 0;
    if (mode === 2) {
      const dest = ev.frame ? ws.items[ev.frame] : undefined;
      if (!dest) continue;
       
      if (isUnder(ws, dest.id, hit.id)) return base;
      if (!tx) return { ...base, moved: hit.name };
       
      const pose = mul(inv(liveChildFrame(ws, dest.id, live)), liveAbsPose(ws, hit.id, live));
      if (hit.parent !== dest.id) {
        if (hit.parent && ws.items[hit.parent]) tx.set(hit.parent, { children: ws.items[hit.parent].children.filter((c) => c !== hit.id) });
        tx.set(dest.id, { children: [...ws.items[dest.id].children.filter((c) => c !== hit.id), hit.id] });
        tx.set(hit.id, { parent: dest.id });
      }
      tx.set(hit.id, { pose });
      return { ...base, moved: hit.name };
    }
    if (mode === 3) {
      const robot = ev.frame ? ws.items[ev.frame] : undefined;
      if (robot?.type !== "robot" || !robot.robot) continue;
      return { ...base, stopRobot: robot.id };
    }
    if (mode === 1) {
      tx?.remove(hit.id);
      return { ...base, removed: hit.name };
    }
    return base;
  }
  return { done: false };
}
