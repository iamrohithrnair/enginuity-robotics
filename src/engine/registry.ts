 
 
 
 

import { z } from "zod";
import type { PostService } from "./posts";
import type { Tx } from "./tx";
import type { Workspace } from "./types";

export type Origin = "ui" | "api" | "agent" | "system";

 
export interface Services {
  geometry: GeometryStore;
  library?: {
    load(file: string, kind?: LibraryEntry["kind"] | "object"): Promise<{ bytes: Uint8Array; url: string }>;
    catalog(): Promise<LibraryEntry[]>;
    search(q: Record<string, unknown>): Promise<{ total: number; items: LibraryEntry[] }>;
     
    mirror?(opts: { refresh?: boolean; concurrency?: number }): unknown;
    mirrorStatus?(): unknown;
  };
  post?: (req: PostRequest) => Promise<PostResult>;
   
  itemData?: (itemId: string) => [string, Uint8Array][];
  files?: {
     
    saveStation(name: string, data: unknown): Promise<string>;
    loadStation(path: string): Promise<unknown>;
    listStations(): Promise<string[]>;
     
    stationPath?(nameOrPath: string): string;
     
    readFile?(path: string): Promise<Uint8Array>;
     
    recent?(): string[];
    pushRecent?(path: string): void;
    clearRecent?(): void;
     
    listBackups?(): { file: string; path: string; mtime: number }[];
    writeBackup?(stationName: string, data: unknown): string;
    deleteBackups?(stationName: string): number;
    loadBackup?(path: string): Promise<unknown>;
     
    writeExport?(fileName: string, bytes: Uint8Array): string;
    



    writeStationFile?(nameOrPath: string, bytes: Uint8Array, opts?: { overwrite?: boolean }): string;
     
    exists?(nameOrPath: string): boolean;
     
    reveal?(path: string): string;
  };
  settings: Record<string, number | string | boolean>;
  setSetting?: (key: string, value: number | string | boolean) => void;
  emit?: (event: { type: string; [k: string]: unknown }) => void;
  undo?: {
    undo(): unknown;
    redo(): unknown;
    list(): unknown;
    clear(): void;
    drop(station: string): void;
     
    setLimit?(limit: number): boolean;
     
    undoTo?(index: number): unknown;
     
    isClean?(station: string): boolean;
    setClean?(station: string): void;
  };
   
  view?: {
     
    clients(): number;
     
    screenshot(opts: { file: string; white: boolean }): Promise<{ path: string; width: number; height: number }>;
     
    pose?(): number[] | null;
  };
   
  cad?: {
     
    importCad(bytes: Uint8Array, ext: string): Promise<{ meshes: { triangles: Float32Array; color: [number, number, number, number]; part?: number }[]; parts?: string[]; faces?: number; failed?: number }>;
  };
   
  ask?(html: string, buttons: string[], title?: string): Promise<string>;
   
  prompt?(html: string, buttons: string[], title: string, input: string): Promise<{ button: string; text: string }>;
   
  progress?(html: string, title: string): { close(): void };
   
  posts?: PostService;
   
  api?: {
     
    setPendingRunMode(mode: number, item: string | null, name: string, opts?: { path?: boolean }): void;
     
    clearPath(item: string): void;
  };
   
  python?: {
     
    start(key: string, name: string, code: string, opts?: { file?: string; args?: string[] }): boolean;
    stop(key: string): boolean;
    isRunning(key: string): boolean;
     
    saveScript(name: string, code: string, opts?: { agent?: boolean }): string;
     
    fileState(file: string): { full: string; exists: boolean; agentWritten: boolean; contentHash: string | null; text?: string };
     
    startFile(key: string, name: string, file: string): string | null;
    hash(code: string): string;
  };
   
  runner?: {
     
    start(programId: string, opts: { loop?: boolean; startAt?: number; count?: number }): void;
    stopAll(): void;
    moveRobot(robotId: string, joints: number[], kind: "joint" | "linear"): void;
     
    moveRobotArc?(robotId: string, via: number[], end: number[]): void;
     
    skipWait?(programId?: string): string[];
     
    liveJoints?(robotId: string): number[] | undefined;
  };
   
  scripts?: import("./scripts").ScriptServices;
   
  decisions?: import("./decisions").DecisionServices;
   
  examples?: {
     
    list(): Promise<(import("./examples").ExampleEntry & { missing: string[] })[]>;
     
    load(slug: string): Promise<unknown>;
  };
   
  simRecorder?: import("./simExport").SimRecorderService;
   
  simViewerScript?(): string;
   
  simready?: {
    search(q: { query?: string; category?: string; limit?: number; offset?: number }): Promise<{
      total: number;
      items: { id: string; name: string; category: string; tags?: string[] }[];
      categories: { value: string; count: number }[];
      error?: string;
    }>;
     
    prepare(id: string, opts?: { textures?: boolean }): Promise<SimReadyPrepared>;
    status(): unknown;
  };
}

 
export interface SimReadyPrepared {
  id: string;
  name: string;
  category: string;
  parts: import("./meshformats").MeshPart[];
  triangles: number;
   
  bbox: { min: [number, number, number]; max: [number, number, number] };
   
  size: [number, number, number];
   
  physics?: { mass?: number; density?: number; staticFriction?: number; dynamicFriction?: number; restitution?: number; rigidBody?: boolean; kinematic?: boolean; collisionApproximation?: string };
  warnings: string[];
   
  cached: boolean;
   
  downloadedBytes: number;
   
  bytes: number;
  ms: number;
}

export interface GeometryStore {
  put(triangles: Float32Array, id?: string): string;
  get(id: string): Float32Array | undefined;
}

export interface LibraryEntry {
  id: string;
  name: string;
  file: string;
  image?: string;
  brand?: string;
  model?: string;
  type?: string;
  kind: "robot" | "tool" | "object" | "station" | "axis";
  axes?: number;
  reach?: number;
  payload?: number;
  weight?: number;
  repeatability?: number;
  applications?: string[];
}

export interface PostRequest {
  post: string;
  program: unknown;
  outDir?: string;
}
export interface PostResult {
  ok: boolean;
  files: { name: string; content: string; encoding?: "utf-8" | "base64"; path?: string }[];
  log: string;
  error?: string;
}

export interface CmdCtx {
  ws: Workspace;
  tx: Tx;
  origin: Origin;
  services: Services;
   
  undoLabel?: string | null;
}

export interface CommandDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  category:
    | "station"
    | "item"
    | "robot"
    | "target"
    | "program"
    | "simulation"
    | "view"
    | "library"
    | "edit"
    | "settings"
    | "tools"
    | "query";
  schema: S;
   
  undoable?: boolean;
   
  readonly?: boolean;
   
  shortcut?: string;
   
  spec?: string;
   
  internal?: boolean;
  



  detached?: boolean;
  run(ctx: CmdCtx, params: z.infer<S>): unknown | Promise<unknown>;
}

const commands = new Map<string, CommandDef>();

export function defineCommand<S extends z.ZodTypeAny>(def: CommandDef<S>): CommandDef<S> {
   
  commands.set(def.name, def as unknown as CommandDef);
  return def;
}

export const getCommand = (name: string) => commands.get(name);
export const allCommands = () => [...commands.values()];





export function status(ctx: Pick<CmdCtx, "services">, text: string, ms = 10000) {
  ctx.services.emit?.({ type: "status", text, ms });
}

export class CommandError extends Error {
  constructor(message: string, readonly code = "command_failed") {
    super(message);
  }
}

 
export const ItemRef = z.union([z.string(), z.number()]).describe("Item id, exact item name, or numeric handle");
export const Pose = z.array(z.number()).length(16).describe("4x4 pose matrix, row-major, mm");
export const XYZRPW = z
  .array(z.number())
  .length(6)
  .describe("[x, y, z, rx, ry, rz] in mm and degrees; pose = transl·rotz(rz)·roty(ry)·rotx(rx)");
export const Joints = z.array(z.number()).describe("joint values in degrees (rotary) or mm (linear)");
