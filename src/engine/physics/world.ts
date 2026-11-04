 
 
 
 
 
 
 
 

import type { Collider, RigidBody, Shape, World as RapierWorld } from "@dimforge/rapier3d-deterministic-compat";
import { poseToQuat, type Mat } from "../math";
import type { GeometryStore } from "../registry";
import { AUTO, type Candidate, type Other, type Relations } from "./classify";
import { meshInfo, transformedBox, type Vec3 } from "./geometry";
import { quadrangulate, supportPoints, type Hull } from "./hull";

 
const HULL_EXACT_MAX = 4000;
 
const DENSE_TRIS = 20000;





const KINEMATIC_SOFT_CCD = 0.1;
import type { Rapier } from "./rapier";
import type { BodySpec } from "./scene";
import { FRAME_S, PHYSICS_DEFAULTS, type BodyRole, type ItemPhysics } from "./types";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
 
export interface Tf {
  t: Vec3;
  q: Quat;
}

export function toTf(m: Mat): Tf {
  const [w, x, y, z] = poseToQuat(m);
  const n = Math.hypot(w, x, y, z) || 1;
  return { t: [m[3] * 0.001, m[7] * 0.001, m[11] * 0.001], q: { x: x / n, y: y / n, z: z / n, w: w / n } };
}

export function toMat(t: { x: number; y: number; z: number }, q: Quat): Mat {
   
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  const x = q.x / n;
  const y = q.y / n;
  const z = q.z / n;
  const w = q.w / n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), t.x * 1000,
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), t.y * 1000,
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), t.z * 1000,
    0, 0, 0, 1,
  ];
}

const vec = (t: Vec3) => ({ x: t[0], y: t[1], z: t[2] });

 
export function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v[2] - q.z * v[1]);
  const ty = 2 * (q.z * v[0] - q.x * v[2]);
  const tz = 2 * (q.x * v[1] - q.y * v[0]);
  return [v[0] + q.w * tx + (q.y * tz - q.z * ty), v[1] + q.w * ty + (q.z * tx - q.x * tz), v[2] + q.w * tz + (q.x * ty - q.y * tx)];
}

 
export function compose(a: Tf, b: Tf): Tf {
  const { x, y, z, w } = a.q;
  const r = rotate(a.q, b.t);
  const t: Vec3 = [r[0] + a.t[0], r[1] + a.t[1], r[2] + a.t[2]];
  const b2 = b.q;
  const q = {
    x: w * b2.x + x * b2.w + y * b2.z - z * b2.y,
    y: w * b2.y - x * b2.z + y * b2.w + z * b2.x,
    z: w * b2.z + x * b2.y - y * b2.x + z * b2.w,
    w: w * b2.w - x * b2.x - y * b2.y - z * b2.z,
  };
  return { t, q };
}

 
export function lerpTf(a: Tf, b: Tf, s: number): Tf {
  let { x, y, z, w } = b.q;
  let dot = a.q.x * x + a.q.y * y + a.q.z * z + a.q.w * w;
  if (dot < 0) {
    dot = -dot;
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  let k0 = 1 - s;
  let k1 = s;
  if (dot < 0.9995) {
    const th = Math.acos(Math.min(1, dot));
    const sn = Math.sin(th);
    k0 = Math.sin((1 - s) * th) / sn;
    k1 = Math.sin(s * th) / sn;
  }
  const q = { x: a.q.x * k0 + x * k1, y: a.q.y * k0 + y * k1, z: a.q.z * k0 + z * k1, w: a.q.w * k0 + w * k1 };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return {
    t: [a.t[0] + (b.t[0] - a.t[0]) * s, a.t[1] + (b.t[1] - a.t[1]) * s, a.t[2] + (b.t[2] - a.t[2]) * s],
    q: { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n },
  };
}

 
interface Part {
  shape: Shape;
  at: Tf;
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
 
const CYLINDER_AXIS: Record<0 | 1 | 2, Quat> = {
  0: { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 },
  1: IDENTITY,
  2: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
};





interface Caches {
  hulls: Map<string, Hull | null>;
  parts: Map<string, Part[]>;
   
  probes: Map<string, { shape: Shape; at: Tf } | null>;
}
const cachesByStore = new WeakMap<GeometryStore, Caches>();
let scratch: RapierWorld | null = null;

function cachesOf(store: GeometryStore): Caches {
  let c = cachesByStore.get(store);
  if (!c) {
    c = { hulls: new Map(), parts: new Map(), probes: new Map() };
    cachesByStore.set(store, c);
  }
  return c;
}

 
function computeHull(R: Rapier, points: Float32Array): Hull | null {
  scratch ??= new R.World({ x: 0, y: 0, z: 0 });
  try {
    const desc = R.ColliderDesc.convexHull(points);
    if (!desc) return null;
    const col = scratch.createCollider(desc);
    const v = col.vertices();
    const ix = col.indices();
    const ok = v && ix && v.length >= 12 && col.volume() > 1e-12;
    const hull = ok ? { vertices: v.slice(), indices: ix.slice() } : null;
    scratch.removeCollider(col, false);
    return hull;
  } catch {
    return null;
  }
}

 
function usable(R: Rapier, hull: Hull): boolean {
  try {
    const raw = new R.ConvexPolyhedron(hull.vertices, hull.indices).intoRaw();
    if (!raw) return false;
    raw.free();
    return true;
  } catch {
    return false;
  }
}

function hullOf(R: Rapier, store: GeometryStore, id: string): Hull | null {
  const c = cachesOf(store);
  if (c.hulls.has(id)) return c.hulls.get(id)!;
  const info = meshInfo(store, id);
   
  const points = info && info.vertices.length > HULL_EXACT_MAX * 3 ? supportPoints(info.vertices, 1024) : info?.vertices;
  let hull = points && points.length >= 12 ? computeHull(R, points) : null;
  if (hull && !usable(R, hull)) hull = null;
   
  for (let i = 0; hull && i < 3; i++) {
    const pts = quadrangulate(hull);
    if (!pts) break;
    const next = computeHull(R, pts);
    if (!next || !usable(R, next)) break;
    hull = next;
  }
  c.hulls.set(id, hull);
  return hull;
}

 
function partsOf(R: Rapier, store: GeometryStore, id: string): Part[] {
  const c = cachesOf(store);
  const hit = c.parts.get(id);
  if (hit) return hit;
  const info = meshInfo(store, id);
  const parts: Part[] = [];
  if (info) {
    const p = info.primitive;
    if (p?.kind === "box") parts.push({ shape: new R.Cuboid(p.half[0] * 0.001, p.half[1] * 0.001, p.half[2] * 0.001), at: { t: [p.center[0] * 0.001, p.center[1] * 0.001, p.center[2] * 0.001], q: IDENTITY } });
    else if (p?.kind === "sphere") parts.push({ shape: new R.Ball(p.radius * 0.001), at: { t: [p.center[0] * 0.001, p.center[1] * 0.001, p.center[2] * 0.001], q: IDENTITY } });
    else if (p?.kind === "cylinder") parts.push({ shape: new R.Cylinder(p.halfHeight * 0.001, p.radius * 0.001), at: { t: [p.center[0] * 0.001, p.center[1] * 0.001, p.center[2] * 0.001], q: CYLINDER_AXIS[p.axis] } });
    else {
      const hull = hullOf(R, store, id);
      if (hull) parts.push({ shape: new R.ConvexPolyhedron(hull.vertices, hull.indices), at: { t: [0, 0, 0], q: IDENTITY } });
      else {
         
        const h = [0, 1, 2].map((k) => Math.max(0.5, (info.max[k] - info.min[k]) / 2) * 0.001);
        parts.push({ shape: new R.Cuboid(h[0], h[1], h[2]), at: { t: [0, 1, 2].map((k) => ((info.min[k] + info.max[k]) / 2) * 0.001) as Vec3, q: IDENTITY } });
      }
    }
  }
  c.parts.set(id, parts);
  return parts;
}

export type Why = "auto" | "set" | "attached" | "robot" | "tool" | "held" | "follower";

export interface BodyRec {
  spec: BodySpec;
  role: BodyRole;
  why: Why;
  reason: string;
  body: RigidBody;
  colliders: Collider[];
   
  pose: Mat;
   
  from?: Tf;
  to?: Tf;
   
  vel?: Vec3;
   
  written?: Mat;
   
  shown?: Mat;
}

export interface WorldOptions {
  gravity: number;
  substeps: number;
  floorZ: number;
}

const key2 = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class PhysicsWorld {
  readonly world: RapierWorld;
  readonly recs = new Map<string, BodyRec>();
   
  private owners = new Map<number, string>();
   
  private bodyKeys = new Map<number, string>();
   
  private meshBoxes = new Map<number, { min: Vec3; max: Vec3 }>();
   
  readonly ignored = new Map<string, [string, string]>();
  readonly floor: Collider;
   
  version = 0;
  private hooks;
  private events: InstanceType<Rapier["EventQueue"]> | null = null;

  constructor(
    readonly R: Rapier,
    readonly store: GeometryStore,
    private opts: WorldOptions,
  ) {
    this.world = new R.World({ x: 0, y: 0, z: -opts.gravity });
    this.world.timestep = FRAME_S / Math.max(1, Math.round(opts.substeps));
    this.stiffen();
    this.floor = this.world.createCollider(
      new R.ColliderDesc(new R.HalfSpace({ x: 0, y: 0, z: 1 })).setTranslation(0, 0, opts.floorZ * 0.001).setFriction(PHYSICS_DEFAULTS.floorFriction).setRestitution(0),
    );
    this.owners.set(this.floor.handle, "floor");
    const ignored = this.ignored;
    const bodyKeys = this.bodyKeys;
    this.hooks = {
      filterContactPair(_c1: number, _c2: number, b1: number | null, b2: number | null) {
         
        const a = bodyKeys.get(b1 ?? 0);
        const b = bodyKeys.get(b2 ?? 0);
        return a && b && ignored.has(key2(a, b)) ? null : R.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair() {
        return true;
      },
    };
  }

  get floorZ() {
    return this.opts.floorZ;
  }

  get substeps() {
    return Math.max(1, Math.round(this.opts.substeps));
  }

  configure(o: { gravity?: number; substeps?: number }) {
    if (o.gravity !== undefined) {
      this.opts.gravity = o.gravity;
      this.world.gravity = { x: 0, y: 0, z: -o.gravity };
      for (const r of this.recs.values()) if (r.role === "dynamic") r.body.wakeUp();
    }
    if (o.substeps !== undefined) {
      this.opts.substeps = Math.max(1, Math.round(o.substeps));
      this.world.timestep = FRAME_S / this.substeps;
      this.stiffen();
    }
  }

  





  private stiffen() {
    this.world.integrationParameters.contact_natural_frequency = Math.min(240, 60 * this.substeps);
  }

  free() {
    this.events?.free();
    this.events = null;
    this.world.free();
    this.recs.clear();
    this.owners.clear();
    this.bodyKeys.clear();
    this.meshBoxes.clear();
    this.ignored.clear();
  }

  ownerOf(c: Collider): string | undefined {
    return this.owners.get(c.handle);
  }

   

  private trimeshColliders(rec: BodyRec, friction: number, restitution: number) {
    for (const g of rec.spec.meshes) {
      const info = meshInfo(this.store, g);
      if (!info || info.indices.length < 3) continue;
      const desc = this.R.ColliderDesc.trimesh(info.vertices, info.indices).setFriction(friction).setRestitution(restitution);
      const c = this.world.createCollider(desc, rec.body);
      this.owners.set(c.handle, rec.spec.key);
      this.meshBoxes.set(c.handle, info);
      rec.colliders.push(c);
    }
  }

  private dropColliders(rec: BodyRec) {
    for (const c of rec.colliders) {
      this.owners.delete(c.handle);
      this.meshBoxes.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    rec.colliders = [];
  }

   
  parts(spec: BodySpec): Part[] {
    return spec.meshes.flatMap((g) => partsOf(this.R, this.store, g));
  }

  private newBody(spec: BodySpec, desc: ReturnType<Rapier["RigidBodyDesc"]["fixed"]>, role: BodyRole, why: Why, reason: string): BodyRec {
    const tf = toTf(spec.pose);
    desc.setTranslation(tf.t[0], tf.t[1], tf.t[2]).setRotation(tf.q);
    const body = this.world.createRigidBody(desc);
    const rec: BodyRec = { spec, role, why, reason, body, colliders: [], pose: spec.pose };
    this.recs.set(spec.key, rec);
    this.version++;
    this.bodyKeys.set(body.handle, spec.key);
    return rec;
  }

  addKinematic(spec: BodySpec, why: Why, reason: string): BodyRec {
    const rec = this.newBody(spec, this.R.RigidBodyDesc.kinematicPositionBased().setSoftCcdPrediction(KINEMATIC_SOFT_CCD), "kinematic", why, reason);
    rec.from = rec.to = toTf(spec.pose);
    this.trimeshColliders(rec, PHYSICS_DEFAULTS.kinematicFriction, 0);
    return rec;
  }

  addFixed(spec: BodySpec, why: Why, reason: string): BodyRec {
    const rec = this.newBody(spec, this.R.RigidBodyDesc.fixed(), "static", why, reason);
    const s = spec.settings;
    this.trimeshColliders(rec, s.friction ?? PHYSICS_DEFAULTS.friction, s.restitution ?? PHYSICS_DEFAULTS.restitution);
    return rec;
  }

   
  makeDynamic(rec: BodyRec, o: { why: Why; reason: string; linvel?: Vec3; angvel?: Vec3 }) {
    this.dropColliders(rec);
    const tf = toTf(rec.spec.pose);
    rec.body.setBodyType(this.R.RigidBodyType.Dynamic, false);
    rec.body.setSoftCcdPrediction(0);
    rec.body.setTranslation(vec(tf.t), false);
    rec.body.setRotation(tf.q, false);
    rec.body.enableCcd(true);
    rec.body.setAngularDamping(0.1);
    const s: ItemPhysics = rec.spec.settings;
    const friction = s.friction ?? PHYSICS_DEFAULTS.friction;
    const restitution = s.restitution ?? PHYSICS_DEFAULTS.restitution;
    const density = s.density && s.density > 0 ? s.density : PHYSICS_DEFAULTS.density;
    for (const p of this.parts(rec.spec)) {
      const desc = new this.R.ColliderDesc(p.shape).setTranslation(p.at.t[0], p.at.t[1], p.at.t[2]).setRotation(p.at.q).setFriction(friction).setRestitution(restitution).setDensity(density);
      const c = this.world.createCollider(desc, rec.body);
      this.owners.set(c.handle, rec.spec.key);
      rec.colliders.push(c);
    }
     
    if (s.mass && s.mass > 0) {
      const vol = rec.colliders.reduce((n, c) => n + c.volume(), 0);
      if (vol > 0) for (const c of rec.colliders) c.setDensity(s.mass / vol);
    }
    rec.body.recomputeMassPropertiesFromColliders();
    rec.body.setLinvel(vec(o.linvel ?? [0, 0, 0]), true);
    rec.body.setAngvel(vec(o.angvel ?? [0, 0, 0]), true);
    rec.role = "dynamic";
    rec.why = o.why;
    rec.reason = o.reason;
    rec.pose = rec.spec.pose;
    rec.written = rec.spec.pose;
    rec.shown = rec.spec.pose;
    rec.from = rec.to = undefined;
    rec.vel = undefined;
    this.version++;
     
     
     
     
     
  }

   
  makeKinematic(rec: BodyRec, why: Why, reason: string) {
    this.dropColliders(rec);
    rec.body.setBodyType(this.R.RigidBodyType.KinematicPositionBased, true);
    rec.body.setSoftCcdPrediction(KINEMATIC_SOFT_CCD);
    rec.role = "kinematic";
    rec.why = why;
    rec.reason = reason;
    rec.written = rec.shown = undefined;
    rec.from = rec.to = toTf(rec.spec.pose);
    this.teleport(rec, rec.spec.pose);
    this.trimeshColliders(rec, PHYSICS_DEFAULTS.kinematicFriction, 0);
    this.unignore(rec.spec.key);
    this.version++;
  }

  makeStatic(rec: BodyRec, why: Why, reason: string) {
    this.dropColliders(rec);
    rec.body.setBodyType(this.R.RigidBodyType.Fixed, false);
    rec.body.setSoftCcdPrediction(0);
    rec.role = "static";
    rec.why = why;
    rec.reason = reason;
    rec.written = rec.shown = undefined;
    rec.from = rec.to = undefined;
    this.teleport(rec, rec.spec.pose);
    const s = rec.spec.settings;
    this.trimeshColliders(rec, s.friction ?? PHYSICS_DEFAULTS.friction, s.restitution ?? PHYSICS_DEFAULTS.restitution);
    this.unignore(rec.spec.key);
    this.version++;
  }

  remove(key: string) {
    const rec = this.recs.get(key);
    if (!rec) return;
    for (const c of rec.colliders) {
      this.owners.delete(c.handle);
      this.meshBoxes.delete(c.handle);
    }
    this.bodyKeys.delete(rec.body.handle);
    this.world.removeRigidBody(rec.body);
    this.recs.delete(key);
    this.unignore(key);
    this.version++;
  }

   
  teleport(rec: BodyRec, pose: Mat) {
    const tf = toTf(pose);
    rec.body.setTranslation(vec(tf.t), true);
    rec.body.setRotation(tf.q, true);
    if (rec.role === "kinematic") {
      rec.body.setNextKinematicTranslation(vec(tf.t));
      rec.body.setNextKinematicRotation(tf.q);
      rec.from = rec.to = tf;
      rec.vel = [0, 0, 0];
    } else if (rec.role === "dynamic") {
      rec.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rec.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rec.written = rec.shown = pose;
    }
    rec.pose = pose;
  }

   

  ignore(a: string, b: string) {
    if (a === b || a === "floor" || b === "floor") return;
    this.ignored.set(key2(a, b), [a, b]);
    for (const k of [a, b]) for (const c of this.recs.get(k)?.colliders ?? []) c.setActiveHooks(this.R.ActiveHooks.FILTER_CONTACT_PAIRS);
  }

  private unignore(key: string) {
    let changed = false;
    for (const [k, [a, b]] of this.ignored) {
      if (a === key || b === key) {
        this.ignored.delete(k);
        changed = true;
      }
    }
    if (changed) this.refreshHooks();
  }

  private refreshHooks() {
    const on = new Set<string>();
    for (const [a, b] of this.ignored.values()) {
      on.add(a);
      on.add(b);
    }
    for (const r of this.recs.values()) for (const c of r.colliders) c.setActiveHooks(on.has(r.spec.key) ? this.R.ActiveHooks.FILTER_CONTACT_PAIRS : this.R.ActiveHooks.NONE);
  }

  




  releaseSeparated() {
    if (!this.ignored.size) return;
    let changed = false;
    for (const [k, [a, b]] of this.ignored) {
      let ra = this.recs.get(a);
      let rb = this.recs.get(b);
      if (ra && rb && ra.role !== "dynamic") [ra, rb] = [rb, ra];
      let overlap = false;
      if (ra && rb && ra.role === "dynamic") {
        const base = { t: [ra.body.translation().x, ra.body.translation().y, ra.body.translation().z] as Vec3, q: ra.body.rotation() };
        outer: for (const p of this.parts(ra.spec)) {
          const tf = compose(base, p.at);
          for (const c of rb.colliders) {
            if (c.intersectsShape(p.shape, vec(tf.t), tf.q)) {
              overlap = true;
              break outer;
            }
          }
        }
      }
      if (!overlap) {
        this.ignored.delete(k);
        changed = true;
      }
    }
    if (changed) this.refreshHooks();
  }

   

  step() {
     
    if (this.ignored.size) {
      this.events ??= new this.R.EventQueue(true);
      this.world.step(this.events, this.hooks);
    } else this.world.step();
  }

  





  wakeAround(spec: BodySpec, poses: Mat[], margin: number) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of poses) {
      const b = this.box(spec, p);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], b.min[k] - margin);
        max[k] = Math.max(max[k], b.max[k] + margin);
      }
    }
    if (!(max[0] >= min[0])) return;
    const c = { x: (min[0] + max[0]) * 0.0005, y: (min[1] + max[1]) * 0.0005, z: (min[2] + max[2]) * 0.0005 };
    const h = { x: (max[0] - min[0]) * 0.0005, y: (max[1] - min[1]) * 0.0005, z: (max[2] - min[2]) * 0.0005 };
    const keys = new Set<string>();
    this.world.collidersWithAabbIntersectingAabb(c, h, (col) => {
      const key = this.owners.get(col.handle);
      if (key) keys.add(key);
      return true;
    });
     
    for (const key of keys) {
      const r = this.recs.get(key);
      if (r && r.role === "dynamic" && r.body.isSleeping()) r.body.wakeUp();
    }
  }

   

   
  box(spec: BodySpec, pose: Mat = spec.pose): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const g of spec.meshes) {
      const info = meshInfo(this.store, g);
      if (!info) continue;
      const b = transformedBox(info.min, info.max, pose);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], b.min[k]);
        max[k] = Math.max(max[k], b.max[k]);
      }
    }
    return { min, max };
  }

  candidate(spec: BodySpec, o: { mode: Candidate["mode"]; released?: boolean; carrier?: string }): Candidate {
    const b = this.box(spec);
    const ext = [0, 1, 2].map((k) => Math.max(0, b.max[k] - b.min[k]));
    return {
      key: spec.key,
      name: spec.name,
      mode: o.mode,
      size: Math.max(ext[0], ext[1], ext[2]),
      volume: (ext[0] * ext[1] * ext[2]) / 1e9,
      locked: spec.locked,
      released: o.released,
      carrier: o.carrier,
      box: b,
    };
  }

   
  others(exclude: Set<string>): Other[] {
    const out: Other[] = [{ key: "floor", name: "the floor", role: "floor" }];
    for (const r of this.recs.values()) {
      if (exclude.has(r.spec.key)) continue;
      out.push({ key: r.spec.key, name: r.spec.name, role: r.role === "dynamic" ? "dynamic" : r.role === "static" ? "static" : "kinematic", robotBase: r.spec.kind === "link" && r.spec.link === 0 });
    }
    return out;
  }

   
  private near(box: { min: Vec3; max: Vec3 }, pad: number, skip: (k: string) => boolean): { key: string; c: Collider }[] {
    const out: { key: string; c: Collider }[] = [{ key: "floor", c: this.floor }];
    for (const r of this.recs.values()) {
      if (skip(r.spec.key) || !r.colliders.length) continue;
      const b = this.box(r.spec, r.pose);
      if (b.min[0] > box.max[0] + pad || b.max[0] < box.min[0] - pad || b.min[1] > box.max[1] + pad || b.max[1] < box.min[1] - pad || b.min[2] > box.max[2] + pad || b.max[2] < box.min[2] - pad) continue;
      for (const c of r.colliders) {
         
        const m = this.meshBoxes.get(c.handle);
        if (m) {
          const mb = transformedBox(m.min, m.max, r.pose);
          if (mb.min[0] > box.max[0] + pad || mb.max[0] < box.min[0] - pad || mb.min[1] > box.max[1] + pad || mb.max[1] < box.min[1] - pad || mb.min[2] > box.max[2] + pad || mb.max[2] < box.min[2] - pad) continue;
        }
        out.push({ key: r.spec.key, c });
      }
    }
    return out;
  }

  







  private coarse(near: { key: string; c: Collider }[], spec: BodySpec, probe: (s: BodySpec) => { c: Collider } | null): { key: string; c: Collider }[] {
    const box = this.box(spec);
    const vol = (b: { min: Vec3; max: Vec3 }) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
    const tris = new Map<string, number>();
    for (const { key, c } of near) tris.set(key, (tris.get(key) ?? 0) + (this.meshBoxes.get(c.handle) ? ((c.indices()?.length ?? 0) / 3) : 0));
    const out: { key: string; c: Collider }[] = [];
    const swapped = new Set<string>();
    for (const n of near) {
      const rec = this.recs.get(n.key);
      if (rec && (tris.get(n.key) ?? 0) > DENSE_TRIS) {
        const b = this.box(rec.spec, rec.pose);
        const lo: Vec3 = [Math.max(b.min[0], box.min[0]), Math.max(b.min[1], box.min[1]), Math.max(b.min[2], box.min[2])];
        const hi: Vec3 = [Math.min(b.max[0], box.max[0]), Math.min(b.max[1], box.max[1]), Math.min(b.max[2], box.max[2])];
        if (vol({ min: lo, max: hi }) > 0.5 * vol(b)) {
          if (!swapped.has(n.key)) {
            swapped.add(n.key);
            const p = probe({ ...rec.spec, pose: rec.pose });
            if (p) out.push({ key: n.key, c: p.c });
          }
          continue;
        }
      }
      out.push(n);
    }
    return out;
  }

  





  private probeShape(spec: BodySpec): { shape: Shape; at: Tf } | null {
    const key = spec.meshes.join(",");
    const c = cachesOf(this.store);
    const hit = c.probes.get(key);
    if (hit !== undefined) return hit;
    let out: { shape: Shape; at: Tf } | null = null;
    const parts = this.parts(spec);
    if (parts.length === 1) out = parts[0];
    else if (parts.length > 1) {
      const infos = spec.meshes.map((g) => meshInfo(this.store, g)).filter((i): i is NonNullable<typeof i> => !!i);
      const n = infos.reduce((k, i) => k + i.vertices.length, 0);
      const all = new Float32Array(n);
      let o = 0;
      for (const i of infos) {
        all.set(i.vertices, o);
        o += i.vertices.length;
      }
      const hull = computeHull(this.R, n > HULL_EXACT_MAX * 3 ? supportPoints(all, 512) : all);
      out = hull && usable(this.R, hull) ? { shape: new this.R.ConvexPolyhedron(hull.vertices, hull.indices), at: { t: [0, 0, 0], q: IDENTITY } } : parts[0];
    }
    c.probes.set(key, out);
    return out;
  }

  







  relations(cands: BodySpec[], bases: BodySpec[], belowOnly: Set<string> = new Set()): Relations {
    const rel: Relations = { pen: new Map(), touch: new Map(), below: new Map(), overlap: new Map() };
    const touch = AUTO.touchGap * 0.001;
    const gap = AUTO.supportGap * 0.001;
    const still = { x: 0, y: 0, z: 0 };
    const down = { x: 0, y: 0, z: -1 };
    const probes = new Map<string, { c: Collider; q: Quat }>();
    const probe = (spec: BodySpec) => {
      if (probes.has(spec.key)) return probes.get(spec.key)!;
      const ps = this.probeShape(spec);
      if (!ps) return null;
      const tf = compose(toTf(spec.pose), ps.at);
      const c = this.world.createCollider(new this.R.ColliderDesc(ps.shape).setSensor(true).setTranslation(tf.t[0], tf.t[1], tf.t[2]).setRotation(tf.q));
      const p = { c, q: tf.q };
      probes.set(spec.key, p);
      return p;
    };
    const below = (p: { c: Collider; q: Quat }, near: { key: string; c: Collider }[]) => {
      const found = new Set<string>();
      for (const { key, c } of near) {
        if (found.has(key)) continue;
        const hit = c.castCollider(still, p.c, down, 0, gap, false);
         
         
        if (hit && hit.time_of_impact <= gap && rotate(p.q, [hit.normal2.x, hit.normal2.y, hit.normal2.z])[2] < -0.5) found.add(key);
      }
      return found;
    };
    try {
      for (const spec of cands) {
        const p = probe(spec);
        const pen = new Map<string, number>();
        const touching = new Set<string>();
        rel.pen.set(spec.key, pen);
        rel.touch.set(spec.key, touching);
        if (!p) {
          rel.below.set(spec.key, new Set());
          continue;
        }
        const near = this.coarse(this.near(this.box(spec), AUTO.supportGap, (k) => k === spec.key), spec, probe);
        if (belowOnly.has(spec.key)) {
           
           
          rel.below.set(spec.key, below(p, near));
          continue;
        }
        const dist = new Map<string, number>();
        for (const { key, c } of near) {
          const ct = c.contactCollider(p.c, touch);
          if (ct && ct.distance < (dist.get(key) ?? Infinity)) dist.set(key, ct.distance);
        }
        for (const [key, d] of dist) {
          if (d < 0) pen.set(key, -d * 1000);
          if (d <= touch) touching.add(key);
        }
        rel.below.set(spec.key, below(p, near));
      }
      for (const spec of bases) {
        const p = probe(spec);
        if (!p) continue;
        const robot = `${spec.item}#`;
        const near = this.coarse(this.near(this.box(spec), AUTO.supportGap, (k) => k.startsWith(robot)), spec, probe);
        rel.below.set(spec.key, below(p, near));
      }
       
       
      const boxes = cands.map((s) => this.box(s));
      for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.min[0] > b.max[0] || b.min[0] > a.max[0] || a.min[1] > b.max[1] || b.min[1] > a.max[1] || a.min[2] > b.max[2] || b.min[2] > a.max[2]) continue;
          if (belowOnly.has(cands[i].key) || belowOnly.has(cands[j].key)) continue;
          const pa = probes.get(cands[i].key);
          const pb = probes.get(cands[j].key);
          if (!pa || !pb) continue;
          const ct = pa.c.contactCollider(pb.c, 0);
          const depth = ct && ct.distance < 0 ? -ct.distance * 1000 : 0;
          if (depth > 0) {
            for (const [x, y] of [[cands[i].key, cands[j].key], [cands[j].key, cands[i].key]]) {
              const m = rel.overlap!.get(x) ?? new Map<string, number>();
              m.set(y, depth);
              rel.overlap!.set(x, m);
            }
          }
        }
      }
    } finally {
      for (const p of probes.values()) this.world.removeCollider(p.c, false);
    }
    return rel;
  }
}
