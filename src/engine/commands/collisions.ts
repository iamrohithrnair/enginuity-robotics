 
 
 

import { z } from "zod";
import { activeMapPairs, checkCollisions, collectBodies, collisionMapOf, mapBodies, pairActive, pairKey, stationIdFor } from "../collision";
import { requireRef } from "../dispatch";
import { inv, mul, type Mat } from "../math";
import { motionState, planMove } from "../sim/planner";
import type { CollisionMapData, Item, Workspace } from "../types";
import { absPose, descendants } from "../workspace";
import { CommandError, defineCommand, ItemRef, type Services } from "../registry";
import { activeStationId } from "./items";
import { requireRobot } from "./robot";

const Joints = z.array(z.number());
const Pose = z.array(z.number()).length(16);

function stationOfRef(ws: Workspace, ref: string | number | undefined): string {
  if (ref === undefined) return activeStationId(ws);
  const st = requireRef(ws, ref);
  if (st.type !== "station") throw new CommandError(`${st.name} is not a station`);
  return st.id;
}

const mapData = (ws: Workspace, st: string): CollisionMapData => {
  const d = ws.items[st].collisionMap;
  return { mode: d?.mode ?? "default", pairs: (d?.pairs ?? []).map((p) => [...p] as CollisionMapData["pairs"][number]) };
};

 
export function robotJoints(robot: Item, q: number[]): number[] {
  const n = robot.robot!.model.nq;
  return Array.from({ length: n }, (_, i) => (Number.isFinite(q[i]) ? q[i] : 0));
}

 
export function robotReferenceAbs(ws: Workspace, robot: Item): Mat {
  const f = robot.robot?.activeFrame;
  if (f && ws.items[f]) return absPose(ws, f);
  return absPose(ws, robot.id);
}

defineCommand({
  name: "collision.map",
  title: "Collision Map",
  description:
    "The station's collision map (Tools ▸ Collision Map, Shift+X): its mode (default, all or none), the bodies (robot links, tools, objects) in the map's order, which pairs are checked (active[i][j]) and the per-pair overrides.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-50",
  schema: z.object({ station: ItemRef.optional() }),
  run({ ws }, p) {
    const st = stationOfRef(ws, p.station);
    const map = collisionMapOf(ws, st);
    const bodies = mapBodies(ws, st);
    const active = bodies.map((a) => bodies.map((b) => pairActive(ws, a, b, map)));
    return {
      station: ws.items[st].name,
      mode: map.mode,
      bodies: bodies.map((b) => ({ item: b.id, name: ws.items[b.id]?.name ?? "", link: b.link, kind: b.kind })),
      active,
      checkedPairs: activeMapPairs(ws, st).length,
      overrides: [...map.overrides].map(([key, on]) => ({ key, active: on })),
    };
  },
});

defineCommand({
  name: "collision.setMap",
  title: "Set Collision Map",
  description:
    "Reset the station's collision map: 'default' (the default pairs), 'all' (every pair) or 'none' (no pair). Per-pair overrides are cleared (station command CollisionMap).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-50",
  schema: z.object({ mode: z.enum(["default", "all", "none"]), station: ItemRef.optional() }),
  run({ ws, tx, services }, p) {
    const st = stationOfRef(ws, p.station);
    tx.set(st, { collisionMap: { mode: p.mode, pairs: [] } });
    services.emit?.({ type: "collision-map", station: st });
    return { mode: p.mode };
  },
});

const PairSpec = z.object({
  item1: ItemRef,
  item2: ItemRef,
   
  link1: z.number().int().default(0),
  link2: z.number().int().default(0),
  active: z.boolean(),
});

function setPairs(ws: Workspace, st: string, pairs: z.infer<typeof PairSpec>[]): CollisionMapData {
  const data = mapData(ws, st);
  for (const p of pairs) {
    const a = requireRef(ws, p.item1);
    const b = requireRef(ws, p.item2);
    const key = pairKey(a.id, p.link1, b.id, p.link2);
    data.pairs = data.pairs.filter(([x, lx, y, ly]) => pairKey(x, lx, y, ly) !== key);
    data.pairs.push([a.id, p.link1, b.id, p.link2, p.active]);
  }
  return data;
}

defineCommand({
  name: "collision.setPair",
  title: "Set Collision Pair",
  description:
    "Check (active: true) or ignore (false) collisions between two bodies of the collision map: robot links are given as the robot plus a link index (0 = base), tools and objects with link 0 (setCollisionActivePair).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-50",
  schema: PairSpec.extend({ station: ItemRef.optional() }),
  run({ ws, tx, services }, p) {
    const st = p.station !== undefined ? stationOfRef(ws, p.station) : stationIdFor(ws, requireRef(ws, p.item1).id) ?? activeStationId(ws);
    tx.set(st, { collisionMap: setPairs(ws, st, [p]) });
    services.emit?.({ type: "collision-map", station: st });
    return { ok: 1 };
  },
});

defineCommand({
  name: "collision.setPairs",
  title: "Set Collision Pairs",
  description: "Set several collision map pairs at once (setCollisionActivePairList).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-50",
  schema: z.object({ pairs: z.array(PairSpec), station: ItemRef.optional() }),
  run({ ws, tx, services }, p) {
    const st = stationOfRef(ws, p.station);
    tx.set(st, { collisionMap: setPairs(ws, st, p.pairs) });
    services.emit?.({ type: "collision-map", station: st });
    return { ok: 1, count: p.pairs.length };
  },
});

 

 
function robotCollisions(ws: Workspace, services: Services, robot: Item, q: number[]): number {
  const st = activeStationId(ws);
  const carried = new Set([robot.id, ...descendants(ws, robot.id).map((d) => d.id)]);
  return checkCollisions(ws, services.geometry, st, Number(services.settings.Collision_Clearance ?? 0), { [robot.id]: q }).filter((p) => carried.has(p.a) || carried.has(p.b)).length;
}






function bisectionOrder(span: number, step: number): number[] {
  const out = [0, 1];
  let queue: [number, number][] = [[0, 1]];
  while (queue.length) {
    const next: [number, number][] = [];
    for (const [lo, hi] of queue) {
      if ((hi - lo) * span <= step) continue;
      const mid = (lo + hi) / 2;
      out.push(mid);
      next.push([lo, mid], [mid, hi]);
    }
    queue = next;
  }
  return out;
}

 
function blendedPath(j1: number[], j2: number[], j3: number[], blend: number, step: number): number[][] {
  const dist = (a: number[], b: number[]) => Math.max(0, ...a.map((v, i) => Math.abs(b[i] - v)));
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const d1 = dist(j1, j2);
  const d2 = dist(j2, j3);
  const r = Math.max(0, Math.min(blend, d1 / 2, d2 / 2));
  const a = d1 > 0 ? lerp(j2, j1, r / d1) : j2;
  const b = d2 > 0 ? lerp(j2, j3, r / d2) : j2;
  const seg = (p: number[], q: number[]) => {
    const n = Math.max(1, Math.ceil(dist(p, q) / step));
    return Array.from({ length: n }, (_, k) => lerp(p, q, k / n));
  };
  const out = [...seg(j1, a)];
  const nb = Math.max(1, Math.ceil((2 * r) / step));
  for (let k = 0; k < nb; k++) {
    const t = k / nb;
    out.push(a.map((v, i) => (1 - t) * (1 - t) * v + 2 * (1 - t) * t * j2[i] + t * t * b[i]));
  }
  out.push(...seg(b, j3), j3);
  return out;
}

defineCommand({
  name: "collision.testMove",
  title: "Test Move for Collisions",
  description:
    "Test a robot move for collisions (MoveJ_Test / MoveL_Test / MoveJ_Test_Blend). Joint move: from → to. Linear move: from → pose (TCP pose relative to the robot's active reference frame). Blend: from → via → to with the corner rounded by blendDeg. Returns collisions: 0 free, n = colliding pairs at the first colliding configuration, -1 linear move impossible, -2 target unreachable. The robot is left at the colliding configuration, else at the end. Collisions are only tested while collision checking is on (Shift+C).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-53",
  schema: z.object({
    robot: ItemRef.optional(),
    from: Joints,
    to: Joints.optional(),
    pose: Pose.optional(),
    via: Joints.optional(),
    blendDeg: z.number().default(5),
    stepMM: z.number().optional(),
    stepDeg: z.number().optional(),
  }),
  run({ ws, tx, services }, p) {
    const r = requireRobot(ws, p.robot);
    const place = (q: number[]) => tx.set(r.id, { robot: { ...ws.items[r.id].robot!, joints: q.slice() } });
    const start = robotJoints(r, p.from);
    const deg = p.stepDeg && p.stepDeg > 0 ? p.stepDeg : Number(services.settings.PathStepCollisionDeg ?? 4);
    const mm = p.stepMM && p.stepMM > 0 ? p.stepMM : Number(services.settings.PathStepCollisionMM ?? 4);
    if (p.pose) {
      const goalAbs = mul(robotReferenceAbs(ws, r), p.pose);
      const fake: Item = { id: "__movel_test", handle: 0, type: "instruction", name: "MoveL", parent: null, children: [], visible: true, pose: goalAbs, instruction: { kind: "move", moveType: "linear", pose: goalAbs } };
      const res = planMove(ws, r, motionState(ws, r, start), fake, { stepMM: 1, wristTolerance: Number(services.settings.ToleranceSingularityWrist ?? 2.5) });
      if (!res.ok) return { collisions: res.error?.kind === "path" ? -1 : -2, joints: r.robot!.joints };
      if (ws.collisionsActive) {
        const every = Math.max(1, Math.round(mm));
        for (let k = 0; k < res.samples.length; k += every) {
          const hits = robotCollisions(ws, services, r, res.samples[k]);
          if (hits > 0) {
            place(res.samples[k]);
            return { collisions: hits, joints: res.samples[k] };
          }
        }
      }
      place(res.joints);
      return { collisions: 0, joints: res.joints };
    }
    if (!p.to) throw new CommandError("Provide the end joints (to) or a pose");
    const end = robotJoints(r, p.to);
    if (p.via) {
      const path = blendedPath(start, robotJoints(r, p.via), end, Math.max(0, p.blendDeg), deg);
      if (ws.collisionsActive) {
        for (const q of path) {
          const hits = robotCollisions(ws, services, r, q);
          if (hits > 0) {
            place(q);
            return { collisions: hits, joints: q };
          }
        }
      }
      place(end);
      return { collisions: 0, joints: end };
    }
    const span = Math.max(0, ...start.map((v, i) => Math.abs(end[i] - v)));
    if (ws.collisionsActive) {
      for (const t of bisectionOrder(span, deg)) {
        const q = start.map((v, i) => v + (end[i] - v) * t);
        const hits = robotCollisions(ws, services, r, q);
        if (hits > 0) {
          place(q);
          return { collisions: hits, joints: q };
        }
      }
    }
    place(end);
    return { collisions: 0, joints: end };
  },
});

 

const bboxCache = new Map<string, [number, number, number, number, number, number]>();

function bbox(id: string, tri: Float32Array) {
  let b = bboxCache.get(id);
  if (!b) {
    b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tri.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], tri[i + k]);
        b[k + 3] = Math.max(b[k + 3], tri[i + k]);
      }
    }
    bboxCache.set(id, b);
  }
  return b;
}

 
function segmentHitsBox(p: number[], d: number[], b: number[]): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (p[k] < b[k] || p[k] > b[k + 3]) return false;
      continue;
    }
    let ta = (b[k] - p[k]) / d[k];
    let tb = (b[k + 3] - p[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

 
function segmentTriangles(p: number[], d: number[], tri: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i + 8 < tri.length; i += 9) {
    const e1 = [tri[i + 3] - tri[i], tri[i + 4] - tri[i + 1], tri[i + 5] - tri[i + 2]];
    const e2 = [tri[i + 6] - tri[i], tri[i + 7] - tri[i + 1], tri[i + 8] - tri[i + 2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(a) < 1e-12) continue;
    const f = 1 / a;
    const s = [p[0] - tri[i], p[1] - tri[i + 1], p[2] - tri[i + 2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    if (t >= 0 && t <= 1 && t < best) best = t;
  }
  return best;
}

const apply = (m: Mat, v: number[]) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3], m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7], m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11]];





export function lineCollision(ws: Workspace, services: Services, stationId: string, p1: number[], p2: number[]): { item: string | null; xyz: number[] } {
  let best: { t: number; item: string } | null = null;
  for (const body of collectBodies(ws, services.geometry, stationId)) {
    const it = ws.items[body.item];
    const meshes = it?.robot ? it.robot.links[body.link ?? 0] ?? [] : it?.object?.meshes ?? it?.tool?.meshes ?? [];
    const toLocal = inv(body.pose);
    const a = apply(toLocal, p1);
    const b = apply(toLocal, p2);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    for (const m of meshes) {
      const tri = services.geometry.get(m.geometry);
      if (!tri || !segmentHitsBox(a, d, bbox(m.geometry, tri))) continue;
      const t = segmentTriangles(a, d, tri);
      if (t < (best?.t ?? Infinity)) best = { t, item: body.item };
    }
  }
  if (!best) return { item: null, xyz: [0, 0, 0] };
  return { item: best.item, xyz: p1.map((v, k) => v + (p2[k] - v) * best!.t) };
}

defineCommand({
  name: "collision.line",
  title: "Line Collision",
  description:
    "Find the first robot link, tool or object a straight line from p1 to p2 hits (points in mm, in station coordinates or relative to `reference`). Returns the item (null when the line is free) and the intersection point closest to p1 (Collision_Line).",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-52",
  schema: z.object({ p1: z.array(z.number()).length(3), p2: z.array(z.number()).length(3), reference: ItemRef.optional() }),
  run({ ws, services }, p) {
    const ref = p.reference !== undefined ? absPose(ws, requireRef(ws, p.reference).id) : undefined;
    const a = ref ? apply(ref, p.p1) : p.p1;
    const b = ref ? apply(ref, p.p2) : p.p2;
    const hit = lineCollision(ws, services, activeStationId(ws), a, b);
    return { collision: hit.item !== null, item: hit.item ? ws.items[hit.item].name : null, id: hit.item, xyz: hit.xyz };
  },
});

