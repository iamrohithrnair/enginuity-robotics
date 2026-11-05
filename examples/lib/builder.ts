// Provides helpers for constructing example cells, targets, and robot programs.
 
 

import { fk, ikClosest } from "@/engine/kinematics";
import { DEG, inv, mul, rotx, roty, rotz, transl, xyzrpwToPose, type Mat } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { absPose, toolPose } from "@/engine/workspace";

export type V3 = [number, number, number];
 
export type Pose6 = [number, number, number, number?, number?, number?];
export type RGBA = number[];

 
export const C = {
  base: [0.3, 0.31, 0.33],
  dark: [0.2, 0.21, 0.23],
  steel: [0.58, 0.6, 0.63],
  frame: [0.68, 0.7, 0.72],
  light: [0.84, 0.85, 0.86],
  white: [0.94, 0.94, 0.95],
  belt: [0.16, 0.17, 0.18],
  accent: [0.145, 0.388, 0.922],
  accentSoft: [0.6, 0.71, 0.95],
  good: [0.09, 0.64, 0.29],
  bad: [0.86, 0.15, 0.15],
  amber: [0.96, 0.62, 0.04],
  glass: [0.74, 0.82, 0.9, 0.35],
} satisfies Record<string, RGBA>;

export interface Part {
  shape: "box" | "cylinder" | "sphere" | "roundedBox" | "tube" | "extrusion";
   
  size?: V3;
  radius?: number;
  height?: number;
  corner?: number;
  inner?: number;
  profile?: number[][];
  at?: Pose6;
  color: RGBA;
}

export const box = (size: V3, at: Pose6, color: RGBA): Part => ({ shape: "box", size, at, color });
export const rbox = (size: V3, corner: number, at: Pose6, color: RGBA): Part => ({ shape: "roundedBox", size, corner, at, color });
export const cyl = (radius: number, height: number, at: Pose6, color: RGBA): Part => ({ shape: "cylinder", radius, height, at, color });
export const tube = (radius: number, inner: number, height: number, at: Pose6, color: RGBA): Part => ({ shape: "tube", radius, inner, height, at, color });
export const extrusion = (profile: number[][], height: number, at: Pose6, color: RGBA): Part => ({ shape: "extrusion", profile, height, at, color });
export const sphere = (radius: number, at: Pose6, color: RGBA): Part => ({ shape: "sphere", radius, at, color });

export const pose6 = (p: Pose6): Mat => xyzrpwToPose([p[0], p[1], p[2], p[3] ?? 0, p[4] ?? 0, p[5] ?? 0]);
const xyzrpw = (p: Pose6) => [p[0], p[1], p[2], p[3] ?? 0, p[4] ?? 0, p[5] ?? 0];

 
export const down = (x: number, y: number, z: number, rz = 0): Mat => mul(mul(transl(x, y, z), rotz(rz * DEG)), rotx(Math.PI));
 
export const along = (p: Mat, dz: number, dx = 0, dy = 0): Mat => mul(p, transl(dx, dy, dz));
export { DEG, inv, mul, rotx, roty, rotz, transl, type Mat };

 
export function slotProfile(s: number): number[][] {
  const h = s / 2;
  const slot = s * 0.16;
  const lip = s * 0.12;
  const pts: number[][] = [];
   
  const side = (a: number) => {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const p = (u: number, v: number) => pts.push([u * c - v * sn, u * sn + v * c]);
    p(h, -h);
    p(h, -slot);
    p(h - lip, -slot);
    p(h - lip, slot);
    p(h, slot);
  };
  for (let k = 0; k < 4; k++) side((k * Math.PI) / 2);
  return pts;
}

type Run = (name: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export class ExampleBuilder {
   
  readonly library = new Map<string, { file: string; kind: "robot" | "tool" | "axis" }>();
  readonly robots: string[] = [];
  readonly tools: string[] = [];
  station = "";

  constructor(
    private readonly runCommand: Run,
    private readonly workspace: () => Workspace,
  ) {}

  get ws(): Workspace {
    return this.workspace();
  }

  item(id: string): Item {
    const it = this.ws.items[id];
    if (!it) throw new Error(`No item ${id}`);
    return it;
  }

  async cmd<T = Record<string, unknown>>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    const r = await this.runCommand(name, params);
    if (!r.ok) throw new Error(`${name} failed: ${r.error}\n${JSON.stringify(params).slice(0, 400)}`);
    return r.result as T;
  }

  private async id(name: string, params: Record<string, unknown>): Promise<string> {
    return (await this.cmd<{ id: string }>(name, params)).id;
  }

  async newStation(name: string): Promise<string> {
    this.station = await this.id("station.new", { name });
    return this.station;
  }

   

  private shapeParams(part: Part): Record<string, unknown> {
    const p: Record<string, unknown> = { shape: part.shape, color: part.color };
    if (part.size) Object.assign(p, { sizeX: part.size[0], sizeY: part.size[1], sizeZ: part.size[2] });
    if (part.radius !== undefined) p.radius = part.radius;
    if (part.height !== undefined) p.height = part.height;
    if (part.corner !== undefined) p.cornerRadius = part.corner;
    if (part.inner !== undefined) p.innerRadius = part.inner;
    if (part.profile) p.profile = part.profile;
    return p;
  }

   
  async shape(name: string, part: Part, parent?: string): Promise<string> {
    return this.id("object.addShape", { ...this.shapeParams(part), name, parent: parent ?? this.station, xyzrpw: xyzrpw(part.at ?? [0, 0, 0]) });
  }

  




  async assembly(name: string, parts: Part[], at: Pose6 = [0, 0, 0], parent?: string): Promise<string> {
    const ids: string[] = [];
    for (const [i, part] of parts.entries()) ids.push(await this.shape(`${name} ${i + 1}`, part, this.station));
    const first = ids[0];
    if (ids.length > 1) await this.cmd("object.merge", { items: ids });
    await this.cmd("object.setGeometryPose", { item: first, pose: pose6(parts[0].at ?? [0, 0, 0]), apply: true });
    if (parent && parent !== this.station) await this.cmd("item.setParent", { item: first, parent });
    await this.cmd("item.setPose", { item: first, xyzrpw: xyzrpw(at) });
    await this.cmd("item.rename", { item: first, name });
    return first;
  }

   

  async frame(name: string, at: Pose6, parent?: string): Promise<string> {
    return this.id("item.addFrame", { name, parent: parent ?? this.station, xyzrpw: xyzrpw(at) });
  }

   
  async notes(name: string, html: string): Promise<string> {
    return this.id("item.addNotes", { name, text: html });
  }

  






  async linearAxis(name: string, body: string, lower: number, upper: number, moving: string | null = null): Promise<{ robot: string; carrier: string }> {
    const at = this.item(body).pose.slice();
    const r = await this.cmd<{ id: string }>("mechanism.build", {
      type: 4,
      name,
      objects: [body, moving],
       
      base: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1],
      lower: [lower],
      upper: [upper],
    });
    const base = this.item(r.id).parent!;
    await this.cmd("item.setPose", { item: base, pose: at });
    await this.cmd("item.delete", { items: moving ? [body, moving] : [body] });
    const carrier = await this.id("item.addFrame", { name: `${name} Carrier`, parent: r.id, pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    return { robot: r.id, carrier };
  }

   
  async carry(objects: string[], holder: string) {
    for (const o of objects) await this.cmd("item.setParent", { item: o, parent: holder, keepAbsolute: true });
  }

   
  async robot(file: string, at: Pose6, opts: { name?: string; home?: number[]; parent?: string; kind?: "robot" | "tool" } = {}): Promise<string> {
    const r = await this.cmd<{ id: string }>("library.load", { file, kind: opts.kind ?? "robot", parent: opts.parent ?? this.station, xyzrpw: xyzrpw(at) });
    this.library.set(r.id, { file, kind: opts.kind ?? "robot" });
     
     
    const model = this.item(r.id).robot!.model;
    const raise = model.base[11] < 0 && model.nq === 6 && model.mech !== 5 ? -model.base[11] : 0;
    if (raise) await this.cmd("item.setPose", { item: this.item(r.id).parent!, xyzrpw: xyzrpw([at[0], at[1], at[2] + raise, at[3], at[4], at[5]]) });
    if (opts.kind === "tool") this.tools.push(file);
    else this.robots.push(file);
    if (opts.name) {
      await this.cmd("item.rename", { item: r.id, name: opts.name });
      const base = this.item(r.id).parent;
      if (base) await this.cmd("item.rename", { item: base, name: `${opts.name} Base` });
    }
    if (opts.home) {
      await this.cmd("robot.setJoints", { robot: r.id, joints: opts.home });
      await this.cmd("robot.setHome", { robot: r.id, joints: opts.home });
    }
    return r.id;
  }

   
  async tool(file: string, robot: string, opts: { name?: string; tcp?: Mat } = {}): Promise<string> {
    const r = await this.cmd<{ id: string }>("library.load", { file, kind: "tool", robot });
    this.library.set(r.id, { file, kind: "tool" });
    this.tools.push(file);
    if (opts.name) await this.cmd("item.rename", { item: r.id, name: opts.name });
    if (opts.tcp) await this.cmd("item.setPose", { item: r.id, pose: opts.tcp });
    return r.id;
  }

   

  



  async target(name: string, frame: string, robot: string, pose: Mat, seed?: number[]): Promise<string> {
    if (seed) await this.cmd("robot.setJoints", { robot, joints: seed });
    const id = await this.id("target.add", { name, parent: frame, robot, pose });
    this.checkReach(id, robot);
     
    await this.cmd("robot.setJoints", { robot, joints: this.item(id).target!.joints });
    return id;
  }

  



  bestTurn(robot: string, frame: string, make: (deg: number) => Mat, seed: number[]): { deg: number; pose: Mat } | null {
    const ws = this.ws;
    const r = this.item(robot);
    const model = r.robot!.model;
    const toBase = mul(inv(absPose(ws, robot)), absPose(ws, frame));
    const tool = toolPose(ws, robot);
    let best: { deg: number; pose: Mat; cost: number } | null = null;
    for (let deg = 0; deg < 360; deg += 15) {
      const pose = make(deg);
      const q = ikClosest(model, mul(mul(toBase, pose), inv(tool)), seed);
      if (!q) continue;
      const cost = Math.max(...q.map((v, i) => Math.abs(v - seed[i])));
      if (!best || cost < best.cost) best = { deg, pose, cost };
    }
    return best && { deg: best.deg, pose: best.pose };
  }

  async jointTarget(name: string, frame: string, robot: string, joints: number[]): Promise<string> {
    return this.id("target.add", { name, parent: frame, robot, joints, isJoint: true });
  }

   
  checkReach(target: string, robot: string) {
    const ws = this.ws;
    const t = this.item(target);
    const r = this.item(robot);
    const tcp = mul(mul(absPose(ws, robot), fk(r.robot!.model, t.target!.joints)), toolPose(ws, robot));
    const want = absPose(ws, target);
    const d = Math.hypot(tcp[3] - want[3], tcp[7] - want[7], tcp[11] - want[11]);
    let rot = 0;
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) rot = Math.max(rot, Math.abs(tcp[k] - want[k]));
    if (d > 0.05 || rot > 1e-3) throw new Error(`${r.name} cannot reach ${t.name} (${d.toFixed(1)} mm off)`);
  }

   

  async program(name: string, robot: string): Promise<Program> {
    const id = await this.id("program.add", { name, robot });
    return new Program(this, id, name);
  }
}

export class Program {
  private last: string | undefined;

  constructor(
    private readonly b: ExampleBuilder,
    readonly id: string,
    readonly name: string,
  ) {}

  private async add(command: string, params: Record<string, unknown>): Promise<string> {
    const r = await this.b.cmd<{ id: string }>(command, { program: this.id, ...(this.last ? { after: this.last } : {}), ...params });
    this.last = r.id;
    return r.id;
  }

  moveJ(target: string) {
    return this.add("program.addMoveJ", { target });
  }
  moveL(target: string) {
    return this.add("program.addMoveL", { target });
  }
  moveC(via: string, target: string) {
    return this.add("program.addMoveC", { via, target });
  }
  speed(linear: number, joint?: number, linearAccel?: number, jointAccel?: number) {
    return this.add("program.addInstruction", { kind: "speed", linear, ...(joint !== undefined ? { joint } : {}), ...(linearAccel !== undefined ? { linearAccel } : {}), ...(jointAccel !== undefined ? { jointAccel } : {}) });
  }
  rounding(mm: number) {
    return this.add("program.addInstruction", { kind: "rounding", rounding: mm });
  }
  pause(ms: number) {
    return this.add("program.addInstruction", { kind: "pause", pauseMs: ms });
  }
  setDO(name: string, value: number | string) {
    return this.add("program.addInstruction", { kind: "io", ioMode: "set", ioName: name, ioValue: String(value) });
  }
  waitDI(name: string, value: number | string, timeoutMs?: number) {
    return this.add("program.addInstruction", { kind: "io", ioMode: "wait", ioName: name, ioValue: String(value), ...(timeoutMs ? { timeoutMs } : {}) });
  }
  call(program: string) {
    return this.add("program.addInstruction", { kind: "call", text: program });
  }
  thread(program: string) {
    return this.add("program.addInstruction", { kind: "thread", text: program });
  }
  message(text: string) {
    return this.add("program.addInstruction", { kind: "print", text });
  }
  comment(text: string) {
    return this.add("program.addInstruction", { kind: "comment", text });
  }
  setTool(tool: string) {
    return this.add("program.addInstruction", { kind: "tool", tool });
  }
  setFrame(frame: string) {
    return this.add("program.addInstruction", { kind: "frame", frame });
  }
   
  attach(tool: string) {
    return this.add("program.addInstruction", { kind: "event", eventAction: "attach", tool });
  }
   
  detach(tool: string, frame: string) {
    return this.add("program.addInstruction", { kind: "event", eventAction: "detach", tool, frame });
  }
   
  home(robots: string[]) {
    return this.add("program.addInstruction", { kind: "event", eventAction: "home", objects: robots });
  }
  show(objects: string[]) {
    return this.add("program.addInstruction", { kind: "event", eventAction: "show", objects });
  }
  hide(objects: string[]) {
    return this.add("program.addInstruction", { kind: "event", eventAction: "hide", objects });
  }
   
  async resetObjects() {
    const id = await this.add("program.addInstruction", { kind: "event", eventAction: "show", objects: [] });
    await this.b.cmd("event.recordAllObjects", { instruction: id });
    return id;
  }
  decision(params: Record<string, unknown>) {
    return this.add("program.addDecision", params);
  }
}
