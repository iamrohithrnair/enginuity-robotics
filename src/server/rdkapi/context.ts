 

import type { Mat } from "@/engine/math";
import type { Item } from "@/engine/types";
import type { WireReader, WireWriter } from "./codec";

export interface ConnInfo {
  id: number;
  remote: string;
   
  safeMode: boolean;
  autoUpdate: number;
  skipStatus: boolean;
   
  runMode: number;
   
  programName: string;
   
  pathItem: string | null;
}

export interface Ctx {
  r: WireReader;
  w: WireWriter;
  conn: ConnInfo;
   
  exec<T>(fn: () => T | Promise<T>): Promise<T>;
   
  flush(): void;
   
  startEvents(filter: number[] | null): void;
}

 
export type Handler = (c: Ctx) => Promise<void | "raw">;

export interface CommandSpec {
  name: string;
   
  resp: string;
  run: Handler;
}

export const COMMANDS = new Map<string, CommandSpec>();

export function def(name: string, resp: string, run: Handler) {
  COMMANDS.set(name, { name, resp, run });
}






export interface CommandHook {
  before?(name: string, conn: ConnInfo): void;
   
  after?(name: string, conn: ConnInfo, reply: WireWriter): void | Promise<void>;
}
export const COMMAND_HOOKS = new Map<string, CommandHook>();

let tail: Promise<unknown> = Promise.resolve();





export function withApiLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const job = tail.then(() => fn());
  tail = job.catch(() => undefined);
  return job;
}

 
export interface ApiState {
   
  runMode: number;
   
  scmd: Record<string, string>;
   
  dataParams: Map<string, Map<string, Buffer>>;
   
  itemData: Map<string, Map<string, Buffer>>;
   
  copyBuffer: { roots: string[]; items: Item[] } | null;
   
  insRef: Map<string, string>;
   
  lastTargetless: Map<string, string>;
   
  treeExpanded: Map<string, boolean>;
   
  viewPose: Mat | null;
   
  itemFlags: Map<string, number>;
  rdkFlags: number;
  startedAt: number;
}

const KEY = "__robocraft_rdkapi_state";

export function apiState(): ApiState {
  const g = globalThis as unknown as Record<string, ApiState | undefined>;
  if (!g[KEY]) {
    g[KEY] = {
      runMode: 1,
      scmd: {},
      dataParams: new Map(),
      itemData: new Map(),
      copyBuffer: null,
      insRef: new Map(),
      lastTargetless: new Map(),
      treeExpanded: new Map(),
      viewPose: null,
      itemFlags: new Map(),
      rdkFlags: -1,
      startedAt: Date.now(),
    };
  }
  return g[KEY]!;
}
