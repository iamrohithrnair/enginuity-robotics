"use client";

 
 
 

import { create } from "zustand";
import { cmd, onServerEvent } from "@/client/api";
import { useRC } from "@/client/store";
import type { BodyReport, PhysicsState } from "@/engine/physics/types";

interface PhysicsUi {
  state: PhysicsState | null;
   
  panel: boolean;
}

export const usePhysics = create<PhysicsUi>(() => ({ state: null, panel: false }));

export const openPhysicsPanel = (open = true) => usePhysics.setState({ panel: open });

 
export function physicsFloorY(): number | null {
  const s = usePhysics.getState().state;
  return s?.enabled && typeof s.floorZ === "number" ? s.floorZ / 1000 : null;
}

 
export const usePhysicsReport = (id: string | null | undefined): BodyReport | null => usePhysics((s) => (id && s.state?.enabled ? (s.state.report[id] ?? null) : null));

type StatusReply = Omit<PhysicsState, "report"> & { report: BodyReport[] };

export async function refreshPhysics() {
  const r = await cmd<StatusReply>("physics.status", {}, { quiet: true });
  if (r) usePhysics.setState({ state: { ...r, report: Object.fromEntries(r.report.map((b) => [b.item, b])) } });
}

let started = false;

export function startPhysicsClient() {
  if (started || typeof window === "undefined") return;
  started = true;
  onServerEvent((e) => {
    if (e.type === "physics") {
      const { type: _type, full, ...rest } = e as unknown as PhysicsState & { type: string; full?: boolean };
      void _type;
      const prev = usePhysics.getState().state;
      usePhysics.setState({ state: full === false && prev ? { ...rest, report: prev.report } : rest });
    } else if (e.type === "snapshot") void refreshPhysics();
  });
   
  let held: string[] = [];
  useRC.subscribe((s, prev) => {
    if (s.drag === prev.drag) return;
    const ids = s.drag?.ids ?? [];
    if (ids.length && !held.length) {
      if (!usePhysics.getState().state?.enabled) return;
      held = ids.slice();
      void cmd("physics.hold", { items: held, held: true }, { quiet: true });
    } else if (!ids.length && held.length) {
      const release = held;
      held = [];
      void cmd("physics.hold", { items: release, held: false }, { quiet: true });
    }
  });
}
