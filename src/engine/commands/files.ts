 
 
 
 

import { STATION_FORMATS } from "./station";
import { z } from "zod";
import { requireRef } from "../dispatch";
import { MESH_EXTENSIONS, parseMeshParts } from "../meshio";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";
import { makeItem } from "../workspace";
import { parseRobotFile } from "../kinematics";
import { addObjectFromBytes, addRobotFromBytes, addToolFromBytes, defaultObjectParent, meshesFromParsed } from "./library";
import { openStationFile } from "./rdk";
import { isStationFile, stationFileBase } from "../stationFile";

export interface OpenedFile {
   
  name: string;
  bytes: Uint8Array;
   
  path?: string;
}

export interface FileOpenOptions {
   
  robot?: string | number;
   
  parent?: string | number;
   
  asTool?: boolean;
}

export type FileHandler = (ctx: CmdCtx, file: OpenedFile, opts: FileOpenOptions) => unknown | Promise<unknown>;

const handlers = new Map<string, FileHandler>();





export function registerFileHandler(extensions: string[], handler: FileHandler) {
  for (const e of extensions) handlers.set(e.toLowerCase().replace(/^\./, ""), handler);
}

 
export function fileExtension(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").toLowerCase();
  if (isStationFile(base)) return "mech";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1);
}

const STATION_EXT = new Set(["rdk", "rdka", "rdkbak"]);
const CAD_EXT = new Set(["stp", "step", "igs", "iges"]);
 
const PROGRAM_EXT = new Set(["mod", "modx", "cfg", "sys", "src", "ncp", "script", "jbi", "prm", "urp", "ls", "cnd"]);

 
export const STEP_NOT_SUPPORTED =
  "Importing STEP or IGES files is not supported on this version of Enginuity.";

 
function urlFromShortcut(bytes: Uint8Array): string | null {
  const m = /^\s*URL\s*=\s*(\S+)\s*$/im.exec(new TextDecoder().decode(bytes));
  return m ? m[1] : null;
}

 
export async function openFileBytes(ctx: CmdCtx, file: OpenedFile, opts: FileOpenOptions = {}): Promise<Record<string, unknown>> {
  const ext = fileExtension(file.name);
  const label = file.path ?? file.name;
  const base = isStationFile(file.name) ? stationFileBase(file.name) : file.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
   
  ctx.undoLabel = null;
  let result: Record<string, unknown>;
  if (STATION_EXT.has(ext)) {
    result = { kind: "station", ...openStationFile(ctx, file.bytes, base, file.path) };
  } else if (ext === "mech" || ext === "json") {
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(file.bytes));
    } catch {
      throw new CommandError("Problems reading file: The Enginuity Station file is corrupted or there's not enough available space. Errors will follow.");
    }
    if (!STATION_FORMATS.includes(String((data as { format?: string })?.format))) throw new CommandError(`File format not supported: ${file.name}`);
    status(ctx, `Loading: ${label}`);
     
    const { openStationFileData } = await import("./examples");
    result = { kind: "station", ...(await openStationFileData(ctx, data, label, file.path)) };
    status(ctx, "Loading finished.");
  } else if (ext === "robot") {
    status(ctx, `Loading: ${label}`);
    result = { kind: "robot", ...addRobotFromBytes(ctx, file.bytes, file.name, { parent: opts.parent, source: label }) };
    status(ctx, "Loading finished.");
  } else if (ext === "tool") {
    status(ctx, `Loading: ${label}`);
    result = { kind: "tool", ...addToolFromBytes(ctx, file.bytes, file.name, { robot: opts.robot, source: label }) };
    status(ctx, "Loading finished.");
  } else if (ext === "sld") {
    status(ctx, `Loading: ${label}`);
    result = { kind: "object", ...addSldObject(ctx, file, { parent: opts.parent, source: label }) };
    status(ctx, "Loading finished.");
  } else if (handlers.has(ext)) {
    status(ctx, `Loading: ${label}`);
    result = { kind: ext, ...((await handlers.get(ext)!(ctx, file, opts)) as Record<string, unknown>) };
    status(ctx, "Loading finished.");
  } else if (MESH_EXTENSIONS.has(ext)) {
    status(ctx, `Loading: ${label}`);
    try {
      if (opts.asTool && opts.robot !== undefined) result = { kind: "tool", ...addMeshTool(ctx, file, opts.robot, label) };
      else result = { kind: "object", ...addObjectFromBytes(ctx, file.bytes, file.name, { parent: opts.parent, source: label }) };
    } catch (e) {
      if (e instanceof CommandError) throw e;
      throw new CommandError(e instanceof Error ? e.message : String(e));
    }
    status(ctx, "Loading finished.");
  } else if (CAD_EXT.has(ext)) {
    if (!ctx.services.cad) throw new CommandError(STEP_NOT_SUPPORTED, "not_supported");
     
    const mode = await stepImportMode(ctx, ext, label);
    if (mode === "cancel") return { kind: "cancelled", file: label };
    status(ctx, `Loading: ${label}`);
    let cad: Awaited<ReturnType<NonNullable<typeof ctx.services.cad>["importCad"]>>;
    try {
      cad = await ctx.services.cad.importCad(file.bytes, ext);
    } catch (e) {
      throw new CommandError(`Problems reading file: ${file.name} (${e instanceof Error ? e.message : String(e)})`);
    }
    const stats = cad.faces !== undefined ? { faces: cad.faces, facesNotMeshed: cad.failed ?? 0 } : {};
    const partCount = new Set(cad.meshes.filter((m) => m.triangles.length).map((m) => m.part ?? 0)).size;
    if (mode === "assembly" && partCount > 1) result = { kind: "assembly", ...addCadAssembly(ctx, base, cad, { parent: opts.parent, source: label }), ...stats };
    else result = { kind: "object", ...addCadObject(ctx, base, mergeByColor(cad.meshes), { parent: opts.parent, source: label }), ...stats };
    status(ctx, "Loading finished.");
  } else if (ext === "url") {
    const url = urlFromShortcut(file.bytes);
    if (!url) throw new CommandError(`File format not supported: ${file.name}`);
    status(ctx, `Opening URL link: ${url}`);
    result = { kind: "url", openUrl: url };
  } else if (PROGRAM_EXT.has(ext)) {
    throw new CommandError(`Importing robot programs (.${ext}) is not available in Enginuity: ${file.name}`, "not_supported");
  } else {
    throw new CommandError(`File format not supported: ${file.name}`, "not_supported");
  }
   
  if (file.path && (ctx.origin === "ui" || ctx.origin === "agent")) ctx.services.files?.pushRecent?.(file.path);
  return result;
}

 
function addMeshTool(ctx: CmdCtx, file: OpenedFile, robotRef: string | number, source: string) {
  const { ws, tx, services } = ctx;
  const robot = requireRef(ws, robotRef, "robot");
  if (!robot.robot) throw new CommandError("Select robot first");
  const parts = parseMeshParts(file.name, file.bytes);
  const meshes = parts.map((pt) => ({ geometry: services.geometry.put(pt.triangles), color: pt.color ?? ([0.86, 0.87, 0.9, 1] as [number, number, number, number]) }));
  const tool = makeItem(ws, "tool", file.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""), { tool: { meshes } });
  tx.add(tool, robot.id);
  const rd = ws.items[robot.id].robot!;
  if (!rd.activeTool || !ws.items[rd.activeTool]) tx.set(robot.id, { robot: { ...rd, activeTool: tool.id } });
  tx.split(`Add: ${tool.name}`);
  return { id: tool.id, name: tool.name, robot: robot.name, source };
}





function addSldObject(ctx: CmdCtx, file: OpenedFile, opts: { parent?: string | number; source?: string }) {
  const { ws, tx, services } = ctx;
  let parsed: ReturnType<typeof parseRobotFile>;
  try {
    parsed = parseRobotFile(file.bytes);
  } catch (e) {
    throw new CommandError(`Problems reading file: ${file.name} (${e instanceof Error ? e.message : String(e)})`);
  }
  const meshes = meshesFromParsed(parsed.json, parsed.floats, (t) => services.geometry.put(t)).flat();
  if (!meshes.length) throw new CommandError(`No geometry found in ${file.name}`);
  const name = String(parsed.json.name || file.name.replace(/^.*[\\/]/, "").replace(/\.sld$/i, ""));
  const obj = makeItem(ws, "object", name, { object: { meshes, source: opts.source ?? file.name } });
  tx.add(obj, opts.parent !== undefined ? requireRef(ws, opts.parent).id : defaultObjectParent(ws));
  tx.split(`Add: ${obj.name}`);
  tx.setMeta("selection", [obj.id]);
  return { id: obj.id, name: obj.name, handle: obj.handle, meshes: meshes.length };
}







export async function stepImportMode(ctx: CmdCtx, ext: string, label: string): Promise<"object" | "assembly" | "cancel"> {
  if (ext !== "stp" && ext !== "step") return "object";
  const action = Number(ctx.services.settings.ImportStepAction ?? 1);
  if (action === 2) return "assembly";
  if (action !== 0 || ctx.origin === "api" || !ctx.services.ask) return "object";
  const answer = await ctx.services.ask(`Import as assembly or single object?<br>${label}`, ["Assembly", "Object", "Cancel"]);
  return answer === "Assembly" ? "assembly" : answer === "Object" ? "object" : "cancel";
}






function addCadAssembly(
  ctx: CmdCtx,
  name: string,
  cad: { meshes: { triangles: Float32Array; color: [number, number, number, number]; part?: number }[]; parts?: string[] },
  opts: { parent?: string | number; source?: string },
) {
  const { ws, tx, services } = ctx;
  const frame = makeItem(ws, "frame", name);
  tx.add(frame, opts.parent !== undefined ? requireRef(ws, opts.parent).id : defaultObjectParent(ws));
  const byPart = new Map<number, typeof cad.meshes>();
  for (const m of cad.meshes) if (m.triangles.length) byPart.set(m.part ?? 0, [...(byPart.get(m.part ?? 0) ?? []), m]);
  const objects: { id: string; name: string }[] = [];
  for (const [part, meshes] of [...byPart.entries()].sort((a, b) => a[0] - b[0])) {
    const label = cad.parts?.[part]?.trim() || `${name} ${objects.length + 1}`;
    const obj = makeItem(ws, "object", label, { object: { meshes: meshes.map((m) => ({ geometry: services.geometry.put(m.triangles), color: m.color })), source: opts.source } });
    tx.add(obj, frame.id);
    objects.push({ id: obj.id, name: obj.name });
  }
  tx.split(`Add: ${frame.name}`);
  tx.setMeta("selection", [frame.id]);
  return { id: frame.id, name: frame.name, handle: frame.handle, objects };
}

 
function mergeByColor(meshes: { triangles: Float32Array; color: [number, number, number, number] }[]) {
  const by = new Map<string, { triangles: Float32Array[]; color: [number, number, number, number] }>();
  for (const m of meshes) {
    const k = m.color.join(",");
    const e = by.get(k) ?? { triangles: [], color: m.color };
    e.triangles.push(m.triangles);
    by.set(k, e);
  }
  return [...by.values()].map(({ triangles, color }) => {
    const out = new Float32Array(triangles.reduce((n, t) => n + t.length, 0));
    let o = 0;
    for (const t of triangles) {
      out.set(t, o);
      o += t.length;
    }
    return { triangles: out, color };
  });
}

 
function addCadObject(
  ctx: CmdCtx,
  name: string,
  meshes: { triangles: Float32Array; color: [number, number, number, number] }[],
  opts: { parent?: string | number; source?: string },
) {
  const { ws, tx, services } = ctx;
  const refs = meshes.filter((m) => m.triangles.length).map((m) => ({ geometry: services.geometry.put(m.triangles), color: m.color }));
  if (!refs.length) throw new CommandError(`No geometry found in ${name}`);
  const obj = makeItem(ws, "object", name, { object: { meshes: refs, source: opts.source } });
  tx.add(obj, opts.parent !== undefined ? requireRef(ws, opts.parent).id : defaultObjectParent(ws));
  tx.split(`Add: ${obj.name}`);
  tx.setMeta("selection", [obj.id]);
  return { id: obj.id, name: obj.name, handle: obj.handle, meshes: refs.length, triangles: meshes.reduce((n, m) => n + m.triangles.length / 9, 0) };
}

 
export async function openPath(ctx: CmdCtx, path: string, opts: FileOpenOptions) {
  const files = ctx.services.files;
  if (!files?.readFile) throw new CommandError("Opening files from disk is only available on the server");
  const bytes = await files.readFile(path);
  return openFileBytes(ctx, { name: path.replace(/^.*[\\/]/, ""), bytes, path }, opts);
}

defineCommand({
  name: "file.open",
  title: "Open",
  description:
    "Open a file like File ▸ Open or a file dropped on the window: Enginuity stations (.mech) and imported robot stations (.rdk, .rdka, .rdkbak) open as a new station; .robot adds a robot under '<name> Base'; .tool adds a tool to `robot` (required when there are several robots); meshes (STL, OBJ, PLY, VRML/WRL, 3DS, DAE, GLB/GLTF, SLP), object files (.sld) and CAD (STEP, IGES) become objects in mm; .csv/.txt point lists and curves, CAM programs and .py scripts open through their features. Give `path` (absolute path on this computer) or `fileName` + `base64` content.",
  category: "station",
  shortcut: "Ctrl+O",
  spec: "R-SLF-31, R-SLF-32, R-SLF-33, R-SLF-34",
  schema: z.object({
    path: z.string().optional().describe("absolute path of the file on the Enginuity computer"),
    fileName: z.string().optional().describe("file name (with extension) when sending the content as base64"),
    base64: z.string().optional(),
    robot: ItemRef.optional().describe("robot that receives a tool"),
    parent: ItemRef.optional().describe("parent item for robots and objects"),
  }),
  async run(ctx, p) {
    const opts = { robot: p.robot, parent: p.parent };
    if (p.path) return openPath(ctx, p.path, opts);
    if (!p.fileName || p.base64 === undefined) throw new CommandError("Provide a file path, or a file name and its base64 content");
    const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
    return openFileBytes(ctx, { name: p.fileName, bytes }, opts);
  },
});
