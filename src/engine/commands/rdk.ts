// Reconstructs station items, robots and instructions from RDK payloads.
import { z } from "zod";
import { parseRdkFile } from "../kinematics";
import { eye, inv, mul, poseDistance, type Mat } from "../math";
import { APPROACH_KEYWORDS } from "../machining/apt";
import { newMachining } from "../machining/settings";
import { instructionName } from "../naming";
import { rewritePythonImports } from "../python-imports";
import { CommandError, defineCommand, status, type CmdCtx } from "../registry";
import { SyncImport } from "../sync/import";
import { isSynced } from "../sync/plan";
import type { InstructionData, Item, MachiningKind, MeshRef, ObjectData } from "../types";
import { absPose, makeItem } from "../workspace";
import { meshesFromParsed } from "./library";
import { robotDataFromParsed } from "./robot";
import { newStation } from "./station";

 
 
 

type Ref = number;
interface RdkInstruction {
  index: number;
  type: number;
  name: string;
  move_type?: number;
  target?: Ref;
  is_joint?: boolean;
  joints?: number[];
  pose?: Mat;
  refs?: Ref[];
   
  poses?: (Mat | null)[];
  speed?: { flags: number; linear: number; linear_accel: number; joint: number; joint_accel: number };
  ref?: Ref;
   
  flag?: number;
  pause_ms?: number;
   
  event?: { behavior: number; tool: Ref; frame: Ref; objects: Ref[]; poses?: Mat[]; parents?: Ref[]; option?: number; distance?: number };
  code_type?: number;
  text?: string;
  rounding?: number;
   
  io?: { mode: "set" | "wait"; name: string; value: string; timeout_ms: number };
  error?: string;
}
interface RdkItem {
  index: number;
  type: number;
  kind: string;
  parent: number;
  name: string;
  visible?: boolean;
  pose?: Mat;
  tcp?: Mat;
  links?: unknown[][];
  robot?: Record<string, unknown> | Ref;
  active_frame?: Ref;
  active_tool?: Ref;
   
  locked?: boolean;
   
  loop?: boolean;
   
  sync?: Ref[];
  is_joint?: boolean;
  joints?: number[];
  instructions?: RdkInstruction[];
  html?: string;
  code?: string;
  reason?: string;
   
  points?: number[][];
  point_names?: string[];
  curves?: { name: string; rgba: [number, number, number, number]; points: number[][] }[];
   
  geometry_pose?: Mat;
   
  frame?: Ref;
  tool?: Ref;
  object?: Ref;
  program?: Ref;
  input_file?: string | null;
  project_kind?: number;
  path_items?: [number, number, number][];
  events?: Record<string, number | string>;
   
  approach?: number[][];
  retract?: number[][];
   
  params?: [string, string][];
   
  settings?: Record<string, number>;
   
  poses?: Partial<Record<"frame_offset" | "tool_orientation" | "path_to_tool", { pose: Mat; mode?: number; formula?: string }>>;
   
  apt_input?: RdkMatrix;
  apt_path?: RdkMatrix;
  robot_path?: RdkMatrix;
   
  extra?: { start_joints?: number[] };
   
  attach_distance?: number;
  data_params?: [string, number[]][];
   
  record_tail?: number[];
   
  flags?: number[];
}
 
export interface RdkMatrix {
  rows: number;
  cols: number;
  at: number;
}

 
export function matrixColumns(floats: Float32Array, m: RdkMatrix | undefined): number[][] {
  if (!m || !m.rows || !m.cols) return [];
  const start = floats.byteOffset + m.at * 4;
  const v = new Float64Array(floats.buffer.slice(start, start + m.rows * m.cols * 8));
  const out: number[][] = [];
  for (let c = 0; c < m.cols; c++) out.push(Array.from(v.subarray(c * m.rows, (c + 1) * m.rows)));
  return out;
}
interface RdkJson {
  name: string;
  version: number;
  view: Mat | null;
   
  file_info?: { flags: number; version: string; platform: string; build: number; date: number; min_build: number } | null;
  items: RdkItem[];
  skipped: RdkItem[];
  counts: { records: number; imported: number; skipped: number };
}

 
function bytesToBase64(bytes: number[]): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(bin);
}

const MOVE_TYPES: Record<number, InstructionData["moveType"]> = { 1: "joint", 2: "linear", 3: "circular", 5: "search" };
 
const PROJECT_KINDS: MachiningKind[] = ["machining", "curve", "point", "print3d"];







function approachSpec(cols: number[][] | undefined): string | undefined {
  if (!cols) return undefined;
  return cols
    .map((c) => {
      const word = APPROACH_KEYWORDS.find(([, code]) => code === c[0])?.[0] ?? String(c[0]);
      const count = c[0] >= 201 && c[0] <= 204 ? 2 : c[0] >= 101 && c[0] <= 104 ? 3 : 1;
      const vals = c.slice(1, 4);
      let n = vals.length;
      while (n > count && vals[n - 1] === 0) n--;
      return [word, ...vals.slice(0, n).map((v) => String(v))].join(" ");
    })
    .join("; ");
}

 
function placeRow(g: Mat, r: number[]): number[] {
  const out = r.slice();
  for (let k = 0; k < 3; k++) out[k] = g[k * 4] * (r[0] ?? 0) + g[k * 4 + 1] * (r[1] ?? 0) + g[k * 4 + 2] * (r[2] ?? 0) + g[k * 4 + 3];
  if (r.length >= 6) for (let k = 0; k < 3; k++) out[3 + k] = g[k * 4] * r[3] + g[k * 4 + 1] * r[4] + g[k * 4 + 2] * r[5];
  return out;
}








function placedShapes(links: unknown[][] | undefined, floats: Float32Array, g: Mat): { links: unknown[][]; floats: Float32Array } {
  type Shape = { triangles: number; positions: number; normals: number };
  const all = (links ?? []) as Shape[][];
  const out = new Float32Array(all.flat().reduce((n, sh) => n + Math.max(0, sh.triangles) * 18, 0));
  let o = 0;
  const copy = (from: number, n: number, w: number) => {
    const at = o;
    for (let i = 0; i + 2 < n; i += 3) {
      const x = floats[from + i];
      const y = floats[from + i + 1];
      const z = floats[from + i + 2];
      for (let k = 0; k < 3; k++) out[at + i + k] = g[k * 4] * x + g[k * 4 + 1] * y + g[k * 4 + 2] * z + w * g[k * 4 + 3];
    }
    o += n;
    return at;
  };
  const placed = all.map((shapes) =>
    shapes.map((sh) => {
      const n = Math.max(0, sh.triangles) * 9;
      return { ...sh, positions: copy(sh.positions, n, 1), normals: copy(sh.normals, n, 0) };
    }),
  );
  return { links: placed, floats: out };
}

 
function featuresOf(src: RdkItem): Partial<ObjectData> {
  const out: Partial<ObjectData> = {};
  const g = src.geometry_pose;
  const place = (rows: number[][]) => (g ? rows.map((r) => placeRow(g, r)) : rows);
  if (src.curves?.length) out.curves = src.curves.map((c) => ({ points: place(c.points), ...(c.name ? { name: c.name } : {}), color: c.rgba }));
  if (src.points?.length) {
    out.points = place(src.points);
    const names = Object.fromEntries((src.point_names ?? []).map((n, i) => [i, n] as const).filter(([, n]) => !!n));
    if (Object.keys(names).length) out.pointNames = names;
  }
  return out;
}
 
const EVENT_ACTIONS: Record<number, NonNullable<InstructionData["event"]>["action"]> = { 0: "attach", 1: "detach", 2: "show", 3: "hide", 4: "move", 5: "move", 6: "home", 7: "conveyor", 8: "create", 9: "remove", 10: "wait" };

 
const samePose = (a: Mat, b: Mat) => {
  const d = poseDistance(a, b);
  return d.mm < 1e-6 && d.deg < 1e-6;
};

 
function ioFromName(name: string): InstructionData["io"] | undefined {
  const m = /^(Set|Wait) (.+?)=(\S+)(?: T(\d+(?:\.\d+)?)(ms|s))?$/.exec(name);
  if (!m) return undefined;
  const pre = /^(IO|AO)_(\d+)$/.exec(m[2]);
  const timeout = m[4] ? Number(m[4]) * (m[5] === "s" ? 1000 : 1) : undefined;
  return { mode: m[1] === "Set" ? "set" : "wait", name: pre ? pre[2] : m[2], value: m[3], timeoutMs: timeout, analog: pre?.[1] === "AO" || undefined };
}

function importStation(ctx: CmdCtx, rdk: RdkJson, floats: Float32Array, fallbackName: string) {
  const { ws, tx, services } = ctx;
  const station = newStation(ctx, rdk.name || fallbackName);
  const put = (t: Float32Array) => services.geometry.put(t);
  const ids = new Map<number, string>();
  const parentOf = new Map<number, number>();
  for (const it of [...rdk.items, ...rdk.skipped]) parentOf.set(it.index, it.parent);
  const stationRecord = rdk.items.find((i) => i.kind === "station")?.index ?? 0;
  ids.set(stationRecord, station.id);
  ids.set(-1, station.id);
   
   
   
  const stationSrc = rdk.items.find((i) => i.kind === "station");
  const stored = stationSrc?.params ?? [];
  if (stored.length) tx.set(station.id, { stationParams: stored.map(([name, value]) => [name, value] as [string, string]) });
   
   
  const info = rdk.file_info;
  const extra: NonNullable<Item["rdk"]> = {
    ...(stationSrc?.attach_distance !== undefined ? { attachDistance: stationSrc.attach_distance } : {}),
    ...(stationSrc?.data_params?.length ? { dataParams: stationSrc.data_params.map(([k, b]) => [k, bytesToBase64(b)] as [string, string]) } : {}),
    ...(info ? { savedWith: { version: info.version, platform: info.platform, build: info.build, date: info.date } } : {}),
    ...(rdk.view ? { view: rdk.view } : {}),
  };
  if (Object.keys(extra).length) tx.set(station.id, { rdk: extra });

   
  const parentId = (index: number): string => {
    let p = parentOf.get(index) ?? -1;
    for (let guard = 0; guard < 10_000; guard++) {
      const id = ids.get(p);
      if (id) return id;
      p = parentOf.get(p) ?? -1;
    }
    return station.id;
  };
  const refId = (ref: Ref | undefined) => (ref !== undefined && ref >= 0 ? ids.get(ref) ?? null : null);
  const add = (src: RdkItem, item: Item) => {
    item.visible = src.visible ?? true;
    tx.add(item, parentId(src.index));
    ids.set(src.index, item.id);
    return item;
  };
  const meshesOf = (links: unknown[][] | undefined): MeshRef[] => meshesFromParsed({ links: links ?? [] }, floats, put).flat();
   
  const geometryOf = (src: RdkItem): { meshes: MeshRef[]; geometryPose?: Mat } => {
    const g = src.geometry_pose;
    if (!g) return { meshes: meshesOf(src.links) };
    const p = placedShapes(src.links, floats, g);
    return { meshes: meshesFromParsed({ links: p.links }, p.floats, put).flat(), geometryPose: g };
  };

   
  const robots: { src: RdkItem; id: string }[] = [];
  const programs: RdkItem[] = [];
  const projects: RdkItem[] = [];
  for (const src of rdk.items) {
    switch (src.kind) {
      case "station":
        break;
      case "frame":
        add(src, makeItem(ws, "frame", src.name, { pose: src.pose ?? eye() }));
        break;
      case "robot": {
        const json = src.robot as Record<string, unknown>;
         
        const data = robotDataFromParsed(json, meshesFromParsed(json, floats, put));
        const r = add(src, makeItem(ws, "robot", src.name, { robot: { ...data, activeFrame: null }, ...(src.record_tail?.length ? { rdk: { robotTail: bytesToBase64(src.record_tail) } } : {}) }));
        robots.push({ src, id: r.id });
        break;
      }
      case "tool":
         
        add(src, makeItem(ws, "tool", src.name, { pose: src.tcp ?? eye(), tool: geometryOf(src), ...(src.locked ? { locked: true } : {}) }));
        break;
      case "object":
         
        add(src, makeItem(ws, "object", src.name, { pose: src.pose ?? eye(), object: { ...geometryOf(src), source: "rdk", ...featuresOf(src) }, ...(src.locked ? { locked: true } : {}) }));
        break;
      case "machining":
         
        projects.push(src);
        add(src, makeItem(ws, "machining", src.name, { machining: newMachining(PROJECT_KINDS[src.project_kind ?? 1] ?? "curve", null) }));
        break;
      case "target":
        add(src, makeItem(ws, "target", src.name, { pose: src.pose ?? eye(), target: { joints: src.joints ?? [], isJoint: !!src.is_joint, robot: null } }));
        break;
      case "folder":
        add(src, makeItem(ws, "folder", src.name));
        break;
      case "notes":
        add(src, makeItem(ws, "notes", src.name, { notes: { html: src.html ?? "" } }));
        break;
      case "python":
         
        add(src, makeItem(ws, "python", src.name, { python: { code: rewritePythonImports(src.code ?? "") } }));
        break;
      case "program":
        programs.push(src);
         
        add(src, makeItem(ws, "program", src.name, { program: { robot: null }, ...(src.loop ? { params: { Loop: "1" } } : {}), ...(src.flags ? { rdk: { programFlags: src.flags } } : {}) }));
        break;
      default:
        break;
    }
  }

   
  for (const { src, id } of robots) {
    const r = ws.items[id];
    const sync = (src.sync ?? []).map(refId).filter((x): x is string => !!x && !!ws.items[x]?.robot);
    tx.set(id, { robot: { ...r.robot!, activeFrame: refId(src.active_frame), activeTool: refId(src.active_tool), ...(sync.length ? { sync } : {}) } });
  }
  for (const src of rdk.items) {
    if (src.kind !== "target") continue;
    const id = ids.get(src.index)!;
    const t = ws.items[id];
    tx.set(id, { target: { ...t.target!, robot: refId(src.robot as Ref) } });
  }
  for (const src of projects) {
    const id = ids.get(src.index)!;
    const m = ws.items[id].machining!;
     
     
    const items = src.path_items ?? [];
    const indices = items.map((p) => p[0]);
    const flagged = items.filter((p) => p[2] !== 0).map((p) => p[0]);
    const pose = (key: "frame_offset" | "tool_orientation" | "path_to_tool") => {
      const p = src.poses?.[key]?.pose;
      return p && !p.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12) ? p : null;
    };
    const file = src.input_file && src.input_file !== "CAM" ? src.input_file : null;
     
     
    const apt = m.kind === "machining" || m.kind === "print3d" ? matrixColumns(floats, src.apt_input) : [];
    const curveLike = m.kind === "curve" || m.kind === "point";
    tx.set(id, {
      machining: {
        ...m,
        robot: refId(src.robot as Ref),
        frame: refId(src.frame),
        tool: refId(src.tool),
        program: refId(src.program),
        settings: { ...m.settings, ...src.settings },
        events: { ...m.events, ...src.events },
        approach: approachSpec(src.approach) ?? m.approach,
        retract: approachSpec(src.retract) ?? m.retract,
        input: curveLike
          ? {
              object: refId(src.object),
              curves: indices.length ? indices : null,
              reversed: m.kind === "curve" && flagged.length ? flagged : null,
              flipped: m.kind === "point" && flagged.length ? flagged : null,
            }
          : { ...(file ? { nc: { file, text: "" } } : { object: refId(src.object) }), ...(apt.length ? { apt } : {}) },
        pathToTool: pose("path_to_tool"),
        frameOffset: pose("frame_offset"),
        toolOrientation: pose("tool_orientation"),
        startJoints: src.extra?.start_joints?.length ? src.extra.start_joints : null,
      },
    });
  }

   
  let instructions = 0;
  for (const src of programs) {
    const pid = ids.get(src.index)!;
    const progRobot = refId(src.robot as Ref);
    tx.set(pid, { program: { robot: progRobot } });
     
     
    const robotItem = progRobot ? ws.items[progRobot] : undefined;
    const baseAbs = () => (robotItem?.robot ? absPose(ws, robotItem.id) : eye());
    const active = robotItem?.robot?.activeFrame && ws.items[robotItem.robot.activeFrame] ? robotItem.robot.activeFrame : null;
    let frameAbs: Mat | null = null;
     
    const nq = robotItem?.robot?.model.nq ?? Infinity;
    const synced = (src.instructions ?? []).some((i) => i.type === 0 && (i.joints?.length ?? 0) > nq);
     
    const syncImp = robotItem && isSynced(ws, robotItem) ? new SyncImport(ws, robotItem) : null;
    for (const ins of src.instructions ?? []) {
      let data: InstructionData;
      switch (ins.type) {
        case 0: {
          const target = refId(ins.target);
          const index = /\s(\d+)$/.exec(ins.name)?.[1];
          if (target) data = { kind: "move", moveType: MOVE_TYPES[ins.move_type ?? 1] ?? "joint", target };
          else {
            const rel = ins.pose ?? null;
            const pose = rel ? (syncImp ? syncImp.place(rel, ins.joints) : mul(frameAbs ?? (active ? absPose(ws, active) : baseAbs()), rel)) : undefined;
            data = { kind: "move", moveType: MOVE_TYPES[ins.move_type ?? 1] ?? "joint", joints: ins.is_joint ? ins.joints : undefined, pose, index: index ? Number(index) : undefined };
             
             
             
            if (!ins.is_joint && ins.joints?.length) data.refJoints = ins.joints;
          }
          break;
        }
        case 1: {
           
          const refs = (ins.refs ?? []).map(refId).filter((r): r is string => !!r && ws.items[r]?.type === "target");
          const [via, end] = ins.poses ?? [];
          const place = (rel: Mat, q?: number[] | null) => (syncImp ? syncImp.place(rel, q) : mul(frameAbs ?? (active ? absPose(ws, active) : baseAbs()), rel));
          const viaEnd = ins.joints as unknown as (number[] | null)[] | undefined;
          data = {
            kind: "movec",
            moveType: "circular",
            target: via ? null : refs.shift() ?? null,
            target2: end ? null : refs.shift() ?? null,
            ...(via ? { pose: place(via, viaEnd?.[0]) } : {}),
            ...(end ? { pose2: place(end, viaEnd?.[1]) } : {}),
          };
          break;
        }
        case 2: {
          const s = ins.speed;
          const f = s?.flags ?? 1;
          data = {
            kind: "speed",
            speed: { linear: f & 1 ? s!.linear : -1, linearAccel: f & 2 ? s!.linear_accel : -1, joint: f & 4 ? s!.joint : -1, jointAccel: f & 8 ? s!.joint_accel : -1 },
          };
          break;
        }
        case 3: {
           
           
           
           
           
           
          const frame = refId(ins.ref);
          if (syncImp) {
             
            data = syncImp.setRef(frame, ins.pose, ins.flag);
            break;
          }
          const ref = frame && synced ? absPose(ws, ws.items[frame].parent ?? frame) : baseAbs();
          const stored = ins.pose ? mul(ref, ins.pose) : null;
          const forced = !!stored && (!frame || (ins.flag === 1 && !samePose(stored, absPose(ws, frame))));
          frameAbs = forced ? stored : frame ? absPose(ws, frame) : frameAbs;
          data = { kind: "frame", frame, ...(stored ? { pose: mul(inv(baseAbs()), stored) } : {}), ...(forced && frame ? { forcePose: true } : {}) };
          break;
        }
        case 4: {
          const tool = refId(ins.ref);
          const forced = !!ins.pose && ins.flag === 1 && !!tool && !samePose(ins.pose, ws.items[tool].pose);
          data = { kind: "tool", tool, ...(ins.pose ? { pose: ins.pose } : {}), ...(forced ? { forcePose: true } : {}) };
          break;
        }
        case 5:
          data = { kind: "robot", robot: refId(ins.ref) };
          break;
        case 6:
          data = { kind: "pause", pauseMs: ins.pause_ms ?? -1 };
          break;
        case 7: {
          const e = ins.event;
           
          const positions = e?.poses?.length
            ? e.poses
                .map((pose, i) => ({ item: refId(e.objects[i]), parent: refId(e.parents?.[i]), pose }))
                .filter((x): x is { item: string; parent: string | null; pose: Mat } => !!x.item)
            : undefined;
          data = {
            kind: "event",
            event: {
              action: EVENT_ACTIONS[e?.behavior ?? -1] ?? "replace",
              tool: refId(e?.tool),
              frame: refId(e?.frame),
              objects: (e?.objects ?? []).map(refId).filter((x): x is string => !!x),
              distance: e?.distance ?? 200,
              option: e?.option ?? 0,
              ...(positions ? { positions, relative: e?.behavior === 5 } : {}),
            },
          };
          break;
        }
        case 8:
          data = { kind: "code", codeType: ins.code_type ?? 1, text: ins.text ?? ins.name };
          break;
        case 9:
          data = { kind: "print", text: ins.text ?? ins.name.replace(/^Print:\s*/, "") };
          break;
        case 10:
          data = { kind: "rounding", rounding: ins.rounding ?? -1 };
          break;
        case 11: {
           
          const io = ins.io
            ? (() => {
                const pre = /^(IO|AO)_(\d+)$/.exec(ins.io.name);
                return { mode: ins.io.mode, name: pre ? pre[2] : ins.io.name, value: ins.io.value, timeoutMs: ins.io.timeout_ms >= 0 ? ins.io.timeout_ms : undefined, analog: pre?.[1] === "AO" || undefined };
              })()
            : ioFromName(ins.name);
          data = io ? { kind: "io", io } : { kind: "custom", text: ins.name };
          break;
        }
        default:
          data = { kind: "custom", text: ins.name };
      }
       
      const name = data.kind === "print" || data.kind === "code" ? data.text ?? "" : ins.name || instructionName(ws, data);
       
      const params = data.kind === "event" && ins.event ? { Behavior: String(ins.event.behavior) } : undefined;
      tx.add(makeItem(ws, "instruction", name, { instruction: data, ...(params ? { params } : {}) }), pid);
      instructions += 1;
    }
  }

  return { station, instructions };
}





 
export const STATION_FILE_CORRUPTED = "Problems reading file: The Enginuity Station file is corrupted or there's not enough available space. Errors will follow.";

export function openStationFile(ctx: CmdCtx, bytes: Uint8Array, label: string, file?: string) {
  let parsed: ReturnType<typeof parseRdkFile>;
  try {
    parsed = parseRdkFile(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
     
    throw new CommandError(/Station File|Control string|Problems reading file/i.test(msg) ? msg : STATION_FILE_CORRUPTED);
  }
  const rdk = parsed.json as unknown as RdkJson;
   
  status(ctx, `Loading: ${file ?? label}`);
  const { station, instructions } = importStation(ctx, rdk, parsed.floats, label || "Station");
  if (file) ctx.tx.set(station.id, { file });
  const skipped = rdk.skipped.map((s) => ({ type: s.type, name: s.name, reason: s.reason }));
  status(ctx, "Loading finished.");
  return {
    id: station.id,
    name: ctx.ws.items[station.id].name,
    imported: rdk.counts.imported - 1,
    instructions,
    skipped,
    view: rdk.view,
     
    fileInfo: rdk.file_info ?? null,
  };
}

defineCommand({
  name: "station.openRdk",
  title: "Open Example Station",
  description:
    "Open a station file (.rdk) as a new active station: a library station by `file` or file bytes as `base64`. For ready-made example cells use examples.list / examples.open; library stations are listed by library.search kind 'station' only when the option 'Show library example stations' is on. Frames, robots (with kinematics and meshes), tools, objects (with their curves and points), targets, programs and their instructions, folders, notes, Python programs and machining / curve follow / point follow / 3D printing projects (links, input and program events) are imported with their stored names and poses; other item types are reported as skipped. The station parameters stored in the file are set (station.getParam / RDK.getParam).",
  category: "station",
  undoable: false,
  spec: "R-SLF (station file part C)",
  schema: z.object({ file: z.string().optional(), base64: z.string().optional(), name: z.string().optional() }),
  async run(ctx, p) {
    let bytes: Uint8Array;
    let label = p.name ?? "";
    if (p.base64) bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
    else if (p.file) {
      if (!ctx.services.library) throw new CommandError("The robot library is only available on the server");
      bytes = (await ctx.services.library.load(p.file, "station")).bytes;
      label ||= p.file.replace(/\.rdk$/i, "");
    } else throw new CommandError("Provide a library station file or base64 data");
    return openStationFile(ctx, bytes, label);
  },
});
