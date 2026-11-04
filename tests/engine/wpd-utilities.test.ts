 
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findAction } from "@/engine/actions";
import { fk, initKinematics, linkFrames, parseRobotFile } from "@/engine/kinematics";
import { mul, rotx, roty, rotz, transl, type Mat } from "@/engine/math";
import { applyCameraParams, defaultCameraSettings, formatCameraSettings, parseColor, pixelSizeFor } from "@/engine/utilities/camera";
import { frameFromPoints, rotationAngleDeg, tcpByPlane, tcpByPoint, turntableFrame } from "@/engine/utilities/calibration";
import { eulerToPose, poseToEuler } from "@/engine/utilities/euler";
import { isoCubePoints, ISO_SEQUENCE } from "@/engine/commands/iso";
import { buildMechanismModel, MECHANISM_TYPES, mechanismKinematics } from "@/engine/utilities/mechanism";
import { encodePng, pngInfo } from "@/engine/utilities/png";
import { encodeJpeg } from "@/engine/utilities/jpeg";
import { rasterize } from "@/engine/utilities/raster";
import { VR_MESSAGE } from "@/engine/utilities/hardware";
import { Tx } from "@/engine/tx";
import { makeItem } from "@/engine/workspace";
import { engine, ROOT } from "../helpers";

const probe = JSON.parse(readFileSync(path.join(ROOT, "research/evidence/utilities/robodk-utilities-probe.json"), "utf8"));
const mechProbe = JSON.parse(readFileSync(path.join(ROOT, "research/evidence/utilities/robodk-mechanism-probe-1.json"), "utf8"));
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
type Id = { id: string };
type Engine = Awaited<ReturnType<typeof engine>>;

 
function addMesh(e: Engine, name: string, tri: number[], pose: Mat): string {
  const geometry = e.services.geometry.put(new Float32Array(tri));
  const it = makeItem(e.ws, "object", name, { object: { meshes: [{ geometry, color: [1, 0, 0, 1] }] }, pose });
  new Tx(e.ws).add(it, e.ws.activeStation);
  return it.id;
}

beforeAll(async () => {
  await initKinematics();
});

describe("Euler formats (robolink EULER_*)", () => {
  const m = mul(transl(100, -50, 300), mul(rotz(0.4), mul(roty(-0.7), rotx(1.1))));
  it.each([0, 1, 2, 3, 4, 5, 6])("format %i round-trips a pose", (f) => {
    expect(maxDiff(eulerToPose(poseToEuler(m, f), f), m)).toBeLessThan(1e-9);
  });
  it("format 4 is Fanuc W,P,R (Rz·Ry·Rx) and 1 the KUKA order", () => {
    expect(maxDiff(eulerToPose([0, 0, 0, 10, 20, 30], 4), mul(rotz(0.5236), mul(roty(0.3491), rotx(0.1745))))).toBeLessThan(1e-4);
    expect(maxDiff(eulerToPose([0, 0, 0, 10, 20, 30], 1), mul(rotz(0.1745), mul(roty(0.3491), rotx(0.5236))))).toBeLessThan(1e-4);
  });
});

describe("TCP calibration by point (CalibTCP3, FUN_100709f60)", () => {
  const rows0: number[][] = probe["tcp.inputs.staubli"];
  const flanges = rows0.map((r) => eulerToPose(r, 0));
  it.each([0, 1, 2, 3, 4, 5])("format %i: same TCP, stats and errors as RoboDK", (f) => {
    const res = tcpByPoint(rows0.map((r) => eulerToPose(poseToEuler(eulerToPose(r, 0), f), f)));
    const ref = probe[`tcp.format${f}`];
    expect(maxDiff([...res.tcp, ...res.point], ref.tcp)).toBeLessThan(1e-9);
    expect(maxDiff(res.errors, ref.errors)).toBeLessThan(1e-9);
  });
  it("noisy measurements reproduce RoboDK to 1e-9 (sample standard deviation)", () => {
    const res = tcpByPoint(probe["tcp.noisy.inputs"].map((r: number[]) => eulerToPose(r, 0)));
    const ref = probe["tcp.noisy.point"];
    expect(maxDiff([...res.tcp, ...res.point], ref.tcp)).toBeLessThan(1e-9);
    expect(maxDiff(res.stats, ref.stats)).toBeLessThan(1e-9);
    expect(maxDiff(res.errors, ref.errors)).toBeLessThan(1e-9);
  });
  it("orientations closer than the minimum angle are skipped (close pair, 22° minimum)", () => {
    const close = tcpByPoint(probe["tcp.close.inputs"].map((r: number[]) => eulerToPose(r, 0)));
    expect(close.skipped).toBeGreaterThan(0);
    expect(maxDiff([...close.tcp, ...close.point], probe["tcp.close.point"].tcp)).toBeLessThan(1e-9);
    const min22 = tcpByPoint(flanges, 22);
    expect(maxDiff([...min22.tcp, ...min22.point], probe["tcp.minangle10"].tcp)).toBeLessThan(1e-9);
  });
  it("three poses work, fewer than three valid pairs fail", () => {
    expect(maxDiff(tcpByPoint(flanges.slice(0, 3)).tcp, probe["tcp.n3"].tcp.slice(0, 3))).toBeLessThan(1e-9);
    const near = [0, 1, 0, 0].map((_, i) => mul(transl(600, 50, 400), i === 0 ? rotx(0) : i === 1 ? rotx(0.0175) : i === 2 ? roty(0.0175) : rotz(0.0175)));
    expect(tcpByPoint(near).ok).toBe(false);
  });
  it("joints use the flange FK of the robot (ABB IRB 120)", async () => {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    const res = await e.run("calib.tool", { rows: probe["tcp.joints.inputs"], input: "joints", robot: robot.id });
    expect(maxDiff([...(res.tcp as number[]), ...(res.stationaryPoint as number[])], probe["tcp.joints"].tcp)).toBeLessThan(1e-6);
    expect(String(res.message)).toMatch(/^Calibrated TCP \[X,Y,Z\] = \[12\.000, -25\.000, 140\.000\] mm\. Stationary point = /);
    expect(String(res.errorsText)).toMatch(/^Errors : \[mean, std, max\]=\[0\.000, 0\.000, 0\.000\] mm$/);
    const bad = await e.tryRun("calib.tool", { rows: [...probe["tcp.joints.inputs"], [0, 0, 0, 0, 999, 0]], input: "joints", robot: robot.id });
    expect(bad.error).toBe("Joints at position 7 are not valid.");
  });
  it("by plane recovers a TCP from poses touching a plane", () => {
    const t = [10, -20, 150];
    const poses = [
      [0, 0, 0],
      [0.3, 0, 0],
      [0, 0.3, 0],
      [-0.2, 0.25, 0.5],
      [0.25, -0.3, -0.6],
      [0.1, 0.1, 1.2],
    ].map(([a, b, c], k) => {
      const R = mul(rotx(Math.PI), mul(rotz(c), mul(roty(b), rotx(a))));
      const tip = mul(R, transl(t[0], t[1], t[2]));
      return mul(transl(400 + 30 * k - tip[3], 20 * k - tip[7], 100 - tip[11]), R);
    });
    const res = tcpByPlane(poses, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 100, 0, 0, 0, 1]);
    expect(res.ok).toBe(true);
    expect(maxDiff(res.tcp, t)).toBeLessThan(1e-6);
  });
  it("tool calibration applies the XYZ only, with the TCP undo text", async () => {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    const tool = (await e.run("robot.addTool", { robot: robot.id, name: "Probe", xyzrpw: [1, 2, 3, 0, 0, 90] })) as unknown as Id;
    await e.run("calib.tool", { rows: probe["tcp.joints.inputs"], input: "joints", robot: robot.id, tool: tool.id, apply: true }, "ui");
    const p = e.ws.items[tool.id].pose;
    expect(maxDiff([p[3], p[7], p[11]], [12, -25, 140])).toBeLessThan(1e-6);
    expect(Math.abs(p[1] + 1)).toBeLessThan(1e-9);  
    expect(e.undo.list()).toEqual(expect.objectContaining({ undo: expect.arrayContaining(["Move TCP: Probe"]) }));
  });
});

describe("Reference frame calibration (CalibFrame, FUN_1007093b8)", () => {
  it.each(["m0", "m1", "m0_offaxis", "m0_extra", "m2"])("%s matches RoboDK", (k) => {
    const method = k.startsWith("m0") ? 0 : k === "m1" ? 1 : 2;
    const r = frameFromPoints(probe[`frame.${k}.inputs`], method);
    expect(r.ok).toBe(true);
    expect(maxDiff(r.pose, probe[`frame.${k}`].pose)).toBeLessThan(1e-6);
  });
  it("degenerate 3-point input: identity without error for p1 = origin, failure for p1 on X", () => {
    for (const k of ["collinear", "close"]) {
      const r = frameFromPoints(probe[`frame.${k}.inputs`], 1);
      expect(r.ok).toBe(true);
      expect(r.degenerate).toBe(true);
      expect(r.pose).toEqual(probe[`frame.${k}`].pose);
      expect(frameFromPoints(probe[`frame.${k}.inputs`], 0).ok).toBe(false);
    }
    expect(frameFromPoints(probe["frame.m2_five.inputs"], 2).ok).toBe(false);
  });
  it("1-axis turntable: geometric circle fit, RoboDK's six statistics", () => {
    const r = turntableFrame(probe["frame.turntable.inputs"]);
    expect(maxDiff(r.pose, probe["frame.turntable"].pose)).toBeLessThan(1e-6);
    expect(maxDiff(r.stats, probe["frame.turntable"].stats)).toBeLessThan(1e-9);
  });
  it("2-axis turntable: split, axes and the 21 statistics", () => {
    const r = frameFromPoints(probe["frame.turntable2.inputs"], 4);
    expect(maxDiff(r.pose, probe["frame.turntable2"].pose)).toBeLessThan(1e-6);
    expect(maxDiff(r.stats.slice(0, 20), probe["frame.turntable2"].stats.slice(0, 20))).toBeLessThan(1e-8);
  });
  it("2-axis turntable with perpendicular axes: common perpendicular, 21 statistics", () => {
    const conn = JSON.parse(readFileSync(path.join(ROOT, "research/evidence/utilities/robodk-conn-tt2-probe.json"), "utf8"));
    const r = frameFromPoints(conn["tt2.perp.inputs"], 4);
    expect(maxDiff(r.pose, conn["tt2.perp"].pose)).toBeLessThan(1e-6);
    expect(maxDiff(r.stats, conn["tt2.perp"].stats)).toBeLessThan(1e-6);
  });
  it("frame command: message, Points are too close, apply relative to the parent", async () => {
    const e = await engine();
    const parent = (await e.run("item.addFrame", { name: "Parent" })) as unknown as Id;
    await e.run("item.setPose", { item: parent.id, pose: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    const f = (await e.run("item.addFrame", { name: "Measured", parent: parent.id })) as unknown as Id;
    const res = await e.run("calib.frame", { rows: probe["frame.m1.inputs"], method: "p1-origin", frame: f.id, apply: true });
    expect(String(res.message)).toMatch(/^Calibrated frame \[X,Y,Z\] = \[300\.000, -150\.000, 50\.000\] mm ; \[W,P,R\] = \[/);
    const abs = mul(transl(100, 0, 0), e.ws.items[f.id].pose);
    expect(maxDiff(abs, probe["frame.m1"].pose)).toBeLessThan(1e-6);
    const bad = await e.tryRun("calib.frame", { rows: probe["frame.collinear.inputs"], method: "p1-origin" });
    expect(bad.error).toBe("Cannot calculate frame with current input. Points are too close.");
  });
  it("rotation angle helper", () => {
    expect(rotationAngleDeg(rotz(Math.PI / 6))).toBeCloseTo(30, 9);
    expect(rotationAngleDeg(rotx(Math.PI))).toBeCloseTo(180, 9);
  });
});

describe("Model Mechanism or Robot (BuildMechanism, FUN_1007395cc)", () => {
  it("lists the 23 types in RoboDK's order", () => {
    expect(MECHANISM_TYPES).toHaveLength(23);
    expect(MECHANISM_TYPES[0]).toEqual({ code: 1, label: "1 rotative axis" });
    expect(MECHANISM_TYPES.at(-1)).toEqual({ code: 24, label: "7 axes generic" });
  });
  const PARAMS: Record<number, number[]> = { 1: [], 2: [90, 100], 3: [], 4: [], 5: [10, 20, 30, 40], 6: [10, 20, 30, 40, 50, 60], 7: [330, 50, 0, 330, 35, 335, 80, 0, -90, 0, 0, 0, 0], 8: [340, 400, 400, 126, 0, 0, 0, 0, 0, 0, 0], 9: [250, 200, 50], 11: [162.5, 425, 392.2, 133.3, 99.7, 99.6, 0, 0, 0, 0, 0, 0] };
  it.each(Object.keys(PARAMS).map(Number))("type %i: DH, joint map and FK match the robot RoboDK built", (t) => {
    const n = mechanismKinematics(t, PARAMS[t]).nq;
    const senses = t === 7 ? [1, 1, -1, -1, -1, -1, -1] : t === 2 ? [1, -1] : new Array(n).fill(1);
    const { model } = buildMechanismModel({ type: t, params: PARAMS[t], senses, lower: Array.from({ length: n }, (_, k) => -170 - k), upper: Array.from({ length: n }, (_, k) => 170 + k) });
    const saved = parseRobotFile(new Uint8Array(readFileSync(path.join(ROOT, `research/evidence/utilities/mech/mech-${t}.robot`))));
    const j = saved.json as { dh: { alpha: number; a: number; theta: number; d: number; kind: number }[]; mech: number };
    expect(model.joints.map((r) => [r.alpha, r.a, r.theta, r.d, r.kind === "linear" ? 1 : 0])).toEqual(j.dh.map((r) => [r.alpha, r.a, r.theta, r.d, r.kind]).map((r) => r.map((v) => expect.closeTo(v, 9))));
    expect(model.mech).toBe(j.mech);
    const ref = mechProbe[`mech.${t}`];
    expect(maxDiff(fk(model, ref.fk_q), ref.fk)).toBeLessThan(1e-6);
    expect(maxDiff(model.userLower, ref.limits[0])).toBe(0);
  });
   
  const PARAMS2: Record<number, number[]> = {
    13: [100, 200, 300, 10, 20, 30, 40, 0],
    14: [250, 200, 300],
    15: [100, 200, 300, 10, 20],
    16: [],
    17: [250, 200, 300],
    19: [100, 200, 300, 10, 20, 30, 5, 6, 7, 8, 9, 10],
    20: [10, 20, 30, 40, 50, 60, 70, 0, 1, 0],
    21: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 0, 0, 1, 0],
    22: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 0, 0, 0, 1, 0, 0],
    23: [300, -90, 50, 0, 10, 0, 300, 0, 0, -90, 30, 0, 300, 90, 0, 0, 0, -90, 0, 0, 80],
    24: [340, -90, 0, 0, 0, 90, 0, 0, 400, -90, 0, 0, 0, 90, 0, 0, 400, -90, 0, 0, 0, 90, 0, 0, 126],
    25: [300, -90, 50, 0, 10, 0, 300, 0, 0, -90, 30, 0, 300, 90, 0, 0, 0, -90, 0, 0, 80],
     
    10: [0.5],
    12: [100, 10, 20],
  };
  const mech2 = Object.assign(
    {},
    ...[2, 3, 4, 5].map((k) => JSON.parse(readFileSync(path.join(ROOT, `research/evidence/utilities/robodk-mechanism-probe-${k}.json`), "utf8"))),
  );
  it.each(Object.keys(PARAMS2).map(Number))("type %i: DH table, mechanism code and joint map match RoboDK's saved robot", (t) => {
    const n = mechanismKinematics(t, PARAMS2[t]).nq;
    const { model } = buildMechanismModel({ type: t, params: PARAMS2[t], senses: new Array(n).fill(1), lower: Array.from({ length: n }, (_, k) => -170 - k), upper: Array.from({ length: n }, (_, k) => 170 + k) });
    const saved = parseRobotFile(new Uint8Array(readFileSync(path.join(ROOT, `research/evidence/utilities/mech/mech-${t}.robot`))));
    const j = saved.json as { dh: { alpha: number; a: number; theta: number; d: number; kind: number }[]; mech: number; map: number[] };
    expect(model.joints.map((r) => [r.alpha, r.a, r.theta, r.d, r.kind === "linear" ? 1 : 0])).toEqual(j.dh.map((r) => [r.alpha, r.a, r.theta, r.d, r.kind]).map((r) => r.map((v) => expect.closeTo(v, 9))));
    expect([model.mech, model.map]).toEqual([j.mech, j.map]);
    expect(model.userLower).toEqual(mech2[`mech.${t}`].limits[0]);
     
    expect(maxDiff(fk(model, mech2[`mech.${t}`].fk_q), mech2[`mech.${t}`].fk)).toBeLessThan(1e-6);
  });
  it("builds a robot from objects: base frame at the first object + 1000 mm in Y, joints at home", async () => {
    const e = await engine();
    const tri = [0, 0, 0, 40, 0, 0, 0, 40, 0];
    const objs: string[] = [];
    for (let i = 0; i < 3; i++) objs.push(addMesh(e, `Part ${i}`, tri, mul(transl(2000, 100 * i, 50 * i), rotz((10 * i * Math.PI) / 180))));
    const res = await e.run("mechanism.build", { type: 2, name: "Built2", objects: objs, params: [90, 100], build: [10, 20], home: [5, 10], senses: [1, -1], lower: [-170, -171], upper: [170, 171] });
    const robot = e.ws.items[String(res.id)];
    const base = e.ws.items[robot.parent!];
    expect(base.name).toBe("Built2 Base");
    expect(base.pose).toEqual(mechProbe["mech.2"].parent_pose);
    expect(robot.robot!.joints).toEqual([5, 10]);
     
    const frames = linkFrames(robot.robot!.model, [10, 20]);
    const g = e.services.geometry.get(robot.robot!.links[2][0].geometry)!;
    const world = mul(mul(transl(2000, 0, 0), frames[2]), transl(g[3], g[4], g[5]));
    const obj2 = mul(mul(transl(2000, 200, 100), rotz((20 * Math.PI) / 180)), transl(40, 0, 0));
    expect(maxDiff([world[3], world[7], world[11]], [obj2[3], obj2[7], obj2[11]])).toBeLessThan(1e-4);
  });
});

describe("Simulated 2D camera (Cam2D_*)", () => {
  it("defaults: focal 5 mm, FOV = view angle, far = focal + 2000, pixel size", () => {
    const s = defaultCameraSettings(30);
    expect([s.focal, s.fov, s.far]).toEqual([5, 30, 2005]);
    expect(s.pixelSize).toBeCloseTo((5000 * Math.tan(Math.PI / 12)) / 540, 12);
    expect(defaultCameraSettings(0).fov).toBeCloseTo((2 * Math.atan(2.7 / 5) * 180) / Math.PI, 12);
  });
  it("parameter grammar: sizes, colours, flags, misspellings and the read-back string", () => {
    const s = applyCameraParams(defaultCameraSettings(), "FOCAL_LENGHT=6 FOV=32 FAR_LENGTH=1000 SIZE=640x480 BG_COLOR=black LIGHT_AMBIENT=red LIGHT_DIFFUSE=#FF00FF00 GRAYSCALE ORTHO WINDOWFIXED");
    expect([s.focal, s.fov, s.far, s.width, s.height, s.gray, s.ortho, s.windowFixed]).toEqual([6, 32, 1000, 640, 480, true, true, true]);
    expect(s.bg).toEqual([0, 0, 0, 1]);
    expect(s.diffuse).toEqual([0, 1, 0, 1]);
    expect(s.pixelSize).toBeCloseTo(pixelSizeFor(32, 6), 12);
    expect(formatCameraSettings(s)).toMatch(/^FOV=32 PixelSize=[\d.]+ Size=640x480 ActualSize=640x480 Snapshot=640x480 FOCAL_LENGTH=6 FAR_LENGTH=1000 BG_COLOR=#ff000000 GRAYSCALE Ortho WindowFixed$/);
    expect(parseColor("#80ff0000")).toEqual([1, 0, 0, 128 / 255]);
  });
  it("renders a square with the pinhole projection (vertical FOV, Y down)", () => {
     
    const cam = mul(transl(0, 0, 1000), rotx(Math.PI));
    const sq = new Float32Array([0, -100, 0, 200, -100, 0, 200, 100, 0, 0, -100, 0, 200, 100, 0, 0, 100, 0]);
    const img = rasterize([{ triangles: sq, pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color: [1, 0, 0, 1] }], { pose: cam, fov: 30, near: 5, far: 2005, width: 400, height: 300 }, { bg: [1, 1, 1, 1], ambient: [0.4, 0.4, 0.4, 1], diffuse: [0.6, 0.6, 0.6, 1], specular: [0, 0, 0, 1] });
    const f = 150 / Math.tan(Math.PI / 12);
    let minX = 1e9;
    let maxX = -1;
    let minY = 1e9;
    let maxY = -1;
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 400; x++)
        if (img.rgba[(y * 400 + x) * 4 + 1] < 200) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
     
    expect(minX).toBe(200);
    expect(Math.abs(maxX + 1 - (200 + (f * 200) / 1000))).toBeLessThanOrEqual(1);
    expect(Math.abs(minY - (150 - (f * 100) / 1000))).toBeLessThanOrEqual(1);
    expect(Math.abs(maxY + 1 - (150 + (f * 100) / 1000))).toBeLessThanOrEqual(1);
    expect(img.depth[150 * 400 + 250]).toBeCloseTo(1000, 6);
  });
  it("camera items, snapshots and RoboDK's location message", async () => {
    const e = await engine();
    const none = await e.tryRun("camera.add", {});
    expect(none.error).toBe("Use a reference frame, object or tool to establish the position of the camera");
    const frame = (await e.run("item.addFrame", { name: "CamFrame" })) as unknown as Id;
    await e.run("item.setPose", { item: frame.id, pose: mul(transl(0, 0, 1000), rotx(Math.PI)) });
    addMesh(e, "Square", [0, -100, 0, 200, -100, 0, 200, 100, 0, 0, -100, 0, 200, 100, 0, 0, 100, 0], transl(0, 0, 0));
    const c1 = await e.run("camera.add", { attachTo: frame.id, params: "SIZE=320x240" });
    const c2 = await e.run("camera.add", { attachTo: frame.id, params: "Closed" });
    expect([c1.camera, c2.camera]).toEqual(["Camera 1", "Camera 2"]);
    expect(e.ws.items[String(c1.id)].type).toBe("camera");
    expect([e.ws.items[String(c1.id)].camera!.open, e.ws.items[String(c2.id)].camera!.open]).toEqual([true, false]);
    for (const kind of ["color", "gray", "depth"] as const) {
      const shot = await e.run("camera.snapshot", { camera: c1.id, kind });
      const png = Uint8Array.from(Buffer.from(String(shot.png), "base64"));
      expect(pngInfo(png)).toEqual({ width: 320, height: 240, bitDepth: kind === "depth" ? 16 : 8, colorType: kind === "color" ? 2 : 0 });
    }
    const agent = await e.run("camera.snapshot", { camera: c1.id }, "agent");
    expect(agent.png).toBeUndefined();
    await e.run("camera.window", { open: false });
    expect(e.ws.items[String(c1.id)].camera!.open).toBe(false);
  });
  it("JPEG snapshot files: baseline, quality 100 (all-one quantisers), 4:4:4", () => {
    const rgb = new Uint8Array(20 * 12 * 3).map((_, i) => (i * 7) % 256);
    const jpg = encodeJpeg(20, 12, rgb);
    expect([jpg[0], jpg[1], jpg.at(-2), jpg.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    const sof = jpg.findIndex((v, i) => v === 0xff && jpg[i + 1] === 0xc0);
    expect([(jpg[sof + 5] << 8) | jpg[sof + 6], (jpg[sof + 7] << 8) | jpg[sof + 8], jpg[sof + 9]]).toEqual([12, 20, 3]);
    const dqt = jpg.findIndex((v, i) => v === 0xff && jpg[i + 1] === 0xdb);
    expect([...jpg.subarray(dqt + 5, dqt + 69)].every((q) => q === 1)).toBe(true);
  });
  it("PNG encoder writes a valid stream (stored blocks without a platform deflate)", () => {
    const png = encodePng({ width: 2, height: 2, channels: 3, data: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255] });
    expect(pngInfo(png)).toEqual({ width: 2, height: 2, bitDepth: 8, colorType: 2 });
  });
});

describe("ISO 9283 cube (DialogISOcube, FUN_100807b5c)", () => {
  it("11 points on the diagonal test plane, rotated per plane A–D", () => {
    const p = isoCubePoints([500, 0, 400], 200, "C");
    expect(p[0]).toEqual([500, 0, 400]);
    expect(p[1]).toEqual([400, -100, 500]);
    expect(p[3]).toEqual([600, 100, 300]);
    expect(p[8]).toEqual([500, 100, 400]);
    expect(p[9].map((v) => +v.toFixed(6))).toEqual([570.710678, 0, 329.289322]);
    const a = isoCubePoints([0, 0, 0], 200, "A");
    expect(a[1].map((v) => Math.round(v))).toEqual([100, 100, 100]);
  });
  it("creates the ISO9283 program: Set Tool, moves through P1…P10 and the side/centre comment", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const res = await e.run("iso.cube", { center: [374, 0, 630], side: 100, refJoints: [0, 0, 0, 0, 30, 0] });
    const prog = e.ws.items[String(res.id)];
    expect(prog.name).toBe("ISO9283");
    const ins = prog.children.map((c) => e.ws.items[c].instruction!);
    expect(ins).toHaveLength(1 + ISO_SEQUENCE.length + 1);
    expect(ins[0].kind).toBe("tool");
    expect(ins[1]).toEqual(expect.objectContaining({ kind: "code", codeType: 3, text: "Side 100.0. Center 374.0,0.0,630.0." }));
    expect(ins.filter((i) => i.kind === "movec")).toHaveLength(2);
    const far = await e.tryRun("iso.cube", { center: [5000, 0, 0], side: 100 });
    expect(far.error).toBe("Invalid parameters. Can't create ISO 9283 cube.<br>Change the cube center or side.");
  });
});

describe("Hardware features, VR and action bindings", () => {
  it("Connect VR shows RoboDK's message; VR View doubles the view angle", async () => {
    const e = await engine();
    expect((await e.run("vr.connect")).message).toBe(VR_MESSAGE);
    const on = await e.run("view.vrView", {});
    expect(on).toEqual({ vr: true, viewAngle: 60 });
    expect((await e.run("view.vrView", {})).vr).toBe(false);
  });
  it("robot connection: parameters kept, no driver answers, disconnect", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    await e.run("robot.setConnection", { robot: r.id, ip: "127.0.0.1", port: 1 });
    const c = await e.run("robot.connect", { robot: r.id });
    expect(c.connected).toBe(false);
    const st = await e.run("robot.connectionState", { robot: r.id });
    expect([st.ip, st.port, st.state]).toEqual(["127.0.0.1", 1, c.state]);
    expect((await e.run("robot.disconnect", { robot: r.id })).message).toBe("Robot disconnected");
  });
  it("Utilities and Connect actions are bound", () => {
    for (const name of ["actionCalibrate_tool", "actionCalibrate_frame", "actionAdd_Mechanism_or_Robot", "actionISO_9283_targets_and_path", "action-ConnectRobot", "actionSimulate_2D_Camera", "actionVR_View"]) expect(findAction(name)?.ui).toBe(true);
    expect(findAction("actionConnect_HTC_Vive_VR")?.command).toBe("vr.connect");
    expect(findAction("actionBallbar_Validation")).toEqual(expect.objectContaining({ command: "utilities.hardware", params: { feature: "ballbar" } }));
  });
});
