 
 
 
 
 
 
 
 
 
 

import { eye, inv, mul, type Mat } from "../math";
import { fk, kinematicsReady } from "../kinematics";
import type { GeometryStore } from "../registry";
import type { Item, Workspace } from "../types";
import { descendants, listItems } from "../workspace";
import { emitOnce } from "./emit";
import { parseSprayConfig, particlesPerUpdate, type SprayConfig, type SprayMatrix } from "./options";
import { ParticleBuffer } from "./particles";
import { makeRng, randomSeed, type Rng } from "./rng";
import { buildTarget, type SprayTarget } from "./target";

 
export const SPRAY_OFF = 0;
export const SPRAY_ON = 1;
export const SPRAY_HIDDEN = 2;

 
export const STATS_INFO = "id<br>percent in<br>percent out<br>count";






export const MAX_STORED_PARTICLES = 4_000_000;

export interface SprayGun {
   
  key: string;
  station: string;
   
  tool: string;
   
  object: string;
  options: string;
  cfg: SprayConfig;
   
  state: number;
   
  inCount: number;
  outCount: number;
  particles: ParticleBuffer;
  rng: Rng;
   
  updates: number;
}

export interface GunMeta {
  key: string;
  id: number;
  tool: string;
  object: string;
  state: number;
  options: string;
  inCount: number;
  outCount: number;
   
  count: number;
  particle: SprayConfig["particle"];
}

export interface AddParams {
   
  tool?: string | null;
   
  object?: string | null;
  options?: string;
  volume?: SprayMatrix | null;
  geometry?: SprayMatrix | null;
  seed?: number;
}

export interface AddResult {
   
  id: number;
  key?: string;
   
  reason?: string;
  tool?: string;
  object?: string;
}

interface Store {
  stations: Map<string, SprayGun[]>;
  targets: Map<string, SprayTarget>;
  listeners: Set<(station: string, why: string) => void>;
  seq: number;
}

const KEY = "__robocraft_spray";

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  g[KEY] ??= { stations: new Map(), targets: new Map(), listeners: new Set(), seq: 0 };
  return g[KEY]!;
}

 
export function onSprayChange(fn: (station: string, why: string) => void): () => void {
  store().listeners.add(fn);
  return () => store().listeners.delete(fn);
}

function changed(station: string, why: string) {
  for (const fn of store().listeners) {
    try {
      fn(station, why);
    } catch {
       
    }
  }
}

export function stationGuns(station: string | null | undefined): SprayGun[] {
  return station ? (store().stations.get(station) ?? []) : [];
}

export function gunByKey(key: string): SprayGun | undefined {
  for (const list of store().stations.values()) for (const g of list) if (g.key === key) return g;
  return undefined;
}

 
export function hasActiveGuns(station: string | null | undefined): boolean {
  return stationGuns(station).some((g) => g.state !== 0);
}

export function gunMeta(g: SprayGun, id: number): GunMeta {
  return { key: g.key, id, tool: g.tool, object: g.object, state: g.state, options: g.options, inCount: g.inCount, outCount: g.outCount, count: g.particles.count, particle: g.cfg.particle };
}

export function stationMeta(station: string | null | undefined): GunMeta[] {
  return stationGuns(station).map((g, i) => gunMeta(g, i));
}

 

 
const isArm6 = (r: Item) => !!r.robot && [1, 3, 6, 7, 8].includes(r.robot.model.mech) && r.robot.model.nq > 5;
 
const isArm3 = (r: Item) => !!r.robot && r.robot.model.nq > 2;

 
export function sprayRobot(ws: Workspace, station: string): Item | undefined {
  const robots = listItems(ws, { type: "robot", station });
  return robots.find(isArm6) ?? robots.find(isArm3);
}

function activeTool(ws: Workspace, robot: Item): Item | undefined {
  const id = robot.robot?.activeTool;
  if (id && ws.items[id]) return ws.items[id];
  return robot.children.map((c) => ws.items[c]).find((c) => c?.type === "tool");
}

 
export function objectTriangles(geometry: GeometryStore, it: Item): number {
  let n = 0;
  for (const m of it.object?.meshes ?? []) n += Math.floor((geometry.get(m.geometry)?.length ?? 0) / 9);
  return n;
}






export function sprayObject(ws: Workspace, geometry: GeometryStore, station: string, robot: Item): Item | undefined {
  const frameId = robot.robot?.activeFrame;
  const frame = frameId ? ws.items[frameId] : undefined;
  const candidates = frame ? descendants(ws, frame.id).filter((it) => it.type === "object") : listItems(ws, { type: "object", station }).reverse();
  return candidates.find((o) => objectTriangles(geometry, o) > 0);
}

 





export function absPoseWith(ws: Workspace, id: string, joints?: Map<string, number[]>): Mat {
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
    if (parent?.type === "robot" && parent.robot && kinematicsReady()) m = mul(m, fk(parent.robot.model, joints?.get(parent.id) ?? parent.robot.joints));
    m = mul(m, it.pose);
  }
  return m;
}

 
export function gunTcp(ws: Workspace, g: SprayGun, joints?: Map<string, number[]>): Mat {
  return absPoseWith(ws, g.tool, joints);
}

 

function targetKey(it: Item): string {
  const o = it.object!;
  return JSON.stringify([o.meshes.map((m) => [m.geometry, m.color[3]]), it.color?.[3] ?? null, o.geometryPose ?? null]);
}

 
export function sprayTarget(geometry: GeometryStore, it: Item): SprayTarget {
  const key = targetKey(it);
  const s = store();
  const hit = s.targets.get(key);
  if (hit) return hit;
  const gp = it.object?.geometryPose;
  const parts = (it.object?.meshes ?? []).map((m) => {
    const src = geometry.get(m.geometry) ?? new Float32Array(0);
    let tri = src;
    if (gp && gp.length === 16) {
      tri = new Float32Array(src.length);
      for (let k = 0; k < src.length; k += 3) {
        const [x, y, z] = [src[k], src[k + 1], src[k + 2]];
        tri[k] = gp[0] * x + gp[1] * y + gp[2] * z + gp[3];
        tri[k + 1] = gp[4] * x + gp[5] * y + gp[6] * z + gp[7];
        tri[k + 2] = gp[8] * x + gp[9] * y + gp[10] * z + gp[11];
      }
    }
    return { tri, alpha: it.color?.[3] ?? m.color[3] };
  });
  const t = buildTarget(parts);
  if (s.targets.size > 64) s.targets.delete(s.targets.keys().next().value!);
  s.targets.set(key, t);
  return t;
}

 






export function addGun(ws: Workspace, geometry: GeometryStore, p: AddParams): AddResult {
  const station = ws.activeStation;
  if (!station) return { id: -1, reason: "No active station" };
  let tool = p.tool ? ws.items[p.tool] : undefined;
  if (!tool) {
    const robot = sprayRobot(ws, station);
    if (!robot) return { id: -1, reason: "No robot in the station to take the active tool from" };
    tool = activeTool(ws, robot);
    if (!tool) return { id: -1, reason: `Robot ${robot.name} has no active tool` };
  }
  if (tool.type !== "tool" && tool.type !== "object") return { id: -1, reason: `Gun_Add: not supported type for ${tool.name}` };
  let object = p.object ? ws.items[p.object] : undefined;
  if (!object) {
    const parent = tool.parent ? ws.items[tool.parent] : undefined;
    const robot = parent?.type === "robot" ? parent : sprayRobot(ws, station);
    if (!robot) return { id: -1, reason: "No robot in the station to find the object to spray on" };
    object = sprayObject(ws, geometry, station, robot);
    if (!object) {
      const frame = robot.robot?.activeFrame ? ws.items[robot.robot.activeFrame] : undefined;
      return { id: -1, reason: frame ? `No object with geometry in the active reference frame ${frame.name}` : "No object with geometry in the station" };
    }
  }
  const s = store();
  const list = s.stations.get(station) ?? [];
  const gun: SprayGun = {
    key: `spray${++s.seq}`,
    station,
    tool: tool.id,
    object: object.id,
    options: p.options ?? "",
    cfg: parseSprayConfig(p.options ?? "", p.volume, p.geometry),
    state: SPRAY_OFF,
    inCount: 0,
    outCount: 0,
    particles: new ParticleBuffer(),
    rng: makeRng(p.seed ?? randomSeed()),
    updates: 0,
  };
  list.push(gun);
  s.stations.set(station, list);
  changed(station, "add");
  return { id: list.length - 1, key: gun.key, tool: tool.id, object: object.id };
}

 
export function setGunState(ws: Workspace, state: number, id = -1): number {
  const station = ws.activeStation;
  const list = stationGuns(station);
  if (id >= 0 && id < list.length) list[id].state = state;
  else for (const g of list) g.state = state;
  if (station && list.length) changed(station, "state");
  return state;
}





export function gunStats(ws: Workspace): { info: string; columns: number[][] } {
  const columns = stationGuns(ws.activeStation).map((g, i) => {
    const total = g.inCount + g.outCount;
    return total < 1 ? [i, 0, 0, total] : [i, (g.inCount * 100) / total, (g.outCount * 100) / total, total];
  });
  return { info: STATS_INFO, columns };
}

 
export function clearGuns(station: string | null | undefined): 0 | 1 {
  if (!station) return 0;
  const s = store();
  const had = (s.stations.get(station)?.length ?? 0) > 0;
  s.stations.delete(station);
  if (had) changed(station, "clear");
  return had ? 1 : 0;
}

 
export function dropClosedStations(ws: Workspace) {
  for (const st of [...store().stations.keys()]) if (!ws.items[st] || !ws.stations.includes(st)) clearGuns(st);
}

 
export function clearIfItemsRemoved(ws: Workspace, removed: Iterable<string>): string[] {
  const gone = new Set(removed);
  const cleared: string[] = [];
  for (const [st, list] of store().stations) {
    if (list.some((g) => gone.has(g.tool) || gone.has(g.object) || !ws.items[g.tool] || !ws.items[g.object])) {
      clearGuns(st);
      cleared.push(st);
    }
  }
  return cleared;
}

function storedCount(station: string): number {
  return stationGuns(station).reduce((n, g) => n + g.particles.count, 0);
}






export function emitGuns(ws: Workspace, geometry: GeometryStore, joints?: Map<string, number[]>): number {
  const station = ws.activeStation;
  const list = stationGuns(station);
  if (!station || !list.some((g) => g.state !== 0)) return 0;
  let stored = storedCount(station);
  let n = 0;
  const objPoses = new Map<string, Mat>();
  for (const g of list) {
    if (g.state === 0) continue;
    const obj = ws.items[g.object];
    const tool = ws.items[g.tool];
    if (!obj || obj.type !== "object" || !tool) continue;
    let objAbs = objPoses.get(obj.id);
    if (!objAbs) {
      objAbs = absPoseWith(ws, obj.id, joints);
      objPoses.set(obj.id, objAbs);
    }
    const M = mul(inv(objAbs), gunTcp(ws, g, joints));
    const target = g.cfg.project ? sprayTarget(geometry, obj) : null;
    const res = emitOnce(g.cfg, M, target, g.rng, (pos, quat, rgba) => {
      if (stored >= MAX_STORED_PARTICLES) return;
      g.particles.push(pos, quat, rgba);
      stored++;
    });
    g.inCount += res.in;
    g.outCount += res.out;
    g.updates++;
    n++;
  }
  if (n) changed(station, "emit");
  return n;
}

 
export function listGuns(ws: Workspace) {
  const station = ws.activeStation;
  return stationGuns(station).map((g, id) => {
    const total = g.inCount + g.outCount;
    return {
      id,
      tool: ws.items[g.tool]?.name ?? g.tool,
      object: ws.items[g.object]?.name ?? g.object,
      state: g.state,
      options: g.options,
      shape: g.cfg.shape === 2 ? "RECTANGLE" : "ELLYPSE",
      project: g.cfg.project,
      step: `${g.cfg.stepA}x${g.cfg.stepB}`,
      perUpdate: particlesPerUpdate(g.cfg),
      rand: g.cfg.rand,
      particle: g.cfg.particle.kind === "mesh" ? { kind: "mesh", triangles: g.cfg.particle.vertices.length / 9 } : g.cfg.particle,
      nearColor: g.cfg.near.slice(9, 13),
      farColor: g.cfg.far.slice(9, 13),
      updates: g.updates,
      in: g.inCount,
      out: g.outCount,
      total,
      percentIn: total < 1 ? 0 : (g.inCount * 100) / total,
      percentOut: total < 1 ? 0 : (g.outCount * 100) / total,
      stored: g.particles.count,
    };
  });
}
