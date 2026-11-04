 
 

import { initKinematics } from "@/engine/kinematics";
import { syncAxes } from "@/engine/sync/axes";
import { replay, Tx } from "@/engine/tx";
import { ITEM_TYPE_CODES, type Item, type Workspace } from "@/engine/types";
import { descendants } from "@/engine/workspace";
import { activeUndo, broadcast, clearUndo, getServer, run } from "@/server/store";
import type { WireWriter } from "./codec";

 
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message = "",
    readonly placeholder?: (w: WireWriter) => void,
  ) {
    super(message);
  }
}

export const ws = (): Workspace => getServer().ws;

const LIVE_KEY = "__robocraft_rdkapi_live";






function liveMap(): Map<string, number[]> {
  const g = globalThis as unknown as Record<string, Map<string, number[]> | undefined>;
  if (!g[LIVE_KEY]) {
    const live = new Map<string, number[]>();
    g[LIVE_KEY] = live;
    getServer().listeners.add((e) => {
      if (e.type === "live" && Array.isArray(e.joints)) live.set(String(e.robot), e.joints as number[]);
      else if (e.type === "live-end") live.delete(String(e.robot));
    });
  }
  return g[LIVE_KEY]!;
}

 
export function robotJoints(robot: Item): number[] {
  const live = liveMap();
  const own = live.get(robot.id) ?? robot.robot?.joints ?? [];
   
   
  if (!robot.robot?.sync?.length) return own;
  return syncAxes(ws(), robot).reduce((q, a) => [...q, ...(live.get(a.item.id) ?? a.item.robot!.joints).slice(0, a.nq)], own.slice(0, robot.robot.model.nq));
}

 
export async function settle() {
  const s = getServer();
  await s.ready;
  await s.queue;
  await initKinematics();
  liveMap();
}






export function mutate<T>(fn: (w: Workspace, tx: Tx) => T | Promise<T>): Promise<T> {
  const s = getServer();
  const job = s.queue.then(async () => {
    await s.ready;
    await initKinematics();
    const tx = new Tx(s.ws);
    try {
      const out = await fn(s.ws, tx);
      if (tx.changed) {
        s.ws.rev += 1;
        broadcast({ type: "patch", patch: tx.patch() });
      }
      return out;
    } catch (err) {
      if (tx.changed) replay(s.ws, tx.ops, "undo");
      throw err;
    }
  });
  s.queue = job.catch(() => undefined);
  return job;
}

 
const WARNINGS = ["The parent can not be a child of the current item"];

 
export function toApiError(message: string): ApiError {
  if (/^Invalid item provided/.test(message)) return new ApiError(1);
  if (WARNINGS.some((w) => message.startsWith(w))) return new ApiError(2, message);
  if (/not reachable|cannot be reached/i.test(message)) return new ApiError(10, "Target cannot be reached");
  return new ApiError(3, message);
}

 
export async function cmd<T = Record<string, unknown>>(name: string, params: Record<string, unknown>): Promise<T> {
  const res = await run(name, params, "api");
  if (!res.ok) throw toApiError(res.error ?? `${name} failed`);
  return res.result as T;
}





export function safeModeClearUndo() {
  try {
    if (activeUndo().size > 0) clearUndo();
  } catch {
     
  }
}

export function typeCode(it: Item | undefined): number {
  if (!it) return -1;
  return ITEM_TYPE_CODES[it.type] ?? 20;
}

 
export function byHandle(handle: number): Item | undefined {
  if (!(handle > 0)) return undefined;
  const items = ws().items;
  for (const id in items) if (items[id].handle === handle) return items[id];
  return undefined;
}

 
export function need(handle: number, placeholder?: (w: WireWriter) => void): Item {
  const it = byHandle(handle);
  if (!it) throw new ApiError(1, "", placeholder);
  return it;
}

 
export function stationItems(): Item[] {
  const w = ws();
  const st = w.activeStation ? w.items[w.activeStation] : undefined;
  if (!st) return [];
   
  return [st, ...descendants(w, st.id).filter((it) => it.type !== "instruction")];
}









export function itemByName(name: string, type = -1): Item | undefined {
  const all = stationItems();
  if (type < 0) {
    const low = name.toLowerCase();
    let partial: Item | undefined;
    for (const it of all) {
      if (it.name === name) return it;
      if (!partial && it.name.toLowerCase().includes(low)) partial = it;
    }
    return partial;
  }
  const typed = all.filter((it) => matchesType(it, type));
  if (name === "") return typed[0];
  const want = name.trim();
  return typed.find((it) => it.name.trim() === want);
}






export function matchesType(it: Item, type: number): boolean {
  if (type < 0) return true;
  if (type === 18) return it.type === "robot" && (it.robot?.model.nq ?? 0) >= 4;
  if (type === 21) return it.type === "robot" && (it.robot?.model.nq ?? 0) < 4;
  return typeCode(it) === type;
}
