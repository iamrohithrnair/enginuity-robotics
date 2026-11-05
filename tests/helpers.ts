// Creates engine test harnesses with geometry storage, command dispatch, and undo support.
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { TestRunner, type RunnerTestCase } from "vitest";
import { dispatch } from "@/engine/dispatch";
import { initKinematics, parseRobotFile } from "@/engine/kinematics";
import type { GeometryStore, Origin, Services } from "@/engine/registry";
import { UndoGroup } from "@/engine/tx";
import type { Workspace } from "@/engine/types";
import { createWorkspace } from "@/engine/workspace";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { findLibraryFile, LIBRARY_FILE, libraryMissing } from "./library";
import "@/engine/commands";

 
export { findLibraryFile, hasLibraryFile, LIBRARY_DIR, LIBRARY_FILE, LIBRARY_KIND_DIR, qUncompress, type LibraryKind } from "./library";

export const ROOT = path.resolve(__dirname, "..");
 
export const ROBOT_FILE = (name: string) => LIBRARY_FILE("robots", name);






export function skipWithoutLibrary(name: string): never {
  const note = libraryMissing(name);
  const test = TestRunner.getCurrentTest<RunnerTestCase | undefined>();
  if (test) test.context.skip(note);
  throw new Error(`${note}; npm run library:mirror creates the mirror`);
}

class MemGeometry implements GeometryStore {
  private m = new Map<string, Float32Array>();
  private n = 0;
  put(t: Float32Array) {
    const id = `g${++this.n}`;
    this.m.set(id, t);
    return id;
  }
  get(id: string) {
    return this.m.get(id);
  }
}

export async function engine() {
  await initKinematics();
  const ws: Workspace = createWorkspace();
  const group = new UndoGroup(500);
  const undo = {
    get stack() {
      return group.active(ws);
    },
    undo: () => group.active(ws).undo(ws),
    redo: () => group.active(ws).redo(ws),
    list: () => group.active(ws).list(),
    clear: () => group.active(ws).clear(),
    group,
  };
  const events: { type: string; [k: string]: unknown }[] = [];
   
  let missing: string | undefined;
  const services: Services = {
    geometry: new MemGeometry(),
    settings: { ...DEFAULT_SETTINGS },
    setSetting(k, v) {
      services.settings[k] = v;
    },
    emit: (e) => events.push(e),
    library: {
       
      async load(file, kind) {
        const p = findLibraryFile(file, kind);
        if (!p) {
          missing = file;
          skipWithoutLibrary(file);
        }
        return { bytes: new Uint8Array(readFileSync(p)), url: `file://${file}` };
      },
      async catalog() {
        return [];
      },
      async search() {
        return { total: 0, items: [] };
      },
    },
  };
  services.undo = {
    undo: () => {
      const p = undo.undo();
      return { undone: !!p };
    },
    redo: () => {
      const p = undo.redo();
      return { redone: !!p };
    },
    list: () => undo.list(),
    clear: () => undo.clear(),
    drop: (station) => group.drop(station),
    undoTo: (index) => {
      group.active(ws).undoTo(ws, index);
      return { index: group.active(ws).index };
    },
    isClean: (station) => group.stack(station).isClean(),
    setClean: (station) => group.stack(station).setClean(),
  };
  const skipIfMissing = () => {
    if (missing === undefined) return;
    const file = missing;
    missing = undefined;
    skipWithoutLibrary(file);
  };
  const run = async (name: string, params: Record<string, unknown> = {}, origin: Origin = "system") => {
    const r = await dispatch(ws, group.active(ws), services, name, params, origin);
    skipIfMissing();
    if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
    return r.result as Record<string, unknown> & unknown[];
  };
  const tryRun = async (name: string, params: Record<string, unknown> = {}, origin: Origin = "system") => {
    const r = await dispatch(ws, group.active(ws), services, name, params, origin);
    skipIfMissing();
    return r;
  };
  await run("station.new");
  undo.clear();
  return { ws, undo, services, run, tryRun, events };
}

export function parseFile(name: string) {
  const p = findLibraryFile(name, "robot");
  if (!p) skipWithoutLibrary(name);
  return parseRobotFile(new Uint8Array(readFileSync(p)));
}

export const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;
