// Handles extended API tree, viewport, file-transfer and calibration commands.
 
 
 
 
 

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectBodies } from "@/engine/collision";
import { clampJoints, fk, withinLimits } from "@/engine/kinematics";
import { CALIB_MSG, tcpByPlane, tcpByPoint } from "@/engine/utilities/calibration";
import { eulerToPose } from "@/engine/utilities/euler";
import { eye, type Mat } from "@/engine/math";
import { snapshotStation } from "@/engine/commands/station";
import { writeItemExport } from "@/engine/itemExport";
import type { Item, Workspace } from "@/engine/types";
import { absPose, descendants } from "@/engine/workspace";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { broadcast, getServer } from "@/server/store";
import { requestViewPick } from "@/server/viewpick";
import { ApiError, byHandle, cmd, mutate, need, stationItems, ws } from "./bridge";
import { WireReader, WireWriter } from "./codec";
import { addShapes } from "./cmd-geometry";
import { activeStation, writeItem } from "./cmd-items";
import { API_COMPAT_BUILD, liveHeader, ROBOCRAFT_BUILD_DATE, ROBOCRAFT_VERSION } from "./cmd-station";
import { INS_TYPE } from "./cmd-program";
import { insertAfter } from "./cmd-robot";
import { COMMANDS, apiState, def, type Ctx } from "./context";
import { generating, programFor } from "./runmode";
import { addInstruction } from "@/engine/commands/programs";
import { instructionTreeLabel } from "@/engine/naming";

 





async function delegate(c: Ctx, name: string, build: (w: WireWriter) => void): Promise<void | "raw"> {
  const spec = COMMANDS.get(name);
  if (!spec) throw new ApiError(3, `${name} is not available`);
  const req = new WireWriter();
  build(req);
  const r = new WireReader();
  r.push(req.toBuffer());
  return spec.run({ ...c, r });
}

const isProgram = (it: Item | undefined) => it?.type === "program";

 

 
function instructionList(w: Workspace, prog: Item): string {
  if (prog.program?.showInstructions === false) return "";
  let out = "";
  for (const id of prog.children) {
    const ins = w.items[id];
    if (!ins?.instruction) continue;
     
     
    const name = instructionTreeLabel(w, ins).replace(/\n/g, "<br>").replace(/\|/g, " ");
    out += `${INS_TYPE[ins.instruction.kind] ?? 12}|${name}||`;
  }
  return out;
}







function treeExport(c: Ctx, kind: "tree" | "tree2" | "tree3" | "wasm") {
  const w = ws();
  const items = stationItems();
  const expanded = apiState().treeExpanded;
  c.w.int(items.length);
  for (const it of items) {
    if (kind === "tree3") c.w.int(5);
    writeItem(c.w, it);
    c.w.line(it.name);
    writeItem(c.w, it.type === "station" ? null : it.parent ? w.items[it.parent] : null);
    if (kind === "tree") continue;
     
     
    c.w.int((expanded.get(it.id) ?? it.type === "station") ? 1 : 0);
    if (kind === "tree2") continue;
    c.w.int(it.visible ? 1 : 0);
    if (kind === "tree3") continue;
    c.w.int(isProgram(it) && it.params?.Loop === "1" ? 1 : 0);
    c.w.line(isProgram(it) ? instructionList(w, it) : "");
  }
}

def("G_List_Items_Tree", "S", async (c) => {
  await c.exec(() => treeExport(c, "tree"));
  return undefined;
});
def("G_List_Items_Tree2", "S", async (c) => {
  await c.exec(() => treeExport(c, "tree2"));
});
def("G_List_Items_Tree3", "S", async (c) => {
  await c.exec(() => treeExport(c, "tree3"));
});
def("G_List_Items_WASM", "S", async (c) => {
  await c.exec(() => treeExport(c, "wasm"));
});

 

 
export const VIEW_PRESET_ANGLES: Record<number, [number, number]> = {
  1: [-60, -135],  
  2: [-90, -90],  
  3: [0, -90],  
  4: [-90, -180],  
  5: [-90, 0],  
  6: [-90, 90],  
};

const f = Math.fround;

function presetRotation(a: number, b: number): number[] {
  const sa = f(Math.sin(f((f(a) * f(Math.PI)) / 180)));
  const ca = f(Math.cos(f((f(a) * f(Math.PI)) / 180)));
  const sb = f(Math.sin(f((f(b) * f(Math.PI)) / 180)));
  const cb = f(Math.cos(f((f(b) * f(Math.PI)) / 180)));
   
  return [cb, -sb, 0, f(ca * sb), f(ca * cb), -sa, f(sa * sb), f(sa * cb), ca];
}





export function stationViewBox(w: Workspace): number[] | null {
  const st = w.activeStation;
  if (!st) return null;
  const store = getServer().services.geometry;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.min(box[2], z);
    box[3] = Math.max(box[3], x);
    box[4] = Math.max(box[4], y);
    box[5] = Math.max(box[5], z);
  };
  for (const body of collectBodies(w, store, st)) {
    const it = w.items[body.item];
    const meshes = it?.robot ? it.robot.links[body.link ?? 0] ?? [] : it?.object?.meshes ?? it?.tool?.meshes ?? [];
    const m = body.pose;
    for (const mesh of meshes) {
      const tri = store.get(mesh.geometry);
      if (!tri) continue;
      for (let i = 0; i + 2 < tri.length; i += 3) {
        const x = tri[i];
        const y = tri[i + 1];
        const z = tri[i + 2];
        add(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]);
      }
    }
  }
  for (const it of descendants(w, st)) {
    if (it.type !== "frame" || !it.visible) continue;
    const p = absPose(w, it.id);
    add(p[3], p[7], p[11]);
  }
  return Number.isFinite(box[0]) ? box.map((v) => f(v)) : null;
}





export function fitViewPose(rot: number[], box: number[] | null, viewAngleDeg: number): Mat {
  const c = box ? [f((box[0] + box[3]) * 0.5), f((box[1] + box[4]) * 0.5), f((box[2] + box[5]) * 0.5)] : [0, 0, 0];
  const size = box ? f(Math.sqrt(f(f((box[4] - box[1]) ** 2) + f((box[3] - box[0]) ** 2)) + f((box[5] - box[2]) ** 2))) : 0;
  const radius = size >= 600 ? size : 600;
  const tanHalf = f(Math.tan((viewAngleDeg * Math.PI) / 360));
  const t0 = -(rot[1] * c[1] + rot[0] * c[0] + rot[2] * c[2]);
  const t1 = -(rot[4] * c[1] + rot[3] * c[0] + rot[5] * c[2]);
  const t2 = f(f(f(radius * -1.2) * 0.5) / tanHalf) - (rot[7] * c[1] + c[0] * rot[6] + c[2] * rot[8]);
  return [rot[0], rot[1], rot[2], t0, rot[3], rot[4], rot[5], t1, rot[6], rot[7], rot[8], t2, 0, 0, 0, 1];
}

function viewAngle(): number {
  return Number(getServer().services.settings.ViewAngle ?? DEFAULT_SETTINGS.ViewAngle) || 30;
}

 
def("FitAll", "S", async (c) => {
  await c.exec(() => cmd("view.fit", {}));
});

 
 
 
def("G_ViewPose2", "HS", async (c) => {
  const preset = await c.r.int();
  await c.exec(() => {
    const cur = apiState().viewPose ?? eye();
    const angles = VIEW_PRESET_ANGLES[preset];
    if (angles) c.w.pose(fitViewPose(presetRotation(angles[0], angles[1]), stationViewBox(ws()), viewAngle()));
    else if (preset === 7) c.w.pose(fitViewPose([cur[0], cur[1], cur[2], cur[4], cur[5], cur[6], cur[8], cur[9], cur[10]], stationViewBox(ws()), viewAngle()));
     
    else c.w.pose(cur.map((v) => f(v)));
  });
});

 
 
def("Proj2d3d", "ITXS", async (c) => {
  const x = await c.r.int();
  const y = await c.r.int();
  const hit = await requestViewPick(x, y);
  await c.exec(() => {
    const it = hit?.item ? ws().items[hit.item] : undefined;
    if (!hit || !it) {
      c.w.int(0).nullItem().xyz([0, 0, 0]);
      return;
    }
    c.w.int(1);
    writeItem(c.w, it);
     
    c.w.xyz(hit.xyz.map((v) => f(v)));
  });
});

 

const SHAPE_ERROR = "Invalid shape, a 3xN (or 6xN) list of points must be provided (N must be multiple of 3)";

 
 
 
def("AddShape", "TS", async (c) => {
  const pts = await c.r.matrix();
  const h = await c.r.handle();
  await c.exec(async () => {
    const addTo = h ? need(h) : undefined;
    if (pts.rows < 3 || pts.cols < 3) throw new ApiError(2, SHAPE_ERROR, (w) => w.nullItem());
    writeItem(c.w, await addShapes(addTo, false, [{ ...pts, color: [] }]));
  });
});

 
 
def("Copy", "S", async (c) => {
  const h = await c.r.handle();
  const it = h ? byHandle(h) : undefined;
  if (!it || it.type === "instruction") throw new ApiError(1);
  return delegate(c, "Copy2", (w) => w.handle(h).int(1));
});

 
 
def("AddBlind", "S", async (c) => {
  const file = await c.r.line();
  const h = await c.r.handle();
  c.w.status(0);
  c.flush();
  const sink = new WireWriter();
  try {
    await delegate({ ...c, w: sink }, "Add", (w) => w.line(file).handle(h));
  } catch (e) {
     
    broadcast({ type: "status", text: e instanceof Error ? e.message : String(e), ms: 10000 });
  }
  return "raw";
});

 
 
 
def("InsCustom", "S", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const pathRun = await c.r.line();
  const pathIcon = await c.r.line();
  const blocking = await c.r.int();
  await c.exec(async () => {
    const w = ws();
    let prog = h ? byHandle(h) : undefined;
    let after: string | null | undefined;
    if (prog?.type === "program") after = insertAfter(prog);
    else {
      const sel = w.selection.map((s) => w.items[s]).filter(Boolean);
      const ins = sel.find((s) => s.type === "instruction");
      prog = ins?.parent ? w.items[ins.parent] : sel.find((s) => s.type === "program");
      if (!prog) throw new ApiError(2, "No Program or Instruction selected");
      after = ins ? ins.id : prog.children.at(-1) ?? null;
    }
    const p = prog;
    await mutate((ww, tx) => {
      const cur = ww.items[p.id];
      const ins = addInstruction(ww, tx, cur, { kind: "custom", text: name }, after ?? null);
      tx.set(ins.id, { name, params: { PathRunSim: pathRun, PathIcon: pathIcon, PathRunRobot: "", Blocking: String(blocking) } });
    });
  });
});

 
 
def("MakeProg", "S", async (c) => {
  const h = await c.r.handle();
  const folderIn = await c.r.line();
  const it = h ? byHandle(h) : undefined;
  if (it?.type !== "program") {
    c.w.line("invalid program").status(1);
    return "raw";
  }
  const sink = new WireWriter();
  await delegate({ ...c, w: sink }, "MakeProg2", (w) => w.handle(h).line(folderIn).int(3));
   
  const r = new WireReader();
  r.push(sink.toBuffer());
  const ok = await r.int();
  const log = (await r.line()).slice(0, 500);
  c.w.int(ok).line(log);
});

 
 
 
 
def("S_Speed", "S", async (c) => {
  const speed = await c.r.int();
  const accel = await c.r.int();
  const h = await c.r.handle();
  await c.exec(async () => {
    const w = ws();
    const robot = h ? byHandle(h) : stationItems().find((i) => i.type === "robot");
    if (!robot || robot.type !== "robot" || !robot.robot) throw new ApiError(1);
    const lin = speed > 0 ? speed * 0.001 : -1;
    const acc = accel > 0 ? accel * 0.001 : -1;
    await cmd("robot.setSpeed", { robot: robot.id, linear: lin, joint: speed > 0 && robot.robot.model.nq < 4 ? lin : -1, linearAccel: acc });
    if (generating(c.conn)) {
      const prog = await programFor(c.conn, w.items[robot.id]);
      if (prog.type === "program") await cmd("program.addInstruction", { program: prog.id, kind: "speed", linear: lin, joint: -1, linearAccel: acc, jointAccel: -1, after: insertAfter(prog) });
    } else if (c.conn.runMode === 6) {
      throw new ApiError(3, "Robot is not ready");
    }
  });
});

 
 
 
 
 
def("S_Thetas2", "S", async (c) => {
  const joints = await c.r.array();
  const h = await c.r.handle();
  const mode = await c.r.int();
  return c.exec(async () => {
    const it = h ? byHandle(h) : undefined;
    const reply = (n: number, status: number) => {
      if (!c.conn.skipStatus) c.w.int(n).status(status);
      return "raw" as const;
    };
    if (it?.type === "robot" && it.robot) {
      const model = it.robot.model;
      const ok = withinLimits(model, joints.slice(0, model.nq).concat(Array(Math.max(0, model.nq - joints.length)).fill(0)));
      if (mode === 0 || (mode !== 1 && ok)) await cmd("robot.setJoints", { robot: it.id, joints });
      else if (mode === 1) {
        await mutate((w, tx) => {
          const r = w.items[it.id];
          if (!r?.robot) return;
          const q = joints.slice(0, r.robot.model.nq);
          while (q.length < r.robot.model.nq) q.push(r.robot.joints[q.length] ?? 0);
          tx.set(r.id, { robot: { ...r.robot, joints: q } });
        });
      } else if (mode > 2) await cmd("robot.setJoints", { robot: it.id, joints: clampJoints(model, joints) });
      return reply(ok ? 1 : 0, 0);
    }
    if (it?.type === "target" && it.target) {
      await mutate((w, tx) => {
        const t = w.items[it.id];
        if (t?.target) tx.set(t.id, { target: { ...t.target, joints: joints.slice() } });
      });
      return reply(0, 0);
    }
    return reply(0, 1);
  });
});

 
 
 
 
def("S_Gen_Str", "S", async (c) => {
  const h = await c.r.handle();
  const param = await c.r.line();
  const value = await c.r.line();
  await c.exec(async () => {
    const it = h ? byHandle(h) : undefined;
    if (!it) throw new ApiError(1);
    if (it.type === "object" || it.type === "tool") {
      if (!param.toLowerCase().startsWith("display")) throw new ApiError(2, `Unknown property for ${it.name}`);
      await cmd("object.setDisplay", { item: it.id, value });
      return;
    }
    if (it.type === "machining") {
      if (param !== "CAM_FILE") throw new ApiError(2, `Unknown parameter ${param} for ${it.name}`);
       
      if (!existsSync(value)) throw new ApiError(2, `File doesn't exist: ${value}`);
      await cmd("machining.setInput", { project: it.id, ncText: readFileSync(value, "utf8"), fileName: path.basename(value) });
      await cmd("machining.update", { project: it.id });
      return;
    }
    throw new ApiError(1);
  });
});

 

 
 
def("G_License", "LS", async (c) => {
  await c.exec(() => {
    c.w.line("Enginuity");
  });
});

 
 
def("S_License", "IS", async (c) => {
  await c.r.line();
  await c.exec(() => {
    c.w.int(0);
  });
});

 
 
def("FactorySettings", "LS", async (c) => {
  await c.exec(async () => {
    await cmd("settings.reset", {});
    c.w.line(`Enginuity v${ROBOCRAFT_VERSION} (64 bit). Build: ${API_COMPAT_BUILD}. Version release date: ${ROBOCRAFT_BUILD_DATE}`);
  });
});

 
 
def("RobotBin", "AS", async (c) => {
  await c.exec(() => {
    const robot = stationItems().find((i) => i.type === "robot" && i.robot);
    if (!robot) {
      c.w.array([]);
      return;
    }
    const h = liveHeader(robot).slice(0, 4000);
    while (h.length < 4000) h.push(0);
    c.w.array(h);
  });
});

 
function itemFileBytes(it: Item, ext: string): Uint8Array | null {
  const w = ws();
  if (it.type === "station") {
     
    return new TextEncoder().encode(JSON.stringify(snapshotStation(w, it.id)));
  }
  const fmt = ext.replace(/^\./, "").toLowerCase();
  if (!["stl", "ply", "wrl", "sld", "tool"].includes(fmt)) return null;
  if (it.type !== "object" && it.type !== "tool") return null;
  if (fmt === "tool" && it.type !== "tool") return null;
  return writeItemExport(w, getServer().services.geometry, [it], fmt as "stl", `${it.name}.${fmt}`).bytes;
}

 
 
 
def("BinSave", "BS", async (c) => {
  const file = await c.r.line();
  const h = await c.r.handle();
  await c.exec(() => {
    const it = h ? need(h) : activeStation();
    if (file && !file.toLowerCase().endsWith(".cadobj")) throw new ApiError(2, "Specifying format not supported. Provide a supported file name.", () => undefined);
     
    c.w.bytes(itemFileBytes(it, it.type === "tool" ? "tool" : "sld") ?? new Uint8Array(0));
  });
});

 
 
 
def("FileSendBin", "S", async (c) => {
  const h = await c.r.handle();
  const file = await c.r.line();
  return c.exec(() => {
    const it = h ? byHandle(h) : undefined;
    const station = !it || it.type === "station";
    const ext = path.extname(file);
    const bytes = itemFileBytes(station ? (it ?? activeStation()) : it, station ? ".rdk" : ext);
    if (!bytes) {
      c.w.status(0);
      return "raw" as const;
    }
     
    c.w.bytes(bytes);
    c.w.status(0);
    return "raw" as const;
  });
});

 
 
 
def("FileRecvBin", "S", async (c) => {
  let file = await c.r.line();
  const size = await c.r.int();
  const h = await c.r.handle();
  const load = await c.r.int();
  if (!file) file = path.join(os.tmpdir(), "TempStationRecv.rdk");
  else if (file.toLowerCase().endsWith("startup.rdk")) file = "startup.rdk";
  c.w.status(0);
  c.flush();
  const bytes = size > 0 ? await c.r.take(size) : Buffer.alloc(0);
  const full = path.resolve(file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  if (load > 0) {
    const sink = new WireWriter();
    await delegate({ ...c, w: sink }, "Add", (w) => w.line(full).handle(h)).catch((e) =>
      broadcast({ type: "status", text: e instanceof Error ? e.message : String(e), ms: 10000 }),
    );
  }
  return "raw";
});

 
 
 
def("S_WID", "S", async (c) => {
  const wid = await c.r.handle();
  await c.exec(() => {
    console.log(`[enginuity-api] Using parent window WID=${wid} (no native window to embed)`);
  });
});

 

 
 
 
 
def("Render", "S", async (c) => {
  const value = await c.r.int();
  await c.exec(() => {
    if (c.conn.runMode !== 1) return;
     
    c.conn.autoUpdate = value;
  });
});

 

const matColumns = (m: { rows: number; cols: number; data: number[] }) => Array.from({ length: m.cols }, (_, j) => m.data.slice(j * m.rows, j * m.rows + m.rows));
const errorMatrix = (w: WireWriter, errors: number[]) => w.matrix(errors.length, 2, [...errors.map((_, i) => i + 1), ...errors]);
const emptyCalib = (w: WireWriter) => w.array([]).array([]).matrix(0, 0, []);

 
 
 
 
 
def("CalibTCP", "S", async (c) => {
  const m = await c.r.matrix();
  const format = await c.r.int();
  const method = await c.r.int();
  await c.exec(() => {
    if (m.rows < 6 || m.cols < 3) throw new ApiError(3, CALIB_MSG.tcpApiSize, emptyCalib);
    const flanges = matColumns(m).map((r) => eulerToPose(r, format));
    const res = method === 1 ? tcpByPlane(flanges, eye()) : method === 0 ? tcpByPoint(flanges, 5) : null;
    c.w.array(res ? res.tcp : [0, 0, 0]).array(res ? res.stats : [0, 0, 0]);
    errorMatrix(c.w, res ? res.errors : []);
    if (!res?.ok) {
      c.w.status(3, "Can't calculate the TCP. Increase the number of points.");
      return "raw";
    }
    return undefined;
  }).then((r) => r);
});

 
 
 
 
def("CalibTCP2", "S", async (c) => {
  const m = await c.r.matrix();
  const format = await c.r.int();
  const method = await c.r.int();
  const h = await c.r.handle();
  return c.exec(() => {
    if (m.cols < 3) throw new ApiError(3, CALIB_MSG.tcpApiSize, emptyCalib);
    let problems = "";
    const robot = h ? byHandle(h) : undefined;
    const flanges: Mat[] = [];
    if (format < 0 && (!robot || robot.type !== "robot")) problems += CALIB_MSG.robotForJoints;
    else if (format >= 0 && m.rows < 6) problems += "Invalid XYZWPR values! Size must be 6xN. ";
    else {
      matColumns(m).forEach((col, i) => {
        if (format < 0) {
          const model = robot!.robot!.model;
          const q = col.slice(0, model.nq);
          if (!withinLimits(model, q)) problems += CALIB_MSG.outsideLimits(i + 1);
          flanges.push(fkFlange(robot!, q));
        } else flanges.push(eulerToPose(col, format));
      });
    }
    let res = null as ReturnType<typeof tcpByPoint> | null;
    if (method === 1) {
      res = flanges.length ? tcpByPlane(flanges, eye()) : null;
      const [ax, ay] = res?.planeAngles ?? [0, 0];
      c.w.array(res ? [...res.tcp, res.point[0], ax, ay, 0, 0, 0] : new Array(9).fill(0)).array(res ? [...res.stats, 0, 0] : [0, 0, 0, 0, 0]);
    } else if (method === 0) {
      res = flanges.length ? tcpByPoint(flanges, 5) : null;
      c.w.array(res ? [...res.tcp, ...res.point] : new Array(6).fill(0)).array(res ? res.stats : [0, 0, 0]);
    } else {
      problems += "Invalid calibration Method. ";
      c.w.array([0, 0, 0]).array([0, 0, 0]);
    }
    errorMatrix(c.w, res ? res.errors : []);
    if (problems) c.w.status(3, problems);
    else if (!res?.ok) c.w.status(3, CALIB_MSG.tcpApiFail);
    else c.w.status(0);
    return "raw" as const;
  });
});

 
function fkFlange(robot: Item, q: number[]): Mat {
  return fk(robot.robot!.model, q);
}

 
 
 
 
 
def("CalibRobot", "S", async (c) => {
  await c.r.matrix();
  await c.r.int();
  const h = await c.r.handle();
  await c.exec(() => {
    const robot = h ? byHandle(h) : undefined;
    if (!robot || robot.type !== "robot") {
      c.w.int(-10).line("Invalid input for calibration").status(3, "Invalid parameters input matrix");
      return;
    }
    c.w.int(-1).line("").status(3, "Robot calibration from measurements is not available in Enginuity");
  });
  return "raw";
});

 
 
def("MeasLT", "XS", async (c) => {
  await c.r.xyz();
  await c.r.int();
  await c.exec(() => undefined);
  c.w.xyz([0, 0, 0]).status(2, "Laser tracker request could not be completed or timed out");
  return "raw";
});

 
 
def("MeasLT2", "AS", async (c) => {
  await c.r.xyz();
  await c.r.int();
  await c.exec(() => {
    c.w.array([]);
  });
});

 
 
def("MeasPose", "S", async (c) => {
  await c.exec(() => {
    c.w.pose(eye()).pose(eye()).int(0).int(0).int(0).int(0);
  });
});

 
 
 
 
def("MeasPose4", "HAS", async (c) => {
  await c.r.array();
  await c.exec(() => undefined);
  c.w.pose(eye()).array([-1, -1, -1, -1]).status(13, "Invalid license for tracking");
  return "raw";
});

 
 
 
 
 
def("S_Gen_Mat", "S", async (c) => {
  await c.r.handle();
  await c.r.line();
  await c.r.matrix();
  await c.exec(() => undefined);
  throw new ApiError(1, "", () => undefined);
});

def("S_ValueMat", "MS", async (c) => {
  await c.r.handle();
  await c.r.line();
  await c.r.matrix();
  await c.exec(() => undefined);
  throw new ApiError(1, "", (w) => w.int(0).int(0));
});

 
 
 
 
def("Connect", "IS", async (c) => {
  const h = await c.r.handle();
  const ip = await c.r.line();
  const robot = h ? byHandle(h) : stationItems().find((i) => i.type === "robot");
  if (!robot || robot.type !== "robot") throw new ApiError(1, "", (w) => w.int(0));
  c.conn.runMode = 6;
  return delegate(c, "Connect2", (w) => w.handle(robot.handle).line(ip).int(1));
});

 
 
def("Popup_ProgISO9283_Param", "TS", async (c) => {
  const h = await c.r.handle();
  const params = await c.r.array();
  await c.exec(async () => {
    const robot = h ? byHandle(h) : undefined;
    const [x, y, z, , side = 0] = params;
    const res = await cmd<{ id?: string; program?: string }>("iso.cube", {
      ...(robot?.type === "robot" ? { robot: robot.id } : {}),
      ...(params.length >= 3 ? { center: [x, y, z] } : {}),
      ...(side > 0 ? { side } : {}),
    });
    const prog = res.id ? ws().items[res.id] : stationItems().find((i) => i.type === "program" && i.name === "ISO9283");
    writeItem(c.w, prog ?? null);
  });
});

 

 
 
 
 
def("ExecArgs", "S", async (c) => {
  const n = await c.r.int();
  const args: string[] = [];
  for (let i = 0; i < n; i++) args.push(await c.r.line());
  if (n < 1) {
    c.w.int(-1);
    return "raw";
  }
  c.w.status(0);
  c.flush();
  for (const a of args) {
    try {
      await c.exec(() => runArg(c, a));
    } catch (e) {
      broadcast({ type: "status", text: e instanceof Error ? e.message : String(e), ms: 10000 });
    }
  }
  return "raw";
});

async function runArg(c: Ctx, arg: string) {
  const up = arg.toUpperCase();
  if (!arg.startsWith("-")) {
    const full = path.resolve(arg);
    if (!existsSync(full)) throw new Error(`File not found: ${arg}`);
    await delegate({ ...c, w: new WireWriter() }, "Add", (w) => w.line(full).handle(0));
    return;
  }
  if (up === "-ADDSTATION") await cmd("station.new", {});
  else if (up === "-CLOSEALL") {
    for (const id of [...ws().stations]) await cmd("station.close", { station: id }).catch(() => undefined);
  } else if (up.startsWith("-SAVE=") || up.startsWith("-SAVEAS=")) {
    const file = arg.slice(arg.indexOf("=") + 1);
    const full = path.resolve(file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(snapshotStation(ws(), activeStation().id)));
  } else if (up === "-DEFAULTS" || up === "-RESET") await cmd("settings.reset", {});
  else console.log(`[enginuity-api] Running parameter: ${arg} (not applicable)`);
}

 








interface AccuracyParams {
  poses: Mat[];
  rows: number[][];
  poses2: Mat[];
  rows2: number[][];
  a10: number[];
  aN: number[];
}

 
const ID_POSE: Mat = [1, -0, 0, 0, 0, 1, -0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nominalAccuracy(robot: Item): AccuracyParams {
  const rd = robot.robot!;
  const n = rd.model.nq;
  const h = rd.header && rd.header.length >= 4000 ? rd.header : null;
  const rows = Array.from({ length: n }, (_, j) => {
    const dh = h ? [0, 1, 2, 3].map((r) => h[(10 + j) * 20 + r]) : [rd.model.joints[j]?.alpha ?? 0, rd.model.joints[j]?.a ?? 0, rd.model.joints[j]?.theta ?? 0, rd.model.joints[j]?.d ?? 0];
    return [...dh, 0, 0, 0, 0];
  });
  return { poses: [ID_POSE, ID_POSE, ID_POSE], rows, poses2: [ID_POSE, ID_POSE], rows2: rows.map((r) => r.slice()), a10: new Array(10).fill(0), aN: new Array(n).fill(0) };
}

function accuracyOf(robot: Item): AccuracyParams {
  const stored = robot.params?.AccuracyParams;
  if (stored) {
    try {
      return JSON.parse(stored) as AccuracyParams;
    } catch {
       
    }
  }
  return nominalAccuracy(robot);
}

 
const robotOrFirstItem = (h: number) => (h ? byHandle(h) : stationItems().find((i) => i.type === "robot"));

 
 
def("G_RobotParamAll", "S", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const robot = robotOrFirstItem(h);
    if (!robot || robot.type !== "robot" || !robot.robot) {
       
      c.w.pose(eye()).pose(eye()).pose(eye()).int(0).pose(eye()).pose(eye()).int(0).array([]).array([]).status(1);
      return "raw";
    }
    const p = accuracyOf(robot);
    const n = p.rows.length;
    for (const m of p.poses) c.w.pose(m);
    c.w.int(n);
    for (const r of p.rows) c.w.array(r.slice(0, 8));
    for (const m of p.poses2) c.w.pose(m);
    c.w.int(n);
    for (const r of p.rows2) c.w.array(r.slice(0, 8));
    c.w.array(p.a10.slice(0, 10)).array(p.aN.slice(0, n));
    return undefined;
  }).then((r) => r);
});

 
 
 
def("S_AbsAccParam", "S", async (c) => {
  const h = await c.r.handle();
  const poses = [await c.r.pose(), await c.r.pose(), await c.r.pose()];
  const n1 = await c.r.int();
  const rows: number[][] = [];
  for (let i = 0; i < n1; i++) rows.push(await c.r.array());
  const poses2 = [await c.r.pose(), await c.r.pose()];
  const n2 = await c.r.int();
  const rows2: number[][] = [];
  for (let i = 0; i < n2; i++) rows2.push(await c.r.array());
  const a10 = await c.r.array();
  const aN = await c.r.array();
  await c.exec(async () => {
    const robot = robotOrFirstItem(h);
    if (!robot || robot.type !== "robot" || !robot.robot) throw new ApiError(1);
    const set: AccuracyParams = { poses, rows, poses2, rows2, a10, aN };
    await mutate((w, tx) => {
      const r = w.items[robot.id];
      if (r) tx.set(r.id, { params: { ...(r.params ?? {}), AccuracyParams: JSON.stringify(set) } });
    });
  });
});

 
 
 
 
 
def("UpdateKinematicsUR", "S", async (c) => {
  const h = await c.r.handle();
  await c.r.matrix();
  await c.r.array();
  await c.exec(() => {
    const robot = h ? byHandle(h) : undefined;
    if (!robot || robot.type !== "robot") {
      c.w.int(-1).line("Invalid robot selected").array([]).array([]).status(3, "Invalid robot");
      return;
    }
    c.w.int(-1).line("Unable to calibrate: unexpected errors").array([]).array([]).status(3, "UR kinematics calibration is not available in Enginuity");
  });
  return "raw";
});

 
 
 
 
const FILTER_MSG = "Filtering programs with a calibrated robot model is not available in Enginuity";

def("FilterProg", "IS", async (c) => {
  const h = await c.r.handle();
  await c.r.line();
  await c.exec(() => {
    const robot = h ? byHandle(h) : undefined;
    if (!robot || robot.type !== "robot") {
      c.w.line("invalid program").status(1);
      return;
    }
    c.w.int(-1).status(3, FILTER_MSG);
  });
  return "raw";
});

def("FilterProg2", "ILS", async (c) => {
  const h = await c.r.handle();
  await c.r.line();
  await c.exec(() => {
    const robot = h ? byHandle(h) : undefined;
    if (!robot || robot.type !== "robot") {
      c.w.line("invalid program").status(1);
      return;
    }
    c.w.int(-1).line("").status(3, FILTER_MSG);
  });
  return "raw";
});
