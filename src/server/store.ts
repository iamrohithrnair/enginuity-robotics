// Maintains shared server workspace state, serialized commands and event delivery.
 
 
 

import "server-only";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { dispatch, type DispatchResult } from "@/engine/dispatch";
import { initKinematics } from "@/engine/kinematics";
import { getCommand, type GeometryStore, type Origin, type Services } from "@/engine/registry";
import { UndoGroup, type UndoMacro, type UndoStack } from "@/engine/tx";
import type { Workspace, WorkspacePatch } from "@/engine/types";
import { clone, createWorkspace } from "@/engine/workspace";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import "@/engine/commands";
import { publicSettings } from "./util";
 
import "./simRecorder";

export const DATA_DIR = process.env.ROBOCRAFT_DATA_DIR ?? path.join(  process.cwd(), "data");

export type ServerEvent =
  | { type: "patch"; patch: WorkspacePatch }
  | { type: "snapshot"; ws: Workspace }
  | { type: string; [k: string]: unknown };

class DiskGeometryStore implements GeometryStore {
  private mem = new Map<string, Float32Array>();
  private dir = path.join(DATA_DIR, "geometry");
  constructor() {
    mkdirSync(this.dir, { recursive: true });
  }
  put(triangles: Float32Array, id?: string): string {
    const bytes = new Uint8Array(triangles.buffer, triangles.byteOffset, triangles.byteLength);
    const key = id ?? createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    if (!this.mem.has(key)) {
      this.mem.set(key, triangles);
      const f = path.join(this.dir, `${key}.f32`);
      if (!existsSync(f)) writeFileSync(f, bytes);
    }
    return key;
  }
  get(id: string): Float32Array | undefined {
    const hit = this.mem.get(id);
    if (hit) return hit;
    const f = path.join(this.dir, `${id.replace(/[^a-z0-9_-]/gi, "")}.f32`);
    if (!existsSync(f)) return undefined;
    const b = readFileSync(f);
    const arr = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    this.mem.set(id, arr);
    return arr;
  }
}

function loadSettings(): Record<string, number | string | boolean> {
  const f = path.join(DATA_DIR, "settings.json");
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(f, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export interface ServerState {
  ws: Workspace;
   
  undo: UndoGroup;
  services: Services;
  listeners: Set<(e: ServerEvent) => void>;
  ready: Promise<void>;
  queue: Promise<unknown>;
   
  flags: Record<string, string>;
   
  runner?: import("./runner").Runner;
}

declare global {
  var __robocraft: ServerState | undefined;
}

function create(): ServerState {
  mkdirSync(DATA_DIR, { recursive: true });
  const settings = loadSettings();
  const listeners = new Set<(e: ServerEvent) => void>();
  const emit = (e: ServerEvent) => {
    for (const l of listeners) {
      try {
        l(e);
      } catch {
         
      }
    }
  };
  const state: ServerState = {
    ws: createWorkspace(),
    undo: new UndoGroup(Number(settings.UndoStackLimit ?? 0)),
    listeners,
    flags: { Popups: "1" },
    queue: Promise.resolve(),
    ready: Promise.resolve(),
    services: {
      geometry: new DiskGeometryStore(),
      settings,
      setSetting(key, value) {
        settings[key] = value;
         
        const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULT_SETTINGS[k] !== v));
        writeFileSync(path.join(DATA_DIR, "settings.json"), JSON.stringify(changed, null, 2));
        emit({ type: "settings", settings: publicSettings(settings) });
      },
      emit,
    },
  };
  state.ready = (async () => {
    await initKinematics();
    const { attachServerServices } = await import("./services");
    attachServerServices(state);
     
    await run("station.new", {}, "system");
    state.undo.clearAll();
  })();
   
   
   
   
  const example = process.env.ENGINUITY_DEFAULT_EXAMPLE;
  if (example)
    void state.ready.then(async () => {
      await run("view.setDisplay", { frames: false }, "system");
      const blank = state.ws.activeStation;
      const opened = await run("examples.open", { example }, "system");
      if (opened.ok && blank) await run("station.close", { station: blank, ifUnsaved: "discard" }, "system");
       
      const main = opened.ok ? (opened.result as { mainProgram?: string }).mainProgram : undefined;
      if (main) await run("edit.select", { items: [main] }, "system");
      state.undo.clearAll();
    });
  return state;
}

export function getServer(): ServerState {
  if (!globalThis.__robocraft) globalThis.__robocraft = create();
  return globalThis.__robocraft;
}

 
export function activeUndo(): UndoStack {
  const s = getServer();
  return s.undo.active(s.ws);
}





export function clearUndo() {
  activeUndo().clear();
  broadcast({ type: "undo", undo: activeUndo().list() });
}

export function broadcast(e: ServerEvent) {
  getServer().services.emit?.(e);
}






const PATCH_BATCH_MS = 150;
let patchBatch: { ids: Set<string>; meta: Set<string>; timer: ReturnType<typeof setTimeout> } | null = null;

function queuePatch(p: WorkspacePatch) {
  patchBatch ??= { ids: new Set(), meta: new Set(), timer: setTimeout(() => void exclusive(flushPatches), PATCH_BATCH_MS) };
  for (const u of p.upserts) patchBatch.ids.add(u.id);
  for (const id of p.removes) patchBatch.ids.add(id);
  for (const k of Object.keys(p.meta ?? {})) patchBatch.meta.add(k);
}

 
export function flushPatches() {
  const b = patchBatch;
  if (!b) return;
  patchBatch = null;
  clearTimeout(b.timer);
  const ws = getServer().ws;
  const meta: Record<string, unknown> = {};
  for (const k of b.meta) meta[k] = clone((ws as unknown as Record<string, unknown>)[k]);
  const ids = [...b.ids];
  broadcast({
    type: "patch",
    patch: {
      rev: ws.rev,
      upserts: ids.filter((id) => ws.items[id]).map((id) => clone(ws.items[id])),
      removes: ids.filter((id) => !ws.items[id]),
      ...(b.meta.size ? { meta: meta as WorkspacePatch["meta"] } : {}),
    },
  });
}

 
export function exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
  const s = getServer();
  const job = s.queue.then(fn);
  s.queue = job.catch(() => undefined);
  return job;
}





export function run(name: string, params: unknown, origin: Origin, opts: { macro?: UndoMacro; station?: string | null } = {}): Promise<DispatchResult> {
  const s = getServer();
   
  if (getCommand(name)?.detached) {
    return (async () => {
      await s.ready;
      await initKinematics();
      return dispatch(s.ws, s.undo.active(s.ws), s.services, name, params, origin, opts);
    })();
  }
  const job = s.queue.then(async () => {
    if (name !== "station.new" || origin !== "system") await s.ready;
     
    await initKinematics();
    const res = await dispatch(s.ws, s.undo.active(s.ws), s.services, name, params, origin, opts);
     
    if (res.patch) {
      if (opts.macro) queuePatch(res.patch);
      else broadcast({ type: "patch", patch: res.patch });
    }
    return res;
  });
  s.queue = job.catch(() => undefined);
  return job;
}
