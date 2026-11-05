// Samples robot TCP motion and broadcasts trace paths.
 
 
 
 

import "server-only";
import { fk } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { viewOf } from "@/engine/view";
import { absPose, toolPose } from "@/engine/workspace";
import type { ServerEvent, ServerState } from "./store";

 
export type TraceSample = number[];

const MAX_SAMPLES = 4000;
const MIN_STEP_MM = 0.5;

interface TraceState {
  paths: Map<string, TraceSample[]>;
  reset: number;
  attached: boolean;
}

declare global {
  var __robocraft_trace: TraceState | undefined;
}

function trace(): TraceState {
  if (!globalThis.__robocraft_trace) globalThis.__robocraft_trace = { paths: new Map(), reset: 0, attached: false };
  return globalThis.__robocraft_trace;
}

export function tracePaths(): Record<string, TraceSample[]> {
  return Object.fromEntries(trace().paths);
}

function tcpSample(ws: Workspace, robot: Item, joints: number[]): TraceSample {
  const m = mul(mul(absPose(ws, robot.id), fk(robot.robot!.model, joints)), toolPose(ws, robot.id));
  return m.slice(0, 12);
}

 
export function recordSample(ws: Workspace, robot: Item, joints: number[]): TraceSample | null {
  const t = trace();
  const sample = tcpSample(ws, robot, joints);
  const list = t.paths.get(robot.id) ?? [];
  const last = list[list.length - 1];
  if (last && Math.hypot(sample[3] - last[3], sample[7] - last[7], sample[11] - last[11]) < MIN_STEP_MM) return null;
  list.push(sample);
  if (list.length > MAX_SAMPLES) list.shift();
  t.paths.set(robot.id, list);
  return sample;
}

export function attachTrace(state: ServerState) {
  const t = trace();
  if (t.attached) return;
  t.attached = true;
  t.reset = viewOf(state.ws).traceReset;
  const emit = (e: ServerEvent) => state.services.emit?.(e);
  const onEvent = (e: ServerEvent) => {
    const ws = state.ws;
    const v = viewOf(ws);
    if (v.traceReset !== t.reset) {
      t.reset = v.traceReset;
      t.paths.clear();
      emit({ type: "trace-reset" });
    }
    if (!v.trace) return;
    try {
      if (e.type === "live") {
        const r = ws.items[String(e.robot)];
        if (r?.robot && Array.isArray(e.joints)) {
          const s = recordSample(ws, r, e.joints as number[]);
          if (s) emit({ type: "trace", robot: r.id, samples: [s] });
        }
      } else if (e.type === "patch") {
        const ups = (e.patch as { upserts: Item[] }).upserts;
        for (const up of ups) {
          const r = ws.items[up.id];
          if (r?.type !== "robot" || !r.robot) continue;
          const s = recordSample(ws, r, r.robot.joints);
          if (s) emit({ type: "trace", robot: r.id, samples: [s] });
        }
      }
    } catch {
       
    }
  };
  state.listeners.add(onEvent);
}
