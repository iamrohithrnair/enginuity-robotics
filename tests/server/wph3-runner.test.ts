// Verifies robotless program calls, blocked moves, motion settings, and simulation timing.
 
 
 
 
 
 
 
 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fk } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import { absPose, toolPose } from "@/engine/workspace";
import { findLibraryFile, hasLibraryFile } from "../library";

 
const describeAbb = describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"));

type Srv = ReturnType<typeof import("@/server/store").getServer>;
type Ev = { type: string; text?: unknown };
let srv: Srv;
let run: typeof import("@/server/store").run;

async function ok(name: string, params: Record<string, unknown> = {}) {
  const r = await run(name, params, "system");
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result as Record<string, unknown>;
}

const busy = (id: string) => (srv.ws.busy ?? []).includes(id);
async function until(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return cond();
}

 
async function runToEnd(id: string) {
  const name = srv.ws.items[id].name;
  const evs: Ev[] = [];
  const fn = (e: Ev) => void evs.push(e);
  srv.listeners.add(fn);
  try {
    const res = await ok("program.run", { program: id });
    const finished = await until(() => evs.some((e) => e.type === "status" && String(e.text).startsWith(`Program ${name} finished`)));
    await until(() => !busy(id));
    return { res, evs, finished, done: evs.filter((e) => e.type === "status").map((e) => String(e.text)).find((t) => t.startsWith(`Program ${name} finished`)) };
  } finally {
    srv.listeners.delete(fn);
  }
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-wph3-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  srv.services.library = {
    ...srv.services.library!,
     
    load: async (file: string, kind?: string) => {
      const { readFileSync } = await import("node:fs");
      const p = findLibraryFile(file, kind);
      if (!p) throw new Error(`${file} is not in the offline library mirror`);
      return { bytes: new Uint8Array(readFileSync(p)), url: `file://${file}` };
    },
  };
}, 60_000);

 
async function cell() {
  await ok("station.new", {});
  const nr = (await ok("program.add", { name: "NR" })).id as string;
  const nrm = (await ok("program.add", { name: "NRMove" })).id as string;
  await ok("library.load", { file: "ABB-IRB-120-3-0-6.robot", kind: "robot" });
  const robot = Object.values(srv.ws.items).find((it) => it.type === "robot")!.id;
  await ok("robot.setJoints", { robot, joints: [0, 0, 0, 0, 30, 0] });
  const t1 = (await ok("target.add", { name: "T1", robot, joints: [30, 0, 0, 0, 30, 0], isJoint: true })).id as string;
  const sub = (await ok("program.add", { name: "Sub", robot })).id as string;
  await ok("program.addMoveJ", { program: sub, target: t1 });
  await ok("program.addInstruction", { program: nr, kind: "call", text: "Sub" });
  await ok("program.addMoveJ", { program: nrm, target: t1 });
  await ok("sim.setSpeed", { factor: 1000 });
  return { nr, nrm, sub, robot, t1 };
}

describeAbb("programs without a robot in a simulation", () => {
  it("run their calls: the called program's robot moves; RunProg answers -1", async () => {
    const { nr, robot } = await cell();
    expect(srv.ws.items[nr].program?.robot ?? null).toBeNull();
    const { res, finished } = await runToEnd(nr);
    expect(res.instructions).toBe(-1);
    expect(finished).toBe(true);
    expect(srv.ws.items[robot].robot!.joints.map((v) => Math.round(v * 1e4) / 1e4 + 0)).toEqual([30, 0, 0, 0, 30, 0]);
  });

  it("stay busy on a move without a message until stopped; the robot does not move", async () => {
    const { nrm, robot } = await cell();
    const evs: Ev[] = [];
    const fn = (e: Ev) => void evs.push(e);
    srv.listeners.add(fn);
    try {
      await ok("program.run", { program: nrm });
      await new Promise((r) => setTimeout(r, 400));
      expect(busy(nrm)).toBe(true);
      expect(srv.ws.items[robot].robot!.joints).toEqual([0, 0, 0, 0, 30, 0]);
      await ok("sim.stop", {});
      expect(await until(() => !busy(nrm))).toBe(true);
    } finally {
      srv.listeners.delete(fn);
    }
    expect(evs.filter((e) => e.type === "dialog")).toEqual([]);
  });
});

describeAbb("move times of a simulated run", () => {
  it("Set Speed and Set Rounding of the program time its moves; Update() keeps the robot's state", async () => {
    const { robot } = await cell();
    const rd = srv.ws.items[robot].robot!;
    const q0 = [20, 0, 0, 0, 30, 0];
    const tcp = mul(mul(absPose(srv.ws, robot), fk(rd.model, q0)), toolPose(srv.ws, robot));
    const a = (await ok("target.add", { name: "A", robot, joints: q0, isJoint: true })).id as string;
    const prog = (await ok("program.add", { name: "Square", robot })).id as string;
    await ok("program.addInstruction", { program: prog, kind: "rounding", rounding: 1 });
    await ok("program.addInstruction", { program: prog, kind: "speed", linear: 100 });
    await ok("program.addMoveJ", { program: prog, target: a });
     
    for (const [i, [dx, dy]] of [
      [50, 0],
      [50, 50],
      [0, 50],
      [0, 0],
    ].entries()) {
      const pose = tcp.slice();
      pose[3] += dx;
      pose[7] += dy;
      const t = (await ok("target.add", { name: `S${i}`, robot, pose })).id as string;
      await ok("program.addMoveL", { program: prog, target: t });
    }
     
    const upd = (await ok("program.update", { program: prog })) as unknown as number[];
    expect(upd[1]).toBeCloseTo(2 * Math.sqrt(20 / 150) + 4 * 2 * Math.sqrt(50 / 1500), 6);
     
    const { done } = await runToEnd(prog);
    expect(done).toMatch(/^Program Square finished \(path length: [\d.]+ mm, program time: 2\.1s\)$/);
     
    expect((await ok("robot.motionState", { robot })) as unknown).toMatchObject({ stored: { linear: 100, rounding: 1 }, constantSpeed: true });
  });
});
