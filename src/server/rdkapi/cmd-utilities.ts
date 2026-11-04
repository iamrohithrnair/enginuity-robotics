 
 
 
 
 
 
 
 
 

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fk, withinLimits } from "@/engine/kinematics";
import { mul, type Mat } from "@/engine/math";
import type { Item } from "@/engine/types";
import { CALIB_MSG, frameFromPoints, tcpByPlane, tcpByPoint } from "@/engine/utilities/calibration";
import { eulerToPose, JOINT_FORMAT } from "@/engine/utilities/euler";
import type { Vec3 } from "@/engine/utilities/linalg";
import { CAMERA_MSG, snapshotKind } from "@/engine/utilities/camera";
import { connectionOf } from "@/engine/utilities/hardware";
import { encodeJpeg } from "@/engine/utilities/jpeg";
import { cameraSettings, imageRgb, renderCameraPng } from "@/engine/commands/camera";
import { toolPose } from "@/engine/workspace";
import { DATA_DIR, getServer } from "@/server/store";
import { ApiError, byHandle, cmd, need, ws } from "./bridge";
import type { WireWriter } from "./codec";
import { def } from "./context";
import { writeItem } from "./cmd-items";

 
const columns = (m: { rows: number; cols: number; data: number[] }) => Array.from({ length: m.cols }, (_, j) => m.data.slice(j * m.rows, j * m.rows + m.rows));

const robotOf = (h: number): Item | undefined => {
  const it = byHandle(h);
  return it?.type === "robot" && it.robot ? it : undefined;
};

 

def("CalibTCP3", "AAMS", async (c) => {
  const m = await c.r.matrix();
  const format = await c.r.int();
  const algorithm = await c.r.array();
  const hRobot = await c.r.handle();
  await c.r.handle();  
  await c.exec(() => {
    const empty = (w: WireWriter) => w.array([]).array([]).matrix(0, 0, []);
    const fail = (status: number, msg: string) => new ApiError(status, msg, empty);
    const cols = columns(m);
    if (cols.length < 3) throw fail(12, CALIB_MSG.tcpApiSize);
    const method = algorithm[0] ?? 0;
    let flanges: Mat[];
    if (format === JOINT_FORMAT) {
      const robot = robotOf(hRobot);
      if (!robot) throw fail(3, CALIB_MSG.robotForJoints);
      const model = robot.robot!.model;
      flanges = cols.map((q, i) => {
        const joints = q.slice(0, model.nq);
        if (!withinLimits(model, joints)) throw fail(3, CALIB_MSG.outsideLimits(i + 1));
        return fk(model, joints);
      });
    } else {
       
      if (format < 0 || format > 5) throw fail(12, CALIB_MSG.tcpApiFail);
      flanges = cols.map((r) => eulerToPose(r, format));
    }
    if (method === 0) {
      const minAngle = algorithm.length > 1 && algorithm[1] > 0 ? algorithm[1] : 5;
      const res = tcpByPoint(flanges, minAngle);
      if (!res.ok) throw fail(12, CALIB_MSG.tcpApiFail);
      c.w.array([...res.tcp, ...res.point]).array(res.stats).matrix(res.errors.length, 2, [...res.errors.map((_, i) => i + 1), ...res.errors]);
      return;
    }
    if (method === 1 || method === 4) {
      const res = tcpByPlane(flanges, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], { scara: method === 4 });
      if (!res.ok) throw fail(12, CALIB_MSG.tcpApiFail);
      const [ax, ay] = res.planeAngles ?? [0, 0];
      c.w.array([...res.tcp, res.point[0], ax, ay, 0, 0]).array([...res.stats, 0, 0]).matrix(res.errors.length, 2, [...res.errors.map((_, i) => i + 1), ...res.errors]);
      return;
    }
     
    c.w.array([0, 0, 0]).array([-1, -1, -1]).matrix(0, 0, []);
  });
});

 

def("CalibFrame", "HAS", async (c) => {
  const m = await c.r.matrix();
  const useJoints = await c.r.int();
  const method = await c.r.int();
  const hRobot = await c.r.handle();
  await c.exec(() => {
    const fail = (msg: string) => new ApiError(3, msg, (w) => w.pose([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).array([]));
    const cols = columns(m);
    if (cols.length < 3) throw fail(CALIB_MSG.tcpApiSize);
    let points: Vec3[];
    if (useJoints === -1) {
      const robot = robotOf(hRobot);
      if (!robot) throw fail(CALIB_MSG.robotForJoints);
      const model = robot.robot!.model;
      const tcp = toolPose(ws(), robot.id);
      points = cols.map((q, i) => {
        const joints = q.slice(0, model.nq);
        if (!withinLimits(model, joints)) throw fail(CALIB_MSG.outsideLimits(i + 1));
        const p = mul(fk(model, joints), tcp);
        return [p[3], p[7], p[11]];
      });
    } else {
      if (m.rows < 3) throw fail(CALIB_MSG.framePoints);
      points = cols.map((r) => [r[0], r[1], r[2]]);
    }
    const res = frameFromPoints(points, method);
    if (!res.ok) throw fail(CALIB_MSG.frameApiFail);
    c.w.pose(res.pose).array(res.stats);
  });
});

 

def("BuildMechanism", "TS", async (c) => {
  const hRobot = await c.r.handle();
  const name = await c.r.line();
  const type = await c.r.int();
  const ndofs = await c.r.int();
  const objects: number[] = [];
  for (let i = 0; i < ndofs + 1; i++) objects.push(await c.r.handle());
  const base = await c.r.pose();
  const tool = await c.r.pose();
  const params = await c.r.array();
  const joints = await c.r.matrix();
  await c.exec(async () => {
    const fail = (msg: string) => new ApiError(-1, msg, (w) => w.nullItem());
    if (ndofs < 1 || joints.rows < ndofs || joints.cols < 5) throw fail("Invalid joints");
    const col = (j: number) => joints.data.slice(j * joints.rows, j * joints.rows + joints.rows);
    const [build, home, senses, lower, upper] = [0, 1, 2, 3, 4].map(col);
    const res = await cmd<{ id: string }>("mechanism.build", {
      type,
      name: name || "New robot",
      objects: objects.map((h) => (h ? (byHandle(h)?.id ?? null) : null)),
      params,
      build: build.slice(0, ndofs),
      home: home.slice(0, ndofs),
      senses: senses.slice(0, ndofs === 6 ? 7 : ndofs),
      lower: lower.slice(0, ndofs),
      upper: upper.slice(0, ndofs),
      base,
      tool,
      ...(hRobot && robotOf(hRobot) ? { replace: robotOf(hRobot)!.id } : {}),
    }).catch((e: ApiError) => {
      throw fail(e.message);
    });
    writeItem(c.w, ws().items[res.id]);
  });
});

 

 
function camera(h: number): Item {
  const it = need(h, (w) => w.int(0));
  if (it.type !== "camera") throw new ApiError(1, "", (w) => w.int(0));
  return it;
}

async function addCamera(hObject: number, hCamera: number, params: string): Promise<Item> {
  const res = await cmd<{ id: string }>("camera.add", {
    params,
    ...(hCamera ? { camera: need(hCamera, (w) => w.nullItem()).id } : {}),
    ...(hObject ? { attachTo: need(hObject, (w) => w.nullItem()).id } : {}),
  }).catch((e: ApiError) => {
    throw new ApiError(3, e.message === CAMERA_MSG.needLocation ? CAMERA_MSG.selectLocation : e.message, (w) => w.nullItem());
  });
  return ws().items[res.id];
}

def("Cam2D_PtrAdd", "TS", async (c) => {
  const hObject = await c.r.handle();
  const hCamera = await c.r.handle();
  const params = await c.r.line();
  await c.exec(async () => writeItem(c.w, await addCamera(hObject, hCamera, params)));
});

def("Cam2D_Add", "PS", async (c) => {
  const hObject = await c.r.handle();
  const params = await c.r.line();
  await c.exec(async () => {
    c.w.handle((await addCamera(hObject, 0, params)).handle);
  });
});





function writeImage(file: string, png: Uint8Array, width: number, height: number, rgb: () => Uint8Array) {
  const out = path.isAbsolute(file) ? file : path.join(DATA_DIR, "screenshots", file);
  mkdirSync(path.dirname(out), { recursive: true });
  if (/\.jpe?g$/i.test(out)) writeFileSync(out, encodeJpeg(width, height, rgb()));
  else writeFileSync(out, /\.bmp$/i.test(out) ? bmp(width, height, rgb()) : png);
}

 
function bmp(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = (width * 3 + 3) & ~3;
  const b = Buffer.alloc(54 + stride * height);
  b.write("BM", 0);
  b.writeUInt32LE(b.length, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      b[row + x * 3] = rgb[i + 2];
      b[row + x * 3 + 1] = rgb[i + 1];
      b[row + x * 3 + 2] = rgb[i];
    }
  }
  return b;
}

 
async function viewSnapshot(file: string): Promise<Uint8Array> {
  const view = getServer().services.view;
  if (!view || !view.clients()) throw new ApiError(3, "No 3D view is open: open Enginuity in a browser to take screenshots");
  const shot = await view.screenshot({ file: file || `api_snapshot_${Date.now()}.png`, white: false });
  return new Uint8Array(readFileSync(shot.path));
}

async function snapshot(cam: Item | undefined, file: string, params: string): Promise<Uint8Array> {
  if (!cam) return viewSnapshot(file);
  const s = getServer().services;
  const shot = await renderCameraPng(ws(), s, cam, { kind: snapshotKind(params, cameraSettings(s, cam)) });
  if (file) writeImage(file, shot.png, shot.width, shot.height, () => imageRgb(shot.img));
  return shot.png;
}

def("Cam2D_PtrSnapshot", "S", async (c) => {
  const h = await c.r.handle();
  const file = await c.r.line();
  const params = await c.r.line();
  await c.exec(async () => {
    const cam = h ? camera(h) : undefined;
    const png = await snapshot(cam, file, params);
    if (file) c.w.int(1);
    else c.w.bytes(png);
  });
});

def("Cam2D_Snapshot", "IS", async (c) => {
  const h = await c.r.handle();
  const file = await c.r.line();
  await c.exec(async () => {
    await snapshot(h ? camera(h) : undefined, file, "");
    c.w.int(1);
  });
});

async function setParams(h: number, params: string) {
  const cam = camera(h);
  await cmd("camera.setParams", { camera: cam.id, params });
}

def("Cam2D_SetParams", "IS", async (c) => {
  const h = await c.r.handle();
  const params = await c.r.line();
  await c.exec(async () => {
    await setParams(h, params);
    c.w.int(1);
  });
});

def("Cam2D_PtrSetParams", "IS", async (c) => {
  const h = await c.r.handle();
  const params = await c.r.line();
  await c.exec(async () => {
    await setParams(h, params);
    c.w.int(1);
  });
});

async function closeCamera(h: number) {
  await cmd("camera.window", { camera: camera(h).id, open: false });
}

def("Cam2D_Close", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    await closeCamera(h);
    c.w.int(1);
  });
});

def("Cam2D_PtrClose", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    await closeCamera(h);
    c.w.int(1);
  });
});

def("Cam2D_CloseAll", "IS", async (c) => {
  await c.exec(async () => {
    await cmd("camera.window", { open: false });
    c.w.int(1);
  });
});

 

const needRobot = (h: number, placeholder: Parameters<typeof need>[1]) => {
  const it = need(h, placeholder);
  if (it.type !== "robot" || !it.robot) throw new ApiError(1, "", placeholder);
  return it;
};

def("setConnectParams", "S", async (c) => {
  const h = await c.r.handle();
  const ip = await c.r.line();
  const port = await c.r.int();
  const remotePath = await c.r.line();
  const ftpUser = await c.r.line();
  const ftpPass = await c.r.line();
  await c.exec(async () => {
    const r = needRobot(h, () => undefined);
    await cmd("robot.setConnection", { robot: r.id, ip, port, remotePath, ftpUser, ftpPass });
  });
});

def("ConnectParams", "LILLLS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const r = needRobot(h, (w) => w.line("").int(0).line("").line("").line(""));
    const p = connectionOf(r);
    c.w.line(p.ip).int(p.port).line(p.remotePath).line(p.ftpUser).line(p.ftpPass);
  });
});

def("Connect2", "IS", async (c) => {
  const h = await c.r.handle();
  const ip = await c.r.line();
  await c.r.int();  
  await c.exec(async () => {
    const r = needRobot(h, (w) => w.int(0));
    const res = await cmd<{ connected: boolean }>("robot.connect", { robot: r.id, ...(ip ? { ip } : {}) });
    c.w.int(res.connected ? 1 : 0);
  });
});

def("ConnectedState", "ILS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = byHandle(h);
     
    if (!it || it.type !== "robot" || !it.robot) throw new ApiError(1, "", (w) => w.int(-1).line("Invalid item provided"));
    const p = connectionOf(it);
    c.w.int(p.state).line(p.message);
  });
});

def("Disconnect", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    const r = needRobot(h, (w) => w.int(0));
    await cmd("robot.disconnect", { robot: r.id });
    c.w.int(1);
  });
});

 

def("Popup_ProgISO9283", "TS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    const robot = h ? robotOf(h) : undefined;
     
     
    const res = await cmd<{ id: string; name: string }>("iso.program", { ...(robot ? { robot: robot.id } : {}), dialog: true });
    writeItem(c.w, ws().items[res.id]);
  });
});
