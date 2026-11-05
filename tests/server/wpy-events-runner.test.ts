// Verifies conveyor motion, moving-object sensors, and create/wait event scheduling.
 
 
 
 
 
 
 
 
 
 
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Item } from "@/engine/types";

type Srv = ReturnType<typeof import("@/server/store").getServer>;
let srv: Srv;
let run: typeof import("@/server/store").run;
let absPose: typeof import("@/engine/workspace").absPose;
const statuses: string[] = [];

async function ok(name: string, params: Record<string, unknown> = {}) {
  const r = await run(name, params, "system");
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result as Record<string, unknown>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
 
const items = () => {
  const out: Item[] = [];
  const walk = (id: string) => {
    for (const c of srv.ws.items[id]?.children ?? []) {
      const it = srv.ws.items[c];
      if (!it) continue;
      out.push(it);
      walk(c);
    }
  };
  if (srv.ws.activeStation) walk(srv.ws.activeStation);
  return out;
};
const byName = (name: string, type?: string) => items().find((i) => i.name === name && (!type || i.type === type)) as Item;
const xyz = (m: number[]) => [m[3], m[7], m[11]].map((v) => Math.round(v * 1e4) / 1e4 + 0);
 
async function idle(limitMs = 20_000) {
  await sleep(60);
  const until = Date.now() + limitMs;
  while (((srv.ws.busy?.length ?? 0) > 0 || srv.ws.running) && Date.now() < until) await sleep(10);
}
async function until(cond: () => boolean, limitMs = 20_000) {
  const end = Date.now() + limitMs;
  while (!cond() && Date.now() < end) await sleep(10);
  return cond();
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-wpy-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  absPose = (await import("@/engine/workspace")).absPose;
  await srv.ready;
  srv.listeners.add((e: { type: string; text?: unknown }) => {
    if (e.type === "status") statuses.push(String(e.text));
  });
}, 60_000);

 
async function conveyorCell() {
  await ok("sim.stop");
  await ok("station.new", {});
  const st = srv.ws.activeStation!;
  const shape = async (name: string, size: number, at: number[], parent = st) => (await ok("object.addShape", { shape: "box", name, sizeX: size, sizeY: size, sizeZ: size, xyzrpw: [...at, 0, 0, 0], parent })).id as string;
  const belt = await shape("Belt", 50, [0, 0, 0]);
  const carriage = await shape("Carriage", 10, [0, 0, 0]);
  const conv = (await ok("mechanism.build", { type: 4, name: "Conveyor", objects: [belt, carriage], lower: [-1e6], upper: [1e6] })).id as string;
   
  srv.ws.items[conv].robot!.speeds = { linear: 200, joint: 200, linearAccel: 2000, jointAccel: 2000 };
  const ref = (await ok("item.addFrame", { name: "Conveyor Move Ref", parent: conv })).id as string;
  const event = async (prog: string, action: string, set: Record<string, unknown>) => {
    const ins = (await ok("program.addInstruction", { program: prog, kind: "event", eventAction: action })).id as string;
    await ok("instruction.setEvent", { instruction: ins, ...set });
    return ins;
  };
  return { st, shape, conv, ref, event };
}

describe("move conveyor, create and wait events in the simulation", () => {
  it("Move conveyor: the program waits for the motion, parts on the conveyor ride along, the length counts", async () => {
    const { st, shape, conv, ref, event } = await conveyorCell();
    const template = await shape("Part", 100, [300, 0, 0], st);
    const main = (await ok("program.add", { name: "Main", robot: conv })).id as string;
    await event(main, "create", { objects: [template], frame: ref });
    await event(main, "conveyor", { objects: [conv], distance: 400 });
    await ok("sim.setSpeed", { factor: 10 });
    statuses.length = 0;
    await ok("program.run", { program: main });
     
    await sleep(80);
    expect(srv.ws.busy).toContain(main);
    await idle();
    expect(srv.ws.items[conv].robot!.joints).toEqual([400]);
    const copy = items().find((i) => i.name === "Part" && i.parent === ref)!;
    expect(xyz(absPose(srv.ws, copy.id))).toEqual(xyz(absPose(srv.ws, template)).map((v, k) => (k === 2 ? v + 400 : v)));
     
    expect(statuses.find((s) => s.startsWith("Program Main finished"))).toMatch(/^Program Main finished \(path length: 400\.0 mm, program time: /);
  });

  it("Move conveyor without a mechanism never finishes: the program stays busy until stopped", async () => {
    const { st, shape, event } = await conveyorCell();
    const part = await shape("Part", 100, [300, 0, 0], st);
    const p = (await ok("program.add", { name: "NoMech" })).id as string;
    await event(p, "conveyor", { objects: [part], distance: 100 });
    await ok("program.run", { program: p });
    await sleep(600);
    expect(srv.ws.busy).toContain(p);
    await ok("sim.stop");
    expect(await until(() => !(srv.ws.busy ?? []).includes(p), 3000)).toBe(true);
  });

  it("Wait & Remove: the sensor deletes the part a moving conveyor carries through it, then the program goes on", async () => {
    const { st, shape, conv, ref, event } = await conveyorCell();
     
    const part = await shape("Box", 60, [0, 0, 0], ref);
    const at = absPose(srv.ws, part);
    const sensor = await shape("Laser Sensor", 40, [at[3], at[7], at[11] + 300], st);
    await ok("item.lock", { items: [sensor], locked: true });
    const deleter = (await ok("program.add", { name: "BoxDeleter" })).id as string;
    await event(deleter, "wait", { objects: [sensor], option: 1 });
    const main = (await ok("program.add", { name: "Main", robot: conv })).id as string;
    await ok("program.addInstruction", { program: main, kind: "thread", text: "BoxDeleter" });
    await event(main, "conveyor", { objects: [conv], distance: 1000 });
    await ok("sim.setSpeed", { factor: 5 });
    await ok("program.run", { program: main });
    await sleep(100);
     
    expect(srv.ws.busy).toContain(deleter);
    expect(srv.ws.items[part]).toBeDefined();
    expect(await until(() => !srv.ws.items[part])).toBe(true);
     
    expect(await until(() => !(srv.ws.busy ?? []).includes(deleter), 3000)).toBe(true);
    await idle();
    expect(srv.ws.items[conv].robot!.joints).toEqual([1000]);
  });

  it("Wait & Stop stops the robot named by the event where it is; its motion never ends", async () => {
    const { st, shape, conv, ref, event } = await conveyorCell();
    const part = await shape("Box", 60, [0, 0, 0], ref);
    const at = absPose(srv.ws, part);
    const sensor = await shape("Stop Sensor", 40, [at[3], at[7], at[11] + 300], st);
    await ok("item.lock", { items: [sensor], locked: true });
    const stopper = (await ok("program.add", { name: "Stopper" })).id as string;
    await event(stopper, "wait", { objects: [sensor], option: 3, frame: conv });
    const mover = (await ok("program.add", { name: "Mover", robot: conv })).id as string;
    await event(mover, "conveyor", { objects: [conv], distance: 1000 });
    await ok("sim.setSpeed", { factor: 5 });
    await ok("program.run", { program: stopper });
    await ok("program.run", { program: mover });
    expect(await until(() => !(srv.ws.busy ?? []).includes(stopper))).toBe(true);
    await sleep(400);
     
    const q = srv.ws.items[conv].robot!.joints[0];
    expect(q).toBeGreaterThan(150);
    expect(q).toBeLessThan(1000);
    expect(srv.ws.busy).toContain(mover);
    expect(srv.ws.items[part].parent).toBe(ref);
    await ok("sim.stop");
  });
});

const STATIONS = path.join(path.resolve(__dirname, "../.."), "data/library/files/library-stations");
const CONV04 = path.join(STATIONS, "Conveying-04.rdk");
const CRB = path.join(STATIONS, "Conveying-with-ABB-CRB-1300-7-1-4.rdk");

describe.skipIf(!existsSync(CONV04) || !existsSync(CRB))("library conveyor stations against RoboDK 6.0.7 (library mirror)", () => {
  async function open(file: string) {
    await ok("sim.stop");
    await ok("station.openRdk", { base64: readFileSync(file).toString("base64") });
  }

  it("Conveying-04: Main moves the conveyor to 400 and its new box rides along; Reset puts the 6 boxes back", async () => {
    await open(CONV04);
    const objects0 = items().filter((i) => i.type === "object").map((i) => i.id);
    await ok("sim.setSpeed", { factor: 50 });
    await ok("program.run", { program: byName("Main", "program").id });
    await idle();
    expect(srv.ws.items[byName("Box Conveyor", "robot").id].robot!.joints).toEqual([400]);
    const made = items().filter((i) => i.type === "object" && !objects0.includes(i.id));
    expect(made.map((o) => [o.name, srv.ws.items[o.parent!].name, o.visible])).toEqual([["RoboDK Box", "Box Conveyor Frame", true]]);
     
    const m = absPose(srv.ws, made[0].id);
    expect([m[0], m[1], m[4], m[5]].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, -1, 1, 0]);
    expect(xyz(m)).toEqual([-1950, 875, 715]);
    await ok("program.run", { program: byName("Reset", "program").id });
    await idle();
    expect(srv.ws.items[byName("Box Conveyor", "robot").id].robot!.joints).toEqual([0]);
    const after = items().filter((i) => i.type === "object");
    expect(after).toHaveLength(13);
    expect(objects0.map((id, i) => (srv.ws.items[id] ? i : -1)).filter((i) => i >= 0)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(srv.ws.items[made[0].id]).toBeUndefined();
  });

  it("CRB-1300: the looping feeder keeps creating boxes on conveyor A and the looping deleter removes them at Laser Sensor A", async () => {
    await open(CRB);
    const boxes = () => items().filter((i) => i.type === "object" && i.name === "Box" && !i.locked);
    let removed = 0;
    const seen = new Set<string>();
    const listener = (e: { type: string; patch?: { removes: string[] } }) => {
      if (e.type === "patch") removed += e.patch!.removes.filter((id) => seen.has(id)).length;
    };
    srv.listeners.add(listener);
    try {
      await ok("sim.setSpeed", { factor: 20 });
      await ok("program.run", { program: byName("BoxFeeder", "program").id });
       
      await sleep(1500);
      for (const b of boxes()) seen.add(b.id);
      expect(boxes().length).toBeGreaterThanOrEqual(3);
      expect(boxes().every((b) => srv.ws.items[b.parent!].name === "ConveyorA Move Ref")).toBe(true);
      expect(xyz(absPose(srv.ws, boxes()[0].id))).toEqual([60, 290, 366.5]);
      expect(srv.ws.busy).toContain(byName("BoxFeeder", "program").id);
      const deleter = byName("BoxDeleterA", "program").id;
      await ok("program.run", { program: deleter });
      await ok("program.run", { program: byName("ConveyorMoveA", "program").id });
       
      expect(await until(() => removed >= 2, 15_000)).toBe(true);
      expect(srv.ws.busy).toContain(deleter);
    } finally {
      srv.listeners.delete(listener);
      await ok("sim.stop");
    }
  });
});
