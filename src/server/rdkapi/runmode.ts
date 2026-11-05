// Tracks API run modes and records motion into generated programs.
 
 
 
 
 
 
 
 
 

import { addInstruction } from "@/engine/commands/programs";
import { fk } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import type { InstructionData, Item } from "@/engine/types";
import { absPose, descendants, toolPose } from "@/engine/workspace";
import { broadcast, getServer } from "@/server/store";
import { cmd, mutate, ws } from "./bridge";
import type { ConnInfo } from "./context";

export const RUNMODE_SIMULATE = 1;
export const RUNMODE_QUICKVALIDATE = 2;
export const RUNMODE_MAKE_ROBOTPROG = 3;
export const RUNMODE_MAKE_ROBOTPROG_AND_UPLOAD = 4;
export const RUNMODE_MAKE_ROBOTPROG_AND_START = 5;
export const RUNMODE_RUN_ROBOT = 6;

interface Pending {
  mode: number;
  item: string | null;
  name: string;
  path: boolean;
  at: number;
  seen: boolean;
}

 
interface GenProgram {
  name: string;
  folder: string;
  post: string;
  robot: string | null;
  program: string | null;
}

interface State {
  pending: Pending | null;
  programs: Map<number, GenProgram>;
   
  paths: Map<string, number[][]>;
}

const KEY = "__robocraft_rdkapi_runmode";

function st(): State {
  const g = globalThis as unknown as Record<string, State | undefined>;
  g[KEY] ??= { pending: null, programs: new Map(), paths: new Map() };
  return g[KEY];
}

 
export const generating = (conn: ConnInfo) => conn.runMode >= RUNMODE_MAKE_ROBOTPROG && conn.runMode <= RUNMODE_MAKE_ROBOTPROG_AND_START;

 
export const quickMotion = (conn: ConnInfo) => conn.runMode >= RUNMODE_QUICKVALIDATE && conn.runMode <= RUNMODE_MAKE_ROBOTPROG_AND_START;





export function setPendingRunMode(mode: number, item: string | null, name: string, opts: { path?: boolean } = {}) {
  const s = st();
  s.pending = mode === RUNMODE_SIMULATE && !opts.path ? null : { mode, item, name, path: !!opts.path, at: Date.now(), seen: false };
  if (opts.path && item) {
    s.paths.set(item, []);
    broadcast({ type: "python-path", item, points: [] });
  }
}

 
export function clearPath(item: string) {
  if (st().paths.delete(item)) broadcast({ type: "python-path", item, points: [] });
}

export function pathOf(item: string): number[][] {
  return st().paths.get(item) ?? [];
}

 
export function connectionRunMode(): Pick<ConnInfo, "runMode" | "programName" | "pathItem"> {
  const s = st();
  const none = { runMode: RUNMODE_SIMULATE, programName: "", pathItem: null };
  const p = s.pending;
  if (!p) return none;
  const running = p.item === null || !!getServer().services.python?.isRunning(p.item);
  if (!running) {
     
    if (p.seen || Date.now() - p.at > 600_000) s.pending = null;
    return none;
  }
  p.seen = true;
  return { runMode: p.mode, programName: p.name, pathItem: p.path ? p.item : null };
}

function firstRobot(): Item | undefined {
  const w = ws();
  return w.activeStation ? descendants(w, w.activeStation).find((it) => it.type === "robot" && it.robot) : undefined;
}

async function createProgram(g: GenProgram): Promise<Item> {
  const robot = g.robot ? ws().items[g.robot] : undefined;
  const res = await cmd<{ id: string }>("program.add", { name: g.name, ...(robot ? { robot: robot.id } : {}) });
  g.program = res.id;
   
   
  if (robot?.robot) {
    const frame = robot.robot.activeFrame && ws().items[robot.robot.activeFrame] ? robot.robot.activeFrame : null;
    const tool = robot.robot.activeTool && ws().items[robot.robot.activeTool] ? robot.robot.activeTool : null;
    await mutate((w, tx) => {
      const p = w.items[res.id];
      if (frame) addInstruction(w, tx, p, { kind: "frame", frame }, p.children.at(-1) ?? null, true);
      if (tool) addInstruction(w, tx, w.items[res.id], { kind: "tool", tool }, w.items[res.id].children.at(-1) ?? null, true);
      else if (robot.robot?.tcp) addInstruction(w, tx, w.items[res.id], { kind: "tool", tool: null, pose: robot.robot.tcp }, w.items[res.id].children.at(-1) ?? null, true);
    });
  }
  return ws().items[res.id];
}






export async function programStart(conn: ConnInfo, p: { name: string; folder: string; post: string; robot: Item | null }): Promise<number> {
  if (!generating(conn)) return 0;
  await finishProgram(conn);
  const robot = p.robot ?? firstRobot();
  if (!robot) return -1;
  const g: GenProgram = { name: p.name, folder: p.folder, post: p.post, robot: robot.id, program: null };
  st().programs.set(conn.id, g);
  await createProgram(g);
  return 0;
}

 
export async function generatedProgram(conn: ConnInfo, robot: Item): Promise<Item> {
  const s = st();
  let g = s.programs.get(conn.id);
  if (!g) {
    g = { name: conn.programName || robot.name, folder: "", post: "", robot: robot.id, program: null };
    s.programs.set(conn.id, g);
  }
  const cur = g.program ? ws().items[g.program] : undefined;
  return cur ?? createProgram(g);
}

 
export async function record(conn: ConnInfo, robot: Item, data: InstructionData): Promise<void> {
  const prog = await generatedProgram(conn, robot);
  await mutate((w, tx) => {
    const p = w.items[prog.id];
    addInstruction(w, tx, p, data, p.children.at(-1) ?? null, true);
  });
}

 
export async function programFor(conn: ConnInfo, it: Item): Promise<Item> {
  return generating(conn) && it.type === "robot" && it.robot ? generatedProgram(conn, it) : it;
}

 
export function addPath(conn: ConnInfo, robot: Item, samples: number[][]) {
  if (!conn.pathItem || !robot.robot || !samples.length) return;
  const s = st();
  const pts = s.paths.get(conn.pathItem) ?? [];
  const w = ws();
  const base = absPose(w, robot.id);
  const tool = toolPose(w, robot.id);
  for (const q of samples) {
    pts.push(mul(mul(base, fk(robot.robot.model, q)), tool).slice(0, 12));
  }
  s.paths.set(conn.pathItem, pts);
  broadcast({ type: "python-path", item: conn.pathItem, robot: robot.id, points: pts });
}

 
export async function finishProgram(conn: ConnInfo): Promise<void> {
  const s = st();
  const g = s.programs.get(conn.id);
  s.programs.delete(conn.id);
  if (!g?.program || !ws().items[g.program]) return;
  try {
    await cmd("program.generate", { program: g.program, ...(g.post ? { post: g.post.replace(/\.py$/i, "") } : {}), ...(g.folder ? { folder: g.folder } : {}) });
  } finally {
    if (ws().items[g.program]) await cmd("item.delete", { items: [g.program] });
  }
}
