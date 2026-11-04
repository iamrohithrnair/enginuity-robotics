 
 
 
import { describe, expect, it } from "vitest";
import { fk, linkFrames } from "@/engine/kinematics";
import { mul, poseDistance, type Mat } from "@/engine/math";
import { physicsRuntime } from "@/engine/physics/runtime";
import { absPose, toolPose } from "@/engine/workspace";
import { engine } from "../helpers";

type E = Awaited<ReturnType<typeof engine>>;
type Id = { id: string };
const G = 9810;  
const FRAME = 1 / 60;

const shape = async (e: E, shape: "box" | "cylinder" | "sphere", dims: Record<string, number>, xyzrpw: number[], name?: string) =>
  ((await e.run("object.addShape", { shape, ...dims, xyzrpw, ...(name ? { name } : {}) })) as unknown as Id).id;
const box = (e: E, sx: number, sy: number, sz: number, x: number, y: number, z: number, name?: string) => shape(e, "box", { sizeX: sx, sizeY: sy, sizeZ: sz }, [x, y, z, 0, 0, 0], name);
const z = (e: E, id: string) => absPose(e.ws, id)[11];
const report = async (e: E, id: string) => ((await e.run("physics.status", { item: id })) as unknown as { item: { role: string; text: string; reason: string; sleeping?: boolean } }).item;
const body = (e: E, id: string) => physicsRuntime(e.services, e.ws).world!.recs.get(id)!;
 
function lowest(m: Mat, min: number[], max: number[]) {
  let lo = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    lo = Math.min(lo, m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]);
  }
  return lo;
}

 
async function table(e: E, x = 0, y = 0) {
  const top = await box(e, 1000, 800, 40, x, y, 710, "Table");
  const legs = [];
  for (const [dx, dy] of [[-440, -340], [440, -340], [-440, 340], [440, 340]]) legs.push(await box(e, 60, 60, 710, x + dx, y + dy, 0));
  await e.run("object.merge", { items: [top, ...legs] });
  return top;
}

describe("physics: falling, resting, stacking", () => {
  it("drops a cylinder from 1000 mm: touches at √(2h/g) ≈ 0.4515 s and rests at half height", async () => {
    const e = await engine();
    const cyl = await shape(e, "cylinder", { radius: 120, height: 250 }, [0, 0, 1000, 0, 0, 0]);
    await e.run("physics.enable", { on: true });
    expect((await report(e, cyl)).text).toBe("Auto: Dynamic (floating)");
    const zs = [z(e, cyl)];
    for (let i = 0; i < 40; i++) {
      await e.run("physics.step", { seconds: FRAME });
      zs.push(z(e, cyl));
    }
     
    for (const k of [6, 12, 18, 24]) {
      const t = k * FRAME;
      expect(Math.abs(zs[k] - (1000 - 0.5 * G * t * t))).toBeLessThan(G * (FRAME / 2) * t * 0.6 + 1);
    }
     
    const k = zs.findIndex((v) => v <= 2);
    expect(k).toBeGreaterThan(0);
    expect(Math.abs(k * FRAME - Math.sqrt(2000 / G))).toBeLessThanOrEqual(FRAME + 1e-6);
    await e.run("physics.settle", { maxSeconds: 5 });
     
    expect(Math.abs(z(e, cyl) + 125 - 125)).toBeLessThanOrEqual(2);
    expect(e.ws.items[cyl].pose[10]).toBeGreaterThan(0.9999);
  });

  it("tilted parts fall freely across many short steps (their own poses are never taken for user moves)", async () => {
    const e = await engine();
    const tilts = [
      [30, 20, 25],
      [0, 0, 25],
      [12, -40, 77],
      [-65, 10, -130],
      [5, 5, 5],
      [90, 45, 10],
      [-20, 70, 160],
      [33, -12, -48],
    ];
    const ids: string[] = [];
    for (const [i, [rx, ry, rz]] of tilts.entries()) ids.push(await shape(e, "box", { sizeX: 150, sizeY: 100, sizeZ: 80 }, [i * 400, 0, 1500, rx, ry, rz]));
    await e.run("physics.enable", { on: true });
    const z0 = ids.map((id) => z(e, id));
    for (let i = 0; i < 18; i++) await e.run("physics.step", { seconds: FRAME });
    const t = 18 * FRAME;
    ids.forEach((id, k) => expect(Math.abs(z0[k] - z(e, id) - 0.5 * G * t * t)).toBeLessThan(G * (FRAME / 2) * t * 0.6 + 1));
    for (const id of ids) expect((await report(e, id)).text).toBe("Auto: Dynamic (floating)");
  });

  it("a box released above a table rests on the table top and the table stays put", async () => {
    const e = await engine();
    const t = await table(e);
    const b = await box(e, 200, 200, 200, 100, 50, 1050, "Box");
    const t0 = absPose(e.ws, t);
    await e.run("physics.enable", { on: true });
    expect((await report(e, b)).text).toBe("Auto: Dynamic (floating)");
    const s = (await e.run("physics.settle", { maxSeconds: 5 })) as unknown as { settled: boolean };
    expect(s.settled).toBe(true);
    expect(Math.abs(z(e, b) - 750)).toBeLessThanOrEqual(2);
     
    expect(poseDistance(absPose(e.ws, t), t0).mm).toBeLessThan(2);
  });

  it("a stack of boxes is stable, and boxes dropped onto each other stack up", async () => {
    const e = await engine();
    const exact = [];
    for (let i = 0; i < 4; i++) exact.push(await box(e, 300, 300, 200, 0, 0, i * 200, `S${i}`));
    const dropped = [];
    for (let i = 0; i < 4; i++) dropped.push(await box(e, 300, 300, 200, 1000, 0, i * 260 + 40, `D${i}`));
    await e.run("physics.enable", { on: true });
     
    expect((await report(e, exact[2])).text).toBe("Auto: Dynamic (rests on S1)");
    expect((await report(e, dropped[1])).text).toBe("Auto: Dynamic (floating)");
    const s = (await e.run("physics.settle", { maxSeconds: 8 })) as unknown as { settled: boolean };
    expect(s.settled).toBe(true);
    await e.run("physics.step", { seconds: 2 });
    for (const id of exact) expect((await report(e, id)).sleeping).toBe(true);
    exact.forEach((id, i) => {
      const p = absPose(e.ws, id);
      expect(Math.abs(p[11] - i * 200)).toBeLessThan(1);
      expect(Math.hypot(p[3], p[7])).toBeLessThan(0.5);
    });
    dropped.forEach((id, i) => {
      const p = absPose(e.ws, id);
      expect(Math.abs(p[11] - i * 200)).toBeLessThanOrEqual(2);
      expect(Math.hypot(p[3] - 1000, p[7])).toBeLessThan(20);
      expect(p[10]).toBeGreaterThan(0.999);
    });
  });

  it("with physics off nothing moves, and switching it off stops the motion", async () => {
    const e = await engine();
    const cyl = await shape(e, "cylinder", { radius: 50, height: 100 }, [0, 0, 800, 0, 0, 0]);
    const p0 = e.ws.items[cyl].pose.slice();
    expect(e.services.settings.RC_PHYSICS).toBe(false);
    const r = await e.tryRun("physics.step", { seconds: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Physics is off/);
    expect(e.ws.items[cyl].pose).toEqual(p0);
    await e.run("physics.enable", { on: true });
    await e.run("physics.step", { seconds: 0.2 });
    const p1 = e.ws.items[cyl].pose.slice();
    expect(p1[11]).toBeLessThan(800 - 100);
    await e.run("physics.enable", { on: false });
    expect(e.services.settings.RC_PHYSICS).toBe(false);
    expect((await e.tryRun("physics.step", { seconds: 1 })).ok).toBe(false);
    expect(e.ws.items[cyl].pose).toEqual(p1);
  });
});

describe("physics: robots, tools, grab and release", () => {
  async function cell() {
    const e = await engine();
    const robot = ((await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id).id;
    const tool = ((await e.run("robot.addTool", { robot, name: "Gripper", xyzrpw: [0, 0, 100, 0, 0, 0] })) as unknown as Id).id;
    await e.run("robot.setJoints", { robot, joints: [0, 0, 0, 0, 30, 0] });
    return { e, robot, tool };
  }
  const tcp = (e: E, robot: string) => {
    const r = e.ws.items[robot];
    return mul(mul(absPose(e.ws, robot), fk(r.robot!.model, r.robot!.joints)), toolPose(e.ws, robot));
  };

  it("an attached object follows the tool exactly without gravity; detached, it falls", async () => {
    const { e, robot, tool } = await cell();
    const T = tcp(e, robot);
    const part = await box(e, 60, 60, 60, T[3], T[7], T[11] - 60, "Part");
    await e.run("item.setParent", { item: part, parent: tool, keepAbsolute: true });
    await e.run("physics.enable", { on: true });
    expect((await report(e, part)).role).toBe("kinematic");
    const local = e.ws.items[part].pose.slice();
    const before = absPose(e.ws, part);
    await e.run("physics.step", { seconds: 1 });
    expect(poseDistance(absPose(e.ws, part), before).mm).toBeLessThan(1e-6);
     
    for (let j = 1; j <= 30; j++) {
      await e.run("robot.setJoints", { robot, joints: [j, 0, 0, 0, 30, j] });
      await e.run("physics.step", { seconds: FRAME });
      const want = absPose(e.ws, part);
      const b = body(e, part).body;
      const t = b.translation();
      expect(Math.hypot(t.x * 1000 - want[3], t.y * 1000 - want[7], t.z * 1000 - want[11])).toBeLessThan(0.01);
    }
    expect(e.ws.items[part].pose).toEqual(local);
     
     
    const st = e.ws.activeStation!;
    const at = absPose(e.ws, part);
    await e.run("item.setParent", { item: part, parent: st, keepAbsolute: true });
    expect(poseDistance(absPose(e.ws, part), at).mm).toBeLessThan(1e-6);
    await e.run("physics.step", { seconds: FRAME });
    expect((await report(e, part)).role).toBe("dynamic");
    const next = absPose(e.ws, part);
    const sideways = Math.hypot(next[3] - at[3], next[7] - at[7]) / FRAME / 1000;
    expect(sideways).toBeGreaterThan(0.3);
    expect(sideways).toBeLessThan(0.7);
    expect(next[11]).toBeLessThan(at[11]);
    await e.run("physics.settle", { maxSeconds: 5 });
     
    expect(Math.abs(lowest(absPose(e.ws, part), [-30, -30, 0], [30, 30, 60]))).toBeLessThan(2);
  });

  it("a robot link sweeping through a box pushes it", async () => {
    const { e, robot } = await cell();
    await e.run("physics.configure", { gravity: 0 });
     
    const r = e.ws.items[robot];
    const wrist = mul(absPose(e.ws, robot), linkFrames(r.robot!.model, r.robot!.joints)[5]);
    const b = await box(e, 120, 120, 120, wrist[3], wrist[7], wrist[11] - 60, "Box");
    await e.run("robot.setJoints", { robot, joints: [-50, 0, 0, 0, 30, 0] });
    await e.run("physics.enable", { on: true });
    expect((await report(e, b)).role).toBe("dynamic");
    const p0 = absPose(e.ws, b);
    for (let j = -50; j <= 50; j += 1) {
      await e.run("robot.setJoints", { robot, joints: [j, 0, 0, 0, 30, 0] });
      await e.run("physics.step", { seconds: FRAME });
    }
    const p1 = absPose(e.ws, b);
     
    expect(p1[7] - p0[7]).toBeGreaterThan(50);
    expect(Math.hypot(p1[3] - p0[3], p1[7] - p0[7])).toBeGreaterThan(50);
  });
});

describe("physics: the Auto rule", () => {
  it("fixtures stay Static with their reason; resting parts sleep; floating parts fall", async () => {
    const e = await engine();
    const t = await table(e);
    const p1 = await box(e, 100, 100, 100, -200, 0, 750, "P1");
    const p2 = await shape(e, "cylinder", { radius: 40, height: 120 }, [200, 100, 750, 0, 0, 0], "P2");
    const wall = await box(e, 3000, 100, 2000, 0, 1500, 0, "Wall");
    const loose = await box(e, 100, 100, 100, 1500, 0, 400, "Loose");
    const robot = ((await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id).id;
    const base = e.ws.items[robot].parent!;
    const pedestal = await box(e, 400, 400, 500, -1500, 0, 0, "Pedestal");
    await e.run("item.setPose", { item: base, xyzrpw: [-1500, 0, 500, 0, 0, 0], relativeTo: "station" });
    await e.run("physics.enable", { on: true });
    expect((await report(e, t)).text).toBe("Auto: Static (supports 2 parts)");
    expect((await report(e, p1)).text).toBe("Auto: Dynamic (rests on Table)");
    expect((await report(e, p2)).text).toBe("Auto: Dynamic (rests on Table)");
    expect((await report(e, wall)).text).toBe("Auto: Static (large: 3.0 m)");
    expect((await report(e, loose)).text).toBe("Auto: Dynamic (floating)");
    expect((await report(e, pedestal)).text).toMatch(/^Auto: Static \(carries ABB IRB 120-3\/0\.6 link 0\)$/);
    const fixtures = Object.fromEntries([t, wall, pedestal].map((id) => [id, absPose(e.ws, id)]));
    const parts = Object.fromEntries([p1, p2].map((id) => [id, absPose(e.ws, id)]));
    await e.run("physics.settle", { maxSeconds: 5 });
    for (const [id, p] of Object.entries(fixtures)) expect(poseDistance(absPose(e.ws, id), p).mm).toBe(0);
     
    for (const [id, p] of Object.entries(parts)) {
      expect(poseDistance(absPose(e.ws, id), p).mm).toBeLessThan(1);
      expect((await report(e, id)).sleeping).toBe(true);
    }
    expect(Math.abs(z(e, loose))).toBeLessThan(2);
  });

  it("a bin with parts inside stays Static; an object hung on a wall is mounted", async () => {
    const e = await engine();
     
    const fl = await box(e, 600, 400, 20, 0, 0, 0, "Bin");
    const walls = [await box(e, 600, 20, 200, 0, -190, 20), await box(e, 600, 20, 200, 0, 190, 20), await box(e, 20, 360, 200, -290, 0, 20), await box(e, 20, 360, 200, 290, 0, 20)];
    await e.run("object.merge", { items: [fl, ...walls] });
    const part = await box(e, 80, 80, 80, 0, 0, 20, "Part");
    const wall = await box(e, 2500, 100, 1500, 0, 1000, 0, "Wall");
    const sign = await box(e, 300, 20, 200, 0, 940, 1000, "Sign");
    await e.run("physics.enable", { on: true });
    expect((await report(e, fl)).role).toBe("static");
    expect((await report(e, part)).text).toBe("Auto: Dynamic (rests on Bin)");
    expect((await report(e, sign)).text).toBe("Auto: Static (mounted on Wall)");
    void wall;
  });

  it("an empty bin carrying an object set Static is a fixture; a merged bin keeps its open shape when dynamic", async () => {
    const e = await engine();
    const bin = await box(e, 360, 360, 16, 0, 0, 0, "Bin");
    const walls = [await box(e, 360, 16, 344, 0, -172, 16), await box(e, 360, 16, 344, 0, 172, 16), await box(e, 16, 328, 344, -172, 0, 16), await box(e, 16, 328, 344, 172, 0, 16)];
    await e.run("object.merge", { items: [bin, ...walls] });
    const chute = await box(e, 120, 300, 6, 0, -330, 361, "Chute");
    await e.run("object.setPhysics", { items: [chute], body: "static" });
    const bin2 = await box(e, 360, 360, 16, 1500, 0, 0, "Bin 2");
    const walls2 = [await box(e, 360, 16, 344, 1500, -172, 16), await box(e, 360, 16, 344, 1500, 172, 16), await box(e, 16, 328, 344, 1328, 0, 16), await box(e, 16, 328, 344, 1672, 0, 16)];
    await e.run("object.merge", { items: [bin2, ...walls2] });
    const drop = await box(e, 60, 60, 60, 1500, 0, 600, "Drop");
    await e.run("physics.enable", { on: true });
    expect((await report(e, bin)).text).toBe("Auto: Static (supports Chute)");
    expect((await report(e, bin2)).text).toBe("Auto: Dynamic (rests on the floor)");
     
    await e.run("physics.settle", { maxSeconds: 5 });
    expect(Math.abs(z(e, drop) - 16)).toBeLessThan(2);
  });

  it("an object initially penetrating a table produces no velocity spike", async () => {
    const e = await engine();
    const t = await table(e);
    const deep = await box(e, 200, 200, 200, 0, 0, 730, "Deep");
     
    const a = await box(e, 150, 150, 150, 2000, 0, 500, "A");
    const b = await box(e, 150, 150, 150, 2100, 0, 520, "B");
    await e.run("physics.enable", { on: true });
    expect((await report(e, deep)).text).toBe("Auto: Static (penetrates Table)");
    expect((await report(e, t)).role).toBe("static");
    const d0 = absPose(e.ws, deep);
    let peak = 0;
    let last = [absPose(e.ws, a), absPose(e.ws, b)];
    for (let i = 0; i < 90; i++) {
      await e.run("physics.step", { seconds: FRAME });
      const now = [absPose(e.ws, a), absPose(e.ws, b)];
      for (let k = 0; k < 2; k++) peak = Math.max(peak, poseDistance(now[k], last[k]).mm / FRAME / 1000);
      last = now;
    }
    expect(poseDistance(absPose(e.ws, deep), d0).mm).toBe(0);
     
    expect(peak).toBeLessThan(Math.sqrt(2 * 9.81 * 0.52) + 0.5);
  });
});

describe("physics: objects under objects", () => {
  it("an object placed under a falling object in the tree follows it (kinematic), keeping its relative pose", async () => {
    const e = await engine();
    const crate = await box(e, 200, 200, 150, 0, 0, 800, "Crate");
    const lid = await box(e, 200, 200, 10, 0, 0, 950, "Lid");
    await e.run("item.setParent", { item: lid, parent: crate, keepAbsolute: true });
    const rel = e.ws.items[lid].pose.slice();
    await e.run("physics.enable", { on: true });
    expect((await report(e, crate)).role).toBe("dynamic");
    expect((await report(e, lid)).text).toBe("Kinematic (follows Crate)");
    await e.run("physics.settle", { maxSeconds: 5 });
    expect(Math.abs(z(e, crate))).toBeLessThan(2);
    expect(e.ws.items[lid].pose).toEqual(rel);
    expect(Math.abs(z(e, lid) - 150)).toBeLessThan(2);
  });
});

describe("physics: overlapping copies", () => {
  it("copies placed on one another ignore each other until apart (no explosion), including the first body built", async () => {
    const e = await engine();
     
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await box(e, 80, 80, 20, 0, 0, 60, "part"));
    await box(e, 2500, 600, 100, 0, 0, -100, "Conveyor");
    await e.run("physics.enable", { on: true });
    await e.run("physics.step", { seconds: 2 });
     
    for (const id of ids) {
      const p = absPose(e.ws, id);
      expect(Math.hypot(p[3], p[7])).toBeLessThan(1);
      expect(Math.abs(p[11])).toBeLessThan(1);
    }
     
    await e.run("item.setPose", { item: ids[0], xyzrpw: [400, 0, 0, 0, 0, 0] });
    await e.run("physics.step", { seconds: 0.5 });
    const st = physicsRuntime(e.services, e.ws).world!;
    expect([...st.ignored.values()].some(([a, b]) => a === ids[0] || b === ids[0])).toBe(false);
    expect([...st.ignored.values()].length).toBe((11 * 10) / 2);
  });
});

describe("physics: undo, reset, determinism", () => {
  it("records no undo step; undo of a user move wakes the body", async () => {
    const e = await engine();
    const c = await shape(e, "cylinder", { radius: 60, height: 120 }, [0, 0, 600, 0, 0, 0]);
    await e.run("physics.enable", { on: true });
    const n0 = e.undo.list().undo.length;
    await e.run("physics.settle", { maxSeconds: 5 });
    await e.run("physics.step", { seconds: 1 });
    expect(e.undo.list().undo.length).toBe(n0);
    expect(Math.abs(z(e, c))).toBeLessThan(2);
     
    await e.run("item.setPose", { item: c, xyzrpw: [0, 0, 400, 0, 0, 0] });
    expect(e.undo.list().undo.length).toBe(n0 + 1);
    await e.run("physics.settle", { maxSeconds: 5 });
    expect(Math.abs(z(e, c))).toBeLessThan(2);
    expect(e.undo.list().undo.length).toBe(n0 + 1);
     
    await e.run("edit.undo", {});
    expect(e.undo.list().undo.length).toBe(n0);
    await e.run("physics.step", { seconds: 0.5 });
    expect(Math.abs(z(e, c))).toBeLessThan(2);
  });

  it("physics.reset puts back what physics moved", async () => {
    const e = await engine();
    const c = await shape(e, "cylinder", { radius: 60, height: 120 }, [100, 200, 900, 0, 0, 0]);
    const p0 = e.ws.items[c].pose.slice();
    await e.run("physics.enable", { on: true });
    await e.run("physics.settle", { maxSeconds: 5 });
    expect(z(e, c)).toBeLessThan(2);
    const r = (await e.run("physics.reset", {})) as unknown as { restored: string[] };
    expect(r.restored).toEqual(["Cylinder"]);
    expect(e.ws.items[c].pose).toEqual(p0);
    expect((await report(e, c)).text).toBe("Auto: Dynamic (floating)");
  });

  it("two identical runs give identical poses", async () => {
    const run = async () => {
      const e = await engine();
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) ids.push(await box(e, 150, 120, 100, (i % 3) * 60, Math.floor(i / 3) * 40, 300 + i * 130));
      ids.push(await shape(e, "cylinder", { radius: 50, height: 160 }, [40, 30, 1300, 20, 10, 0]));
      ids.push(await shape(e, "sphere", { radius: 60 }, [-30, 10, 1600, 0, 0, 0]));
      await e.run("physics.enable", { on: true });
      await e.run("physics.step", { seconds: 3 });
      return ids.map((id) => e.ws.items[id].pose);
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
     
    expect(a[7][11]).toBeLessThan(1600);
  });
});

describe("physics: shapes", () => {
  it("parts with polygonal bases land upright (hulls rest on their whole face)", async () => {
    const e = await engine();
     
    const n = 8;
    const tri: number[] = [];
    const p = (i: number, zz: number) => [100 * Math.cos((i / n) * 2 * Math.PI), 100 * Math.sin((i / n) * 2 * Math.PI), zz];
    for (let i = 1; i + 1 < n; i++) tri.push(...p(0, 0), ...p(i + 1, 0), ...p(i, 0), ...p(0, 300), ...p(i, 300), ...p(i + 1, 300));
    for (let i = 0; i < n; i++) tri.push(...p(i, 0), ...p(i + 1, 0), ...p(i + 1, 300), ...p(i, 0), ...p(i + 1, 300), ...p(i, 300));
    const buf = Buffer.alloc(84 + (tri.length / 9) * 50);
    buf.writeUInt32LE(tri.length / 9, 80);
    for (let t = 0; t < tri.length / 9; t++) for (let k = 0; k < 9; k++) buf.writeFloatLE(tri[t * 9 + k], 84 + t * 50 + 12 + k * 4);
    const id = ((await e.run("object.import", { fileName: "octa.stl", base64: buf.toString("base64") })) as unknown as Id).id;
    await e.run("item.setPose", { item: id, xyzrpw: [0, 0, 500, 0, 0, 0] });
    await e.run("physics.enable", { on: true });
    await e.run("physics.settle", { maxSeconds: 6 });
    const m: Mat = e.ws.items[id].pose;
    expect(m[10]).toBeGreaterThan(0.999);
    expect(Math.abs(m[11])).toBeLessThan(2);
  });
});
