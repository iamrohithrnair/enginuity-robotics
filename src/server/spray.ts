// Synchronizes spray emission with server motion and broadcasts particle updates.
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import "server-only";
import type { Profile } from "@/engine/sim/planner";
import { clearIfItemsRemoved, dropClosedStations, emitGuns, hasActiveGuns, onSprayChange, SprayTicker, stationGuns, stationMeta } from "@/engine/spray";
import type { Item, WorkspacePatch } from "@/engine/types";
import type { ServerEvent, ServerState } from "./store";

 
export const PATH_RATE_SETTING = "RobotPathUpdateMS";

interface SprayServer {
  ticker: SprayTicker;
   
  api: Map<number, number>;
   
  sigs: Map<string, string> | null;
  sigStation: string | null;
  notify: Map<string, ReturnType<typeof setTimeout>>;
  attached: boolean;
  state: ServerState | null;
}

const KEY = "__robocraft_spray_server";

function srv(): SprayServer {
  const g = globalThis as unknown as Record<string, SprayServer | undefined>;
  if (!g[KEY]) {
    const s: SprayServer = {
      api: new Map(),
      sigs: null,
      sigStation: null,
      notify: new Map(),
      attached: false,
      state: null,
      ticker: new SprayTicker({
        periodMs: () => Number(s.state?.services.settings[PATH_RATE_SETTING] ?? 5),
        ratio: () => s.state?.ws.simulationSpeed ?? 5,
        paused: () => !!s.state?.ws.paused,
        emit: (joints) => {
          if (s.state) emitGuns(s.state.ws, s.state.services.geometry, joints);
        },
      }),
    };
    g[KEY] = s;
  }
  return g[KEY]!;
}

 
function movingJoints(): Map<string, number[]> {
  return srv().ticker.currentJoints();
}





export function sprayPositionsUpdate(state: ServerState): number {
  const s = srv();
  s.state ??= state;
  if (!hasActiveGuns(state.ws.activeStation)) return 0;
  return emitGuns(state.ws, state.services.geometry, movingJoints());
}

 
export function sprayMotion(state: ServerState, robotId: string, seg: { samples: number[][]; profile?: Profile }, T: number) {
  const s = srv();
  s.state ??= state;
  const handle = {};
  s.ticker.start(handle, { robot: robotId, samples: seg.samples, profile: seg.profile, T }, performance.now());
  return {
     
    update(simT: number) {
      s.ticker.update(handle, performance.now(), simT);
    },
     
    end(simT: number, completed: boolean) {
      s.ticker.end(handle, performance.now(), simT, completed);
    },
  };
}

 
export function sprayMovingRobots(): Set<string> {
  return new Set(movingJoints().keys());
}

 
export function sprayApiBegin(conn: number) {
  srv().api.set(conn, Date.now());
}
export function sprayApiEnd(conn: number) {
  srv().api.delete(conn);
}

function apiInFlight(): boolean {
  const s = srv();
  const now = Date.now();
  for (const [id, t] of s.api) if (now - t > 120_000) s.api.delete(id);  
  return s.api.size > 0;
}

 

function sigOf(it: Item): string {
  return JSON.stringify([it.parent, it.pose, it.robot?.joints ?? null]);
}

function stationSigs(state: ServerState): Map<string, string> {
  const s = srv();
  const ws = state.ws;
  if (!s.sigs || s.sigStation !== ws.activeStation) {
    s.sigs = new Map();
    s.sigStation = ws.activeStation;
    for (const it of Object.values(ws.items)) s.sigs.set(it.id, sigOf(it));
  }
  return s.sigs;
}

 
function patchMoves(state: ServerState, patch: WorkspacePatch): boolean {
  const sigs = stationSigs(state);
  const moving = sprayMovingRobots();
  let moved = false;
  for (const up of patch.upserts) {
    const cur = state.ws.items[up.id];
    if (!cur) continue;
    const sig = sigOf(cur);
    if (sigs.get(up.id) !== sig) {
      if (sigs.has(up.id) && !moving.has(up.id)) moved = true;
      sigs.set(up.id, sig);
    }
  }
  for (const id of patch.removes) sigs.delete(id);
  return moved;
}

 

function scheduleNotify(state: ServerState, station: string, why: string) {
  const s = srv();
  const send = () => {
    s.notify.delete(station);
    state.services.emit?.({ type: "spray", station, active: state.ws.activeStation, guns: stationMeta(station) });
  };
  if (why === "clear" || why === "add" || why === "state") {
    const t = s.notify.get(station);
    if (t) clearTimeout(t);
    send();
    return;
  }
  if (!s.notify.has(station)) s.notify.set(station, setTimeout(send, 60));
}

 
export function attachSpray(state: ServerState) {
  const s = srv();
  s.state = state;
  if (s.attached) return;
  s.attached = true;
  onSprayChange((station, why) => scheduleNotify(srv().state ?? state, station, why));
  state.listeners.add((e: ServerEvent) => {
    const st = srv().state ?? state;
    if (e.type !== "patch") return;
    const patch = (e as { patch: WorkspacePatch }).patch;
    try {
      if (patch.meta?.stations || patch.meta?.activeStation !== undefined) dropClosedStations(st.ws);
       
      if (patch.removes.length) clearIfItemsRemoved(st.ws, patch.removes);
      const station = st.ws.activeStation;
      if (!stationGuns(station).length) {
        srv().sigs = null;
        return;
      }
      if (patch.physics) return;
      const moved = patchMoves(st, patch);
      if (moved && !apiInFlight() && hasActiveGuns(station)) emitGuns(st.ws, st.services.geometry, movingJoints());
    } catch {
       
    }
  });
}
