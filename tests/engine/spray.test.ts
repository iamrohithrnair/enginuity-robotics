 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mul, rotx, transl, type Mat } from "@/engine/math";
import {
  addGun,
  castSegment,
  buildTarget,
  clearGuns,
  DEFAULT_FAR,
  DEFAULT_NEAR,
  emitGuns,
  emitOnce,
  gunStats,
  makeRng,
  parseQColor,
  parseSprayConfig,
  sampleIndexAt,
  segmentTriangle,
  setGunState,
  SprayTicker,
  stationGuns,
  STATS_INFO,
} from "@/engine/spray";
import { makeItem } from "@/engine/workspace";
import { engine, ROOT } from "../helpers";

const probe = (name: string) => JSON.parse(readFileSync(path.join(ROOT, "research/evidence/spray", `probe-${name}.json`), "utf8")) as { step: string; value: { reply: unknown[] } }[];
const step = (rows: ReturnType<typeof probe>, key: string) => rows.find((r) => r.step === key)!.value.reply;
 
const statsColumns = (reply: unknown[]) => {
  const [rows, cols, data] = reply[1] as [number, number, number[]];
  return Array.from({ length: cols }, (_, c) => data.slice(c * rows, (c + 1) * rows));
};

type Engine = Awaited<ReturnType<typeof engine>>;

 
function addMesh(e: Engine, name: string, tris: number[][], pose: Mat = transl(0, 0, 0), color: [number, number, number, number] = [0.7, 0.7, 0.7, 1]) {
  const geometry = e.services.geometry.put(new Float32Array(tris.flat()));
  const st = e.ws.activeStation!;
  const obj = { ...makeItem(e.ws, "object", name, { object: { meshes: [{ geometry, color }] }, pose }), parent: st };
  e.ws.items[obj.id] = obj;
  e.ws.items[st].children.push(obj.id);
  return obj.id;
}

 
const PLATE = [
  [-30, -150, 0, 270, -150, 0, 270, 150, 0],
  [-30, -150, 0, 270, 150, 0, -30, 150, 0],
];
const GUN = [[0, 0, 0, 10, 0, 0, 0, 10, 0]];
const P1 = mul(transl(0, 0, 300), rotx(Math.PI));
const P2 = mul(transl(200, 0, 300), rotx(Math.PI));
 
const VOL_ELLIPSE = { rows: 9, cols: 2, data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600, 200, 0, 600, 0, 100, 600] };
const VOL_RECT = { rows: 9, cols: 2, data: [0, 0, 0, 0, 0, 0, 0, 0, 0, -200, -100, 600, 200, -100, 600, -200, 100, 600] };

describe("spray options (FUN_10060cf9c constructor)", () => {
  it("defaults: ELLYPSE, PROJECT, STEP=1x0, RAND=1, sphere radius 10 / 8 facets, near blue 0.8, far red 0.2", () => {
    const c = parseSprayConfig("");
    expect(c.shape).toBe(1);
    expect(c.project).toBe(true);
    expect([c.stepA, c.stepB, c.rand]).toEqual([1, 0, 1]);
    expect(c.particle).toEqual({ kind: "sphere", radius: 10, facets: 8, scale: null });
    expect(c.near.slice(0, 13)).toEqual([0, 0, -10, 50, 0, -10, 0, 100, -10, 0, 0, 1, 0.8]);
    expect(c.far.slice(0, 13)).toEqual([0, 0, 400, 200, 0, 400, 0, 400, 400, 1, 0, 0, 0.2]);
    expect(DEFAULT_NEAR.length).toBe(16);
    expect(DEFAULT_FAR.length).toBe(16);
     
    expect([c.nearAStep, c.farBStep]).toEqual([0, 0]);
    expect(c.angStep).toBeCloseTo(2 * Math.PI, 12);
  });

  it("the example painting options", () => {
    const c = parseSprayConfig("ELLYPSE PROJECT PARTICLE=SPHERE(4,8,1,1,0.5) STEP=8x8 RAND=2");
    expect([c.shape, c.project, c.stepA, c.stepB, c.rand]).toEqual([1, true, 8, 8, 2]);
    expect(c.particle).toEqual({ kind: "sphere", radius: 4, facets: 8, scale: [1, 1, 0.5] });
     
    expect(c.nearAStep).toBeCloseTo(50 / 8, 12);
    expect(c.nearBStep).toBeCloseTo(100 / 8, 12);
    expect(c.farAStep).toBeCloseTo(200 / 8, 12);
    expect(c.farBStep).toBeCloseTo(400 / 8, 12);
    expect(c.angStep).toBeCloseTo((2 * Math.PI) / 8, 12);
  });

  it("STEP and RAND are integer parses (QString::toInt); STEP needs two 'x' parts; clamp A ≥ 1, B ≥ 0", () => {
    expect(parseSprayConfig("STEP=8X8")).toMatchObject({ stepA: 1, stepB: 0 });
    expect(parseSprayConfig("STEP=8")).toMatchObject({ stepA: 1, stepB: 0 });
    expect(parseSprayConfig("STEP=-3x-2")).toMatchObject({ stepA: 1, stepB: 0 });
    expect(parseSprayConfig("STEP=2x")).toMatchObject({ stepA: 2, stepB: 0 });
    expect(parseSprayConfig("STEP=3x2x9")).toMatchObject({ stepA: 3, stepB: 2 });
    expect(parseSprayConfig("RAND=0.5").rand).toBe(0);
    expect(parseSprayConfig("RAND=").rand).toBe(0);
    expect(parseSprayConfig("RAND=3x4").rand).toBe(3);
    expect(parseSprayConfig("RAND=0").rand).toBe(0);
  });

  it("keywords match by prefix in RoboDK's order; only PARTICLE= and COLOR= ignore case", () => {
    expect(parseSprayConfig("RECTANGLE").shape).toBe(2);
    expect(parseSprayConfig("rectangle").shape).toBe(1);
    expect(parseSprayConfig("RECTANGLE ELLIPSE").shape).toBe(2);  
    expect(parseSprayConfig("RECTANGLE ELLYPSE").shape).toBe(1);
    expect(parseSprayConfig("NO_PROJECT").project).toBe(false);
    expect(parseSprayConfig("NO_PROJECT PROJECTION").project).toBe(true);
    expect(parseSprayConfig("particle=cube(1,2,3)").particle).toEqual({ kind: "cube", size: [1, 2, 3] });
    expect(parseSprayConfig("PARTICLE=CUBE").particle).toEqual({ kind: "cube", size: [10, 10, 10] });
    expect(parseSprayConfig("PARTICLE=Sphere(2)").particle).toEqual({ kind: "sphere", radius: 2, facets: 12, scale: null });
    expect(parseSprayConfig("PARTICLE=SPHERE(2,1)").particle).toEqual({ kind: "sphere", radius: 2, facets: 2, scale: null });
    expect(parseSprayConfig("PARTICLE=TORUS(2)").particle).toEqual({ kind: "sphere", radius: 10, facets: 8, scale: null });
  });

  it("NO_PROJECT moves the near ellipse to the TCP plane (also over a given volume)", () => {
    const c = parseSprayConfig("NO_PROJECT", { rows: 9, cols: 1, data: [1, 2, -200, 5, 0, -200, 0, 10, -200] });
    expect(c.near.slice(0, 9)).toEqual([1, 2, 0, 5, 0, 0, 0, 10, 0]);
  });

  it("volume matrix: column 1 near, column 2 far, rows not given keep the defaults, at most 16 rows", () => {
    const c9 = parseSprayConfig("", VOL_ELLIPSE);
    expect(c9.near.slice(0, 13)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.8]);
    expect(c9.far.slice(0, 13)).toEqual([0, 0, 600, 200, 0, 600, 0, 100, 600, 1, 0, 0, 0.2]);
    const near13 = [0, 0, -200, 5, 0, -200, 0, 10, -200, 1, 0, 0, 1];
    const one = parseSprayConfig("", { rows: 13, cols: 1, data: near13 });
    expect(one.near.slice(0, 13)).toEqual(near13);
    expect(one.far).toEqual(DEFAULT_FAR);
    const big = parseSprayConfig("", { rows: 20, cols: 1, data: Array.from({ length: 20 }, (_, i) => i) });
    expect(big.near).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it("COLOR= sets both ends through QColor (named, #RRGGBB, #AARRGGBB alpha first, invalid = opaque black)", () => {
    expect(parseSprayConfig("COLOR=magenta").near.slice(9, 13)).toEqual([1, 0, 1, 1]);
    const c = parseSprayConfig("COLOR=#ff00a000");
    expect(c.near.slice(9, 13)).toEqual(c.far.slice(9, 13));
    expect(c.near.slice(9, 13)).toEqual([0, Math.fround((0xa0 * 0x101) / 65535), 0, 1]);
    expect(parseQColor("#ffff55bb")).toEqual([1, Math.fround((0x55 * 0x101) / 65535), Math.fround((0xbb * 0x101) / 65535), 1]);
    expect(parseQColor("#80ff0000")).toEqual([1, 0, 0, Math.fround((0x80 * 0x101) / 65535)]);
    expect(parseQColor("White")).toEqual([1, 1, 1, 1]);
    expect(parseQColor("light blue")).toEqual(parseQColor("lightblue"));
    expect(parseQColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseQColor("nonsense")).toEqual([0, 0, 0, 1]);
    expect(parseQColor("#12")).toEqual([0, 0, 0, 1]);
    expect(parseQColor("#f00")).toEqual([1, 0, 0, 1]);
  });

  it("geometry matrix (6 × 3k) gives a mesh particle; a later PARTICLE= replaces it", () => {
    const g = { rows: 6, cols: 3, data: [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1] };
    const c = parseSprayConfig("", null, g);
    expect(c.particle.kind).toBe("mesh");
    expect(parseSprayConfig("PARTICLE=CUBE(1,1,1)", null, g).particle.kind).toBe("cube");
     
    expect(parseSprayConfig("", null, { rows: 3, cols: 3, data: Array(9).fill(0) }).particle.kind).toBe("sphere");
  });
});

describe("where particles land (FUN_10060f144 / FUN_1000f5fa4), probe-geom geometry", () => {
  it("the triangle test is two-sided, bounded to the segment and strict on the edges", () => {
    const t = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const out: [number, number, number] = [0, 0, 0];
    expect(segmentTriangle([2, 2, 5], [2, 2, -5], t, 0, out)).toBe(1);
    expect(out).toEqual([2, 2, 0]);
    expect(segmentTriangle([2, 2, -5], [2, 2, 5], t, 0, out)).toBe(1);  
    expect(segmentTriangle([2, 2, 5], [2, 2, 1], t, 0, out)).toBe(0);  
    expect(segmentTriangle([5, 5, 5], [5, 5, -5], t, 0, out)).toBe(0);  
    expect(segmentTriangle([0, 3, 5], [0, 3, -5], t, 0, out)).toBe(0);  
    expect(segmentTriangle([1, 1, 0], [2, 2, 0], t, 0, out)).toBe(2);  
  });

  it("a segment inside the object's bounding box does not hit; shapes below 0.5 alpha are ignored", () => {
    const box = new Float32Array([
      ...[0, 0, 0, 100, 0, 0, 100, 100, 0],
      ...[0, 0, 0, 100, 100, 0, 0, 100, 0],
      ...[0, 0, 50, 100, 0, 50, 100, 100, 50],
    ]);
    const tgt = buildTarget([{ tri: box, alpha: 1 }]);
    expect(castSegment(tgt, [10, 20, 40], [10, 20, -10])?.point).toEqual([10, 20, 0]);  
    expect(castSegment(tgt, [10, 20, 40], [10, 20, 10])).toBeNull();  
     
    expect(castSegment(tgt, [20, 10, 60], [20, 10, -10])?.d).toBeCloseTo(10, 5);
    expect(castSegment(tgt, [10, 20, 60], [10, 20, -10])?.d).toBeCloseTo(60, 5);
    const hidden = buildTarget([{ tri: box, alpha: 0.4 }]);
    expect(castSegment(hidden, [20, 10, 60], [20, 10, -10])).toBeNull();
  });

  it("STEP=8x4 RAND=0 ellipse over the plate: 40 particles, 31 in / 9 out per update (RoboDK 77.5 % / 22.5 %)", async () => {
    const e = await engine();
    const plate = addMesh(e, "Shape", PLATE);
    const gunObj = addMesh(e, "Shape", GUN, P1);
    const res = addGun(e.ws, e.services.geometry, { tool: gunObj, object: plate, options: "ELLYPSE PROJECT STEP=8x4 RAND=0 PARTICLE=SPHERE(5,8)", volume: VOL_ELLIPSE });
    expect(res.id).toBe(0);
    const rows = probe("geom");
     
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.initial")));
    expect(emitGuns(e.ws, e.services.geometry)).toBe(0);
    setGunState(e.ws, 1, -1);
    expect(emitGuns(e.ws, e.services.geometry)).toBe(1);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.second")));
    const gun = stationGuns(e.ws.activeStation)[0];
     
    const pts = Array.from({ length: gun.particles.count }, (_, i) => gun.particles.get(i));
    expect(pts.length).toBe(31);
    expect(pts.every((p) => Math.abs(p.pos[2]) < 1e-4)).toBe(true);
    expect(pts.some((p) => Math.abs(p.pos[0] - 100) < 1e-3 && Math.abs(p.pos[1]) < 1e-3)).toBe(true);
    expect(pts[0].rgba.map((v) => Math.round(v * 255))).toEqual([128, 0, 128, 128]);
     
    emitGuns(e.ws, e.services.geometry);
    emitGuns(e.ws, e.services.geometry);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.after_conn2")));
    emitGuns(e.ws, e.services.geometry);
    e.ws.items[gunObj].pose = P2;
    emitGuns(e.ws, e.services.geometry);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.after_move")));
     
    setGunState(e.ws, 2, -1);
    emitGuns(e.ws, e.services.geometry);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.state2_a")));
    emitGuns(e.ws, e.services.geometry);
    emitGuns(e.ws, e.services.geometry);
    setGunState(e.ws, 0, -1);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.off_a")));
    expect(emitGuns(e.ws, e.services.geometry)).toBe(0);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.off_b")));
    expect(clearGuns(e.ws.activeStation)).toBe(1);
    expect(gunStats(e.ws).columns).toEqual([]);
    expect(clearGuns(e.ws.activeStation)).toBe(0);
  });

  it("RECTANGLE STEP=2x2 (6 per update, 50 %) and NO_PROJECT STEP=2x1 (4 per update, all out), ids and SetState as RoboDK", async () => {
    const e = await engine();
    const plate = addMesh(e, "Shape", PLATE);
    const gunObj = addMesh(e, "Shape", GUN, P1);
    const rows = probe("multi");
    expect(addGun(e.ws, e.services.geometry, { tool: gunObj, object: plate, options: "RECTANGLE PROJECT STEP=2x2 RAND=0 PARTICLE=CUBE(6,6,6) COLOR=#ff00a000", volume: VOL_RECT }).id).toBe(0);
    expect(addGun(e.ws, e.services.geometry, { tool: gunObj, object: plate, options: "NO_PROJECT STEP=2x1 RAND=0 COLOR=blue" }).id).toBe(1);
    expect(setGunState(e.ws, 1, -1)).toBe(1);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.a")));
    emitGuns(e.ws, e.services.geometry);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.b")));
     
    expect(setGunState(e.ws, 0, 5)).toBe(0);
    emitGuns(e.ws, e.services.geometry);
    expect(stationGuns(e.ws.activeStation).map((g) => g.state)).toEqual([0, 0]);
     
    const [rect, bead] = stationGuns(e.ws.activeStation);
    const mm = (v: number) => Math.round(v) + 0;  
    const hits = Array.from({ length: rect.particles.count }, (_, i) => rect.particles.get(i).pos.map(mm));
    expect(hits.sort()).toEqual([[0, -50, 0], [0, 0, 0], [0, 50, 0]].sort());
    const drops = Array.from({ length: bead.particles.count }, (_, i) => bead.particles.get(i).pos.map(mm));
     
    expect(drops).toEqual([[0, 0, 300], [50, 0, 300], [0, 0, 300], [-50, 0, 300]]);
     
    setGunState(e.ws, 1, 1);
    emitGuns(e.ws, e.services.geometry);
    expect(gunStats(e.ws).columns).toEqual(statsColumns(step(rows, "Gun_Stats.f")).map((c, i) => (i === 0 ? [0, 50, 50, 6] : [1, 0, 100, 8])));
  });

  it("random jitter stays inside the volume and follows RoboDK's draw order", () => {
    const cfg = parseSprayConfig("STEP=4x3 RAND=1 NO_PROJECT", { rows: 9, cols: 1, data: [0, 0, 0, 30, 0, 0, 0, 30, 0] });
    const pts: number[][] = [];
    const rng = makeRng(7);
    let draws = 0;
    const counted = () => {
      draws++;
      return rng();
    };
    emitOnce(cfg, transl(0, 0, 0), null, counted, (p) => pts.push(p));
    expect(pts.length).toBe(16);
     
    expect(draws).toBe(16);
     
    expect(pts.filter((p) => Math.hypot(p[0], p[1]) < 1e-9).length).toBe(4);
    expect(Math.max(...pts.map((p) => Math.hypot(p[0], p[1])))).toBeLessThan(40);
  });
});

describe("automatic tool and object (FUN_1004ad974)", () => {
  it("-1 without a robot; an object can be the tool; a robot's active tool and the station's last object otherwise", async () => {
    const e = await engine();
    const plate = addMesh(e, "Plate", PLATE);
    expect(addGun(e.ws, e.services.geometry, {}).id).toBe(-1);
    expect(addGun(e.ws, e.services.geometry, { tool: plate, object: plate }).id).toBe(0);
    clearGuns(e.ws.activeStation);
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot", kind: "robot" });
    const robot = Object.values(e.ws.items).find((it) => it.type === "robot")!;
    await e.run("robot.addTool", { robot: robot.id, name: "T1", pose: transl(0, 0, 100) });
    const part2 = addMesh(e, "Part2", PLATE);
     
    e.ws.items[robot.id].robot!.activeFrame = null;
    const r = addGun(e.ws, e.services.geometry, { options: "NO_PROJECT" });
    expect(r.id).toBe(0);
    const g = stationGuns(e.ws.activeStation)[0];
    expect(e.ws.items[g.tool].name).toBe("T1");
    expect(g.object).toBe(part2);
     
    const frame = Object.values(e.ws.items).find((it) => it.type === "frame")!;
    e.ws.items[robot.id].robot!.activeFrame = frame.id;
    expect(addGun(e.ws, e.services.geometry, {}).id).toBe(-1);
     
    const tgt = makeItem(e.ws, "target", "Target 1");
    e.ws.items[tgt.id] = { ...tgt, parent: e.ws.activeStation };
    expect(addGun(e.ws, e.services.geometry, { tool: tgt.id, object: plate })).toMatchObject({ id: -1, reason: "Gun_Add: not supported type for Target 1" });
  });
});

describe("statistics and clear (FUN_1004adf40 / FUN_1004a6b28)", () => {
  it("info line and 4 × N columns; Escape cleans the station", async () => {
    const e = await engine();
    expect(gunStats(e.ws)).toEqual({ info: STATS_INFO, columns: [] });
    const plate = addMesh(e, "Plate", PLATE);
    addGun(e.ws, e.services.geometry, { tool: plate, object: plate });
    await e.run("spray.setState", { state: 1 });
    const stats = (await e.run("spray.stats", {})) as unknown as { info: string; columns: number[][] };
    expect(stats.info).toBe("id<br>percent in<br>percent out<br>count");
    expect(stats.columns).toEqual([[0, 0, 0, 0]]);
    const esc = (await e.run("view.escape", {})) as unknown as { step: string };
    expect(esc.step).toBe("station");
    expect(e.events.some((ev) => ev.type === "status" && ev.text === "Cleaned station")).toBe(true);
    expect(stationGuns(e.ws.activeStation)).toEqual([]);
    expect(((await e.run("view.escape", {})) as unknown as { step: string | null }).step).toBe(null);
  });
});

describe("when moving robots emit (station tick FUN_1003fd838 / FUN_1003fda98)", () => {
   
  const samples = Array.from({ length: 301 }, (_, i) => [i]);
  const profile = { d: 300, v: 100, a: 1000 };
  const T = 300 / 100 + 100 / 1000;

  function run(ratio: number, frameMs: number, period = 5) {
    const emitted: number[] = [];
    const ticker = new SprayTicker({ periodMs: () => period, ratio: () => ratio, emit: (j) => emitted.push(j.get("r")![0]) });
    const h = {};
    let now = 1000;
    let sim = 0;
    ticker.start(h, { robot: "r", samples, profile, T }, now);
    while (sim < T) {
      now += frameMs;
      sim = Math.min(T, sim + (frameMs / 1000) * ratio);
      ticker.update(h, now, sim);
    }
    ticker.end(h, now, sim, true);
    return { emitted, ticks: ticker.ticks };
  }

  it("the same emissions whatever the caller's frame rate", () => {
    for (const ratio of [1, 5, 20]) {
      const a = run(ratio, 16);
      const b = run(ratio, 33);
      const c = run(ratio, 4);
      expect(b.emitted).toEqual(a.emitted);
      expect(c.emitted).toEqual(a.emitted);
    }
  });

  it("one emission per tick that reaches a new path point; the last point always emits", () => {
     
    const slow = run(1, 16);
    expect(slow.emitted.length).toBe(300);
    expect(slow.emitted.at(-1)).toBe(300);
    expect(new Set(slow.emitted).size).toBe(slow.emitted.length);
     
    const ticksUpTo = (dt: number) => Math.ceil(T / dt - 1e-9);
    const fast = run(20, 16);
    expect(fast.emitted.length).toBe(ticksUpTo(0.005 * 20));
    expect(fast.emitted.at(-1)).toBe(300);
     
    expect(run(20, 16, 10).emitted.length).toBe(ticksUpTo(0.01 * 20));
  });

  it("samples are reached like segmentJointsAt places the robot (first point as soon as it moves)", () => {
    expect(sampleIndexAt({ samples, profile, t1: T }, 0)).toBe(0);
    expect(sampleIndexAt({ samples, profile, t1: T }, 1e-4)).toBe(1);
    expect(sampleIndexAt({ samples, profile, t1: T }, T)).toBe(300);
  });

  it("a paused simulation does not emit", () => {
    const emitted: number[] = [];
    const ticker = new SprayTicker({ periodMs: () => 5, ratio: () => 1, paused: () => true, emit: () => emitted.push(1) });
    const h = {};
    ticker.start(h, { robot: "r", samples, profile, T }, 0);
    for (let t = 16; t < 500; t += 16) ticker.update(h, t, 0);
    expect(emitted.length).toBe(0);
  });
});
