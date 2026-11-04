 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eye, mul, transl, type Mat } from "@/engine/math";
import { stationParams } from "@/engine/stationParams";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { TestClient } from "./client";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

 
const ABB = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");
const HAS_ABB = hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot");
const describeRobot = describe.skipIf(!HAS_ABB);

let server: RdkApiServer;
let c: TestClient;
let robot = 0;

type Ev = { type: string; [k: string]: unknown };

async function events() {
  const { getServer } = await import("@/server/store");
  return getServer();
}

 
async function nextEvent(type: string, act: () => Promise<void>, ms = 20_000): Promise<Ev> {
  const srv = await events();
  let done: (e: Ev) => void = () => undefined;
  const got = new Promise<Ev>((resolve, reject) => {
    done = resolve;
    setTimeout(() => reject(new Error(`no ${type} event`)), ms);
  });
  const fn = (e: Ev) => {
    if (e.type === type) done(e);
  };
  srv.listeners.add(fn);
  try {
    await act();
    return await got;
  } finally {
    srv.listeners.delete(fn);
  }
}

async function ok() {
  const st = await c.status();
  expect(st).toEqual({ code: 0 });
}

async function icmd(h: number, name: string, value = ""): Promise<string> {
  c.send((w) => w.line("ICMD").handle(h).line(name).line(value));
  const res = await c.r.line();
  await ok();
  return res;
}

async function setJoints(q: number[]) {
  c.send((w) => w.line("S_Thetas").array(q).handle(robot));
  await ok();
}

async function joints(): Promise<number[]> {
  c.send((w) => w.line("G_Thetas").handle(robot));
  const q = await c.r.array();
  await ok();
  return q;
}

async function robotPose(): Promise<Mat> {
  c.send((w) => w.line("G_Hlocal").handle(robot));
  const p = await c.r.pose();
  await ok();
  return p;
}

const near = (a: number[], b: number[], tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

 
function cube(h: number): { rows: number; cols: number; data: number[] } {
  const v = (x: number, y: number, z: number) => [x * h, y * h, z * h];
  const quads = [
    [v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1)],
    [v(-1, -1, 1), v(-1, 1, 1), v(1, 1, 1), v(1, -1, 1)],
    [v(-1, -1, -1), v(-1, -1, 1), v(1, -1, 1), v(1, -1, -1)],
    [v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1)],
    [v(-1, -1, -1), v(-1, 1, -1), v(-1, 1, 1), v(-1, -1, 1)],
    [v(1, -1, -1), v(1, -1, 1), v(1, 1, 1), v(1, 1, -1)],
  ];
  const data: number[] = [];
  for (const [a, b, cc, d] of quads) data.push(...a, ...b, ...cc, ...a, ...cc, ...d);
  return { rows: 3, cols: data.length / 3, data };
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-wpe-"));
  const srv = await events();
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  c = await TestClient.connect(server.port);
  await c.handshake();
  await c.itemCmd("NewStation", (w) => w.line("WPE"));
  if (!HAS_ABB) return;
  const r = await c.itemCmd("Add", (w) => w.line(ABB).handle(0));
  expect(r.type).toBe(2);
  robot = r.handle;
}, 60_000);

afterAll(async () => {
  c?.close();
  await server?.close();
});

 
afterEach(async (ctx) => {
  if (ctx.task.result?.state !== "fail") return;
  c.close();
  c = await TestClient.connect(server.port);
  await c.handshake();
});

describeRobot("robot list kinematics (G_LFK, G_LIK, G_LIK_jnts, G_LIK_cmpl, G_LThetas_Config)", () => {
  const q = [10, -20, 30, 40, 50, 60];

  it("G_LFK answers the flange pose and 1 per valid entry, identity and -1 for an invalid robot", async () => {
    c.send((w) => w.line("G_FK").array(q).handle(robot));
    const fk = await c.r.pose();
    await ok();
    c.send((w) => w.line("G_LFK").int(2).array(q).handle(robot).array(q).handle(0));
    const p1 = await c.r.pose();
    expect(await c.r.int()).toBe(1);
    const p2 = await c.r.pose();
    expect(await c.r.int()).toBe(-1);
    await ok();
    expect(near(p1, fk)).toBe(true);
    expect(p2).toEqual(eye());
  });

  it("G_LIK / G_LIK_jnts solve each pose (empty for an invalid robot), G_LThetas_Config gives 4 flags", async () => {
    c.send((w) => w.line("G_FK").array(q).handle(robot));
    const fk = await c.r.pose();
    await ok();
    c.send((w) => w.line("G_LIK_jnts").int(2).pose(fk).array(q).handle(robot).pose(fk).array(q).handle(0));
    const s1 = await c.r.array();
    const s2 = await c.r.array();
    await ok();
    expect(near(s1, q, 1e-4)).toBe(true);
    expect(s2).toEqual([]);
    c.send((w) => w.line("G_LIK").int(1).pose(mul(transl(0, 0, 5000), fk)).handle(robot));
    expect(await c.r.array()).toEqual([]);
    await ok();
    c.send((w) => w.line("G_LThetas_Config").int(2).array(q).handle(robot).array(q).handle(0));
    expect((await c.r.array()).length).toBe(4);
    expect(await c.r.array()).toEqual([]);
    await ok();
  });

  it("G_LIK_cmpl uses the first robot for handle 0 and returns a matrix per entry", async () => {
    c.send((w) => w.line("G_FK").array(q).handle(robot));
    const fk = await c.r.pose();
    await ok();
    c.send((w) => w.line("G_LIK_cmpl").int(1).pose(fk).handle(0));
    const rows = await c.r.int();
    const cols = await c.r.int();
    const data: number[] = [];
    for (let i = 0; i < rows * cols; i++) data.push((await c.r.doubles(1))[0]);
    await ok();
    expect(rows).toBe(8);
    expect(cols).toBeGreaterThan(0);
    const has = Array.from({ length: cols }, (_, k) => data.slice(k * rows, k * rows + 6)).some((s) => near(s, q, 1e-4));
    expect(has).toBe(true);
  });
});

describeRobot("accuracy filters (FilterTarget, FilterListTarget)", () => {
  it("returns the nominal pose and the joints near the approximation; unreachable → status 10", async () => {
    const q0 = [0, 10, 20, 0, 30, 0];
    await setJoints(q0);
    const pose = await robotPose();
    c.send((w) => w.line("FilterTarget").pose(pose).array(q0).handle(robot));
    const pf = await c.r.pose();
    const qf = await c.r.array();
    await ok();
    expect(near(pf, pose)).toBe(true);
    expect(near(qf, q0, 1e-4)).toBe(true);
    c.send((w) => w.line("FilterTarget").pose(mul(transl(0, 0, 5000), pose)).array(q0).handle(robot));
    expect(await c.r.pose()).toEqual(eye());
    expect(await c.r.array()).toEqual([]);
    expect(await c.status()).toEqual({ code: 10, msg: "Target can not be reached" });
  });

  it("FilterListTarget answers n, then 1 + pose + joints per entry; the first unreachable one ends the reply", async () => {
    const q0 = [0, 10, 20, 0, 30, 0];
    await setJoints(q0);
    const pose = await robotPose();
    c.send((w) => w.line("FilterListTarget").handle(robot).int(1).int(2).pose(pose).array(q0).pose(pose).array(q0));
    expect(await c.r.int()).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(await c.r.int()).toBe(1);
      expect(near(await c.r.pose(), pose)).toBe(true);
      expect(near(await c.r.array(), q0, 1e-4)).toBe(true);
    }
    await ok();
    c.send((w) => w.line("FilterListTarget").handle(robot).int(0).int(2).pose(pose).pose(mul(transl(0, 0, 5000), pose)));
    expect(await c.r.int()).toBe(2);
    expect(await c.r.int()).toBe(1);
    await c.r.pose();
    await c.r.array();
    expect(await c.r.int()).toBe(-2);
    expect(await c.status()).toEqual({ code: 10, msg: "Target can not be reached. Index: 1" });
  });
});

describeRobot("robot file introspection (R-KIN-33)", () => {
  it("reads header values and the getters RoboDK answers for the ABB IRB 120", async () => {
    expect(await icmd(robot, "RobotValue", "0")).toBe("1");
    expect(await icmd(robot, "RobotValue", "1")).toBe("4000");
    expect(await icmd(robot, "RobotValue", "2")).toBe("20");
    expect(await icmd(robot, "RobotValue", "3")).toBe("200");
    expect(await icmd(robot, "RobotValue", "16000")).toBe("Invalid");
    expect(await icmd(robot, "MechType")).toBe("1");
    expect(await icmd(robot, "TypeAxes")).toBe("['R','R','R','R','R','R']");
    expect(await icmd(robot, "NativeName")).toBe("ABB IRB 120-3/0.6");
    expect(await icmd(robot, "IsCalibrated")).toBe("0");
    expect(await icmd(robot, "IsAccuracyActive")).toBe("0");
  });

  it("setters write the header cells observed with savediff (Reach c5.r1, joints c35, speed c6)", async () => {
    expect(await icmd(robot, "Reach", "777")).toBe("OK");
    expect(await icmd(robot, "Reach")).toBe("777");
    expect(await icmd(robot, "RobotValue", String(5 * 20 + 1))).toBe("777");
    expect(await icmd(robot, "Payload", "4.5")).toBe("OK");
    expect(await icmd(robot, "RobotValue", String(5 * 20 + 0))).toBe("4.5");
    await setJoints([10, 20, 30, 40, 50, 60]);
    expect(await icmd(robot, "RobotValue", String(35 * 20 + 2))).toBe("30");
    c.send((w) => w.line("S_Speed4").handle(robot).array([123, 45, 678, 90]));
    await ok();
    const speed: string[] = [];
    for (const r of [0, 1, 3, 4]) speed.push(await icmd(robot, "RobotValue", String(6 * 20 + r)));
    expect(speed).toEqual(["123", "678", "45", "90"]);
    expect(await icmd(robot, "PulsesXdeg", "1,2,3,4,5,6")).toBe("OK");
    expect(await icmd(robot, "RobotValue", String(49 * 20 + 5))).toBe("6");
    expect(await icmd(robot, "MasteringJoints")).toMatch(/^-?\d+\.\d{8}(,-?\d+\.\d{8}){5}$/);
  });

  it("setParamRobotTool writes the tool mass, centre of gravity and gravity (S_ParamCalibTool)", async () => {
    c.send((w) => w.line("S_ParamCalibTool").handle(robot).array([7.5, 1, 2, 3, 0, 0, -9.81]));
    await ok();
    expect(await icmd(robot, "RobotValue", String(151 * 20 + 5))).toBe("7.5");
    expect(await icmd(robot, "RobotValue", String(153 * 20 + 2))).toBe("3");
    expect(await icmd(robot, "RobotValue", String(154 * 20 + 2))).toBe("-9.81");
  });
});

describeRobot("S_Visible visible_frame (robolink setVisible)", () => {
  async function params(h: number, keys: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const k of keys) out.push(await icmd(h, k));
    return out;
  }

  it("maps visible_frame onto the Show* display parameters", async () => {
    c.send((w) => w.line("S_Visible").handle(robot).int(1).int(-2));
    await ok();
    expect(await params(robot, ["ShowFrame", "ShowFlange", "ShowToolFrame"])).toEqual(["0", "0", "0"]);
    c.send((w) => w.line("S_Visible").handle(robot).int(1).int(-3));
    await ok();
    expect(await params(robot, ["ShowFrame", "ShowFlange", "ShowToolFrame"])).toEqual(["1", "1", "1"]);
     
    c.send((w) => w.line("S_Visible").handle(robot).int(1).int(0b110));
    await ok();
    expect(await params(robot, ["ShowFrame", "ShowLinks"])).toEqual(["0", "6"]);
    const f = await c.itemCmd("Add_FRAME", (w) => w.line("VisFrame").handle(0));
    const shape = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(1).matrix(3, 3, [0, 0, 0, 1, 0, 0, 0, 1, 0]).array([]));
    c.send((w) => w.line("S_Visible").handle(shape.handle).int(0).int(-3));
    await ok();
    expect(await params(shape.handle, ["ShowFrame"])).toEqual(["1"]);
    c.send((w) => w.line("G_Visible").handle(shape.handle));
    expect(await c.r.int()).toBe(0);
    await ok();
    expect(f.status).toBe(0);
  });
});

describe("geometry commands", () => {
  async function meshes(h: number): Promise<{ color: number[]; points: number[][] }[]> {
    c.send((w) => w.line("G_Gen_Mat").handle(h).line("Meshes").matrix(0, 0, []));
    const n = await c.r.int();
    const out: { color: number[]; points: number[][] }[] = [];
    for (let i = 0; i < n / 2; i++) {
      const cr = await c.r.matrix();
      const m = await c.r.matrix();
      const points = Array.from({ length: m.cols }, (_, k) => m.data.slice(k * m.rows, k * m.rows + 3));
      out.push({ color: cr.data, points });
    }
    await ok();
    return out;
  }

  it("AddShape4 creates a 'Shape' object with one mesh per shape and colour", async () => {
    const box = cube(50);
    const sh = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(2).matrix(box.rows, box.cols, box.data).array([1, 0, 0, 1]).matrix(box.rows, box.cols, box.data).array([]));
    expect(sh).toMatchObject({ type: 5, status: 0 });
    c.send((w) => w.line("G_Name").handle(sh.handle));
    expect(await c.r.line()).toBe("Shape");
    await ok();
    const m = await meshes(sh.handle);
    expect(m.length).toBe(2);
    expect(m[0].color).toEqual([1, 0, 0, 1]);
    expect(m[0].points.length).toBe(36);
  });

  it("AddShape5 reads float32 data and adds to an existing object; override replaces its shapes", async () => {
    const first = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(1).matrix(3, 3, [0, 0, 0, 10, 0, 0, 0, 10, 0]).array([0, 1, 0, 1]));
    const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const floatShape = () => {
      const b = Buffer.alloc(8 + tri.length * 4 + 4 + 16);
      let o = b.writeInt32BE(3, 0);
      o = b.writeInt32BE(3, o);
      for (const v of tri) o = b.writeFloatBE(v, o);
      o = b.writeInt32BE(4, o);
      for (const v of [0, 0, 1, 1]) o = b.writeFloatBE(v, o);
      return b;
    };
    const send = (override: number) => {
      const head = Buffer.alloc(8 + 4 + 4);
      head.writeBigUInt64BE(BigInt(first.handle), 0);
      head.writeInt32BE(override, 8);
      head.writeInt32BE(1, 12);
      c.sock.write(Buffer.concat([Buffer.from("AddShape5\n"), head, floatShape()]));
    };
    send(0);
    expect(await c.item()).toEqual({ handle: first.handle, type: 5 });
    await ok();
    expect((await meshes(first.handle)).map((m) => m.color)).toEqual([
      [0, 1, 0, 1],
      [0, 0, 1, 1],
    ]);
    send(1);
    expect(await c.item()).toEqual({ handle: first.handle, type: 5 });
    await ok();
    const m = await meshes(first.handle);
    expect(m.length).toBe(1);
    expect(m[0].points).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("IsInside: 1 inside a closed mesh, 0 outside, -1 with status 1 for an invalid item", async () => {
    const box = cube(100);
    const sh = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(1).matrix(box.rows, box.cols, box.data).array([]));
    const small = cube(10);
    const inner = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(1).matrix(small.rows, small.cols, small.data).array([]));
    c.send((w) => w.line("IsInside").handle(inner.handle).handle(sh.handle));
    expect(await c.r.int()).toBe(1);
    await ok();
    c.send((w) => w.line("S_Hlocal").handle(inner.handle).pose(transl(500, 0, 0)));
    await ok();
    c.send((w) => w.line("IsInside").handle(inner.handle).handle(sh.handle));
    expect(await c.r.int()).toBe(0);
    await ok();
    c.send((w) => w.line("IsInside").handle(0).handle(sh.handle));
    expect(await c.r.int()).toBe(-1);
    expect(await c.status()).toEqual({ code: 1 });
  });

  it("Scale multiplies the geometry; MergeItems keeps the first item and deletes the others", async () => {
    const box = cube(10);
    const a = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(1).matrix(box.rows, box.cols, box.data).array([]));
    const b = await c.itemCmd("AddShape4", (w) => w.handle(0).int(0).int(1).matrix(box.rows, box.cols, box.data).array([]));
    c.send((w) => w.line("Scale").handle(a.handle).array([2, 2, 2]));
    await ok();
    const xs = (await meshes(a.handle))[0].points.map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(20, 5);
    const merged = await c.itemCmd("MergeItems", (w) => w.int(2).handle(a.handle).handle(b.handle));
    expect(merged).toMatchObject({ handle: a.handle, type: 5, status: 0 });
    expect((await meshes(a.handle)).length).toBe(2);
    c.send((w) => w.line("G_Name").handle(b.handle));
    await c.r.line();
    expect((await c.status()).code).toBe(1);
  });

  it("G_Gen_Mat answers unknown names with status 2 and no matrices", async () => {
    c.send((w) => w.line("G_Gen_Mat").handle(0).line("NoSuchThing").matrix(0, 0, []));
    expect(await c.r.int()).toBe(0);
    expect(await c.status()).toEqual({ code: 2, msg: "Unknown generic parameter NoSuchThing" });
  });
});

describeRobot("ghost sequences and user picks", () => {
  it("Show_SeqPoses with ROBOT_JOINTS and Show_Seq send the ghost configurations to the views", async () => {
    const q1 = [0, 0, 0, 0, 0, 0];
    const q2 = [10, 0, 0, 0, 30, 0];
    const e = await nextEvent("show-sequence", async () => {
      c.send((w) => w.line("Show_SeqPoses").handle(robot).array([2048 | 2, 5000]).int(2).array(q1).array(q2));
      await ok();
    });
    expect(e).toMatchObject({ robot: expect.any(String), joints: [q1, q2], timeoutMs: 5000 });
    const e2 = await nextEvent("show-sequence", async () => {
      c.send((w) => w.line("Show_Seq").matrix(6, 2, [...q2, ...q1]).handle(robot));
      await ok();
    });
    expect(e2.joints).toEqual([q2, q1]);
  });

  it("PickItemList returns the item the user picked, Cancel returns an invalid item", async () => {
    const srv = await events();
    const before = srv.services.ask;
    const asked: string[][] = [];
    let answer = "";
    srv.services.ask = async (_html, buttons) => {
      asked.push(buttons);
      return answer;
    };
    try {
      const f1 = await c.itemCmd("Add_FRAME", (w) => w.line("PickA").handle(0));
      const f2 = await c.itemCmd("Add_FRAME", (w) => w.line("PickB").handle(0));
      answer = "PickB";
      const picked = await c.itemCmd("PickItemList", (w) => w.line("Select a frame").int(2).handle(f1.handle).handle(f2.handle));
      expect(picked).toEqual({ handle: f2.handle, type: 3, status: 0 });
      expect(asked[0]).toEqual(["PickA", "PickB", "Cancel"]);
      answer = "Cancel";
      const none = await c.itemCmd("PickItem", (w) => w.line("Select a frame").int(3));
      expect(none).toEqual({ handle: 0, type: -1, status: 0 });
    } finally {
      srv.services.ask = before;
    }
  });
});

describeRobot("run modes (S_RunMode, ProgramStart)", () => {
  it("ProgramStart outside the generation modes answers 0 and creates nothing", async () => {
    c.send((w) => w.line("G_RunMode"));
    expect(await c.r.int()).toBe(1);
    await ok();
    c.send((w) => w.line("ProgramStart").line("NotMade").line("").line("").handle(0).handle(robot));
    expect(await c.r.int()).toBe(0);
    await ok();
    const it2 = await c.itemCmd("G_Item", (w) => w.line("NotMade"));
    expect(it2.handle).toBe(0);
  });

  it("RUNMODE_QUICKVALIDATE: moves are validated and the robot jumps without animation", async () => {
    c.send((w) => w.line("S_RunMode").int(2));
    await ok();
    await setJoints([0, 0, 0, 0, 30, 0]);
    c.send((w) => w.line("MoveX").int(1).int(1).array([20, 0, 0, 0, 30, 0]).handle(0).handle(robot));
    await ok();
    expect(near(await joints(), [20, 0, 0, 0, 30, 0], 1e-6)).toBe(true);
    c.send((w) => w.line("MoveX").int(1).int(1).array([0, 0, 0, 0, 0, 999]).handle(0).handle(robot));
    expect((await c.status()).code).toBe(10);
    c.send((w) => w.line("S_RunMode").int(1));
    await ok();
  });

  it("RUNMODE_MAKE_ROBOTPROG records the robot commands and generates the program when the mode ends", async () => {
    c.send((w) => w.line("S_RunMode").int(3));
    await ok();
    c.send((w) => w.line("ProgramStart").line("GenProg").line("").line("").handle(0).handle(robot));
    expect(await c.r.int()).toBe(0);
    await ok();
    await setJoints([0, 0, 0, 0, 30, 0]);
    c.send((w) => w.line("MoveX").int(1).int(1).array([10, 0, 0, 0, 30, 0]).handle(0).handle(robot));
    await ok();
    const p = await robotPose();
    const down = mul(transl(0, 0, -20), p);
    const col: number[] = [];
    for (let k = 0; k < 4; k++) for (let r = 0; r < 4; r++) col.push(down[r * 4 + k]);
    c.send((w) => w.line("MoveX").int(2).int(2).array(col).handle(0).handle(robot));
    await ok();
    c.send((w) => w.line("setDO").handle(robot).line("DO_1").line("1"));
    await ok();
    const gen = await nextEvent("program-generated", async () => {
      c.send((w) => w.line("S_RunMode").int(1));
      await ok();
    });
    expect(gen.program).toBe("GenProg");
    const files = gen.files as { name: string; content: string }[];
    expect(files.length).toBeGreaterThan(0);
    const text = files.map((f) => f.content).join("\n");
    expect(text).toContain("GenProg");
    expect(text).toMatch(/MoveL/);
    expect(text).toMatch(/DO_1/);
     
    const gone = await c.itemCmd("G_Item", (w) => w.line("GenProg"));
    expect(gone.handle).toBe(0);
  });

  it("a Python program's pending run mode applies to its new connections (FUN_100347218)", async () => {
    const { setPendingRunMode } = await import("@/server/rdkapi/runmode");
    setPendingRunMode(2, null, "PyProg");
    const c2 = await TestClient.connect(server.port);
    try {
      await c2.handshake();
      c2.send((w) => w.line("G_RunMode"));
      expect(await c2.r.int()).toBe(2);
      expect(await c2.status()).toEqual({ code: 0 });
    } finally {
      c2.close();
      setPendingRunMode(1, null, "");
    }
  });
});

describeRobot("simulation runner", () => {
  it("a blocking custom instruction waits for its script; a forced Set Tool pose becomes the robot's TCP", async () => {
    const { DATA_DIR, getServer, run } = await import("@/server/store");
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { toolPose } = await import("@/engine/workspace");
    const { xyzrpwToPose } = await import("@/engine/math");
    const srv = getServer();
    const pyDir = path.join(DATA_DIR, "python");
    mkdirSync(pyDir, { recursive: true });
    const flag = path.join(pyDir, "wpe_done.txt");
    writeFileSync(path.join(pyDir, "wpe_custom.py"), `import time\ntime.sleep(0.4)\nopen(${JSON.stringify(flag)}, "w").write("ok")\n`);
    const val = async (name: string, params: Record<string, unknown>) => {
      const r = await run(name, params, "ui");
      if (!r.ok) throw new Error(r.error);
      return r.result as { id: string };
    };
    const robotId = Object.values(srv.ws.items).find((it) => it.handle === robot)!.id;
    const tool = await val("robot.addTool", { robot: robotId, name: "RunT", xyzrpw: [0, 0, 50, 0, 0, 0] });
    const prog = await val("program.add", { name: "RunCustom", robot: robotId });
    const setTool = await val("program.addInstruction", { program: prog.id, kind: "tool", tool: tool.id });
    await val("instruction.forceOriginalPose", { instruction: setTool.id, force: true });
    await val("item.setPose", { item: tool.id, xyzrpw: [0, 0, 80, 0, 0, 0] });
    await val("program.addInstruction", { program: prog.id, kind: "custom", name: "Glue", path: "wpe_custom.py", blocking: true });
    await val("program.addInstruction", { program: prog.id, kind: "io", ioMode: "set", ioName: "WPE_AFTER", ioValue: "1" });
    const t0 = Date.now();
    await val("program.run", { program: prog.id });
    const busy = () => (srv.ws.busy ?? []).includes(prog.id);
    for (let i = 0; i < 100 && !busy(); i++) await new Promise((r) => setTimeout(r, 10));
    while (busy() && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(flag)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
    expect(Object.entries(stationParams(srv.ws)).some(([k, v]) => k.includes("WPE_AFTER") && v === "1")).toBe(true);
    expect(near(toolPose(srv.ws, robotId), xyzrpwToPose([0, 0, 50, 0, 0, 0]))).toBe(true);
  }, 30_000);
});
