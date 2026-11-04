 
 
 

import { z } from "zod";
import { qCompress, type ExportMesh } from "../exporters";
import { fk, ikAllDetailed, ikClosest, jointsConfig, parseRobotFile } from "../kinematics";
import { inv, mul } from "../math";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";
import type { Item } from "../types";
import { absPose, childFrame, toolPose } from "../workspace";
import { exportFileName } from "../itemExport";
import { meshesFromParsed } from "./library";
import { requireRobot, robotDataFromParsed } from "./robot";
import { alignedOrientation } from "../align";

 
function referenceOf(ws: CmdCtx["ws"], robot: Item): string {
  const af = robot.robot?.activeFrame;
  if (af && ws.items[af]) return af;
  return robot.parent ?? robot.id;
}

defineCommand({
  name: "robot.alignToolOrientation",
  title: "Align Tool Orientation",
  description:
    "Rotate the robot's tool to the closest orientation aligned with the axes of its reference frame, keeping the TCP position (robot context menu 'Align Tool Orientation'). Reports 'Align already done' when it is already aligned.",
  category: "robot",
  spec: "R-TREE-40, FUN_10047d6c0",
  schema: z.object({ robot: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = requireRobot(ws, p.robot);
    const rd = r.robot!;
    const ref = referenceOf(ws, r);
    const tcpAbs = mul(mul(absPose(ws, r.id), fk(rd.model, rd.joints)), toolPose(ws, r.id));
    const refAbs = childFrame(ws, ref);
    const a = alignedOrientation(mul(inv(refAbs), tcpAbs));
    if (!a.changed) {
      ctx.undoLabel = null;
      status(ctx, "Align already done");
      return { aligned: false };
    }
     
    const flange = mul(mul(inv(absPose(ws, r.id)), mul(refAbs, a.pose)), inv(toolPose(ws, r.id)));
    const q = ikClosest(rd.model, flange, rd.joints);
    if (!q) throw new CommandError("Target cannot be reached");
    tx.set(r.id, { robot: { ...rd, joints: q } });
    ctx.undoLabel = ctx.origin === "api" ? null : `Move robot: ${r.name}`;
    status(ctx, "Aligned");
    return { aligned: true, joints: q };
  },
});

defineCommand({
  name: "robot.configurations",
  title: "Robot Configurations",
  description:
    "Every joint solution (configuration) that reaches the robot's current flange pose, with its configuration flags [rear, lower arm, flip], marking the current one (robot context menu 'Change Configuration'). Move to one with robot.setJoints.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-TREE-40, FUN_10047d840",
  schema: z.object({ robot: ItemRef.optional() }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    const rd = r.robot!;
    const pose = fk(rd.model, rd.joints);
    const sols = ikAllDetailed(rd.model, pose);
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
    return {
      title: `${r.name}: Robot Configurations`,
      configurations: sols.map((s) => ({ joints: s.joints, config: jointsConfig(rd.model, s.joints), current: near(s.joints, rd.joints) })),
    };
  },
});






export function writeRobotFile(robot: Item, links: ExportMesh[][]): Uint8Array {
  const rd = robot.robot!;
  if (!rd.header?.length) throw new CommandError(`${robot.name} was not loaded from a robot file and can't be saved as one`);
  const head = Float64Array.from(rd.header);
  const rows = head[2];
  const cell = (c: number, r: number, v: number) => (head[c * rows + r] = v);
   
  for (let k = 0; k < 100; k++) head[90 * rows + k] = 0;
  [...robot.name].slice(0, 99).forEach((ch, k) => (head[90 * rows + k] = ch.codePointAt(0)!));
  rd.model.userLower.forEach((v, j) => cell(30, j, v));
  rd.model.userUpper.forEach((v, j) => cell(31, j, v));
  rd.home.forEach((v, j) => cell(34, j, v));
  rd.joints.forEach((v, j) => cell(35, j, v));
  const size = head.byteLength + 8 + links.reduce((n, l) => n + 8 + l.reduce((m, s) => m + 24 + (s.triangles.length / 3) * 14, 0) + 16, 0);
  const out = new Uint8Array(size);
  out.set(new Uint8Array(head.buffer));
  const dv = new DataView(out.buffer);
  let o = head.byteLength;
  dv.setBigInt64(o, BigInt(links.length), true);
  o += 8;
  for (const shapes of links) {
    dv.setBigInt64(o, BigInt(shapes.length), true);
    o += 8;
    for (const s of shapes) {
      dv.setBigInt64(o, BigInt(s.triangles.length / 9), true);
      o += 8;
      for (let k = 0; k < 4; k++) dv.setFloat32(o + k * 4, s.color[k], true);
      o += 16;
      for (let t = 0; t < s.triangles.length; t += 9) {
        const n = faceNormal(s.triangles, t);
        const th = Math.acos(Math.max(-1, Math.min(1, n[2])));
        let ph = Math.atan2(n[1], n[0]);
        if (ph < 0) ph += 2 * Math.PI;
        const b0 = Math.round((th / Math.PI) * 255), b1 = Math.round((ph / (2 * Math.PI)) * 255) % 256;
        for (let v = 0; v < 3; v++) {
          dv.setFloat32(o, s.triangles[t + v * 3], true);
          dv.setFloat32(o + 4, s.triangles[t + v * 3 + 1], true);
          dv.setFloat32(o + 8, s.triangles[t + v * 3 + 2], true);
          dv.setUint8(o + 12, b0);
          dv.setUint8(o + 13, b1);
          o += 14;
        }
      }
    }
    dv.setBigInt64(o, BigInt(0), true);
    dv.setBigInt64(o + 8, BigInt(0), true);
    o += 16;
  }
  return qCompress(out);
}

function faceNormal(t: Float32Array, o: number): [number, number, number] {
  const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
  const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

defineCommand({
  name: "robot.saveAs",
  title: "Save Robot",
  description:
    "Save a robot as a .robot file (robot context menu 'Save As...'): kinematics, joint limits, home and current joints, and link geometry. Returns the saved file path and its base64 content. The default file name replaces spaces, brackets and dots with '-'.",
  category: "robot",
  readonly: true,
  undoable: false,
  spec: "R-TREE-40, FUN_10047c130",
  schema: z.object({ robot: ItemRef.optional(), fileName: z.string().optional() }),
  run(ctx, p) {
    const r = requireRobot(ctx.ws, p.robot);
    const links = r.robot!.links.map((l) => l.map((m) => ({ triangles: ctx.services.geometry.get(m.geometry) ?? new Float32Array(), color: m.color })));
    const bytes = writeRobotFile(r, links);
    const fileName = p.fileName ? (/\.robot$/i.test(p.fileName) ? p.fileName : `${p.fileName}.robot`) : exportFileName(r.name, "robot");
    const path = ctx.services.files?.writeExport?.(fileName, bytes) ?? null;
    if (path) status(ctx, `Robot ${r.name} saved to ${path}`);
    return { path, fileName, bytes: bytes.length, base64: toBase64(bytes) };
  },
});







defineCommand({
  name: "robot.replace",
  title: "Replace Robot",
  description:
    "Replace a robot by another robot model keeping its position, tools, targets and programs (robot context menu 'Replace Robot'). Give a library file (see library.search), a .robot path on the Enginuity computer, or fileName + base64. The base frame is renamed '<new robot> Base'.",
  category: "robot",
  spec: "R-TREE-40, FUN_10047ce18",
  schema: z.object({
    robot: ItemRef.optional(),
    file: z.string().optional().describe("robot library file, e.g. 'UR10e.robot'"),
    path: z.string().optional(),
    fileName: z.string().optional(),
    base64: z.string().optional(),
  }),
  async run(ctx, p) {
    const { ws, tx, services } = ctx;
    const r = requireRobot(ws, p.robot);
    const name = p.file ?? p.path ?? p.fileName ?? "";
    if (!/\.robot$/i.test(name)) throw new CommandError("Format not recognised.");
    let bytes: Uint8Array;
    if (p.base64 !== undefined) bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
    else if (p.path) {
      if (!services.files?.readFile) throw new CommandError("Opening files from disk is only available on the server");
      bytes = await services.files.readFile(p.path);
    } else {
      if (!services.library) throw new CommandError("Robot library is only available on the server");
      bytes = (await services.library.load(p.file!, "robot")).bytes;
    }
    let parsed: ReturnType<typeof parseRobotFile>;
    try {
      if (!(bytes.length > 6 && bytes[4] === 0x78)) throw new Error("uncompressed");
      parsed = parseRobotFile(bytes);
    } catch {
      throw new CommandError("The robot file is not valid. The robot file is corrupted or there's not enough available space. Errors will follow.");
    }
    if (parsed.json.kind !== "robot") throw new CommandError("Format not recognised.");
    const data = robotDataFromParsed(parsed.json, meshesFromParsed(parsed.json, parsed.floats, (t) => services.geometry.put(t)));
    if (p.file) data.libraryFile = p.file;
    const newName = String(parsed.json.name || name.replace(/^.*[\\/]/, "").replace(/\.robot$/i, ""));
    const old = r.robot!;
    tx.set(r.id, { name: newName, robot: { ...data, activeTool: old.activeTool ?? null, activeFrame: old.activeFrame ?? null } });
    const base = r.parent ? ws.items[r.parent] : undefined;
    if (base?.type === "frame") tx.set(base.id, { name: `${newName} Base` });
    ctx.undoLabel = null;
    status(ctx, "Robot replaced");
    return { robot: newName, previous: r.name === newName ? undefined : r.name, dof: data.model.nq };
  },
});

defineCommand({
  name: "robot.addToolFromFile",
  title: "Add Tool (TCP) From File",
  description:
    "Add tools to a robot from files (robot context menu 'Add Tool (TCP) From File...', dialog 'Add tool' for '3D model (*.*)' and 'Tool (*.tool)'): .tool files keep their TCP, 3D models become tools with the TCP at the flange. Give `path` or fileName + base64.",
  category: "robot",
  spec: "R-TREE-40, FUN_10047bda4",
  schema: z.object({ robot: ItemRef.optional(), path: z.string().optional(), fileName: z.string().optional(), base64: z.string().optional() }),
  async run(ctx, p) {
    const r = requireRobot(ctx.ws, p.robot);
    const { openFileBytes, openPath } = await import("./files");
    if (p.path) return openPath(ctx, p.path, { robot: r.id, asTool: true });
    if (!p.fileName || p.base64 === undefined) throw new CommandError("Provide a file path, or a file name and its base64 content");
    return openFileBytes(ctx, { name: p.fileName, bytes: Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0)) }, { robot: r.id, asTool: true });
  },
});

