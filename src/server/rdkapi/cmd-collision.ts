 
 

import { activeMapPairs, bodyOf, checkCollisions, collectBodies, collisionMapOf, pairActive } from "@/engine/collision";
import { lineCollision } from "@/engine/commands/collisions";
import { collide } from "@/engine/kinematics";
import type { Item } from "@/engine/types";
import { descendants } from "@/engine/workspace";
import { broadcast, getServer } from "@/server/store";
import { ApiError, byHandle, cmd, need, ws } from "./bridge";
import { def } from "./context";
import { activeStation, writeItem } from "./cmd-items";
import { needRobot, padJoints } from "./cmd-robot";

 

 
function pairs(jointOverride?: Record<string, number[]>) {
  const s = getServer();
  return checkCollisions(ws(), s.services.geometry, activeStation().id, Number(s.services.settings.Collision_Clearance ?? 0), jointOverride);
}

export const apiCollisionPairs = pairs;

def("Collisions", "IS", async (c) => {
  await c.exec(() => {
     
    c.w.int(pairs().length);
  });
});

def("Collision_SetState", "IS", async (c) => {
  const on = await c.r.int();
  await c.exec(async () => {
    await cmd("collision.setActive", { active: on > 0 });
    c.w.int(pairs().length);
  });
});

def("Collided", "IS", async (c) => {
  const ha = await c.r.handle();
  const hb = await c.r.handle();
  await c.exec(() => {
    const a = need(ha).id;
    const b = need(hb).id;
    const hit = pairs().some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    c.w.int(hit ? 1 : 0);
  });
});

def("Collision_GetPairList", "IS", async (c) => {
  await c.exec(() => {
    const w = ws();
    const out = activeMapPairs(w, activeStation().id);
    c.w.int(out.length);
    for (const [a, b] of out) {
      writeItem(c.w, w.items[a.id]);
      c.w.int(a.link);
      writeItem(c.w, w.items[b.id]);
      c.w.int(b.link);
    }
  });
});

def("Collision_SetPair", "IS", async (c) => {
  const h1 = await c.r.handle();
  const h2 = await c.r.handle();
  const id1 = await c.r.int();
  const id2 = await c.r.int();
  const state = await c.r.int();
  await c.exec(async () => {
    const a = need(h1);
    const b = need(h2);
    await cmd("collision.setPair", { item1: a.id, item2: b.id, link1: id1, link2: id2, active: state !== 0 });
    c.w.int(1);
  });
});

def("Collision_Pairs", "IS", async (c) => {
  await c.exec(() => {
    const w = ws();
    const list = pairs();
     
    c.w.int(list.length);
    for (const p of list) {
      writeItem(c.w, w.items[p.a]);
      c.w.int(p.linkA ?? 0);
      writeItem(c.w, w.items[p.b]);
      c.w.int(p.linkB ?? 0);
    }
  });
});

def("Collision_Items", "IS", async (c) => {
  await c.exec(() => {
    const w = ws();
     
     
    const bodies = new Map<string, { id: string; link: number; hits: number }>();
    for (const p of pairs()) {
      for (const [id, link] of [
        [p.b, p.linkB ?? 0],
        [p.a, p.linkA ?? 0],
      ] as [string, number][]) {
        const key = `${id}#${link}`;
        const b = bodies.get(key) ?? { id, link, hits: 0 };
        b.hits += 1;
        bodies.set(key, b);
      }
    }
    c.w.int(bodies.size);
    for (const b of bodies.values()) {
      writeItem(c.w, w.items[b.id]);
      c.w.int(b.link).int(b.hits);
    }
  });
});

 

 
 
async function testMove(params: Record<string, unknown>): Promise<number> {
  const res = await cmd<{ collisions: number }>("collision.testMove", params);
  return res.collisions;
}

def("CollisionMove", "IS", async (c) => {
  const h = await c.r.handle();
  const j1 = await c.r.array();
  const j2 = await c.r.array();
  const step = (await c.r.int()) / 1000;
  await c.exec(async () => {
    const r = needRobot(h);
    c.w.int(await testMove({ robot: r.id, from: padJoints(r, j1), to: padJoints(r, j2), ...(step > 0 ? { stepDeg: step } : {}) }));
  });
});

def("CollisionMoveL", "IS", async (c) => {
  const h = await c.r.handle();
  const j1 = await c.r.array();
  const pose = await c.r.pose();
  const step = (await c.r.int()) / 1000;
  await c.exec(async () => {
    const r = needRobot(h);
    c.w.int(await testMove({ robot: r.id, from: padJoints(r, j1), pose, ...(step > 0 ? { stepMM: step } : {}) }));
  });
});

 
 
def("CollisionMoveBlend", "IS", async (c) => {
  const h = await c.r.handle();
  const j1 = await c.r.array();
  const j2 = await c.r.array();
  const j3 = await c.r.array();
  const minStep = (await c.r.int()) / 1000;
  const blend = (await c.r.int()) / 1000;
  await c.exec(async () => {
    const r = h ? needRobot(h) : ws().items[firstRobotId()];
    if (!r?.robot) throw new ApiError(1, "", (w) => w.int(-1));
    c.w.int(await testMove({ robot: r.id, from: padJoints(r, j1), via: padJoints(r, j2), to: padJoints(r, j3), blendDeg: blend, ...(minStep > 0 ? { stepDeg: minStep } : {}) }));
  });
});

function firstRobotId(): string {
  const w = ws();
  const r = descendants(w, activeStation().id).find((it) => it.type === "robot" && it.robot);
  if (!r) throw new ApiError(1, "", (wr) => wr.int(-1));
  return r.id;
}

 

 
def("Collision_SetPairList", "IS", async (c) => {
  const n = await c.r.int();
  const rows: [number, number, number, number, number][] = [];
  for (let i = 0; i < n; i++) rows.push([await c.r.handle(), await c.r.handle(), await c.r.int(), await c.r.int(), await c.r.int()]);
  await c.exec(async () => {
    const pairs = rows.map(([h1, h2, id1, id2, st]) => ({ item1: need(h1).id, item2: need(h2).id, link1: id1, link2: id2, active: st !== 0 }));
    if (pairs.length) await cmd("collision.setPairs", { pairs });
    c.w.int(1);
  });
});





def("Collided3", "IS", async (c) => {
  const h1 = await c.r.handle();
  const h2 = await c.r.handle();
  const ignoreMap = await c.r.int();
  await c.exec(() => {
    const a = need(h1);
    const b = need(h2);
    const w = ws();
    const s = getServer();
    const st = activeStation().id;
    const bodies = collectBodies(w, s.services.geometry, st);
    const map = collisionMapOf(w, st);
    const clearance = Number(s.services.settings.Collision_Clearance ?? 0);
    let count = 0;
    for (const A of bodies.filter((x) => x.item === a.id)) {
      for (const B of bodies.filter((x) => x.item === b.id)) {
        if (!ignoreMap && !pairActive(w, bodyOf(w, A.item, A.link), bodyOf(w, B.item, B.link), map)) continue;
        if (A.meshes.some((ma) => B.meshes.some((mb) => collide(ma, A.pose, mb, B.pose, clearance)))) count += 1;
      }
    }
    c.w.int(count);
  });
});

 

 
const SHOWN_KEY = "__robocraft_rdkapi_shown_collided";
function shownCollided(): Map<string, Set<number>> {
  const g = globalThis as unknown as Record<string, Map<string, Set<number>> | undefined>;
  g[SHOWN_KEY] ??= new Map();
  return g[SHOWN_KEY]!;
}

function setShownCollided(it: Item, id: number, on: boolean) {
  const shown = shownCollided();
  const links = shown.get(it.id) ?? new Set<number>();
  if (on) links.add(id);
  else links.delete(id);
  if (links.size) shown.set(it.id, links);
  else shown.delete(it.id);
  broadcast({ type: "collisions", items: [...shown.keys()] });
}

 
function bodyCount(it: Item): number {
  if (it.robot) return it.robot.links.length;
  return it.object?.meshes.length ?? 0;
}

 
def("ShowAsCollided", "S", async (c) => {
  const h = await c.r.handle();
  const id = await c.r.int();
  const on = await c.r.int();
  await c.exec(() => {
    const it = need(h);
    if (it.type !== "object" && it.type !== "robot") throw new ApiError(1);
    if (id < 0 || id >= bodyCount(it)) throw new ApiError(2, "Invalid id");
    setShownCollided(it, id, on !== 0);
  });
});

 
def("ShowAsCollidedList", "S", async (c) => {
  const n = await c.r.int();
  const rows: [number, number, number][] = [];
  for (let i = 0; i < n; i++) rows.push([await c.r.handle(), await c.r.int(), await c.r.int()]);
  await c.exec(() => {
    for (const [h, id, on] of rows) {
      const it = byHandle(h);
      if (it && (it.type === "object" || it.type === "robot") && id >= 0 && id < bodyCount(it)) setShownCollided(it, id, on !== 0);
    }
  });
});

 

 
 
def("CollisionLine", "TXS", async (c) => {
  const p1 = await c.r.xyz();
  const p2 = await c.r.xyz();
  await c.exec(() => {
    const s = getServer();
    const hit = lineCollision(ws(), s.services, activeStation().id, p1, p2);
    writeItem(c.w, hit.item ? ws().items[hit.item] : undefined);
    c.w.xyz(hit.xyz);
  });
});

 
 
def("CollisionLineLst", "TMS", async (c) => {
  const n = await c.r.int();
  const segs: [number[], number[]][] = [];
  for (let i = 0; i < n; i++) segs.push([await c.r.xyz(), await c.r.xyz()]);
  await c.exec(() => {
    const s = getServer();
    const st = activeStation().id;
    let first: string | null = null;
    const cols: number[][] = [];
    for (const [a, b] of segs) {
      const hit = lineCollision(ws(), s.services, st, a, b);
      if (hit.item && !first) first = hit.item;
      cols.push(hit.xyz);
    }
    writeItem(c.w, first ? ws().items[first] : undefined);
    c.w.matrix(3, cols.length, cols.flat());
  });
});

 

def("Attach_Closest2", "TS", async (c) => {
  const h = await c.r.handle();
  const keyword = await c.r.line();
  const [tolerance = -1] = await c.r.array();
  const n = await c.r.int();
  const listed: number[] = [];
  for (let i = 0; i < n; i++) listed.push(await c.r.handle());
  await c.exec(async () => {
    const tool = need(h);
    if (tool.type !== "tool") throw new ApiError(3, `${tool.name} is not a tool`);
    const res = await cmd<{ id?: string }>("tool.attach", { tool: tool.id, ...(keyword ? { keyword } : {}), ...(tolerance > 0 ? { tolerance } : {}), ...(listed.length ? { objects: listed.map((x) => need(x).id) } : {}) });
    writeItem(c.w, res.id ? ws().items[res.id] : undefined);
  });
});

 
def("Attach_Closest", "TS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    const tool = byHandle(h);
    if (!tool || tool.type !== "tool") throw new ApiError(1, "", (w) => w.nullItem());
    const res = await cmd<{ id?: string }>("tool.attach", { tool: tool.id });
    writeItem(c.w, res.id ? ws().items[res.id] : undefined);
  });
});

def("Detach_Closest", "TS", async (c) => {
  const h = await c.r.handle();
  const hp = await c.r.handle();
  await c.exec(async () => {
    const tool = need(h);
    const parent = hp ? need(hp) : activeStation();
    const res = await cmd<{ ids: string[] }>("tool.detach", { tool: tool.id, parent: parent.id });
    writeItem(c.w, res.ids[0] ? ws().items[res.ids[0]] : undefined);
  });
});

def("Detach_All", "S", async (c) => {
  const h = await c.r.handle();
  const hp = await c.r.handle();
  await c.exec(async () => {
    const tool = need(h);
    const parent = hp ? need(hp) : activeStation();
     
    await cmd("tool.detach", { tool: tool.id, parent: parent.id, all: true });
  });
});
