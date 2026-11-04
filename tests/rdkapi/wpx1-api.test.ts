 
 
 
 
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { TestClient, sleep } from "./client";
import { hasLibraryFile, LIBRARY_FILE, LIBRARY_KIND_DIR } from "../library";
import { boxMesh } from "@/engine/meshio";
import { mulAll, rotx, roty, rotz, DEG } from "@/engine/math";

const UR5E = LIBRARY_FILE("robots", "UR5e.robot");
const HAS_UR5E = hasLibraryFile("robots", "UR5e.robot");
const R540 = path.join(LIBRARY_KIND_DIR("stations"), "Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk");

let server: RdkApiServer;
let c: TestClient;
let tmp: string;
let srv: Awaited<ReturnType<typeof import("@/server/store")["getServer"]>>;
let run: typeof import("@/server/store")["run"];

const ok = async (name: string, params: Record<string, unknown>) => {
  const r = await run(name, params, "api");
  if (!r.ok) throw new Error(r.error);
  return r.result as Record<string, unknown>;
};
const itemById = (id: string) => srv.ws.items[id];

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "rc-wpx1-"));
  process.env.ROBOCRAFT_DATA_DIR = tmp;
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  c = await TestClient.connect(server.port);
  await c.handshake();
  await c.itemCmd("NewStation", (w) => w.line("X1"));
}, 60_000);

afterAll(async () => {
  c?.close();
  await server?.close();
});

async function readTree(kind: "tree" | "tree2" | "tree3" | "wasm") {
  const n = await c.r.int();
  const rows: { five?: number; handle: number; type: number; name: string; parent: number; expanded?: number; visible?: number; loop?: number; list?: string }[] = [];
  for (let i = 0; i < n; i++) {
    const five = kind === "tree3" ? await c.r.int() : undefined;
    const it = await c.item();
    const name = await c.r.line();
    const parent = (await c.item()).handle;
    const row: (typeof rows)[number] = { ...(five !== undefined ? { five } : {}), handle: it.handle, type: it.type, name, parent };
    if (kind !== "tree") row.expanded = await c.r.int();
    if (kind === "tree3" || kind === "wasm") row.visible = await c.r.int();
    if (kind === "wasm") {
      row.loop = await c.r.int();
      row.list = await c.r.line();
    }
    rows.push(row);
  }
  expect((await c.status()).code).toBe(0);
  return rows;
}

describe("tree exports (FUN_10031a738, FUN_100319b98, FUN_100319d6c, FUN_100319f74)", () => {
  let frame = 0;
  let prog = 0;
  beforeAll(async () => {
    frame = (await c.itemCmd("Add_FRAME", (w) => w.line("F1").handle(0))).handle;
    prog = (await c.itemCmd("Add_PROG", (w) => w.line("P1").handle(0))).handle;
    const progId = Object.values(srv.ws.items).find((i) => i.handle === prog)!.id;
    await ok("program.addInstruction", { program: progId, kind: "pause", pauseMs: 500 });
    await ok("program.addInstruction", { program: progId, kind: "print", text: "a|b" });
  });

  it("G_List_Items_Tree: count, then item, name, parent per item; the station first with the null parent", async () => {
    c.send((w) => w.line("G_List_Items_Tree"));
    const rows = await readTree("tree");
    expect(rows[0].type).toBe(1);
    expect(rows[0].parent).toBe(0);
    const f = rows.find((r) => r.handle === frame)!;
    expect([f.name, f.type, f.parent]).toEqual(["F1", 3, rows[0].handle]);
     
    expect(rows.some((r) => r.type === 9)).toBe(false);
  });

  it("G_List_Items_Tree2 adds the expanded flag (setParam Tree Collapse clears it)", async () => {
    c.send((w) => w.line("ICMD").handle(frame).line("Tree").line("Collapse"));
    await c.r.line();
    await c.status();
    c.send((w) => w.line("G_List_Items_Tree2"));
    const rows = await readTree("tree2");
    expect(rows.find((r) => r.handle === frame)!.expanded).toBe(0);
    expect(rows[0].expanded).toBe(1);
  });

  it("G_List_Items_Tree3 writes int 5 before each item and adds visible", async () => {
    c.send((w) => w.line("G_List_Items_Tree3"));
    const rows = await readTree("tree3");
    expect(rows.every((r) => r.five === 5)).toBe(true);
    expect(rows.find((r) => r.handle === frame)!.visible).toBe(1);
  });

  it("G_List_Items_WASM adds the Loop flag and 'type|tree label||' per instruction ('|' → ' ')", async () => {
    c.send((w) => w.line("G_List_Items_WASM"));
    const rows = await readTree("wasm");
    const p = rows.find((r) => r.handle === prog)!;
    const progId = Object.values(srv.ws.items).find((i) => i.handle === prog)!.id;
    const names = itemById(progId).children.map((id) => itemById(id).name.replace(/\|/g, " "));
    expect(p.loop).toBe(0);
     
    expect(p.list).toBe(`6|${names[0]}||9|Print: ${names[1]}||`);
    expect(rows.find((r) => r.handle === frame)!.list).toBe("");
  });
});

describe("views", () => {
  const f = Math.fround;
  it("G_ViewPose2(3) = top view rotation fitted to an empty station (R-IM-20; FUN_10035969c)", async () => {
    await c.itemCmd("NewStation", (w) => w.line("Empty"));
    c.send((w) => w.line("G_ViewPose2").int(3));
    const p = await c.r.pose();
    expect((await c.status()).code).toBe(0);
     
    expect([p[0], p[1], p[2], p[4], p[5], p[6], p[8], p[9], p[10]].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
     
    expect(p[11]).toBeCloseTo(f(f(f(600 * -1.2) * 0.5) / f(Math.tan((30 * Math.PI) / 360))), 3);
    expect([p[3] + 0, p[7] + 0]).toEqual([0, 0]);
  });

  it.skipIf(!existsSync(R540))("G_ViewPose2(3) and (1) of the KR 3 R540 station match RoboDK's live poses", async () => {
    const probe = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/api-probe/wpx1/wpx1-probe.json"), "utf8")) as { step: string; value: { reply: unknown[] } }[];
    const live = (k: string) => probe.find((s) => s.step === k)!.value.reply[0] as number[];
    await c.itemCmd("Add", (w) => w.line(R540).handle(0));
    for (const preset of [3, 1]) {
      c.send((w) => w.line("G_ViewPose2").int(preset));
      const p = await c.r.pose();
      await c.status();
       
      const colMajor = [0, 1, 2, 3].flatMap((col) => [0, 1, 2, 3].map((row) => p[row * 4 + col]));
      const want = live(`G_ViewPose2.${preset}`);
      colMajor.forEach((v, i) => expect(v).toBeCloseTo(want[i], i >= 12 ? 2 : 6));
    }
  });

  it("G_ViewPose2(1) = the isometric rotation", async () => {
    c.send((w) => w.line("G_ViewPose2").int(1));
    const p = await c.r.pose();
    await c.status();
    const rows = [p[0], p[1], p[2], p[4], p[5], p[6], p[8], p[9], p[10]].map((v) => Math.round(v * 1000) / 1000 + 0);
    expect(rows).toEqual([-0.707, 0.707, 0, -0.354, -0.354, 0.866, 0.612, 0.612, 0.5]);
  });

  it("FitAll answers status 0 and fits the views", async () => {
    const events: unknown[] = [];
    const off = (e: { type: string; action?: string }) => {
      if (e.type === "view" && e.action === "fit") events.push(e);
    };
    srv.listeners.add(off as never);
    c.send((w) => w.line("FitAll"));
    expect((await c.status()).code).toBe(0);
    srv.listeners.delete(off as never);
    expect(events.length).toBe(1);
  });

  it("Proj2d3d without a 3D view: 0, the null item, (0,0,0), status 0", async () => {
    c.send((w) => w.line("Proj2d3d").int(10).int(20));
    expect(await c.r.int()).toBe(0);
    expect((await c.item()).handle).toBe(0);
    expect(await c.r.doubles(3)).toEqual([0, 0, 0]);
    expect((await c.status()).code).toBe(0);
  });

  it("Proj2d3d with a view: 1, the item under the pixel and the point (doubles)", async () => {
    const vb = await import("@/server/viewbridge");
    const vp = await import("@/server/viewpick");
    const frame = (await c.itemCmd("Add_FRAME", (w) => w.line("Pick").handle(0))).handle;
    const id = Object.values(srv.ws.items).find((i) => i.handle === frame)!.id;
    vb.viewConnected();
    const answer = (e: { type: string; id?: string; x?: number; y?: number }) => {
      if (e.type === "view-pick-request") setTimeout(() => vp.completeViewPick(e.id!, { item: id, xyz: [e.x!, e.y!, 0.1] }), 5);
    };
    srv.listeners.add(answer as never);
    try {
      c.send((w) => w.line("Proj2d3d").int(10).int(20));
      expect(await c.r.int()).toBe(1);
      expect((await c.item()).handle).toBe(frame);
      expect(await c.r.doubles(3)).toEqual([10, 20, f(0.1)]);
      expect((await c.status()).code).toBe(0);
    } finally {
      srv.listeners.delete(answer as never);
      vb.viewDisconnected();
    }
  });
});

describe.skipIf(!existsSync(R540))("G_List_Items_WASM of the KR 3 R540 station", () => {
  it("instruction lists equal RoboDK's live strings ('type|tree label||' per instruction)", async () => {
    const probe = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/api-probe/wpx1/wpx1-probe.json"), "utf8")) as { step: string; value: { reply: unknown[] } }[];
    const live = (probe.find((s) => s.step === "G_List_Items_WASM")!.value.reply[0] as { name: string; list: string; item: [number, number] }[]).filter((r) => r.item[1] === 8);
    await c.itemCmd("Add", (w) => w.line(R540).handle(0));
    c.send((w) => w.line("G_List_Items_WASM"));
    const mine = (await readTree("wasm")).filter((r) => r.type === 8);
    for (const want of live) expect([want.name, mine.find((m) => m.name === want.name)?.list]).toEqual([want.name, want.list]);
  });
});

describe("legacy aliases", () => {
  it("AddShape: a 3x3 point list makes a new object 'Shape'; a 2xN list answers status 2 (FUN_100322418)", async () => {
    const r = await c.itemCmd("AddShape", (w) => w.matrix(3, 3, [0, 0, 0, 100, 0, 0, 0, 100, 0]).handle(0));
    expect([r.type, r.status]).toEqual([5, 0]);
    expect(Object.values(srv.ws.items).find((i) => i.handle === r.handle)!.name).toBe("Shape");
    c.send((w) => w.line("AddShape").matrix(2, 3, [0, 0, 1, 1, 2, 2]).handle(0));
    expect((await c.item()).handle).toBe(0);
    expect(await c.status()).toEqual({ code: 2, msg: "Invalid shape, a 3xN (or 6xN) list of points must be provided (N must be multiple of 3)" });
  });

  it("Copy: the null item answers status 1; an item is copied with its children for Paste (FUN_100320dd4)", async () => {
    c.send((w) => w.line("Copy").handle(0));
    expect((await c.status()).code).toBe(1);
    const fr = await c.itemCmd("Add_FRAME", (w) => w.line("CopyMe").handle(0));
    await c.itemCmd("Add_FRAME", (w) => w.line("Child").handle(fr.handle));
    c.send((w) => w.line("Copy").handle(fr.handle));
    expect((await c.status()).code).toBe(0);
    const pasted = await c.itemCmd("Paste", (w) => w.handle(0));
    const it = Object.values(srv.ws.items).find((i) => i.handle === pasted.handle)!;
    expect(it.children.length).toBe(1);
  });

  it("AddBlind: status 0 at once, then the file is loaded (FUN_100325764)", async () => {
    const stl = path.join(tmp, "blind.stl");
    const tri = boxMesh(10, 10, 10);
    const buf = Buffer.alloc(84 + (tri.length / 9) * 50);
    buf.writeUInt32LE(tri.length / 9, 80);
    for (let t = 0; t < tri.length / 9; t++) for (let k = 0; k < 9; k++) buf.writeFloatLE(tri[t * 9 + k], 84 + t * 50 + 12 + k * 4);
    writeFileSync(stl, buf);
    const before = Object.values(srv.ws.items).filter((i) => i.type === "object").length;
    c.send((w) => w.line("AddBlind").line(stl).handle(0));
    expect((await c.status()).code).toBe(0);
    for (let i = 0; i < 50 && Object.values(srv.ws.items).filter((x) => x.type === "object").length === before; i++) await sleep(20);
    expect(Object.values(srv.ws.items).filter((i) => i.type === "object").length).toBe(before + 1);
  });

  it("InsCustom: a custom instruction; no program and nothing selected → status 2 (FUN_10032c440)", async () => {
    const p = await c.itemCmd("Add_PROG", (w) => w.line("Custom").handle(0));
    c.send((w) => w.line("InsCustom").handle(p.handle).line("Glue").line("glue.py").line("").int(1));
    expect((await c.status()).code).toBe(0);
    const prog = Object.values(srv.ws.items).find((i) => i.handle === p.handle)!;
    const ins = itemById(prog.children.at(-1)!);
    expect([ins.name, ins.instruction?.kind, ins.params?.PathRunSim, ins.params?.Blocking]).toEqual(["Glue", "custom", "glue.py", "1"]);
    srv.ws.selection = [];
    c.send((w) => w.line("InsCustom").handle(0).line("X").line("").line("").int(0));
    expect(await c.status()).toEqual({ code: 2, msg: "No Program or Instruction selected" });
  });

  it("MakeProg of a non-program: 'invalid program' and status 1 (FUN_100328dd4)", async () => {
    c.send((w) => w.line("MakeProg").handle(0).line(""));
    expect(await c.r.line()).toBe("invalid program");
    expect((await c.status()).code).toBe(1);
  });

  it("S_Gen_Str: objects take Display strings; other names → status 2; frames → status 1 (FUN_10031f510, FUN_1004b1a48)", async () => {
    const shape = await c.itemCmd("AddShape", (w) => w.matrix(3, 3, [0, 0, 0, 100, 0, 0, 0, 100, 0]).handle(0));
    c.send((w) => w.line("S_Gen_Str").handle(shape.handle).line("Display").line("LINEW=4 pointsize=6 COLOR=#ff0000"));
    expect((await c.status()).code).toBe(0);
    const it = Object.values(srv.ws.items).find((i) => i.handle === shape.handle)!;
    expect(it.object?.display).toMatchObject({ lineWidth: 4, pointSize: 6, color: [1, 0, 0, 1], particle: null });
    c.send((w) => w.line("S_Gen_Str").handle(shape.handle).line("Colour").line("x"));
    expect(await c.status()).toEqual({ code: 2, msg: `Unknown property for ${it.name}` });
    const fr = await c.itemCmd("Add_FRAME", (w) => w.line("NoStr").handle(0));
    c.send((w) => w.line("S_Gen_Str").handle(fr.handle).line("Display").line("LINEW=2"));
    expect((await c.status()).code).toBe(1);
  });
});

describe("instruction JSON", () => {
  it("ObjectList set through JSON records each object's parent and pose (ParentList / PoseList, live conv04 probe)", async () => {
    const icmd = async (h: number, name: string, value: string) => {
      c.send((w) => w.line("ICMD").handle(h).line(name).line(value));
      const out = await c.r.line();
      expect((await c.status()).code).toBe(0);
      return out;
    };
    const fr = await c.itemCmd("Add_FRAME", (w) => w.line("Box Conveyor Frame").handle(0));
    const box = await c.itemCmd("AddShape", (w) => w.matrix(3, 3, [0, 0, 0, 100, 0, 0, 0, 100, 0]).handle(0));
    const boxId = Object.values(srv.ws.items).find((i) => i.handle === box.handle)!.id;
    const frId = Object.values(srv.ws.items).find((i) => i.handle === fr.handle)!.id;
    await ok("item.setParent", { item: boxId, parent: frId, keepAbsolute: false });
    await ok("item.setPose", { item: boxId, pose: [0, -1, 0, -350, 1, 0, 0, 875, 0, 0, 1, 715, 0, 0, 0, 1] });
    const p = await c.itemCmd("Add_PROG", (w) => w.line("NoMech").handle(0));
    expect(await icmd(p.handle, "Add", '{"Type": 7}')).toBe("OK");
    expect(await icmd(p.handle, "0", `{"Behavior": 7, "ObjectList": "${box.handle}", "AttachDistance": 100}`)).toBe("OK");
    const rec = JSON.parse(await icmd(p.handle, "0", ""));
    expect([rec.ObjectList, rec.ParentList, rec.PoseList]).toEqual([String(box.handle), String(fr.handle), "transl(-350,875,715)*rotz(90)"]);
  });
});

describe.skipIf(!HAS_UR5E)("legacy robot commands", () => {
  let robot = 0;
  let robotId = "";
  beforeAll(async () => {
    robot = (await c.itemCmd("Add", (w) => w.line(UR5E).handle(0))).handle;
    robotId = Object.values(srv.ws.items).find((i) => i.handle === robot)!.id;
  }, 60_000);

  it("S_Speed: speed and acceleration ×1000; a 6-axis robot keeps its joint speed (FUN_100334130)", async () => {
    const joint = itemById(robotId).robot!.speeds.joint;
    c.send((w) => w.line("S_Speed").int(250_000).int(1_200_000).handle(robot));
    expect((await c.status()).code).toBe(0);
    const s = itemById(robotId).robot!.speeds;
    expect([s.linear, s.linearAccel, s.joint]).toEqual([250, 1200, joint]);
  });

  it("S_Thetas2: in-limits flag; mode 2 out of limits does not move, mode 3 moves to the clamped joints (FUN_10032dc38)", async () => {
    c.send((w) => w.line("S_Thetas2").array([10, -80, 70, 0, 20, 0]).handle(robot).int(0));
    expect(await c.r.int()).toBe(1);
    expect((await c.status()).code).toBe(0);
    expect(itemById(robotId).robot!.joints.map((v) => Math.round(v))).toEqual([10, -80, 70, 0, 20, 0]);
    c.send((w) => w.line("S_Thetas2").array([10, -80, 70, 0, 20, 9999]).handle(robot).int(2));
    expect(await c.r.int()).toBe(0);
    await c.status();
    expect(Math.round(itemById(robotId).robot!.joints[5])).toBe(0);
    c.send((w) => w.line("S_Thetas2").array([10, -80, 70, 0, 20, 9999]).handle(robot).int(3));
    expect(await c.r.int()).toBe(0);
    await c.status();
    expect(Math.round(itemById(robotId).robot!.joints[5])).toBe(360);
  });

  it("Joints() of a moving robot reports the live joints, not the start joints (WP-Y leftover)", async () => {
    c.send((w) => w.line("S_Thetas").array([0, -90, 90, 0, 90, 0]).handle(robot));
    await c.status();
    srv.ws.simulationSpeed = 1;
     
    c.send((w) => w.line("MoveX").int(1).int(1).array([120, -90, 90, 0, 90, 0]).handle(0).handle(robot));
    expect((await c.status()).code).toBe(0);
    await sleep(150);
    c.send((w) => w.line("G_Thetas").handle(robot));
    const q = await c.r.array();
    await c.status();
    expect(q[0]).toBeGreaterThan(0.5);
    expect(q[0]).toBeLessThan(119.5);
    c.send((w) => w.line("Stop").handle(robot));
    await c.status();
  });

  it("G_RobotParamAll of an uncalibrated UR5e: the live reply bytes (nominal DHM rows, identity poses)", async () => {
    const probe = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/api-probe/wpx1/wpx1-probe-acc.json"), "utf8")) as { step: string; hex?: string }[];
    const want = Buffer.from(probe.find((s) => s.step === "G_RobotParamAll.ur5e")!.hex!, "hex");
    c.send((w) => w.line("G_RobotParamAll").handle(robot));
    const got = await c.r.take(want.length);
    expect(got.toString("hex")).toBe(want.toString("hex"));
  });

  it("S_AbsAccParam stores the set that G_RobotParamAll returns", async () => {
    const pose = [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const rows = Array.from({ length: 6 }, (_, j) => [j, 1, 2, 3, 4, 5, 6, 7]);
    c.send((w) => {
      w.line("S_AbsAccParam").handle(robot);
      for (let i = 0; i < 3; i++) w.pose(pose);
      w.int(6);
      rows.forEach((r) => w.array(r));
      w.pose(pose).pose(pose).int(6);
      rows.forEach((r) => w.array(r));
      w.array(new Array(10).fill(1)).array(new Array(6).fill(2));
    });
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("G_RobotParamAll").handle(robot));
    for (let i = 0; i < 3; i++) expect(await c.r.pose()).toEqual(pose);
    expect(await c.r.int()).toBe(6);
    for (const r of rows) expect(await c.r.array()).toEqual(r);
    await c.r.pose();
    await c.r.pose();
    expect(await c.r.int()).toBe(6);
    for (let i = 0; i < 6; i++) await c.r.array();
    expect(await c.r.array()).toEqual(new Array(10).fill(1));
    expect(await c.r.array()).toEqual(new Array(6).fill(2));
    expect((await c.status()).code).toBe(0);
  });

  it("RobotBin: the first robot's 4000-value header (FUN_100344f84)", async () => {
    c.send((w) => w.line("RobotBin"));
    const a = await c.r.array();
    expect((await c.status()).code).toBe(0);
    expect(a.length).toBe(4000);
    expect(a.slice(0, 4)).toEqual([1, 4000, 20, 200]);
  });
});

describe("calibration and measurement", () => {
  it("CalibTCP: fewer than 6 rows → empty replies and status 3 (FUN_10033f274)", async () => {
    c.send((w) => w.line("CalibTCP").matrix(3, 3, new Array(9).fill(0)).int(0).int(0));
    expect(await c.r.array()).toEqual([]);
    expect(await c.r.array()).toEqual([]);
    expect([await c.r.int(), await c.r.int()]).toEqual([0, 0]);
    expect(await c.status()).toEqual({ code: 3, msg: "Invalid parameters, a 6xN matrix of positions should be provided (N>=3)." });
  });

  it("CalibTCP by point finds the TCP of flange poses touching one point", async () => {
    const tcp = [10, -20, 150];
    const p = [500, 100, 300];
    const angles = [[0, 0, 0], [20, 0, 0], [0, 25, 0], [-15, 10, 30], [10, -20, -40]];
    const rows = angles.map(([a, b, cc]) => {
      const R = mulAll(rotx(a * DEG), roty(b * DEG), rotz(cc * DEG));
      const t = [0, 1, 2].map((i) => p[i] - (R[i * 4] * tcp[0] + R[i * 4 + 1] * tcp[1] + R[i * 4 + 2] * tcp[2]));
      return [...t, a, b, cc];
    });
    c.send((w) => w.line("CalibTCP").matrix(6, rows.length, rows.flat()).int(0).int(0));
    const out = await c.r.array();
    const stats = await c.r.array();
    const nr = await c.r.int();
    const nc = await c.r.int();
    await c.r.doubles(nr * nc);
    expect((await c.status()).code).toBe(0);
    expect(out.map((v) => Math.round(v * 1000) / 1000)).toEqual(tcp);
    expect(stats.length).toBe(3);
    expect([nr, nc]).toEqual([5, 2]);
  });

  it("CalibTCP on RoboDK's live input gives its TCP, stats and per-pose errors", async () => {
    const probe = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/api-probe/wpx1/wpx1-probe.json"), "utf8")) as { step: string; value: { reply: unknown[] } }[];
    const [wantTcp, wantStats, wantErr] = probe.find((s) => s.step === "CalibTCP.points")!.value.reply as [number[], number[], [number, number, number[]]];
    const rows = [[490, 120, 150, 0, 180, 0], [470, 120, 160, 20, 180, 0], [490, 140, 155, 0, 160, 10], [480, 110, 150, -15, 170, 30]];
    c.send((w) => w.line("CalibTCP").matrix(6, 4, rows.flat()).int(0).int(0));
    const tcp = await c.r.array();
    const stats = await c.r.array();
    const nr = await c.r.int();
    const nc = await c.r.int();
    const err = await c.r.doubles(nr * nc);
    expect((await c.status()).code).toBe(0);
    tcp.forEach((v, i) => expect(v).toBeCloseTo(wantTcp[i], 3));
    stats.forEach((v, i) => expect(v).toBeCloseTo(wantStats[i], 3));
    expect([nr, nc]).toEqual([wantErr[0], wantErr[1]]);
    err.forEach((v, i) => expect(v).toBeCloseTo(wantErr[2][i], 3));
  });

  it("MeasLT2 with no tracker: an empty array, status 0; MeasLT: status 2 (FUN_10033e61c, FUN_10033e834)", async () => {
    c.send((w) => w.line("MeasLT2").xyz([0, 0, 0]).int(0));
    expect(await c.r.array()).toEqual([]);
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("MeasLT").xyz([0, 0, 0]).int(1));
    expect(await c.r.doubles(3)).toEqual([0, 0, 0]);
    expect(await c.status()).toEqual({ code: 2, msg: "Laser tracker request could not be completed or timed out" });
  });

  it("MeasPose4 without tracking: identity, [-1 ×4], status 13 (live RoboDK reply)", async () => {
    c.send((w) => w.line("MeasPose4").array([0, 0]));
    const p = await c.r.pose();
    expect(p).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(await c.r.array()).toEqual([-1, -1, -1, -1]);
    expect(await c.status()).toEqual({ code: 13, msg: "Invalid license for tracking" });
  });

  it("S_Gen_Mat / S_ValueMat on items that are not calibration projects: status 1 (FUN_10031ce84, FUN_10031d5c4)", async () => {
    const fr = await c.itemCmd("Add_FRAME", (w) => w.line("NotCalib").handle(0));
    c.send((w) => w.line("S_Gen_Mat").handle(fr.handle).line("CALIB_TARGETS").matrix(1, 1, [0]));
    expect((await c.status()).code).toBe(1);
    c.send((w) => w.line("S_ValueMat").handle(fr.handle).line("CALIB_TARGETS").matrix(1, 1, [0]));
    expect([await c.r.int(), await c.r.int()]).toEqual([0, 0]);
    expect((await c.status()).code).toBe(1);
  });
});

describe("platform and licence", () => {
  it("G_License names Enginuity; S_License applies nothing (0)", async () => {
    c.send((w) => w.line("G_License"));
    expect(await c.r.line()).toBe("Enginuity");
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("S_License").line("License:ABC"));
    expect(await c.r.int()).toBe(0);
    expect((await c.status()).code).toBe(0);
  });

  it("FactorySettings restores the options and answers the version line (FUN_100346d30)", async () => {
    await ok("settings.set", { key: "ViewAngle", value: 45 }).catch(() => undefined);
    c.send((w) => w.line("FactorySettings"));
    const line = await c.r.line();
    expect((await c.status()).code).toBe(0);
    expect(line).toMatch(/^Enginuity v[\d.]+ \(64 bit\)\. Build: \d+\. Version release date: \d\d-\d\d-\d{4}$/);
    expect(Number(srv.services.settings.ViewAngle)).toBe(30);
  });

  it("BinSave: an empty name sends the station serialised; other formats answer status 2 (FUN_100325ca0, live)", async () => {
    c.send((w) => w.line("BinSave").line("").handle(0));
    expect((await c.r.bytes()).length).toBeGreaterThan(0);
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("BinSave").line("x.step").handle(0));
    expect(await c.status()).toEqual({ code: 2, msg: "Specifying format not supported. Provide a supported file name." });
  });

  it("FileSendBin of the station: int size + the bytes, status 0 (FUN_100345b40)", async () => {
    c.send((w) => w.line("FileSendBin").handle(0).line("station.rdk"));
    const bytes = await c.r.bytes();
    expect((await c.status()).code).toBe(0);
    expect(JSON.parse(bytes.toString("utf8"))).toBeTypeOf("object");
  });

  it("FileRecvBin: status 0, then the streamed bytes are saved (FUN_100345668)", async () => {
    const file = path.join(tmp, "recv", "part.txt");
    c.send((w) => w.line("FileRecvBin").line(file).int(5).handle(0).int(0));
    expect((await c.status()).code).toBe(0);
    c.sock.write(Buffer.from("hello"));
    for (let i = 0; i < 50 && !existsSync(file); i++) await sleep(20);
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("ExecArgs: status 0, then -ADDSTATION adds a station", async () => {
    const n = srv.ws.stations.length;
    c.send((w) => w.line("ExecArgs").int(1).line("-ADDSTATION"));
    expect((await c.status()).code).toBe(0);
    for (let i = 0; i < 50 && srv.ws.stations.length === n; i++) await sleep(20);
    expect(srv.ws.stations.length).toBe(n + 1);
  });

  it("S_WID answers status 0; Render answers status 0", async () => {
    c.send((w) => w.line("S_WID").handle(1234));
    expect((await c.status()).code).toBe(0);
    c.send((w) => w.line("Render").int(1));
    expect((await c.status()).code).toBe(0);
  });
});
