// Verifies curve/point projection, machining projects, and display commands over the API.
 
 
 
 
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { TestClient } from "./client";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

 
const UR5E = LIBRARY_FILE("robots", "UR5e.robot");
const HAS_UR5E = hasLibraryFile("robots", "UR5e.robot");

let server: RdkApiServer;
let c: TestClient;
let tmp: string;
let part = 0;
let robot = 0;

 
const mat = (rows: number[][]) => (w: import("@/server/rdkapi/codec").WireWriter) => w.matrix(rows[0].length, rows.length, rows.flat());

async function readMatrix(): Promise<number[][]> {
  const r = await c.r.int();
  const k = await c.r.int();
  const data = await c.r.doubles(r * k);
  return Array.from({ length: k }, (_, j) => data.slice(j * r, j * r + r).map((v) => Math.round(v * 1000) / 1000 + 0));
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "rc-curves-"));
  process.env.ROBOCRAFT_DATA_DIR = tmp;
  const { getServer, run } = await import("@/server/store");
  await getServer().ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  c = await TestClient.connect(server.port);
  await c.handshake();
  await c.itemCmd("NewStation", (w) => w.line("MachProbe"));
  if (!HAS_UR5E) return;
  const rb = await c.itemCmd("Add", (w) => w.line(UR5E).handle(0));
  robot = rb.handle;
   
  const ws = getServer().ws;
  const r1 = await run("item.addFrame", { name: "Part Frame" }, "api");
  const frameId = (r1.result as { id: string }).id;
  await run("item.setPose", { item: frameId, pose: [1, 0, 0, 450, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, "api");
  const robotId = Object.values(ws.items).find((i) => i.handle === robot)!.id;
  await run("robot.addTool", { robot: robotId, name: "T1", xyzrpw: [0, 0, 100, 0, 0, 0] }, "api");
  await run("robot.setActiveFrame", { robot: robotId, frame: frameId }, "api");
  const r2 = await run("object.addShape", { shape: "box", sizeX: 200, sizeY: 150, sizeZ: 50, parent: frameId, name: "Part" }, "api");
  part = (r2.result as { handle: number }).handle;
}, 60_000);

afterAll(async () => {
  c?.close();
  await server?.close();
});

describe.skipIf(!HAS_UR5E)("curves and points over the API", () => {
  it("AddPoints(add_to_ref) projects onto the part; GetPoints(FEATURE_POINT) returns every point", async () => {
    const r = await c.itemCmd("AddPoints", (w) => {
      mat([[-50, 40, 60, 0, 0, 1], [50, 40, 60, 0, 0, 1]])(w);
      w.handle(part).int(1).int(3);
    });
    expect([r.handle, r.status]).toEqual([part, 0]);
    c.send((w) => w.line("G_ObjPoint").handle(part).int(3).int(1));
    const pts = await readMatrix();
    expect(await c.r.line()).toBe("");
    expect((await c.status()).code).toBe(0);
    expect(pts.map((p) => p.slice(0, 3))).toEqual([[-50, 40, 50], [50, 40, 50]]);
  });

  it("AddCurve to a new object: 'Curve' next to the reference; GetCurves / G_ObjPoint read it back", async () => {
    const top = [[-80, -30, 50, 0, 0, 1], [0, -30, 50, 0, 0, 1], [80, -30, 50, 0, 0, 1]];
    const r = await c.itemCmd("AddWire", (w) => {
      mat(top)(w);
      w.handle(part).int(0).int(3);
    });
    expect(r.type).toBe(5);
    c.send((w) => w.line("G_Name").handle(r.handle));
    expect(await c.r.line()).toBe("Curve");
    await c.status();
    c.send((w) => w.line("G_ObjCurves").handle(r.handle).int(2));
    expect(await c.r.int()).toBe(1);
    expect(await readMatrix()).toEqual(top);
    expect(await c.r.line()).toBe("");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_ObjPoint").handle(r.handle).int(2).int(5));
    expect(await readMatrix()).toEqual([]);
    expect(await c.r.line()).toBe("Invalid curve id");
    await c.status();
  });

  it("SelectedFeature reports the curve or point clicked in the 3D view (object.selectFeature)", async () => {
    const { run } = await import("@/server/store");
    const selected = async () => {
      c.send((w) => w.line("G_ObjSelection").handle(part));
      const reply = [await c.r.int(), await c.r.int(), await c.r.int()];
      await c.status();
      return reply;
    };
    expect(await selected()).toEqual([0, 0, 0]);
     
    await run("object.selectFeature", { object: part, feature: "point", id: 1 }, "ui");
    expect(await selected()).toEqual([1, 3, 1]);
    await run("object.selectFeature", { object: part, feature: "curve", id: 0 }, "ui");
    expect(await selected()).toEqual([1, 2, 0]);
    await run("object.selectFeature", { object: part, feature: "none" }, "ui");
    expect(await selected()).toEqual([0, 0, 0]);
  });

  it("ProjectPoints returns RoboDK's projections (CLOSEST_RECALC)", async () => {
    c.send((w) => {
      w.line("ProjectPoints");
      mat([[10, 10, 60, 0, 0, 1], [130, 0, 0, 1, 0, 0]])(w);
      w.handle(part).int(4);
    });
    expect(await readMatrix()).toEqual([
      [10, 10, 50, 0, 0, 1],
      [100, 0, 0, 0, 0, -1],
    ]);
    expect((await c.status()).code).toBe(0);
  });
});

describe.skipIf(!HAS_UR5E)("machining projects over the API", () => {
  it("AddMachiningProject + setMachiningParameters(part=curve object) builds the curve follow program", async () => {
    const curve = await c.itemCmd("AddWire", (w) => {
      mat([[-80, -30, 50, 0, 0, 1], [80, -30, 50, 0, 0, 1]])(w);
      w.handle(part).int(0).int(3);
    });
    const proj = await c.itemCmd("Add_MACHINING", (w) => w.line("Milling settings").handle(robot));
    expect(proj.type).toBe(11);
    c.send((w) => w.line("S_MachiningParams").handle(proj.handle).line("").handle(curve.handle).line("RotZ_Range=45 RotZ_Step=15"));
    const prog = await c.item();
    const ratio = await c.r.int();
    expect((await c.status()).code).toBe(0);
    expect(prog.type).toBe(8);
    expect(ratio).toBe(1000);
    c.send((w) => w.line("G_Name").handle(prog.handle));
    expect(await c.r.line()).toBe("Milling");
    await c.status();
     
    c.send((w) => w.line("ICMD").handle(proj.handle).line("Machining").line(""));
    const settings = JSON.parse(await c.r.line());
    await c.status();
    expect(settings).toMatchObject({ RotZ_Range: 45, RotZ_Step: 15, SpeedOperation: 50, SpeedRapid: 1000 });
     
    c.send((w) => w.line("ICMD").handle(proj.handle).line("CustomKey").line("42"));
    expect(await c.r.line()).toBe("OK");
    await c.status();
  });

  it("setMachiningParameters(ncfile=…) loads a G-code file", async () => {
    const file = path.join(tmp, "square.nc");
    writeFileSync(file, "G21 G90\nG0 X0 Y0 Z10\nG1 Z0 F300\nG1 X50\nG1 Y30\nG0 Z10\n");
    const proj = await c.itemCmd("Add_MACHINING", (w) => w.line("NC settings").handle(robot));
    c.send((w) => w.line("S_MachiningParams").handle(proj.handle).line(file).handle(0).line(""));
    const prog = await c.item();
    await c.r.int();
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_Name").handle(prog.handle));
    expect(await c.r.line()).toBe("square");
    await c.status();
  });
});

describe("curve and point display station commands", () => {
   
  async function scmd(name: string, value = "") {
    c.send((w) => w.line("SCMD").line(name).line(value));
    const reply = await c.r.line();
    await c.status();
    return reply;
  }

  it("reads RoboDK's defaults and keeps values set through the API (probe-display.json, probe-types.json)", async () => {
    const defaults: Record<string, string> = {
      DisplayCurves: "0",
      DisplayPoints: "1",
      ShowCurveNormals: "0",
      DisplayCurveNormalsOnSelect: "1",
      ShowCurvePoints: "0",
      SizeCurvePoints: "5",
      ShowPointNormals: "0",
      ShowSelectedPointNormals: "1",
      SizeCurveArrow: "30",
      SizeRatioCurves: "0.5",
      TolerancePickCurve: "10",
      TolerancePickPoint: "15",
       
      SizeNormals: "15",
    };
    for (const [name, value] of Object.entries(defaults)) expect([name, await scmd(name)]).toEqual([name, value]);
    for (const [name, value] of [["SizeCurvePoints", "7.5"], ["DisplayCurves", "0"], ["TolerancePickCurve", "-1"], ["ShowCurveNormals", "1"]]) {
      expect(await scmd(name, value)).toBe("OK");
      expect(await scmd(name)).toBe(value);
    }
    const { getServer } = await import("@/server/store");
    expect(getServer().services.settings).toMatchObject({ SizeCurvePoints: 7.5, TolerancePickCurve: -1, ShowCurveNormals: true });
  });
});
