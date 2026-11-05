// Verifies API handshakes, item operations, station state, and protocol error responses.
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { mul, rotz, transl } from "@/engine/math";
import { sleep, TestClient } from "./client";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

 
const ABB = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");
const itRobot = it.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"));

let server: RdkApiServer;
let c: TestClient;

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-api-"));
  const { getServer } = await import("@/server/store");
  await getServer().ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  c = await TestClient.connect(server.port);
}, 60_000);

afterAll(async () => {
  c?.close();
  await server?.close();
});

describe("RoboDK API server", () => {
  it("answers the RDK_API handshake like RoboDK (R-POSTGEN-2)", async () => {
    expect(await c.handshake()).toEqual(["RDK_API", 1, 26935, 0]);
  });

  it("creates a station and lists it (NewStation, G_List_Items)", async () => {
    const st = await c.itemCmd("NewStation", (w) => w.line("ProbeStation"));
    expect(st.type).toBe(1);
    expect(st.status).toBe(0);
    c.send((w) => w.line("G_List_Items"));
    const n = await c.r.int();
    const names = [];
    for (let i = 0; i < n; i++) names.push(await c.r.line());
    expect((await c.status()).code).toBe(0);
    expect(names).toEqual(["ProbeStation"]);
  });

  it("looks items up by name: empty name → station, missing → null item with status 0", async () => {
    const st = await c.itemCmd("G_Item", (w) => w.line(""));
    expect(st.type).toBe(1);
    const missing = await c.itemCmd("G_Item", (w) => w.line("nope"));
    expect(missing).toEqual({ handle: 0, type: -1, status: 0 });
  });

  let frame = 0;
  it("adds a frame, sets and reads its pose column-major (Add_FRAME, S_Hlocal, G_Hlocal)", async () => {
    const f = await c.itemCmd("Add_FRAME", (w) => w.line("ProbeFrame").handle(0));
    expect(f.type).toBe(3);
    frame = f.handle;
    const pose = mul(transl(100, 200, 300), rotz(Math.PI / 2));
    c.send((w) => w.line("S_Hlocal").handle(frame).pose(pose));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_Hlocal").handle(frame));
    const got = await c.r.pose();
    expect((await c.status()).code).toBe(0);
    got.forEach((v, i) => expect(v).toBeCloseTo(pose[i], 9));
  });

  it("answers invalid handles with placeholders and status 1 (R-POSTGEN-11)", async () => {
    c.send((w) => w.line("G_Name").handle(0x1234560));
    expect(await c.r.line()).toBe("(unavailable)");
    expect((await c.status()).code).toBe(1);
    c.send((w) => w.line("G_Item_Type").handle(0x1234560));
    expect(await c.r.int()).toBe(-1);
    expect((await c.status()).code).toBe(0);
  });

  let robot = 0;
  itRobot("loads a robot file from disk and clamps joints like RoboDK (Add, S_Thetas 9999 → 400)", async () => {
    const r = await c.itemCmd("Add", (w) => w.line(ABB).handle(0));
    expect(r.type).toBe(2);
    robot = r.handle;
    c.send((w) => w.line("G_Name").handle(robot));
    expect(await c.r.line()).toBe("ABB IRB 120-3/0.6");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_RobLimits").handle(robot));
    expect(await c.r.array()).toEqual([-165, -110, -90, -160, -120, -400]);
    expect(await c.r.array()).toEqual([165, 110, 70, 160, 120, 400]);
    expect(await c.r.int()).toBe(1000);
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("S_Thetas").array([0, 0, 0, 0, 0, 9999]).handle(robot));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_Thetas").handle(robot));
    expect(await c.r.array()).toEqual([0, 0, 0, 0, 0, 400]);
    expect((await c.status()).code).toBe(0);
  });

  it("missing files answer the null item and warning status 2", async () => {
    const r = await c.itemCmd("Add", (w) => w.line("/nonexistent/file.robot").handle(0));
    expect(r.handle).toBe(0);
    expect(r.type).toBe(-1);
     
    expect(r.status).toBe(2);
  });

  itRobot("solves FK/IK like RoboDK (G_FK, G_IK, G_IK_cmpl, unreachable → empty array)", async () => {
    const q = [10, -20, 30, -40, 50, -60];
    c.send((w) => w.line("S_Thetas").array(q).handle(robot));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_FK").array(q).handle(robot));
    const pose = await c.r.pose();
    expect((await c.status()).code).toBe(0);
    expect(pose[3]).toBeCloseTo(257.737919, 5);
    expect(pose[7]).toBeCloseTo(9.446149, 5);
    expect(pose[11]).toBeCloseTo(510.565798, 5);
    c.send((w) => w.line("G_IK").pose(pose).handle(robot));
    const sol = await c.r.array();
    expect((await c.status()).code).toBe(0);
    sol.forEach((v, i) => expect(v).toBeCloseTo(q[i], 6));
    c.send((w) => w.line("G_IK_cmpl").pose(pose).handle(robot));
    const m = await c.r.matrix();
    expect((await c.status()).code).toBe(0);
    expect([m.rows, m.cols]).toEqual([8, 4]);
     
     
    const col = (k: number) => m.data.slice(k * 8, k * 8 + 8);
    expect([0, 1, 2, 3].map((k) => col(k)[6])).toEqual([10, 10, 0, 0]);
    [0, 180, 360, 180].forEach((d, k) => expect(col(k)[7]).toBeCloseTo(d, 6));
    c.send((w) => w.line("G_IK").pose(transl(5000, 0, 0)).handle(robot));
    expect(await c.r.array()).toEqual([]);
    expect((await c.status()).code).toBe(0);
  });

  itRobot("builds a program and estimates it (Add_PROG, Add_TARGET, Add_INSMOVE, Prog_GIns, Update2)", async () => {
    c.send((w) => w.line("S_Thetas").array([0, -10, 20, 0, 30, 0]).handle(robot));
    expect((await c.status()).code).toBe(0);
    const t1 = await c.itemCmd("Add_TARGET", (w) => w.line("Target 1").handle(frame).handle(robot));
    expect(t1.type).toBe(6);
     
     
    c.send((w) => w.line("S_Frame_ptr").handle(frame).handle(robot));
    expect((await c.status()).code).toBe(0);
    const prog = await c.itemCmd("Add_PROG", (w) => w.line("ProbeProg").handle(robot));
    expect(prog.type).toBe(8);
    c.send((w) => w.line("S_Speed4").handle(prog.handle).array([250, -1, -1, -1]));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("Add_INSMOVE").handle(t1.handle).handle(prog.handle).int(1));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("RunPause").handle(prog.handle).int(500_000));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("Prog_Nins").handle(prog.handle));
    expect(await c.r.int()).toBe(3);
    expect((await c.status()).code).toBe(0);
    const names: [string, number][] = [];
    for (let i = 0; i < 3; i++) {
      c.send((w) => w.line("Prog_GIns").handle(prog.handle).int(i));
      const name = await c.r.line();
      const type = await c.r.int();
      if (type === 0) {
        expect(await c.r.int()).toBe(1);  
        expect(await c.r.int()).toBe(0);  
        await c.r.pose();
        expect(await c.r.array()).toEqual([0, -10, 20, 0, 30, 0]);
      }
      expect((await c.status()).code).toBe(0);
      names.push([name, type]);
    }
    expect(names).toEqual([
      ["Set speed (250.0 mm/s)", 2],
      ["MoveJ (Target 1)", 0],
      ["Pause 500 ms", 6],
    ]);
    c.send((w) => w.line("Prog_GIns").handle(prog.handle).int(7));
    expect(await c.r.line()).toBe("invalid id");
    expect(await c.r.int()).toBe(-1);
    expect((await c.status()).code).toBe(1);
    c.send((w) => w.line("Update2").handle(prog.handle).array([0, -1, -1]));
    const upd = await c.r.array();
    const msg = await c.r.line();
    expect((await c.status()).code).toBe(0);
    expect(upd[0]).toBe(3);
    expect(upd[1]).toBeCloseTo(0.5, 3);  
    expect(upd[3]).toBe(1);
    expect(msg).toBe("");
  });

  itRobot("reports MoveXb errors with status 10 like RoboDK (wire log conn7)", async () => {
    c.send((w) => w.line("MoveXb").int(1).int(1).array([0, 0, 0, 0, 0, 9999]).handle(0).handle(robot));
    expect(await c.status()).toEqual({ code: 10, msg: "Joint axes outside limits" });
    const far = transl(5000, 0, 0);
    const colMajor = [far[0], far[4], far[8], far[12], far[1], far[5], far[9], far[13], far[2], far[6], far[10], far[14], far[3], far[7], far[11], far[15]];
    c.send((w) => w.line("MoveXb").int(2).int(2).array(colMajor).handle(0).handle(robot));
    expect(await c.status()).toEqual({ code: 10, msg: "Target cannot be reached" });
  });

  itRobot("moves the robot with a blocking MoveJ and two statuses", async () => {
    c.send((w) => w.line("SimulateSpeed").int(100_000));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("MoveXb").int(1).int(1).array([10, -10, 20, 0, 30, 0]).handle(0).handle(robot));
    expect((await c.status()).code).toBe(0);
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_Thetas").handle(robot));
    const q = await c.r.array();
    expect((await c.status()).code).toBe(0);
    q.forEach((v, i) => expect(v).toBeCloseTo([10, -10, 20, 0, 30, 0][i], 6));
  });

  it("station parameters: unknown → UNKNOWN + warning, set/get round trip", async () => {
    c.send((w) => w.line("G_Param").line("NoSuchParam_xyz"));
    expect(await c.r.line()).toBe("UNKNOWN NoSuchParam_xyz");
    expect(await c.status()).toEqual({ code: 2, msg: "Invalid/unknown parameter to get: NoSuchParam_xyz" });
    c.send((w) => w.line("S_Param").line("ProbeParam").line("42"));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_Param").line("ProbeParam"));
    expect(await c.r.line()).toBe("42");
    expect((await c.status()).code).toBe(0);
  });

  itRobot("station commands: get/set and post processor item command (SCMD, ICMD)", async () => {
    c.send((w) => w.line("SCMD").line("ProgMaxLines").line(""));
    expect(await c.r.line()).toBe("-1");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("SCMD").line("ProgMaxLines").line("5"));
    expect(await c.r.line()).toBe("OK");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("ICMD").handle(robot).line("PostProcessor").line("KUKA_KRC4.py"));
    expect(await c.r.line()).toBe("OK");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("ICMD").handle(robot).line("PostProcessor").line(""));
    expect(await c.r.line()).toBe("KUKA_KRC4");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("ICMD").handle(frame).line("PostProcessor").line("KUKA_KRC4"));
    expect(await c.r.line()).toBe("Invalid Item");
    expect((await c.status()).code).toBe(0);
  });

  it("Version answers four fields", async () => {
    c.send((w) => w.line("Version"));
    expect(await c.r.line()).toMatch(/^Enginuity v/);
    expect(await c.r.int()).toBe(64);
    expect(await c.r.line()).toMatch(/\.26935$/);
    expect(await c.r.line()).toMatch(/^\d\d-\d\d-\d{4}$/);
    expect((await c.status()).code).toBe(0);
  });

   
  itRobot("copies and pastes with the API buffer keeping names (Copy2, Paste)", async () => {
    const t = await c.itemCmd("G_Item2", (w) => w.line("Target 1").int(6));
    c.send((w) => w.line("Copy2").handle(t.handle).int(1));
    expect((await c.status()).code).toBe(0);
    const pasted = await c.itemCmd("Paste", (w) => w.handle(frame));
    expect(pasted.type).toBe(6);
    expect(pasted.handle).not.toBe(t.handle);
    c.send((w) => w.line("G_Name").handle(pasted.handle));
    expect(await c.r.line()).toBe("Target 1");
    expect((await c.status()).code).toBe(0);
  });

  async function insNames(prog: number): Promise<string[]> {
    c.send((w) => w.line("Prog_Nins").handle(prog));
    const n = await c.r.int();
    await c.status();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      c.send((w) => w.line("Prog_GIns").handle(prog).int(i));
      out.push(await c.r.line());
      if ((await c.r.int()) === 0) {
        await c.r.int();
        await c.r.int();
        await c.r.pose();
        await c.r.array();
      }
      await c.status();
    }
    return out;
  }

  async function icmd(item: number, name: string, value: string): Promise<string> {
    c.send((w) => w.line("ICMD").handle(item).line(name).line(value));
    const line = await c.r.line();
    expect((await c.status()).code).toBe(0);
    return line;
  }

  itRobot("reads and edits instruction records as JSON (prog.setParam(i), R-PROG-2/3)", async () => {
    const p = await c.itemCmd("Add_PROG", (w) => w.line("Records").handle(robot));
    c.send((w) => w.line("RunPause").handle(p.handle).int(500_000));
    await c.status();
    expect(JSON.parse(await icmd(p.handle, "0", ""))).toEqual({ Name: "Pause 500 ms", Pause: 500, Type: 6 });
    expect(await icmd(p.handle, "0", JSON.stringify({ Pause: 1500 }))).toBe("OK");
    expect(await icmd(p.handle, "Add", JSON.stringify({ Type: 10 }))).toBe("OK");
    expect(await insNames(p.handle)).toEqual(["Pause 1.5 s", "Smooth(5)"]);
    expect(await icmd(p.handle, "1", JSON.stringify({ Type: -1 }))).toBe("OK");
    expect(await insNames(p.handle)).toEqual(["Pause 1.5 s"]);
  });

  itRobot("names target-less program moves after the previous one (probe1 F, R-PROG-8)", async () => {
    const p = await c.itemCmd("Add_PROG", (w) => w.line("NoTarget").handle(robot));
    c.send((w) => w.line("RunPause").handle(p.handle).int(1000));
    await c.status();
    c.send((w) => w.line("MoveX").int(1).int(1).array([0, -10, 20, 0, 30, 0]).handle(0).handle(p.handle));
    await c.status();
    c.send((w) => w.line("RunCode2").handle(p.handle).line("x").int(3));
    await c.r.int();
    await c.status();
    c.send((w) => w.line("MoveX").int(1).int(1).array([0, -10, 20, 0, 30, 10]).handle(0).handle(p.handle));
    await c.status();
    c.send((w) => w.line("MoveX").int(2).int(2).array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 300, 0, 400, 1]).handle(0).handle(p.handle));
    await c.status();
    expect(await insNames(p.handle)).toEqual(["Pause 1 ms", "MoveJ -1", "MoveJ 1", "MoveL 2", "x"]);
  });

  itRobot("TriggerAction inserts GUI default instructions into the selected program (R-IM-4)", async () => {
    const p = await c.itemCmd("G_Item2", (w) => w.line("NoTarget").int(8));
    c.send((w) => w.line("S_Selection").int(1).handle(p.handle));
    await c.status();
    c.send((w) => w.line("SCMD").line("TriggerAction").line("actionAdd_Pause"));
    expect(await c.r.line()).toBe("OK");
    await c.status();
    expect((await insNames(p.handle)).at(-1)).toBe("Pause 500 ms");
    c.send((w) => w.line("SCMD").line("TriggerAction").line("noSuchAction"));
    expect(await c.r.line()).toBe("Triggering action noSuchAction");
    await c.status();
  });

  it("does not answer unknown commands until the idle delay, then sends -1 (R-POSTGEN-13)", async () => {
    c.send((w) => w.line("NoSuchCommand"));
    await sleep(150);
    expect(c.r.buffered).toBe(0);
    expect(await c.r.int()).toBe(-1);
     
    c.send((w) => w.line("G_Item").line(""));
    expect((await c.item()).type).toBe(1);
    expect((await c.status()).code).toBe(0);
  });

  it("legacy CMD_START handshake with skip-status sends no status-only replies (R-POSTGEN-3, -12)", async () => {
    const s = await TestClient.connect(server.port);
    s.send((w) => w.line("CMD_START").line("1 0 1"));
    s.send((w) => w.line("S_Name").handle(frame).line("Renamed By S"));
    s.send((w) => w.line("G_Name").handle(frame));
     
    expect(await s.r.line()).toBe("Renamed By S");
    expect((await s.status()).code).toBe(0);
    s.close();
  });

  it("streams events on an RDK_EVT channel (Event_Loop.py framing)", async () => {
    const e = await TestClient.connect(server.port);
    expect((await e.handshake())[0]).toBe("RDK_API");
    e.send((w) => w.line("RDK_EVT").int(0));
    expect(await e.r.line()).toBe("RDK_EVT");
    expect(await e.r.int()).toBe(1);
    expect(await e.r.int()).toBe(0);
    c.send((w) => w.line("S_Name").handle(frame).line("Evented"));
    expect((await c.status()).code).toBe(0);
     
    expect(await e.r.int()).toBe(17);
    expect((await e.item()).handle).toBe(frame);
    expect(await e.r.line()).toBe("Evented");
    e.close();
  });

  it("closes connections with an unknown welcome message (R-POSTGEN-4)", async () => {
    const s = await TestClient.connect(server.port);
    s.send((w) => w.line("HELLO"));
    await expect(s.r.line()).rejects.toBeTruthy();
  });

  it("clears the active station's undo stack after SAFE_MODE requests (R-IM-32)", async () => {
    const { activeUndo } = await import("@/server/store");
    c.send((w) => w.line("Add_FRAME").line("").handle(0));
    await c.item();
    expect((await c.status()).code).toBe(0);
    expect(activeUndo().size).toBe(0);
  });
});
