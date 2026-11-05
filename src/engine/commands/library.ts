// Registers library searches, model loading and primitive-object creation.
import { z } from "zod";
import { requireRef } from "../dispatch";
import { parseRobotFile } from "../kinematics";
import { eye, transl, xyzrpwToPose } from "../math";
import { boxMesh, cylinderMesh, parseMeshParts, sphereMesh } from "../meshio";
import { extrudeMesh, roundedBoxMesh, tubeMesh } from "../shapes";
import { CommandError, getCommand, defineCommand, ItemRef, XYZRPW, type CmdCtx, type LibraryEntry } from "../registry";
import type { MeshPart } from "../meshformats";
import type { ItemPhysics } from "../physics/types";
import type { MeshRef, Workspace } from "../types";
import { currentRobot, listItems, makeItem, newFrameOffset } from "../workspace";
import { activeStationId, defaultFrameParent } from "./items";
import { openStationFile } from "./rdk";
import { addRobotItem, requireRobot, robotDataFromParsed } from "./robot";

const DEFAULT_COLOR: [number, number, number, number] = [0.86, 0.87, 0.9, 1];

 
 
export function defaultObjectParent(ws: Workspace): string {
  const r = currentRobot(ws);
  const af = r?.robot?.activeFrame;
  return af && ws.items[af] ? af : activeStationId(ws);
}

export function meshesFromParsed(json: Record<string, unknown>, floats: Float32Array, put: (t: Float32Array) => string): MeshRef[][] {
  type Shape = { triangles: number; rgba: number[]; positions: number; normals: number };
  const links = (json.links as Shape[][]) ?? [];
   
  return links.map((shapes) => {
    const groups = new Map<string, { color: number[]; shapes: Shape[]; tris: number }>();
    for (const sh of shapes) {
      if (sh.triangles <= 0) continue;
      const c = sh.rgba?.length === 4 ? sh.rgba : DEFAULT_COLOR;
      const key = c.map((v) => v.toFixed(3)).join(",");
      const g = groups.get(key) ?? { color: c, shapes: [], tris: 0 };
      g.shapes.push(sh);
      g.tris += sh.triangles;
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => {
      const pos = new Float32Array(g.tris * 9);
      const nrm = new Float32Array(g.tris * 9);
      let o = 0;
      for (const sh of g.shapes) {
        const n = sh.triangles * 9;
        pos.set(floats.subarray(sh.positions, sh.positions + n), o);
        nrm.set(floats.subarray(sh.normals, sh.normals + n), o);
        o += n;
      }
      return { geometry: put(pos), normals: put(nrm), color: [g.color[0], g.color[1], g.color[2], g.color[3]] as [number, number, number, number] };
    });
  });
}

 
const INVALID_ROBOT_FILE = "The robot file is not valid. The robot file is corrupted or there's not enough available space. Errors will follow.";

function parseRobotOrToolFile(bytes: Uint8Array, kind: "robot" | "tool" = "robot") {
   
   
   
  if (kind === "robot" && !(bytes.length > 6 && bytes[4] === 0x78)) throw new CommandError(INVALID_ROBOT_FILE, "invalid_file");
  try {
    return parseRobotFile(bytes);
  } catch {
    throw new CommandError(INVALID_ROBOT_FILE, "invalid_file");
  }
}






export function addRobotFromBytes(
  ctx: CmdCtx,
  bytes: Uint8Array,
  fileName: string,
  opts: { parent?: string | number; xyzrpw?: number[]; libraryFile?: string; source?: string } = {},
) {
  const { ws, tx, services } = ctx;
  const parsed = parseRobotOrToolFile(bytes);
  const links = meshesFromParsed(parsed.json, parsed.floats, (t) => services.geometry.put(t));
  const data = robotDataFromParsed(parsed.json, links);
  if (opts.libraryFile) data.libraryFile = opts.libraryFile;
  const name = String(parsed.json.name || fileName.replace(/^.*[\\/]/, "").replace(/\.robot$/i, ""));
  const st = activeStationId(ws);
  const parent = opts.parent !== undefined ? requireRef(ws, opts.parent, "parent").id : defaultFrameParent(ws);
  const spacing = services.settings.PlaceAtOrigin ? 0 : Number(services.settings.PlaceSpacingMM ?? 1000);
  const y = newFrameOffset(ws, st, spacing);
   
  const h0z = data.model.base[11];
  const z = h0z < 0 && data.model.mech !== 5 && data.model.nq === 6 ? -h0z : 0;
  const basePose = opts.xyzrpw ? xyzrpwToPose(opts.xyzrpw) : transl(0, y, z);
  const { base, robot } = addRobotItem(ws, tx, name, data, parent, basePose);
  ctx.undoLabel = null;
  tx.setMeta("selection", [robot.id]);
  return { id: robot.id, name: robot.name, handle: robot.handle, base: base.name, dof: data.model.joints.length, ...(opts.source ? { source: opts.source } : {}) };
}






export function addToolFromBytes(ctx: CmdCtx, bytes: Uint8Array, fileName: string, opts: { robot?: string | number; source?: string } = {}) {
  const { ws, tx, services } = ctx;
  const parsed = parseRobotOrToolFile(bytes, "tool");
  const links = meshesFromParsed(parsed.json, parsed.floats, (t) => services.geometry.put(t));
  const robots = listItems(ws, { type: "robot" });
  if (opts.robot === undefined && robots.length > 1) throw new CommandError(`Select a robot to place the tool: ${fileName}`, "pick_robot");
  if (!robots.length && opts.robot === undefined) throw new CommandError("Select robot first");
  const robot = requireRobot(ws, opts.robot ?? robots[0].id);
  const tcp = (parsed.json.tcp as number[] | undefined)?.length === 16 ? (parsed.json.tcp as number[]) : eye();
  const tool = makeItem(ws, "tool", String(parsed.json.name || fileName.replace(/^.*[\\/]/, "").replace(/\.tool$/i, "")), {
    pose: tcp,
    tool: { meshes: links.flat() },
  });
  tx.add(tool, robot.id);
  const rd = ws.items[robot.id].robot!;
  if (!rd.activeTool || !ws.items[rd.activeTool]) tx.set(robot.id, { robot: { ...rd, activeTool: tool.id } });
  tx.split(`Add: ${tool.name}`);
  return { id: tool.id, name: tool.name, robot: robot.name, ...(opts.source ? { source: opts.source } : {}) };
}





export function addObjectFromBytes(
  ctx: CmdCtx,
  bytes: Uint8Array,
  fileName: string,
  opts: { parent?: string | number; xyzrpw?: number[]; scale?: number; source?: string; select?: boolean } = {},
) {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return addObjectFromParts(ctx, parseMeshParts(fileName, bytes), base, { ...opts, source: opts.source ?? fileName });
}






export function addObjectFromParts(
  ctx: CmdCtx,
  meshParts: MeshPart[],
  name: string,
  opts: { parent?: string | number; xyzrpw?: number[]; scale?: number; source?: string; select?: boolean; physics?: ItemPhysics } = {},
) {
  const { ws, tx, services } = ctx;
  const scaled = opts.scale !== undefined && opts.scale !== 1;
  const parts = meshParts
    .filter((pt) => pt.triangles.length)
    .map((pt) => ({
      triangles: scaled ? pt.triangles.map((v) => v * opts.scale!) : pt.triangles,
       
      normals: pt.normals?.length === pt.triangles.length && (!scaled || opts.scale! > 0) ? pt.normals : undefined,
      color: pt.color ?? DEFAULT_COLOR,
    }));
  const meshes: MeshRef[] = parts.map((pt) => {
    const geometry = services.geometry.put(pt.triangles);
    return { geometry, ...(pt.normals ? { normals: services.geometry.put(pt.normals) } : {}), color: pt.color };
  });
  const obj = makeItem(ws, "object", name, { object: { meshes, ...(opts.source !== undefined ? { source: opts.source } : {}) } });
  if (opts.xyzrpw) obj.pose = xyzrpwToPose(opts.xyzrpw);
  if (opts.physics && Object.keys(opts.physics).length) obj.physics = opts.physics;
  tx.add(obj, opts.parent !== undefined ? requireRef(ws, opts.parent).id : defaultObjectParent(ws));
  tx.split(`Add: ${obj.name}`);
  if (opts.select !== false) tx.setMeta("selection", [obj.id]);
  return { id: obj.id, name: obj.name, handle: obj.handle, triangles: parts.reduce((n, pt) => n + pt.triangles.length / 9, 0) };
}

defineCommand({
  name: "library.search",
  title: "Search Robot Library",
  description:
    "Search the robot library (robots, tools, external axes; its example stations only when the option 'Show library example stations' is on — Enginuity's own example cells are listed by examples.list) by text and filters: brand, type ('6 DOF','SCARA','Delta','Palletizing','7 DOF'…), axes, payload (kg), reach (mm), application.",
  category: "library",
  readonly: true,
  undoable: false,
  spec: "LIB-SEARCH",
  schema: z.object({
    query: z.string().optional(),
    kind: z.enum(["robot", "tool", "axis", "station"]).optional(),
    brand: z.string().optional(),
    type: z.string().optional(),
    axes: z.number().int().optional(),
    payloadMin: z.number().optional(),
    payloadMax: z.number().optional(),
    reachMin: z.number().optional(),
    reachMax: z.number().optional(),
    application: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  async run({ services }, p) {
    if (!services.library) throw new CommandError("Robot library is only available on the server");
    const res = await services.library.search(p);
    return {
      total: res.total,
      items: res.items.map((e: LibraryEntry) => ({
        file: e.file,
        name: e.name,
        kind: e.kind,
        brand: e.brand,
        type: e.type,
        axes: e.axes,
        payload: e.payload,
        reach: e.reach,
        repeatability: e.repeatability,
        weight: e.weight,
      })),
    };
  },
});

defineCommand({
  name: "library.load",
  title: "Load From Library",
  description:
    "Add a robot (.robot), tool (.tool) or object from the robot library to the station, from the offline mirror when present (otherwise downloaded once and kept). Robots get a '<name> Base' frame; tools are attached to the selected/first robot. Item archives (.rdka: dual-arm robots, multi-part tools) are station files and open as a new active station.",
  category: "library",
  spec: "LIB-LOAD",
  schema: z.object({
    file: z.string().describe("library file name, e.g. 'UR5e.robot' (see library.search)"),
    kind: z.enum(["robot", "tool", "axis", "object"]).optional(),
    parent: ItemRef.optional(),
    robot: ItemRef.optional().describe("robot that receives a tool"),
    xyzrpw: XYZRPW.optional(),
  }),
  async run(ctx, p) {
    const { services } = ctx;
    if (!services.library) throw new CommandError("Robot library is only available on the server");
     
    if (/\.rdk$/i.test(p.file)) {
      const open = getCommand("station.openRdk");
      if (!open) throw new CommandError("Opening example stations is not available");
      return open.run(ctx, open.schema.parse({ file: p.file }));
    }
    let kind = p.kind ?? (p.file.toLowerCase().endsWith(".tool") ? "tool" : p.file.toLowerCase().endsWith(".robot") ? "robot" : "object");
     
    if (!p.kind && /\.rdka$/i.test(p.file)) kind = (await services.library.catalog()).find((e) => e.file === p.file)?.kind === "tool" ? "tool" : "robot";
    const { bytes } = await services.library.load(p.file, kind);
     
    const url = `library/${p.file}`;
    if (/\.rdka$/i.test(p.file)) {
       
      ctx.undoLabel = null;
      return { ...openStationFile(ctx, bytes, p.file.replace(/\.rdka$/i, "")), source: url };
    }
    if (kind === "robot" || kind === "axis") return addRobotFromBytes(ctx, bytes, p.file, { parent: p.parent, xyzrpw: p.xyzrpw, libraryFile: p.file, source: url });
     
     
     
    if (kind === "tool" && /\.robot$/i.test(p.file)) return addRobotFromBytes(ctx, bytes, p.file, { parent: p.robot ?? p.parent, xyzrpw: p.xyzrpw, libraryFile: p.file, source: url });
    if (kind === "tool") return addToolFromBytes(ctx, bytes, p.file, { robot: p.robot, source: url });
    const obj = addObjectFromBytes(ctx, bytes, p.file, { parent: p.parent, xyzrpw: p.xyzrpw, source: url, select: false });
    return { id: obj.id, name: obj.name };
  },
});

defineCommand({
  name: "library.mirror",
  title: "Download Library for Offline Use",
  description:
    "Download the whole robot library (catalog plus every robot, tool, external axis and example station file and thumbnail, about 4 GB) into the local offline mirror as a background job, so the library works offline. Files already mirrored are skipped, so it also resumes an interrupted run. `refresh` re-reads the catalog and revalidates every mirrored file. Follow progress with library.mirrorStatus.",
  category: "library",
  readonly: true,
  undoable: false,
  schema: z.object({
    refresh: z.boolean().default(false),
    concurrency: z.number().int().min(1).max(4).default(2).describe("parallel downloads"),
  }),
  run({ services }, p) {
    if (!services.library?.mirror) throw new CommandError("The offline library mirror is only available on the server");
    return services.library.mirror(p);
  },
});

defineCommand({
  name: "library.mirrorStatus",
  title: "Offline Library Status",
  description:
    "State of the offline robot library mirror: catalog items, files and thumbnails stored locally, bytes, whether a full mirror run completed, failures, and live progress of a running download.",
  category: "library",
  readonly: true,
  undoable: false,
  schema: z.object({}),
  run({ services }) {
    if (!services.library?.mirrorStatus) throw new CommandError("The offline library mirror is only available on the server");
    return services.library.mirrorStatus();
  },
});

defineCommand({
  name: "object.addShape",
  title: "Add Object (shape)",
  description:
    "Add a parametric object, in mm, optionally placed with xyzrpw: box (sizeX, sizeY, sizeZ), cylinder (radius, height), sphere (radius), roundedBox (sizeX, sizeY, sizeZ, cornerRadius), tube (radius, innerRadius, height) or extrusion (a 2D `profile` polygon in XY extruded along Z by `height`). Shapes stand on z = 0 centred on the object's XY origin; an extrusion keeps its profile's XY coordinates.",
  category: "item",
  spec: "TREE-ADD-OBJECT",
  schema: z.object({
    shape: z.enum(["box", "cylinder", "sphere", "roundedBox", "tube", "extrusion"]),
    name: z.string().optional(),
    sizeX: z.number().positive().default(200),
    sizeY: z.number().positive().default(200),
    sizeZ: z.number().positive().default(200),
    radius: z.number().positive().default(100),
    height: z.number().positive().default(200),
    cornerRadius: z.number().min(0).default(10).describe("roundedBox: radius of every edge and corner"),
    innerRadius: z.number().min(0).default(80).describe("tube: inner radius"),
    profile: z.array(z.array(z.number()).min(2)).min(3).optional().describe("extrusion: polygon [[x, y], …] in mm, not closed"),
    color: z.array(z.number()).min(3).max(4).optional(),
    parent: ItemRef.optional(),
    xyzrpw: XYZRPW.optional(),
  }),
  run({ ws, tx, services }, p) {
    if (p.shape === "extrusion" && !p.profile) throw new CommandError("An extrusion needs a profile: [[x, y], …] with at least 3 points");
    const tri =
      p.shape === "box"
        ? boxMesh(p.sizeX, p.sizeY, p.sizeZ)
        : p.shape === "cylinder"
          ? cylinderMesh(p.radius, p.height)
          : p.shape === "sphere"
            ? sphereMesh(p.radius)
            : p.shape === "roundedBox"
              ? roundedBoxMesh(p.sizeX, p.sizeY, p.sizeZ, p.cornerRadius)
              : p.shape === "tube"
                ? tubeMesh(p.radius, p.innerRadius, p.height)
                : extrudeMesh(p.profile!, p.height);
    if (!tri.length) throw new CommandError("The profile has no area to extrude");
    const geometry = services.geometry.put(tri);
    const color = (p.color ? [p.color[0], p.color[1], p.color[2], p.color[3] ?? 1] : [0.55, 0.62, 0.78, 1]) as [number, number, number, number];
    const st = activeStationId(ws);
    const name = p.name ?? `${p.shape[0].toUpperCase()}${p.shape.slice(1)}`;
    const obj = makeItem(ws, "object", name, { object: { meshes: [{ geometry, color }] }, pose: p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : eye() });
    void st;
    tx.add(obj, p.parent !== undefined ? requireRef(ws, p.parent).id : defaultObjectParent(ws));
    tx.split(`Add: ${obj.name}`);
    tx.setMeta("selection", [obj.id]);
    return { id: obj.id, name: obj.name, handle: obj.handle };
  },
});

defineCommand({
  name: "object.import",
  title: "Add Object (file)",
  description: "Import a mesh file (STL/OBJ, base64 content) as an object. `scale` converts units (e.g. 1000 for metres).",
  category: "item",
  spec: "FMT-MESH",
  schema: z.object({ fileName: z.string(), base64: z.string(), scale: z.number().default(1), parent: ItemRef.optional() }),
  run(ctx, p) {
    const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
    const obj = addObjectFromBytes(ctx, bytes, p.fileName, { parent: p.parent, scale: p.scale });
    return { id: obj.id, name: obj.name, triangles: obj.triangles };
  },
});
