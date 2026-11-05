// Exercises simulation timing, I/O waits, program calls, and motion settings through the app.
 
 
import { expect, test, type APIRequestContext } from "@playwright/test";

type WS = {
  busy?: string[];
  running: unknown;
  activeStation: string | null;
  items: Record<string, { name: string; robot?: { joints: number[]; speeds: { linear: number } }; stationParams?: [string, string][] }>;
};

async function command(request: APIRequestContext, name: string, params: Record<string, unknown> = {}) {
  const r = await request.post("/api/command", { data: { name, params } });
  const j = await r.json();
  if (!j.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
}
const ws = async (request: APIRequestContext) => ((await (await request.get("/api/state")).json()) as { ws: WS }).ws;
const idle = async (request: APIRequestContext) => ((await ws(request)).busy ?? []).length === 0;
 
const stationParam = async (request: APIRequestContext, name: string) => {
  const w = await ws(request);
  return (w.activeStation ? w.items[w.activeStation]?.stationParams ?? [] : []).find(([k]) => k === name)?.[1];
};

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
  await command(request, "station.setParam", { key: "Popups", value: "1" });
});

async function abbWithTool(request: APIRequestContext) {
  const r = await command(request, "library.load", { file: "ABB-IRB-120-3-0-6.robot" });
  await command(request, "robot.addTool", { robot: r.id, name: "T1", xyzrpw: [0, 0, 100, 0, 0, 0] });
  await command(request, "robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 30, 0] });
  return r;
}

test("R-PROG-37: a 500 ms pause at ratio 10 takes about 50 ms of real time", async ({ request }) => {
  const p = await command(request, "program.add", { name: "P" });
  await command(request, "program.addInstruction", { program: p.id, kind: "pause", pauseMs: 500 });
  await command(request, "sim.setSpeed", { factor: 10 });
  const t0 = Date.now();
  await command(request, "program.run", { program: p.id });
  await expect.poll(() => idle(request), { intervals: [10] }).toBe(true);
  const dt = Date.now() - t0;
  expect(dt).toBeGreaterThanOrEqual(45);
  expect(dt).toBeLessThan(600);
});

test("R-PROG-39: Wait DI blocks until the station parameter is set; Set DO writes IO_n", async ({ request }) => {
  const p = await command(request, "program.add", { name: "IO" });
  await command(request, "program.addInstruction", { program: p.id, kind: "io", ioMode: "set", ioName: "9", ioValue: 1 });
  await command(request, "program.addInstruction", { program: p.id, kind: "io", ioMode: "wait", ioName: "10", ioValue: 1 });
  await command(request, "program.run", { program: p.id });
  await expect.poll(() => stationParam(request, "IO_9")).toBe("1");
  await new Promise((r) => setTimeout(r, 300));
  expect(await idle(request)).toBe(false);
  await command(request, "station.setParam", { key: "IO_10", value: "1" });
  await expect.poll(() => idle(request)).toBe(true);
});

test("R-PROG-35: Call runs the sub-program synchronously; a missing program is skipped", async ({ request }) => {
  const r = await abbWithTool(request);
  const sub = await command(request, "program.add", { name: "Sub", robot: r.id });
  await command(request, "program.addMoveJ", { program: sub.id, joints: [45, 0, 0, 0, 30, 0], createTarget: false });
  const main = await command(request, "program.add", { name: "Main", robot: r.id });
  await command(request, "program.addInstruction", { program: main.id, kind: "io", ioName: "a", ioValue: 0 });
  await command(request, "program.addInstruction", { program: main.id, kind: "call", text: "Sub" });
  await command(request, "program.addInstruction", { program: main.id, kind: "call", text: "Missing" });
  await command(request, "program.addInstruction", { program: main.id, kind: "io", ioName: "a", ioValue: 1 });
  await command(request, "program.run", { program: main.id });
  await expect.poll(async () => (await ws(request)).busy?.includes(sub.id)).toBe(true);
  expect(await stationParam(request, "a")).toBe("0");
  await expect.poll(() => idle(request), { timeout: 10_000 }).toBe(true);
  const s = await ws(request);
  expect(await stationParam(request, "a")).toBe("1");
  expect(s.items[r.id].robot!.joints.map((v) => Math.round(v))).toEqual([45, 0, 0, 0, 30, 0]);
});

test("R-PROG-17/23: running a Set Speed instruction changes the robot state used by later estimates (probe2 T5)", async ({ request }) => {
  const r = await abbWithTool(request);
  const frame = await command(request, "item.addFrame", { name: "F1" });
  await command(request, "robot.setActiveFrame", { robot: r.id, frame: frame.id });
  const t1 = await command(request, "target.teach", { robot: r.id, parent: frame.id });
  await command(request, "robot.jogCartesian", { robot: r.id, axis: "y", delta: 100 });
  const t2 = await command(request, "target.teach", { robot: r.id, parent: frame.id });
  await command(request, "robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 30, 0] });
   
  await command(request, "edit.select", { items: [] });
  const est = await command(request, "program.add", { name: "Est", robot: r.id });
  await command(request, "program.addMoveL", { program: est.id, target: t2.id });
  const before = (await command(request, "program.update", { program: est.id })) as number[];
  expect(before[1]).toBeCloseTo(0.5164, 3);
  const run = await command(request, "program.add", { name: "RunSpeed", robot: r.id });
  await command(request, "program.addInstruction", { program: run.id, kind: "speed", linear: 50, linearAccel: 400 });
  await command(request, "program.addMoveL", { program: run.id, target: t2.id });
  await command(request, "sim.setSpeed", { factor: 50 });
  await command(request, "program.run", { program: run.id });
  await expect.poll(() => idle(request), { timeout: 10_000 }).toBe(true);
  await command(request, "robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 30, 0] });
  void t1;
  const after = (await command(request, "program.update", { program: est.id })) as number[];
  expect(after[1]).toBeCloseTo(2.125, 3);
});

test("R-PROG-41: Stop leaves the robot where it is", async ({ request }) => {
  const r = await abbWithTool(request);
  const p = await command(request, "program.add", { name: "Long", robot: r.id });
  await command(request, "program.addMoveJ", { program: p.id, joints: [150, 0, 0, 0, 30, 0], createTarget: false });
  await command(request, "sim.setSpeed", { factor: 1 });
  await command(request, "program.run", { program: p.id });
  await new Promise((res) => setTimeout(res, 700));
  await command(request, "sim.stop");
  await expect.poll(() => idle(request)).toBe(true);
  const j1 = (await ws(request)).items[r.id].robot!.joints[0];
  expect(j1).toBeGreaterThan(5);
  expect(j1).toBeLessThan(149);
  await new Promise((res) => setTimeout(res, 400));
  expect((await ws(request)).items[r.id].robot!.joints[0]).toBeCloseTo(j1, 6);
});

test("R-PROG-43: a looping program restarts until stopped", async ({ request }) => {
  const p = await command(request, "program.add", { name: "Loop" });
  await command(request, "program.addInstruction", { program: p.id, kind: "pause", pauseMs: 50 });
  await command(request, "program.setLoop", { program: p.id, loop: true });
  await command(request, "program.run", { program: p.id });
  await new Promise((res) => setTimeout(res, 600));
  expect(await idle(request)).toBe(false);
  await command(request, "sim.stop");
  await expect.poll(() => idle(request)).toBe(true);
});
