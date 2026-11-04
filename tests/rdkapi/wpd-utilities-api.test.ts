 
 
 
 
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WireWriter } from "@/server/rdkapi/codec";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { pngInfo } from "@/engine/utilities/png";
import { TestClient } from "./client";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

const ROOT = path.resolve(__dirname, "../..");
const probe = JSON.parse(readFileSync(path.join(ROOT, "research/evidence/utilities/robodk-utilities-probe.json"), "utf8"));
 
const IRB120 = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

let server: RdkApiServer;
let c: TestClient;

 
const mat = (rows: number[][]) => (w: WireWriter) => w.matrix(rows[0]?.length ?? 0, rows.length, rows.flat());

async function readArray() {
  const n = await c.r.int();
  return c.r.doubles(n);
}
async function readMatrix() {
  const r = await c.r.int();
  const k = await c.r.int();
  return { r, k, data: await c.r.doubles(r * k) };
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-wpd-"));
  const { getServer } = await import("@/server/store");
  await getServer().ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  c = await TestClient.connect(server.port);
  await c.handshake();
  await c.itemCmd("NewStation", (w) => w.line("WPD"));
});

afterAll(async () => {
  c?.close();
  await server?.close();
});

describe("CalibTCP3 / CalibFrame", () => {
  it("CalibrateTool by point: TCP + stationary point, [mean, std, max], N×2 errors", async () => {
    const rows: number[][] = probe["tcp.noisy.inputs"];
    c.send((w) => {
      w.line("CalibTCP3");
      mat(rows)(w);
      w.int(0).array([0]).handle(0).handle(0);
    });
    const tcp = await readArray();
    const stats = await readArray();
    const errs = await readMatrix();
    expect(await c.status()).toEqual({ code: 0 });
    expect(maxDiff(tcp, probe["tcp.noisy.point"].tcp)).toBeLessThan(1e-9);
    expect(maxDiff(stats, probe["tcp.noisy.point"].stats)).toBeLessThan(1e-9);
    expect([errs.r, errs.k]).toEqual([rows.length, 2]);
    expect(errs.data.slice(0, rows.length)).toEqual(rows.map((_, i) => i + 1));
    expect(maxDiff(errs.data.slice(rows.length), probe["tcp.noisy.point"].errors)).toBeLessThan(1e-9);
  });

  it("fewer than 3 poses: empty reply and RoboDK's InputError", async () => {
    c.send((w) => {
      w.line("CalibTCP3");
      mat(probe["tcp.inputs.staubli"].slice(0, 2))(w);
      w.int(0).array([0]).handle(0).handle(0);
    });
    expect(await readArray()).toEqual([]);
    expect(await readArray()).toEqual([]);
    expect(await readMatrix()).toEqual({ r: 0, k: 0, data: [] });
    expect(await c.status()).toEqual({ code: 12, msg: "Invalid parameters, a 6xN matrix of positions should be provided (N>=3)." });
  });

  it("joints without a robot fail like RoboDK", async () => {
    c.send((w) => {
      w.line("CalibTCP3");
      mat(probe["tcp.joints.inputs"])(w);
      w.int(-1).array([0]).handle(0).handle(0);
    });
    await readArray();
    await readArray();
    await readMatrix();
    expect(await c.status()).toEqual({ code: 3, msg: "Robot item must be provided to calibrate by joints! " });
  });

  it("CalibrateReference: frame from 3 points and the 1-axis turntable statistics", async () => {
    c.send((w) => {
      w.line("CalibFrame");
      mat(probe["frame.m1.inputs"])(w);
      w.int(0).int(1).handle(0);
    });
    const pose = await c.r.pose();
    expect(await readArray()).toEqual([]);
    expect(await c.status()).toEqual({ code: 0 });
    expect(maxDiff(pose, probe["frame.m1"].pose)).toBeLessThan(1e-6);
    c.send((w) => {
      w.line("CalibFrame");
      mat(probe["frame.turntable.inputs"])(w);
      w.int(0).int(3).handle(0);
    });
    const tt = await c.r.pose();
    const stats = await readArray();
    expect(await c.status()).toEqual({ code: 0 });
    expect(maxDiff(tt, probe["frame.turntable"].pose)).toBeLessThan(1e-6);
    expect(maxDiff(stats, probe["frame.turntable"].stats)).toBeLessThan(1e-9);
  });

  it("two points: identity, empty stats and the 6xN message", async () => {
    c.send((w) => {
      w.line("CalibFrame");
      mat(probe["frame.two.inputs"])(w);
      w.int(0).int(1).handle(0);
    });
    expect(await c.r.pose()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(await readArray()).toEqual([]);
    expect(await c.status()).toEqual({ code: 3, msg: "Invalid parameters, a 6xN matrix of positions should be provided (N>=3)." });
  });
});

describe("BuildMechanism", () => {
  it("builds a 1-axis turntable from two shapes", async () => {
    const tri = [
      [0, 0, 0],
      [40, 0, 0],
      [0, 40, 0],
    ];
    const a = await c.itemCmd("AddShape2", (w) => {
      mat(tri)(w);
      w.handle(0).int(0);
    });
    const b = await c.itemCmd("AddShape2", (w) => {
      mat(tri)(w);
      w.handle(0).int(0);
    });
    const robot = await c.itemCmd("BuildMechanism", (w) => {
      w.handle(0).line("Turntable").int(1).int(1).handle(a.handle).handle(b.handle);
      w.pose([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).pose([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      w.array([]);
       
      const col = (v: number) => [v, ...new Array(11).fill(0)];
      w.matrix(12, 5, [...col(0), ...col(15), ...col(1), ...col(-180), ...col(180)]);
    });
    expect(robot.status).toBe(0);
    expect(robot.type).toBe(2);
    c.send((w) => w.line("G_Thetas").handle(robot.handle));
    const q = await readArray();
    expect(q).toEqual([15]);
    expect((await c.status()).code).toBe(0);
  });
});

describe("Cam2D", () => {
  it("adds a camera item to a frame, snapshots PNG bytes, sets params and closes", async () => {
    const frame = await c.itemCmd("Add_FRAME", (w) => w.line("CamFrame").handle(0));
    const cam = await c.itemCmd("Cam2D_PtrAdd", (w) => w.handle(frame.handle).handle(0).line("SIZE=64x48"));
    expect([cam.status, cam.type]).toEqual([0, 19]);
    c.send((w) => w.line("Cam2D_PtrSnapshot").handle(cam.handle).line("").line("Grayscale"));
    const png = await c.r.bytes();
    expect(await c.status()).toEqual({ code: 0 });
    expect(pngInfo(new Uint8Array(png))).toEqual({ width: 64, height: 48, bitDepth: 8, colorType: 0 });
    c.send((w) => w.line("Cam2D_PtrSetParams").handle(cam.handle).line("SIZE=32x24"));
    expect(await c.r.int()).toBe(1);
    expect(await c.status()).toEqual({ code: 0 });
    c.send((w) => w.line("Cam2D_PtrClose").handle(cam.handle));
    expect(await c.r.int()).toBe(1);
    expect(await c.status()).toEqual({ code: 0 });
  });

  it("without a location the camera is refused with RoboDK's message", async () => {
    const r = await c.itemCmd("Cam2D_PtrAdd", (w) => w.handle(0).handle(0).line(""));
    expect(r.status).toBe(3);
  });
});

describe("Robot connection", () => {
  it("ConnectedState of a non-robot: -1, Invalid item provided, status 1", async () => {
    const frame = await c.itemCmd("Add_FRAME", (w) => w.line("NotARobot").handle(0));
    c.send((w) => w.line("ConnectedState").handle(frame.handle));
    expect(await c.r.int()).toBe(-1);
    expect(await c.r.line()).toBe("Invalid item provided");
    expect(await c.status()).toEqual({ code: 1 });
  });

  it.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("connection params round-trip and Connect2 answers at once", async () => {
    const robot = await c.itemCmd("Add", (w) => w.line(IRB120).handle(0));
    c.send((w) => w.line("setConnectParams").handle(robot.handle).line("127.0.0.1").int(1).line("/home").line("user").line(""));
    expect(await c.status()).toEqual({ code: 0 });
    c.send((w) => w.line("ConnectParams").handle(robot.handle));
    expect([await c.r.line(), await c.r.int(), await c.r.line(), await c.r.line(), await c.r.line()]).toEqual(["127.0.0.1", 1, "/home", "user", ""]);
    expect(await c.status()).toEqual({ code: 0 });
    const t0 = Date.now();
    c.send((w) => w.line("Connect2").handle(robot.handle).line("").int(1));
    expect(await c.r.int()).toBe(0);
    expect(await c.status()).toEqual({ code: 0 });
    expect(Date.now() - t0).toBeLessThan(2000);
    c.send((w) => w.line("Disconnect").handle(robot.handle));
    expect(await c.r.int()).toBe(1);
    expect(await c.status()).toEqual({ code: 0 });
    c.send((w) => w.line("ConnectedState").handle(robot.handle));
    expect(await c.r.int()).toBe(-2);
    expect(await c.r.line()).toBe("Robot disconnected");
    expect(await c.status()).toEqual({ code: 0 });
  });
});
