// Verifies spray-gun API states, projected particles, statistics, and byte-level replies.
 
 
 
 
 
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WireWriter } from "@/server/rdkapi/codec";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { TestClient } from "./client";

const ROOT = path.resolve(__dirname, "../..");
const probe = (name: string) => JSON.parse(readFileSync(path.join(ROOT, "research/evidence/spray", `probe-${name}.json`), "utf8")) as { step: string; hex?: string }[];
const GEOM = probe("geom");
const MULTI = probe("multi");
const hexOf = (rows: ReturnType<typeof probe>, key: string) => rows.find((r) => r.step === key)!.hex!;

let server: RdkApiServer;
let c: TestClient;

 
async function rawReply(expectBytes: number, ms = 3000): Promise<string> {
  const buf = await Promise.race([c.r.take(expectBytes), new Promise<Buffer>((_, rej) => setTimeout(() => rej(new Error("reply timeout")), ms))]);
  return buf.toString("hex");
}

const pose = (rot: number[][], t: number[]) => {
  const m = [rot[0][0], rot[0][1], rot[0][2], t[0], rot[1][0], rot[1][1], rot[1][2], t[1], rot[2][0], rot[2][1], rot[2][2], t[2], 0, 0, 0, 1];
  return (w: WireWriter) => w.pose(m);
};
const ROTX180 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
];
 
const tris = (t: number[][][]) => (w: WireWriter) => {
  const pts = t.flat();
  w.matrix(3, pts.length, pts.flat());
};
const PLATE = [
  [[-30, -150, 0], [270, -150, 0], [270, 150, 0]],
  [[-30, -150, 0], [270, 150, 0], [-30, 150, 0]],
];
const GUN = [[[0, 0, 0], [10, 0, 0], [0, 10, 0]]];
const EMPTY = (w: WireWriter) => w.matrix(0, 0, []);

async function addShape(t: number[][][], color: number[]) {
  c.send((w) => {
    w.line("AddShape3");
    tris(t)(w);
    w.handle(0).int(0).array(color);
  });
  const it = await c.item();
  expect((await c.status()).code).toBe(0);
  return it.handle;
}

async function setPose(h: number, at: (w: WireWriter) => void) {
  c.send((w) => {
    w.line("S_Hlocal").handle(h);
    at(w);
  });
  expect((await c.status()).code).toBe(0);
}

 
async function gun(build: (w: WireWriter) => void, bytes: number): Promise<string> {
  c.send(build);
  return rawReply(bytes);
}

const STATS_LINE = Buffer.from("id<br>percent in<br>percent out<br>count\n").length;
 
const statsBytes = (guns: number) => STATS_LINE + 8 + 32 * guns + 4;
async function statsN(guns: number, id = -1) {
  c.send((w) => w.line("Gun_Stats").int(id));
  return rawReply(statsBytes(guns));
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-spray-"));
  const { getServer } = await import("@/server/store");
  await getServer().ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  c = await TestClient.connect(server.port);
  await c.handshake();
});

afterAll(async () => {
  c?.close();
  await server?.close();
});

describe("spray guns over the API (probe-geom)", () => {
  it("ellipse STEP=8x4 over a plate: ids, states, statistics and clear byte for byte", async () => {
    await c.itemCmd("NewStation", (w) => w.line("Spray geom"));
    const plate = await addShape(PLATE, [0.7, 0.7, 0.7, 1]);
    const gunObj = await addShape(GUN, [0.2, 0.2, 0.2, 1]);
    await setPose(gunObj, pose(ROTX180, [0, 0, 300]));
    const vol = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600, 200, 0, 600, 0, 100, 600];
    expect(
      await gun((w) => {
        w.line("Gun_Add").handle(gunObj).handle(plate).line("ELLYPSE PROJECT STEP=8x4 RAND=0 PARTICLE=SPHERE(5,8)").matrix(9, 2, vol);
        EMPTY(w);
      }, 8),
    ).toBe(hexOf(GEOM, "Gun_Add.ellipse"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.initial"));
    expect(await gun((w) => w.line("Gun_SetState").int(-1).int(1), 8)).toBe(hexOf(GEOM, "Gun_SetState.on"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.after_on"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.second"));
     
    c.send((w) => w.line("G_Name").handle(plate));
    await c.r.line();
    await c.status();
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.after_G_Name"));
     
    const c2 = await TestClient.connect(server.port);
    await c2.handshake();
    c2.close();
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.after_conn2"));
     
    await setPose(gunObj, pose(ROTX180, [200, 0, 300]));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.after_move"));
    expect(await gun((w) => w.line("Gun_SetState").int(-1).int(2), 8)).toBe(hexOf(GEOM, "Gun_SetState.hidden2"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.state2_a"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.state2_b"));
    expect(await gun((w) => w.line("Gun_SetState").int(-1).int(0), 8)).toBe(hexOf(GEOM, "Gun_SetState.off"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.off_a"));
    expect(await statsN(1)).toBe(hexOf(GEOM, "Gun_Stats.off_b"));
    expect(await gun((w) => w.line("Gun_Clear").int(-1), 8)).toBe(hexOf(GEOM, "Gun_Clear.all"));
     
    expect(await statsN(0)).toBe(hexOf(GEOM, "Gun_Stats.empty"));
    expect(await gun((w) => w.line("Gun_Clear").int(-1), 8)).toBe(hexOf(GEOM, "Gun_Clear.again"));
  });
});

describe("spray guns over the API (probe-multi)", () => {
  it("rectangle + NO_PROJECT guns, SetState by id, Clear(id), automatic tool and object", async () => {
    await c.itemCmd("NewStation", (w) => w.line("Spray multi"));
    const plate = await addShape(PLATE, [0.7, 0.7, 0.7, 1]);
    const gunObj = await addShape(GUN, [0.2, 0.2, 0.2, 1]);
    await setPose(gunObj, pose(ROTX180, [0, 0, 300]));
    const vol = [0, 0, 0, 0, 0, 0, 0, 0, 0, -200, -100, 600, 200, -100, 600, -200, 100, 600];
    expect(
      await gun((w) => {
        w.line("Gun_Add").handle(gunObj).handle(plate).line("RECTANGLE PROJECT STEP=2x2 RAND=0 PARTICLE=CUBE(6,6,6) COLOR=#ff00a000").matrix(9, 2, vol);
        EMPTY(w);
      }, 8),
    ).toBe(hexOf(MULTI, "Gun_Add.rect"));
    expect(
      await gun((w) => {
        w.line("Gun_Add").handle(gunObj).handle(plate).line("NO_PROJECT STEP=2x1 RAND=0 COLOR=blue");
        EMPTY(w);
        EMPTY(w);
      }, 8),
    ).toBe(hexOf(MULTI, "Gun_Add.noproject"));
    expect(await gun((w) => w.line("Gun_SetState").int(-1).int(1), 8)).toBe(hexOf(MULTI, "Gun_SetState.on_all"));
    expect(await statsN(2)).toBe(hexOf(MULTI, "Gun_Stats.a"));
    expect(await statsN(2, 0)).toBe(hexOf(MULTI, "Gun_Stats.b"));
    expect(await gun((w) => w.line("Gun_SetState").int(5).int(0), 8)).toBe(hexOf(MULTI, "Gun_SetState.id5_off"));
    expect(await statsN(2, 1)).toBe(hexOf(MULTI, "Gun_Stats.c"));
    expect(await statsN(2)).toBe(hexOf(MULTI, "Gun_Stats.d"));
    expect(await gun((w) => w.line("Gun_SetState").int(1).int(1), 8)).toBe(hexOf(MULTI, "Gun_SetState.id1_on"));
    expect(await statsN(2)).toBe(hexOf(MULTI, "Gun_Stats.e"));
    expect(await statsN(2)).toBe(hexOf(MULTI, "Gun_Stats.f"));
    expect(await gun((w) => w.line("Gun_Clear").int(7), 8)).toBe(hexOf(MULTI, "Gun_Clear.id7"));
    expect(await statsN(0)).toBe(hexOf(MULTI, "Gun_Stats.after_clear"));
     
    const add = (tool: number, obj: number, opts: string) =>
      gun((w) => {
        w.line("Gun_Add").handle(tool).handle(obj).line(opts);
        EMPTY(w);
        EMPTY(w);
      }, 8);
    expect(await add(0, 0, "")).toBe(hexOf(MULTI, "Gun_Add.auto_no_robot"));
    expect(await add(123456789, plate, "")).toBe(hexOf(MULTI, "Gun_Add.bad_handle"));
     
    expect(await add(plate, plate, "STEP=1x0")).toBe(hexOf(MULTI, "Gun_Add.tool_is_plate"));
  });

  it("station commands update the positions (one emission), the Enginuity capability query does not", async () => {
    await c.itemCmd("NewStation", (w) => w.line("Spray scmd"));
    const plate = await addShape(PLATE, [0.7, 0.7, 0.7, 1]);
    c.send((w) => {
      w.line("Gun_Add").handle(plate).handle(plate).line("STEP=1x0");
      EMPTY(w);
      EMPTY(w);
    });
    expect(await rawReply(8)).toBe("0000000000000000");
    expect(await gun((w) => w.line("Gun_SetState").int(-1).int(1), 8)).toBe("0000000100000000");
    const count = async () => {
      c.send((w) => w.line("Gun_Stats").int(-1));
      await c.r.line();
      const rows = await c.r.int();
      const cols = await c.r.int();
      const data = await c.r.doubles(rows * cols);
      await c.status();
      return data[3];
    };
    const scmd = async (name: string) => {
      c.send((w) => w.line("SCMD").line(name).line(""));
      const line = await c.r.line();
      await c.status();
      return line;
    };
    expect(await scmd("EnginuityApi")).toMatch(/^\{"product":"Enginuity"/);
    expect(await count()).toBe(0);
     
    await scmd("Version");
    expect(await count()).toBe(2);
  });

  it("Proj2d3d answers at once without a 3D view (WP-X1; formerly a status-3 fallback) and the connection stays in sync", async () => {
    c.send((w) => w.line("Proj2d3d").int(10).int(20));
    expect(await c.r.int()).toBe(0);
    expect(await c.item()).toEqual({ handle: 0, type: -1 });
    expect(await c.r.xyz()).toEqual([0, 0, 0]);
    expect(await c.status()).toEqual({ code: 0 });
     
    c.send((w) => w.line("Gun_Clear").int(-1));
    expect(await rawReply(8)).toBe("0000000100000000");
  });
});
