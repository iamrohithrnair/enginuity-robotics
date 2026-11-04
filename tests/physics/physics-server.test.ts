 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fk } from "@/engine/kinematics";
import { mul, poseDistance, type Mat } from "@/engine/math";
import { physicsRuntime } from "@/engine/physics/runtime";
import type { WorkspacePatch } from "@/engine/types";
import { absPose, toolPose } from "@/engine/workspace";
import type { RdkApiServer } from "@/server/rdkapi/server";
import type { ServerEvent } from "@/server/store";
import { sleep, TestClient } from "../rdkapi/client";

let server: RdkApiServer;
let c: TestClient;
let S: typeof import("@/server/store");

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-physics-"));
  S = await import("@/server/store");
  await S.getServer().ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], log: () => undefined });
  c = await TestClient.connect(server.port);
  expect((await c.handshake())[0]).toBe("RDK_API");
}, 60_000);

afterAll(async () => {
  await S.run("physics.enable", { on: false }, "system");
  c?.close();
  await server?.close();
});

const run = async (name: string, params: Record<string, unknown> = {}) => {
  const r = await S.run(name, params, "system");
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result as Record<string, unknown>;
};
const ws = () => S.getServer().ws;
const rt = () => physicsRuntime(S.getServer().services, ws());
const status = async (id: string) => ((await run("physics.status", { item: id })) as { item: { role: string; text: string; mass?: number } }).item;
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(20);
  return cond();
};
async function freshStation(name: string) {
  await run("station.new", { name });
}
 
async function apiPose(handle: number): Promise<Mat> {
  c.send((w) => w.line("G_Hlocal").handle(handle));
  const p = await c.r.pose();
  expect((await c.status()).code).toBe(0);
  return p;
}

describe("physics on the server", () => {
  it("with physics off nothing moves; on, a part falls in real time through physics patches and the loop stops when all sleep", async () => {
    await freshStation("Off");
    const cyl = (await run("object.addShape", { shape: "cylinder", radius: 60, height: 120, xyzrpw: [0, 0, 600, 0, 0, 0] })).id as string;
    await sleep(300);
    expect(ws().items[cyl].pose[11]).toBe(600);
    const patches: WorkspacePatch[] = [];
    const listen = (e: ServerEvent) => {
      if (e.type === "patch" && (e.patch as WorkspacePatch).physics) patches.push(e.patch as WorkspacePatch);
    };
    S.getServer().listeners.add(listen);
    const t0 = Date.now();
    await run("physics.enable", { on: true });
     
    expect(await until(() => ws().items[cyl].pose[11] < 2, 3000)).toBe(true);
    const fell = (Date.now() - t0) / 1000;
    expect(fell).toBeGreaterThan(0.3);
    expect(fell).toBeLessThan(1.5);
     
    expect(patches.length).toBeGreaterThan(5);
    expect(patches.every((p) => p.upserts.length === 1 && p.upserts[0].id === cyl && p.removes.length === 0)).toBe(true);
     
    expect(await until(() => (rt() as unknown as { timer: unknown }).timer === null, 6000)).toBe(true);
    const n = patches.length;
    await sleep(400);
    expect(patches.length).toBe(n);
    S.getServer().listeners.delete(listen);
     
    expect(S.activeUndo().list().undo.filter((l) => !/^Add/.test(l))).toEqual([]);
  }, 30_000);

  it("a pile-up of 300 parts reaches the views as coalesced patches (each part at most once per patch, 15 per second)", async () => {
    await freshStation("Pile");
    const ids: string[] = [];
     
    for (let i = 0; i < 300; i++) ids.push((await run("object.addShape", { shape: "box", sizeX: 40, sizeY: 40, sizeZ: 40, xyzrpw: [(i % 10) * 60, (Math.floor(i / 10) % 10) * 60, 300 + Math.floor(i / 100) * 60, 0, 0, i * 7] })).id as string);
    const patches: { t: number; p: WorkspacePatch }[] = [];
    const listen = (e: ServerEvent) => {
      if (e.type === "patch" && (e.patch as WorkspacePatch).physics) patches.push({ t: Date.now(), p: e.patch as WorkspacePatch });
    };
    S.getServer().listeners.add(listen);
    await run("physics.enable", { on: true });
    await sleep(1500);
    S.getServer().listeners.delete(listen);
    expect(patches.length).toBeGreaterThan(3);
    for (const { p } of patches) expect(new Set(p.upserts.map((u) => u.id)).size).toBe(p.upserts.length);
     
    const big = patches.filter(({ p }) => p.upserts.length > 200);
    expect(big.length).toBeGreaterThan(0);
    expect(big.length).toBeLessThanOrEqual(Math.ceil((big.at(-1)!.t - big[0].t) / 66) + 2);
    expect(Math.max(...ids.map((id) => ws().items[id].pose[11]))).toBeLessThan(300);
  }, 30_000);

  it("pause freezes physics; the RoboDK API reads the physics pose", async () => {
    await freshStation("Api");
    const box = (await run("object.addShape", { shape: "box", sizeX: 100, sizeY: 100, sizeZ: 100, xyzrpw: [300, 0, 1500, 0, 0, 0] })).id as string;
    await sleep(250);
    expect(rt().world?.recs.has(box)).toBe(true);
    await sleep(150);
    await run("sim.pause", { paused: true });
    const z1 = ws().items[box].pose[11];
    expect(z1).toBeLessThan(1500 - 50);
    await sleep(300);
    expect(ws().items[box].pose[11]).toBe(z1);
     
    const p = await apiPose(ws().items[box].handle);
    const t = rt().world!.recs.get(box)!.body.translation();
    expect(Math.abs(p[11] - t.z * 1000)).toBeLessThan(1e-3);
    expect(Math.abs(p[3] - t.x * 1000)).toBeLessThan(1e-3);
    expect(p).toEqual(ws().items[box].pose.map((v) => expect.closeTo(v, 9)));
    await run("sim.pause", { paused: false });
    expect(await until(() => ws().items[box].pose[11] < 2, 3000)).toBe(true);
    const q = await apiPose(ws().items[box].handle);
    expect(Math.abs(q[11])).toBeLessThan(2);
  }, 30_000);

  it("saving and opening a station keeps the physics settings and the current poses", async () => {
    await freshStation("Saved");
    const part = (await run("object.addShape", { shape: "box", sizeX: 80, sizeY: 80, sizeZ: 80, xyzrpw: [0, 0, 400, 0, 0, 0], name: "Heavy" })).id as string;
    await run("object.setPhysics", { items: [part], body: "dynamic", mass: 2.5, friction: 0.3, restitution: 0.2 });
    expect(ws().items[part].physics).toEqual({ body: "dynamic", mass: 2.5, friction: 0.3, restitution: 0.2 });
    expect(await until(() => ws().items[part].pose[11] < 2, 3000)).toBe(true);
    const pose = ws().items[part].pose.slice();
    const saved = (await run("station.save", { name: "wpt-physics-roundtrip" })).path as string;
    const opened = (await run("station.open", { path: saved })).id as string;
    const copy = Object.values(ws().items).find((it) => it.name === "Heavy" && it.parent === opened)!;
    expect(copy.physics).toEqual({ body: "dynamic", mass: 2.5, friction: 0.3, restitution: 0.2 });
    copy.pose.forEach((v, i) => expect(v).toBeCloseTo(pose[i], 6));
    const st = (await run("physics.status", { item: copy.id })) as { item: { mass: number } };
    expect(st.item.mass).toBeCloseTo(2.5, 3);
  }, 30_000);

  it("a simulated pick-and-place drops its part when the tool releases it", async () => {
    await freshStation("Pick");
    const robot = (await run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })).id as string;
    const tool = (await run("robot.addTool", { robot, name: "Gripper", xyzrpw: [0, 0, 100, 0, 0, 0] })).id as string;
    const A = [0, 0, 0, 0, 30, 0];
    await run("robot.setJoints", { robot, joints: A });
    const r = ws().items[robot];
    const T = mul(mul(absPose(ws(), robot), fk(r.robot!.model, A)), toolPose(ws(), robot));
     
    const stand = (await run("object.addShape", { shape: "box", sizeX: 100, sizeY: 100, sizeZ: T[11] - 60, xyzrpw: [T[3], T[7], 0, 0, 0, 0], name: "Stand" })).id as string;
    const part = (await run("object.addShape", { shape: "box", sizeX: 60, sizeY: 60, sizeZ: 60, xyzrpw: [T[3], T[7], T[11] - 60, 0, 0, 0], name: "Part" })).id as string;
    const prog = (await run("program.add", { robot, name: "PickPlace" })).id as string;
    await run("program.addMoveJ", { program: prog, joints: A, createTarget: false });
    await run("program.addInstruction", { program: prog, kind: "event", eventAction: "attach", tool });
    await run("program.addMoveJ", { program: prog, joints: [60, 0, 0, 0, 30, 0], createTarget: false });
    await run("program.addInstruction", { program: prog, kind: "event", eventAction: "detach", tool });
    await run("program.addMoveJ", { program: prog, joints: [60, -25, 0, 0, 30, 0], createTarget: false });
    await run("physics.enable", { on: true });
    expect((await status(stand)).role).toBe("static");
    expect((await status(part)).text).toBe("Auto: Dynamic (rests on Stand)");
    await run("sim.setSpeed", { factor: 10 });
    await run("program.run", { program: prog });
     
    expect(await until(() => ws().items[part].parent === tool, 5000)).toBe(true);
    expect((await status(part)).role).toBe("kinematic");
     
    expect(await until(() => ws().items[part].parent !== tool, 10000)).toBe(true);
    expect(await until(() => absPose(ws(), part)[11] < 2, 5000)).toBe(true);
    const p = absPose(ws(), part);
    const want = mul(mul(absPose(ws(), robot), fk(r.robot!.model, [60, 0, 0, 0, 30, 0])), toolPose(ws(), robot));
    expect(Math.hypot(p[3] - want[3], p[7] - want[7])).toBeLessThan(60);
    await until(() => !ws().running, 10000);
    await run("sim.setSpeed", { factor: 5 });
  }, 40_000);

  





  async function pushCell(name: string, o: { paddle: number; part: [number, number, number]; at: number; speed?: number }) {
    await freshStation(name);
    const robot = (await run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })).id as string;
    const tool = (await run("robot.addTool", { robot, name: "Holder", xyzrpw: [0, 0, 0, 0, 0, 0] })).id as string;
    const A = [-30, 30, 30, 0, 30, 0];
    await run("robot.setJoints", { robot, joints: A });
     
    const F = mul(absPose(ws(), robot), fk(ws().items[robot].robot!.model, A));
    const radius = Math.hypot(F[3], F[7]);
    const paddle = (await run("object.addShape", { shape: "box", sizeX: 160, sizeY: o.paddle, sizeZ: F[11] - 20, xyzrpw: [F[3], F[7], 15, 0, 0, -30], name: "Paddle" })).id as string;
    await run("item.setParent", { item: paddle, parent: tool, keepAbsolute: true });
    const a = (o.at * Math.PI) / 180;
    const [sx, sy, sz] = o.part;
    const part = (await run("object.addShape", { shape: "box", sizeX: sx, sizeY: sy, sizeZ: sz, xyzrpw: [radius * Math.cos(a), radius * Math.sin(a), 0, 0, 0, o.at], name: "Part" })).id as string;
    const prog = (await run("program.add", { robot, name: "Push" })).id as string;
    if (o.speed) await run("program.addInstruction", { program: prog, kind: "speed", joint: o.speed, jointAccel: 4000 });
    for (const j1 of [-30, 60, 40]) await run("program.addMoveJ", { program: prog, joints: [j1, 30, 30, 0, 30, 0], createTarget: false });
    await run("physics.enable", { on: true });
    expect((await status(paddle)).text).toBe("Kinematic (attached to Holder)");
    expect((await status(part)).role).toBe("dynamic");
    return { prog, part, radius };
  }

   
  async function runPush(prog: string, ratio: number) {
    const clock0 = rt().clock;
    await run("sim.setSpeed", { factor: ratio });
    await run("program.run", { program: prog });
    await sleep(50);
    expect(await until(() => !ws().running && !(ws().busy?.length ?? 0), 60_000)).toBe(true);
    const simulated = rt().clock - clock0;
    await run("physics.settle", { maxSeconds: 5 });
    await run("sim.setSpeed", { factor: 5 });
    return simulated;
  }

  const angle = (p: Mat) => (Math.atan2(p[7], p[3]) * 180) / Math.PI;

  it("a robot push settles the same at simulation speed ratios 1, 8 and 100 (programs run on the physics clock)", async () => {
    const runs = [];
    for (const ratio of [1, 8, 100]) {
      const { prog, part, radius } = await pushCell(`Push ×${ratio}`, { paddle: 20, part: [80, 80, 80], at: 20 });
       
      await run("physics.settle", { maxSeconds: 5 });
      const before = absPose(ws(), part);
      const simulated = await runPush(prog, ratio);
      runs.push({ ratio, before, after: absPose(ws(), part), simulated, radius });
    }
    const report = runs.map((x) => `×${x.ratio}: ${angle(x.after).toFixed(3)}° r ${Math.hypot(x.after[3], x.after[7]).toFixed(2)} z ${x.after[11].toFixed(2)} (${x.simulated.toFixed(3)} s simulated)`).join("; ");
    for (const { before, after, simulated, radius } of runs) {
       
      expect(angle(before)).toBeCloseTo(20, 1);
      expect(angle(after), report).toBeGreaterThan(60);
      expect(angle(after), report).toBeLessThan(80);
      expect(Math.abs(Math.hypot(after[3], after[7]) - radius), report).toBeLessThan(60);
      expect(Math.abs(after[11]), report).toBeLessThan(2);
       
       
      expect(simulated, report).toBeGreaterThan(2.2);
    }
     
    for (const { ratio, after } of runs.slice(1)) {
      const d = poseDistance(runs[0].after, after);
      expect(d.mm, `ratio ${ratio} vs 1: ${d.mm.toFixed(3)} mm; ${report}`).toBeLessThan(1);
      expect(d.deg, `ratio ${ratio} vs 1: ${d.deg.toFixed(3)}°; ${report}`).toBeLessThan(0.5);
    }
  }, 120_000);

  it("a fast thin tool pushes a thin resting part instead of passing through it", async () => {
     
    const { prog, part } = await pushCell("Thin", { paddle: 4, part: [80, 8, 50], at: 0, speed: 400 });
    await run("physics.settle", { maxSeconds: 5 });
    expect(rt().world!.recs.get(part)!.body.isSleeping()).toBe(true);
    const p0 = absPose(ws(), part);
    await runPush(prog, 5);
    const p1 = absPose(ws(), part);
     
    expect(angle(p1)).toBeGreaterThan(30);
    expect(Math.hypot(p1[3] - p0[3], p1[7] - p0[7])).toBeGreaterThan(150);
  }, 60_000);

  it("copies of the physics module (Next.js loads one per route) share the server's one runtime", async () => {
    await run("physics.enable", { on: true });
    const live = rt();
    vi.resetModules();
    const copy = await import("@/engine/physics/runtime");
    expect(copy.physicsRuntime).not.toBe(physicsRuntime);
     
    expect(copy.activePhysics(S.getServer().services, ws())).toBe(live);
    expect(copy.physicsRuntime(S.getServer().services, ws())).toBe(live);
    expect(live.disposed).toBe(false);
    expect(live.enabled).toBe(true);
    await run("physics.enable", { on: false });
  });
});
