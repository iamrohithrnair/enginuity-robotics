// Coordinates physics stepping, object updates and workspace event broadcasts.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { inv, mul, poseDistance, type Mat } from "../math";
import type { Services } from "../registry";
import { Tx } from "../tx";
import type { Item, Workspace, WorkspacePatch } from "../types";
import { AUTO, decide, type Candidate } from "./classify";
import { loadRapier } from "./rapier";
import { collectSpecs, floorHeight, Frames, type BodySpec } from "./scene";
import { FRAME_S, PHYSICS_DEFAULTS, PHYSICS_KEYS, roleText, type BodyReport, type PhysicsCounts, type PhysicsState } from "./types";
import { lerpTf, PhysicsWorld, toMat, toTf, type BodyRec, type Tf, type Why } from "./world";


export type ServerEvent = { type: string; [k: string]: unknown };

 
export interface PhysicsHost {
   
  schedule<T>(fn: () => T | Promise<T>): Promise<T>;
   
  subscribe(fn: (e: ServerEvent) => void): () => void;
}

const TICK_MS = 16;
 
const MAX_FRAMES = 600;
 
const TICK_BUDGET_MS = 12;
 
const GRACE_MS = 250;
 
const LEASE_TICKS = 60;
 
const SWEEP_MAX_SPEED = 10;  
const SWEEP_MAX_TURN = 30;  
 
const WAKE_MARGIN = 10;
 
const EPS_MM = 1e-3;
const EPS_ROT = 1e-6;

 
function tooFast(a: Tf, b: Tf, seconds: number): boolean {
  const dx = Math.hypot(b.t[0] - a.t[0], b.t[1] - a.t[1], b.t[2] - a.t[2]);
  const dq = Math.abs(a.q.x * b.q.x + a.q.y * b.q.y + a.q.z * b.q.z + a.q.w * b.q.w);
  const ang = 2 * Math.acos(Math.min(1, dq));
  return !(seconds > 0) || dx / seconds > SWEEP_MAX_SPEED || ang / seconds > SWEEP_MAX_TURN;
}






interface ClockTimer {
  start: number;
  seconds: number;
  frames: number;
  robot?: string;
  joints?: (t: number) => number[];
   
  read: number;
}






function differs(a: Mat, b: Mat): boolean {
  if (Math.abs(a[3] - b[3]) > EPS_MM || Math.abs(a[7] - b[7]) > EPS_MM || Math.abs(a[11] - b[11]) > EPS_MM) return true;
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) if (Math.abs(a[i] - b[i]) > EPS_ROT) return true;
  return false;
}

type Category = "link" | "tool" | "attached" | "held" | "follower" | "free";

const hosts = new WeakMap<Services, PhysicsHost>();

 
export function setPhysicsHost(services: Services, host: PhysicsHost) {
  hosts.set(services, host);
  runtimes.get(services)?.attach(host);
}

 
function serverHost(services: Services): PhysicsHost | undefined {
  const s = (globalThis as unknown as { __robocraft?: { services: Services; queue: Promise<unknown>; listeners: Set<(e: ServerEvent) => void> } }).__robocraft;
  if (!s || s.services !== services) return undefined;
  return {
    schedule: (fn) => {
      const job = s.queue.then(fn);
      s.queue = job.catch(() => undefined);
      return job;
    },
    subscribe: (fn) => {
      s.listeners.add(fn);
      return () => void s.listeners.delete(fn);
    },
  };
}

const runtimes = new WeakMap<Services, PhysicsRuntime>();






const G = globalThis as unknown as { __enginuity_physics?: { code: string; runtime: PhysicsRuntime } };

 
function shared(services: Services): PhysicsRuntime | undefined {
  const g = G.__enginuity_physics?.runtime;
  return g && !g.disposed && g.services === services ? g : undefined;
}

export function physicsRuntime(services: Services, ws: Workspace): PhysicsRuntime {
  const g = shared(services);
  if (g && g.ws === ws) {
    runtimes.set(services, g);
    return g;
  }
  let rt = runtimes.get(services);
  if (!rt || rt.ws !== ws || rt.disposed) {
    g?.dispose();
    if (rt && !rt.disposed) rt.dispose();
    rt = new PhysicsRuntime(services, ws);
    runtimes.set(services, rt);
    const host = hosts.get(services) ?? serverHost(services);
    if (host) {
      rt.attach(host);
       
      const prev = G.__enginuity_physics?.runtime;
      if (prev && prev !== rt && !prev.disposed) prev.dispose();
      G.__enginuity_physics = { code: CODE, runtime: rt };
    }
  }
  return rt;
}





export function activePhysics(services: Services, ws: Workspace): PhysicsRuntime | null {
  const rt = shared(services) ?? runtimes.get(services);
  return rt && !rt.disposed && rt.enabled && rt.ws === ws && rt.ticking ? rt : null;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export interface MovedItem {
  item: string;
  name: string;
  mm: number;
  deg: number;
  role: string;
  text: string;
}

export class PhysicsRuntime {
  world: PhysicsWorld | null = null;
  station: string | null = null;
  enabled = false;
  private host: PhysicsHost | null = null;
  private unsubscribe: (() => void) | null = null;
   
  private live = new Map<string, number[]>();
   
  private held = new Set<string>();
   
  private base = new Map<string, { parent: string | null; pose: Mat }>();
   
  private moved = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickQueued = false;
  private last = 0;
  private acc = 0;
   
  private dirty = false;
  private building: Promise<void> | null = null;
  private stepCost = { ms: 0, steps: 0 };
  private buildMs = 0;
   
  buildPhases = { meshes: 0, colliders: 0, classify: 0 };
  private lastSignature = "";
   
  private unsent = new Set<string>();
  private lastSent = 0;
  private lastAwake = -1;
   
  private frame = 0;
  private ticks = 0;
   
  private timers = new Map<number, ClockTimer>();
  private nextTimer = 1;
   
  private freeSince: number | null = null;

  constructor(
    readonly services: Services,
    readonly ws: Workspace,
  ) {}

   

  get gravity() {
    return num(this.services.settings[PHYSICS_KEYS.gravity], PHYSICS_DEFAULTS.gravity);
  }
  get substeps() {
    return Math.max(1, Math.min(16, Math.round(num(this.services.settings[PHYSICS_KEYS.substeps], PHYSICS_DEFAULTS.substeps))));
  }
  private get wanted() {
    const v = this.services.settings[PHYSICS_KEYS.enabled];
    return v === true || v === 1 || v === "1" || v === "true";
  }

   

  attach(host: PhysicsHost) {
    if (this.host === host) return;
    this.unsubscribe?.();
    this.host = host;
    this.unsubscribe = host.subscribe((e) => this.onEvent(e));
  }

   
  disposed = false;

  dispose() {
    this.disposed = true;
    this.stopTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.host = null;
    this.world?.free();
    this.world = null;
    this.enabled = false;
    this.timers.clear();
  }

   
  get ticking() {
    return !!this.host;
  }

   

   
  get clock() {
    return this.frame * FRAME_S;
  }

  



  startTimer(seconds: number, robot?: string, joints?: (t: number) => number[]): number {
    const id = this.nextTimer++;
    const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.timers.set(id, { start: this.frame, seconds: s, frames: Math.ceil(s / FRAME_S - 1e-9), robot, joints, read: this.ticks });
    this.freeSince = null;
    if (robot) this.dirty = true;
    this.wake();
    return id;
  }

  



  timerElapsed(id: number): { seconds: number; done: boolean } | null {
    const t = this.timers.get(id);
    if (!t) return null;
    t.read = this.ticks;
    if (this.frame - t.start >= t.frames) {
      this.timers.delete(id);
      return { seconds: t.seconds, done: true };
    }
    return { seconds: Math.min(t.seconds, (this.frame - t.start) * FRAME_S), done: false };
  }

  endTimer(id: number) {
    this.timers.delete(id);
  }

   
  private drivers(): Map<string, ClockTimer> {
    const out = new Map<string, ClockTimer>();
    for (const t of this.timers.values()) if (t.robot && t.joints) out.set(t.robot, t);
    return out;
  }

  






  private due(now: number, dtReal: number): number {
    for (const [id, t] of this.timers) if (this.ticks - t.read > LEASE_TICKS) this.timers.delete(id);
    const busy = (this.ws.busy?.length ?? 0) > 0;
    let ratio = this.ws.paused ? 0 : busy ? Math.max(0, this.ws.simulationSpeed) : 1;
    if (busy && !this.timers.size) {
      this.freeSince ??= now;
      if (now - this.freeSince < GRACE_MS) ratio = 0;
    } else this.freeSince = null;
    let limit = MAX_FRAMES;
    for (const t of this.timers.values()) limit = Math.min(limit, Math.max(0, t.start + t.frames - this.frame));
    this.acc += dtReal * ratio;
    let frames = Math.floor(this.acc / FRAME_S + 1e-9);
    if (frames >= limit) {
      frames = limit;
      this.acc = 0;
    } else this.acc -= frames * FRAME_S;
    return frames;
  }

  private onEvent(e: ServerEvent) {
    if (e.type === "settings") {
       
      if (this.wanted !== this.enabled) void this.host?.schedule(() => this.setEnabled(this.wanted)).catch(() => undefined);
      else if (this.world && (this.world.substeps !== this.substeps || Math.abs(this.gravity - this.currentGravity) > 1e-9)) {
        this.world.configure({ gravity: this.gravity, substeps: this.substeps });
        this.currentGravity = this.gravity;
        this.emitState();
        this.wake();
      }
      return;
    }
    if (!this.enabled) return;
    if (e.type === "patch") {
      const p = e.patch as WorkspacePatch;
      if (p.physics) return;
      const relevant =
        p.removes.length > 0 ||
        p.meta?.activeStation !== undefined ||
        p.meta?.stations !== undefined ||
        p.upserts.some((u) => u.type === "object" || u.type === "tool" || u.type === "robot" || u.type === "frame" || u.type === "station");
      if (relevant) {
        this.dirty = true;
        this.wake();
      }
    } else if (e.type === "live" && Array.isArray(e.joints)) {
      this.live.set(String(e.robot), e.joints as number[]);
      this.dirty = true;
      this.wake();
    } else if (e.type === "live-end") {
       
      const robot = String(e.robot);
      this.live.delete(robot);
      for (const r of this.world?.recs.values() ?? []) if (r.role === "kinematic" && this.robotOf(r.spec.item) === robot) r.vel = [0, 0, 0];
      this.dirty = true;
      this.wake();
    }
  }

  private currentGravity: number = PHYSICS_DEFAULTS.gravity;

   
  async ensure() {
    if (this.wanted && !this.enabled) await (this.host ? this.host.schedule(() => this.setEnabled(true)) : this.setEnabled(true));
  }

   

  async setEnabled(on: boolean): Promise<void> {
    if (on && this.enabled && this.world && !this.stationChanged()) return;
    if (!on && !this.enabled) return;
    if (!on) {
      this.sendPatch(true);
      this.enabled = false;
      this.stopTimer();
      this.world?.free();
      this.world = null;
      this.station = null;
      this.held.clear();
      this.base.clear();
      this.moved.clear();
       
      this.timers.clear();
      this.emitState();
      return;
    }
    this.enabled = true;
    this.building ??= this.rebuild().finally(() => {
      this.building = null;
    });
    await this.building;
    this.wake();
  }

   
  async rebuild(): Promise<void> {
    const t0 = performance.now();
    const R = await loadRapier();
    this.world?.free();
    this.world = null;
    const st = this.ws.activeStation && this.ws.items[this.ws.activeStation] ? this.ws.activeStation : null;
    this.station = st;
    this.base.clear();
    this.moved.clear();
    if (!st) {
      this.emitState();
      return;
    }
    const frames = this.frames();
    const specs = collectSpecs(this.ws, st, frames);
     
    const floorZ = floorHeight(this.services.geometry, specs);
    const t1 = performance.now();
    const world = new PhysicsWorld(R, this.services.geometry, { gravity: this.gravity, substeps: this.substeps, floorZ });
    this.currentGravity = this.gravity;
    this.world = world;
    const cats = new Map<string, Category>();
    const cands: string[] = [];
    for (const spec of specs) {
      const cat = this.category(spec, cats, null);
      cats.set(spec.key, cat);
      if (cat === "free") {
        world.addFixed(spec, "auto", "");
        cands.push(spec.key);
      } else world.addKinematic(spec, this.why(cat), this.kinematicReason(spec, cat));
    }
    const t2 = performance.now();
    this.classify(cands, new Map());
    this.fixFollowers(specs);
    for (const it of Object.values(this.ws.items)) if (it.type === "object" && this.inStation(it.id)) this.base.set(it.id, { parent: it.parent, pose: it.pose.slice() });
    const t3 = performance.now();
    this.buildMs = t3 - t0;
    this.buildPhases = { meshes: Math.round(t1 - t0), colliders: Math.round(t2 - t1), classify: Math.round(t3 - t2) };
    this.lastSignature = "";
    this.emitState(true);
  }

   

  






  private frames(frame = this.frame, part = 0, drivers = this.drivers()) {
    return new Frames(this.ws, (r: Item) => {
      const t = drivers.get(r.id);
      if (!t) return this.live.get(r.id) ?? r.robot?.joints ?? [];
      const n = frame - t.start + part;
      return n > 0 ? t.joints!(Math.min(t.seconds, n * FRAME_S)) : (r.robot?.joints ?? []);
    });
  }

  private inStation(id: string) {
    let cur = this.ws.items[id];
    while (cur?.parent) cur = this.ws.items[cur.parent];
    return !!cur && cur.id === this.station;
  }

   
  private category(spec: BodySpec, cats: Map<string, Category>, world: PhysicsWorld | null): Category {
    if (spec.kind === "link") return "link";
    if (spec.kind === "tool") return "tool";
    if (spec.carrier) return "attached";
    if (this.held.has(spec.item)) return "held";
    if (spec.parentObject) {
      const pc = cats.get(spec.parentObject);
      const prec = world?.recs.get(spec.parentObject);
      if (pc === "attached" || pc === "held" || pc === "follower" || prec?.role === "dynamic") return "follower";
    }
    return "free";
  }

  private why(cat: Category): Why {
    return cat === "link" ? "robot" : cat === "tool" ? "tool" : cat === "held" ? "held" : cat === "follower" ? "follower" : "attached";
  }

  private kinematicReason(spec: BodySpec, cat: Category): string {
    const name = (id: string | null) => (id ? (this.ws.items[id]?.name ?? id) : "");
    if (cat === "link") return "robot link";
    if (cat === "tool") return `tool of ${name(spec.carrier)}`;
    if (cat === "held") return "held by a drag";
    if (cat === "follower") return `follows ${name(spec.parentObject)}`;
    return `attached to ${name(spec.carrier)}`;
  }

  



  private classify(keys: string[], released: Map<string, { carrier: string; vel: [number, number, number] }>) {
    const world = this.world;
    if (!world || !keys.length) return;
    const specs = keys.map((k) => world.recs.get(k)?.spec).filter((s): s is BodySpec => !!s);
     
    const set = new Set(specs.map((s) => s.key));
    if (released.size < specs.length) {
      for (const r of world.recs.values()) {
        if (set.has(r.spec.key) || r.spec.kind !== "object" || r.role === "kinematic") continue;
        if (specs.some((s) => this.closeTo(world, s, r.spec))) {
          set.add(r.spec.key);
          specs.push(r.spec);
        }
      }
    }
    const cands: Candidate[] = specs.map((s) => {
      const rel = released.get(s.key);
      return world.candidate(s, { mode: s.settings.body ?? "auto", released: !!rel, carrier: rel?.carrier });
    });
    const bases = [...world.recs.values()].filter((r) => r.spec.kind === "link" && r.spec.link === 0).map((r) => r.spec);
     
    const firm = new Set(cands.filter((c) => !c.released && (c.mode === "static" || (c.mode === "auto" && (c.locked || c.size >= AUTO.largeSize || c.volume >= AUTO.largeVolume)))).map((c) => c.key));
    const decisions = decide(cands, world.others(set), world.relations(specs, bases, firm));
    for (const s of specs) {
      const d = decisions.get(s.key);
      const rec = world.recs.get(s.key);
      if (!d || !rec) continue;
      const mode = s.settings.body ?? "auto";
      const why: Why = mode === "auto" ? "auto" : "set";
      if (d.role === "static") {
        if (rec.role !== "static" || rec.reason !== d.reason) world.makeStatic(rec, why, d.reason);
      } else if (rec.role !== "dynamic") {
        world.makeDynamic(rec, { why, reason: d.reason, linvel: released.get(s.key)?.vel });
        for (const k of d.ignore) world.ignore(s.key, k);
      } else if (rec.why !== why || rec.reason !== d.reason) {
        rec.why = why;
        rec.reason = d.reason;
        world.version++;
      }
    }
  }

  private closeTo(world: PhysicsWorld, a: BodySpec, b: BodySpec) {
    const A = world.box(a);
    const B = world.box(b, world.recs.get(b.key)?.pose ?? b.pose);
    const pad = 5;
    return !(B.min[0] > A.max[0] + pad || B.max[0] < A.min[0] - pad || B.min[1] > A.max[1] + pad || B.max[1] < A.min[1] - pad || B.min[2] > A.max[2] + pad || B.max[2] < A.min[2] - pad);
  }

   
  private fixFollowers(specs: BodySpec[]) {
    const world = this.world;
    if (!world) return;
    for (const s of specs) {
      if (s.kind !== "object" || !s.parentObject || s.carrier || this.held.has(s.item)) continue;
      const parent = world.recs.get(s.parentObject);
      const rec = world.recs.get(s.key);
      if (!rec) continue;
      const moving = !!parent && (parent.role === "dynamic" || (parent.role === "kinematic" && parent.why !== "robot"));
      if (moving && !(rec.role === "kinematic" && rec.why === "follower")) world.makeKinematic(rec, "follower", `follows ${parent!.spec.name}`);
      else if (!moving && rec.role === "kinematic" && rec.why === "follower") this.classify([s.key], new Map());
    }
  }

   
  private stationChanged() {
    const st = this.ws.activeStation && this.ws.items[this.ws.activeStation] ? this.ws.activeStation : null;
    return st !== this.station;
  }

  






  private sync(sweepSeconds: number | null) {
    const world = this.world;
    const st = this.station;
    if (!world || !st) return;
    const drivers = this.drivers();
    const frames = this.frames(this.frame, 0, drivers);
    const specs = collectSpecs(this.ws, st, frames);
    const want = new Set(specs.map((s) => s.key));
    let wakeAll = false;
    for (const key of [...world.recs.keys()]) {
      if (!want.has(key)) {
        world.remove(key);
        wakeAll = true;
      }
    }
    const cats = new Map<string, Category>();
    const judge: string[] = [];
    const released = new Map<string, { carrier: string; vel: [number, number, number] }>();
    for (const spec of specs) {
      let rec = world.recs.get(spec.key);
      const cat = this.category(spec, cats, world);
      cats.set(spec.key, cat);
      const kinematic = cat !== "free";
      if (rec && rec.spec.meshes.join(",") !== spec.meshes.join(",")) {
         
        world.remove(spec.key);
        rec = undefined;
        wakeAll = true;
      }
      if (!rec) {
        if (kinematic) world.addKinematic(spec, this.why(cat), this.kinematicReason(spec, cat));
        else {
          world.addFixed(spec, "auto", "");
          judge.push(spec.key);
          if (!this.base.has(spec.item)) {
            const it = this.ws.items[spec.item];
            if (it) this.base.set(it.id, { parent: it.parent, pose: it.pose.slice() });
          }
        }
        continue;
      }
      const prev = rec.spec;
      rec.spec = spec;
      if (kinematic) {
        if (rec.role !== "kinematic" || rec.why !== this.why(cat)) {
          world.makeKinematic(rec, this.why(cat), this.kinematicReason(spec, cat));
          wakeAll = true;
        } else if (sweepSeconds !== null && !drivers.has(this.robotOf(spec.item) ?? "")) this.retarget(rec, spec.pose, sweepSeconds);
         
        continue;
      }
       
      if (rec.role === "kinematic") {
         
        if (rec.why === "attached" && prev.carrier) released.set(spec.key, { carrier: this.carrierKey(prev.carrier), vel: rec.vel ?? [0, 0, 0] });
        rec.pose = spec.pose;
        judge.push(spec.key);
        continue;
      }
      if (prev.sig !== spec.sig) {
         
        rec.pose = spec.pose;
        world.teleport(rec, spec.pose);
        judge.push(spec.key);
        wakeAll = true;
        continue;
      }
      const ref = rec.role === "dynamic" ? (rec.written ?? rec.pose) : rec.pose;
      if (differs(ref, spec.pose)) {
         
        world.teleport(rec, spec.pose);
        if ((spec.settings.body ?? "auto") === "auto") judge.push(spec.key);
        wakeAll = true;
      }
    }
    if (judge.length || released.size) this.classify(judge, released);
    this.fixFollowers(specs);
    if (wakeAll) for (const r of world.recs.values()) if (r.role === "dynamic") r.body.wakeUp();
  }

   
  private robotOf(id: string): string | null {
    let cur: Item | undefined = this.ws.items[id];
    while (cur && cur.type !== "robot") cur = cur.parent ? this.ws.items[cur.parent] : undefined;
    return cur?.id ?? null;
  }

   
  private carrierKey(item: string): string {
    const world = this.world;
    if (!world) return item;
    if (world.recs.has(item)) return item;
    const links = [...world.recs.keys()].filter((k) => k.startsWith(`${item}#`));
    return links.at(-1) ?? item;
  }

   
  private retarget(rec: BodyRec, pose: Mat, seconds: number) {
    if (!differs(rec.pose, pose)) {
      rec.vel = [0, 0, 0];
      return;
    }
    const to = toTf(pose);
    const from = rec.to ?? toTf(rec.pose);
    if (tooFast(from, to, seconds)) {
      this.world!.teleport(rec, pose);
      for (const r of this.world!.recs.values()) if (r.role === "dynamic") r.body.wakeUp();
      return;
    }
    rec.from = from;
    rec.to = to;
    rec.vel = [(to.t[0] - from.t[0]) / seconds, (to.t[1] - from.t[1]) / seconds, (to.t[2] - from.t[2]) / seconds];
    rec.pose = pose;
  }

   

  






  private advance(frames: number, budgetMs = Infinity): number {
    const world = this.world;
    if (frames <= 0) return 0;
    if (!world) {
      this.frame += frames;
      return 0;
    }
    const sub = world.substeps;
    const total = frames * sub;
    const drivers = this.drivers();
    const driven = drivers.size ? [...world.recs.values()].filter((r) => r.role === "kinematic" && drivers.has(this.robotOf(r.spec.item) ?? "")) : [];
    const swept = [...world.recs.values()].filter((r) => r.role === "kinematic" && r.from && r.to && !driven.includes(r));
    const t0 = performance.now();
    const mat = (tf: Tf) => toMat({ x: tf.t[0], y: tf.t[1], z: tf.t[2] }, tf.q);
    let f = 0;
    while (f < frames) {
       
      if (driven.length) {
        const end = this.posesAt(driven, drivers, this.frame + 1, 0);
        for (const r of driven) {
          const p = end.get(r);
          if (p && differs(p, r.pose)) world.wakeAround(r.spec, [r.pose, p], WAKE_MARGIN);
        }
      }
      for (const r of swept) {
        const a = mat(lerpTf(r.from!, r.to!, f / frames));
        const b = mat(lerpTf(r.from!, r.to!, (f + 1) / frames));
        if (differs(a, b)) world.wakeAround(r.spec, [a, b], WAKE_MARGIN);
      }
      for (let k = 0; k < sub; k++) {
        const s = (f * sub + k + 1) / total;
        for (const r of swept) {
          const tf = lerpTf(r.from!, r.to!, s);
          r.body.setNextKinematicTranslation({ x: tf.t[0], y: tf.t[1], z: tf.t[2] });
          r.body.setNextKinematicRotation(tf.q);
        }
        if (driven.length) this.drive(driven, drivers, this.frame, (k + 1) / sub, FRAME_S / sub);
        world.step();
      }
       
      world.releaseSeparated();
      f++;
      this.frame++;
      if (performance.now() - t0 > budgetMs) break;
    }
    for (const r of swept) r.from = f === frames ? r.to : lerpTf(r.from!, r.to!, f / frames);
    const ms = performance.now() - t0;
    const n = f * sub;
    this.stepCost = { ms: this.stepCost.ms * 0.9 + (ms / Math.max(1, n)) * 0.1, steps: this.stepCost.steps + n };
    return n;
  }

   
  private posesAt(recs: BodyRec[], drivers: Map<string, ClockTimer>, frame: number, part: number): Map<BodyRec, Mat> {
    const fr = this.frames(frame, part, drivers);
    const links = new Map<string, Mat[]>();
    const out = new Map<BodyRec, Mat>();
    for (const r of recs) {
      const s = r.spec;
      let pose: Mat | undefined;
      if (s.kind === "link") {
        let l = links.get(s.item);
        if (!l) links.set(s.item, (l = fr.links(this.ws.items[s.item])));
        pose = l[s.link ?? 0];
      } else pose = s.kind === "tool" ? fr.child(s.carrier) : fr.abs(s.item);
      if (pose) out.set(r, pose);
    }
    return out;
  }

  




  private drive(recs: BodyRec[], drivers: Map<string, ClockTimer>, frame: number, part: number, dt: number) {
    let jumped = false;
    for (const [r, pose] of this.posesAt(recs, drivers, frame, part)) {
      const to = toTf(pose);
      const from = r.to ?? toTf(r.pose);
      if (tooFast(from, to, dt)) {
        this.world!.teleport(r, pose);
        jumped = true;
      } else {
        r.body.setNextKinematicTranslation({ x: to.t[0], y: to.t[1], z: to.t[2] });
        r.body.setNextKinematicRotation(to.q);
        r.vel = [(to.t[0] - from.t[0]) / dt, (to.t[1] - from.t[1]) / dt, (to.t[2] - from.t[2]) / dt];
        r.from = r.to = to;
      }
      r.pose = pose;
    }
    if (jumped) for (const r of this.world!.recs.values()) if (r.role === "dynamic") r.body.wakeUp();
  }

  





  private commit(): string[] {
    const world = this.world;
    if (!world) return [];
    const tx = new Tx(this.ws);
    const frames = this.frames();
    const out: string[] = [];
    for (const rec of world.recs.values()) {
      if (rec.role !== "dynamic") continue;
      const it = this.ws.items[rec.spec.item];
      if (!it) continue;
      const pose = toMat(rec.body.translation(), rec.body.rotation());
      const was = rec.written ?? rec.pose;
      if (pose.every((v, i) => v === was[i])) continue;
      const local = mul(inv(frames.child(it.parent)), pose);
      if (differs(pose, rec.shown ?? was)) {
        tx.set(it.id, { pose: local });
        rec.shown = pose;
        out.push(it.id);
      } else it.pose = local;
      rec.written = pose;
      rec.pose = pose;
      rec.spec = { ...rec.spec, pose };
      this.moved.add(it.id);
    }
    if (tx.changed) {
      this.ws.rev += 1;
      for (const id of out) this.unsent.add(id);
      this.sendPatch(false);
    }
    return out;
  }

  




  private sendPatch(force: boolean) {
    const n = this.unsent.size;
    if (!n) return;
    const now = performance.now();
    if (!force && now - this.lastSent < (n > 200 ? 66 : n > 50 ? 33 : 0)) return;
    this.lastSent = now;
    const ids = [...this.unsent].filter((id) => this.ws.items[id]);
    this.unsent.clear();
    if (!ids.length) return;
    const patch: WorkspacePatch = { rev: this.ws.rev, upserts: ids.map((id) => structuredClone(this.ws.items[id])), removes: [], physics: true };
    this.services.emit?.({ type: "patch", patch });
  }

  private awake(): number {
    let n = 0;
    for (const r of this.world?.recs.values() ?? []) if (r.role === "dynamic" && !r.body.isSleeping()) n++;
    return n;
  }

   

   
  wake() {
    if (!this.enabled || !this.host || this.timer) return;
    this.last = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.requestTick(), TICK_MS);
    (this.timer as { unref?: () => void }).unref?.();
    this.requestTick();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private requestTick() {
    if (this.tickQueued || !this.host) return;
    this.tickQueued = true;
    void this.host
      .schedule(() => {
        this.tickQueued = false;
        return this.tick();
      })
      .catch(() => {
        this.tickQueued = false;
      });
  }

   
  private async tick() {
    if (!this.enabled || this.building) return;
    if (this.stationChanged()) {
       
      this.building ??= this.rebuild().finally(() => {
        this.building = null;
      });
      await this.building;
      return;
    }
    const now = performance.now();
    const dtReal = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.ticks++;
    const frames = this.due(now, dtReal);
    if (!this.world) {
       
      this.advance(frames);
      if (!this.timers.size && !(this.ws.busy?.length ?? 0)) this.stopTimer();
      return;
    }
    const wasDirty = this.dirty;
    this.dirty = false;
    try {
      if (frames > 0) {
        this.sync(frames * FRAME_S);
        const steps = this.advance(frames, TICK_BUDGET_MS);
         
        if (steps < frames * (this.world?.substeps ?? 1)) this.acc = 0;
        this.commit();
      } else if (wasDirty) {
         
        this.sync(null);
        this.commit();
      }
    } catch (err) {
      this.services.emit?.({ type: "status", text: `Physics error: ${err instanceof Error ? err.message : String(err)}`, ms: 10000 });
      this.stopTimer();
       
      this.timers.clear();
      return;
    }
    const awake = this.awake();
    const kinMoving = [...(this.world?.recs.values() ?? [])].some((r) => r.role === "kinematic" && r.vel && (r.vel[0] || r.vel[1] || r.vel[2]));
    if (awake !== this.lastAwake && (awake === 0 || this.lastAwake <= 0)) this.emitState();
    this.lastAwake = awake;
    this.emitIfChanged();
     
    const busyNow = (this.ws.busy?.length ?? 0) > 0;
    if (!awake && !kinMoving && !this.dirty && this.live.size === 0 && this.held.size === 0 && !this.timers.size && !(this.world?.ignored.size ?? 0) && (frames > 0 || !busyNow)) {
      this.sendPatch(true);
      this.stopTimer();
    }
  }

   

   
  async current(): Promise<void> {
    if (this.building) await this.building;
    if (!this.enabled) return;
    if (this.stationChanged() || !this.world) {
      this.building ??= this.rebuild().finally(() => {
        this.building = null;
      });
      await this.building;
    } else {
      this.sync(null);
      this.commit();
      this.sendPatch(true);
    }
  }

  private async need(): Promise<PhysicsWorld> {
    if (this.building) await this.building;
    if (!this.enabled) throw new Error("Physics is off. Switch it on first (physics.enable).");
    if (this.stationChanged() || !this.world) {
      this.building ??= this.rebuild().finally(() => {
        this.building = null;
      });
      await this.building;
    }
    if (!this.world) throw new Error("There is no active station.");
    return this.world;
  }

   
  async step(seconds: number): Promise<{ seconds: number; steps: number; moved: string[] }> {
    await this.need();
    const frames = Math.max(0, Math.round(seconds / FRAME_S));
     
    this.sync(frames * FRAME_S);
    const steps = this.advance(frames);
    const moved = this.commit();
    this.sendPatch(true);
    this.emitIfChanged();
    this.wake();
    return { seconds: frames * FRAME_S, steps, moved };
  }

   
  async settle(maxSeconds: number): Promise<{ seconds: number; settled: boolean; moved: MovedItem[]; stepMs: number }> {
    const world = await this.need();
    this.sync(0);
    const start = new Map<string, Mat>();
    for (const r of world.recs.values()) if (r.spec.kind === "object") start.set(r.spec.item, r.pose);
    const maxFrames = Math.max(0, Math.round(maxSeconds / FRAME_S));
    let frames = 0;
    let steps = 0;
    const t0 = performance.now();
    while (frames < maxFrames && this.awake() > 0) {
      const n = Math.min(10, maxFrames - frames);
      steps += this.advance(n);
      frames += n;
      this.commit();
    }
    this.sendPatch(true);
    const stepMs = steps ? (performance.now() - t0) / steps : 0;
    const moved: MovedItem[] = [];
    for (const [id, p0] of start) {
      const r = world.recs.get(id);
      if (!r) continue;
      const d = poseDistance(p0, r.pose);
      if (d.mm > 0.5 || d.deg > 0.5) moved.push({ item: id, name: r.spec.name, mm: Math.round(d.mm * 10) / 10, deg: Math.round(d.deg * 10) / 10, role: r.role, text: this.text(r) });
    }
    this.emitIfChanged();
    this.emitState();
    this.wake();
    return { seconds: frames * FRAME_S, settled: this.awake() === 0, moved, stepMs };
  }

  



  async reset(tx: Tx): Promise<string[]> {
    await this.need();
    const restored: string[] = [];
    for (const id of this.moved) {
      const b = this.base.get(id);
      const it = this.ws.items[id];
      if (!b || !it) continue;
      if (b.parent !== it.parent && b.parent && this.ws.items[b.parent]) {
        if (it.parent && this.ws.items[it.parent]) tx.set(it.parent, { children: this.ws.items[it.parent].children.filter((c) => c !== id) });
        tx.set(b.parent, { children: [...this.ws.items[b.parent].children.filter((c) => c !== id), id] });
        tx.set(id, { parent: b.parent });
      }
      tx.set(id, { pose: b.pose.slice() });
      restored.push(id);
    }
    this.held.clear();
    await this.rebuild();
    this.wake();
    return restored;
  }

   
  hold(items: string[], on: boolean) {
    for (const id of items) {
      if (on) this.held.add(id);
      else this.held.delete(id);
    }
    if (!on && !items.length) this.held.clear();
    this.dirty = true;
    this.wake();
  }

   

  private text(r: BodyRec): string {
    const mode = r.spec.kind === "object" && r.why === "auto" ? "auto" : undefined;
    return roleText(r.role, r.reason, mode);
  }

  counts(): PhysicsCounts {
    const c: PhysicsCounts = { dynamic: 0, static: 0, kinematic: 0, awake: 0 };
    for (const r of this.world?.recs.values() ?? []) {
      c[r.role]++;
      if (r.role === "dynamic" && !r.body.isSleeping()) c.awake++;
    }
    return c;
  }

  report(): Record<string, BodyReport> {
    const out: Record<string, BodyReport> = {};
    for (const r of this.world?.recs.values() ?? []) {
      const s = r.spec;
      if (s.kind === "link") {
        const prev = out[s.item];
        if (prev) prev.links = (prev.links ?? 1) + 1;
        else out[s.item] = { item: s.item, name: this.ws.items[s.item]?.name ?? s.name, kind: "robot", role: "kinematic", text: "Kinematic (robot links follow the joints)", reason: "robot links follow the joints", links: 1 };
        continue;
      }
      out[s.item] = {
        item: s.item,
        name: s.name,
        kind: s.kind === "tool" ? "tool" : "object",
        role: r.role,
        mode: s.kind === "object" ? (s.settings.body ?? "auto") : undefined,
        text: this.text(r),
        reason: r.reason,
        mass: r.role === "dynamic" ? Math.round(r.body.mass() * 1000) / 1000 : undefined,
        sleeping: r.role === "dynamic" ? r.body.isSleeping() : undefined,
      };
    }
    return out;
  }

  state(withReport = true): PhysicsState {
    return {
      enabled: this.enabled,
      station: this.station,
      floorZ: this.world ? this.world.floorZ : null,
      counts: this.counts(),
      gravity: this.gravity,
      substeps: this.substeps,
      report: withReport ? this.report() : {},
      buildMs: Math.round(this.buildMs),
      stepMs: Math.round(this.stepCost.ms * 1000) / 1000,
    };
  }

   
  emitState(full = true) {
    this.services.emit?.({ type: "physics", ...this.state(full), full });
  }

   
  private emitIfChanged() {
    const sig = this.world ? `${this.station}:${this.world.version}` : "";
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.emitState(true);
    }
  }
}

 
 
 
const CODE = PhysicsRuntime.toString();
{
  const g = G.__enginuity_physics;
  if (g && g.code !== CODE) {
    const old = g.runtime;
    const wasOn = old.enabled && !old.disposed;
    old.dispose();
    G.__enginuity_physics = undefined;
    if (wasOn) setTimeout(() => void physicsRuntime(old.services, old.ws).ensure(), 0);
  }
}
