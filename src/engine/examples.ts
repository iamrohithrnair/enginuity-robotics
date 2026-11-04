 
 
 
 
 
 
 

import { snapshotStation } from "./commands/station";
import type { GeometryStore } from "./registry";
import { remapItemRefs } from "./itemRefs";
import type { Item, MeshRef, RobotData, Workspace } from "./types";

 
export interface ExampleEntry {
   
  slug: string;
  name: string;
  description: string;
   
  features: string[];
   
  robots: string[];
   
  tools: string[];
   
  station: string;
   
  thumbnail: string;
   
  mainProgram: string;
  programs: string[];
   
  cycleTime?: number;
}

export interface ExampleCatalog {
  format: "enginuity-examples";
  version: 1;
  examples: ExampleEntry[];
}

 
export interface LibraryRef {
  item: string;
  file: string;
   
  kind: "robot" | "tool" | "axis";
}

export interface StationFile {
  format: string;
  version: number;
  name: string;
  root: string;
  items: Item[];
   
  geometry?: Record<string, string>;
  library?: LibraryRef[];
}

export const EXAMPLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

 
const ROBOT_STATE: (keyof RobotData)[] = ["joints", "home", "postProcessor", "speeds", "libraryFile", "activeTool", "activeFrame", "rounding", "tcp", "framePose"];

export function hasLibraryRefs(data: unknown): data is StationFile {
  const d = data as StationFile | null;
  return !!d && (Array.isArray(d.library) || (!!d.geometry && typeof d.geometry === "object"));
}

 
export function robotState(r: Partial<RobotData>): Partial<RobotData> {
  const out: Partial<RobotData> = {};
  for (const k of ROBOT_STATE) if (r[k] !== undefined) (out as Record<string, unknown>)[k] = r[k];
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

 
export async function encodeTriangles(t: Float32Array): Promise<string> {
  return toBase64(await pipe(new Uint8Array(t.buffer, t.byteOffset, t.byteLength), new CompressionStream("gzip")));
}

export async function decodeTriangles(s: string): Promise<Float32Array> {
  const raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const bytes = await pipe(raw, new DecompressionStream("gzip"));
  if (bytes.byteLength % 4) throw new Error("Bad mesh data");
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}






export async function packStation(ws: Workspace, store: GeometryStore, stationId: string, library: Map<string, { file: string; kind: LibraryRef["kind"] }>): Promise<StationFile> {
  const snap = snapshotStation(ws, stationId);
  const ids = new Map<string, string>();
  snap.items.forEach((it, i) => ids.set(it.id, `${it.type.slice(0, 3)}${i}`));
  const remap = (id: string | null | undefined) => (id && ids.has(id) ? ids.get(id)! : null);
  const geoIds = new Map<string, string>();
  const geometry: Record<string, string> = {};
  const embed = async (m: MeshRef): Promise<MeshRef> => {
    const one = async (g: string) => {
      if (!geoIds.has(g)) {
        const t = store.get(g);
        if (!t) throw new Error(`Mesh ${g} is missing from the geometry store`);
        const key = `g${geoIds.size + 1}`;
        geoIds.set(g, key);
        geometry[key] = await encodeTriangles(t);
      }
      return geoIds.get(g)!;
    };
    return { geometry: await one(m.geometry), ...(m.normals ? { normals: await one(m.normals) } : {}), color: m.color };
  };
  const refs: LibraryRef[] = [];
  const items: Item[] = [];
  for (const src of snap.items) {
    const it = remapItemRefs(structuredClone(src), remap);
    it.id = ids.get(src.id)!;
    it.parent = src.id === snap.root ? null : remap(src.parent);
    it.children = src.children.map((c) => ids.get(c)).filter((c): c is string => !!c);
    it.handle = 0;
    delete it.file;
    if (it.program?.lastUpdate) delete it.program.lastUpdate;
    const lib = library.get(src.id) ?? (it.robot?.libraryFile ? { file: it.robot.libraryFile, kind: "robot" as const } : undefined);
    if (lib && (it.robot || it.tool)) {
      refs.push({ item: it.id, file: lib.file, kind: lib.kind });
      if (it.robot) it.robot = robotState(it.robot) as RobotData;
      if (it.tool) it.tool = { ...it.tool, meshes: [] };
    } else {
      if (it.robot) {
        delete it.robot.connection;
        it.robot.links = await Promise.all(it.robot.links.map((l) => Promise.all(l.map(embed))));
      }
      if (it.tool) it.tool.meshes = await Promise.all(it.tool.meshes.map(embed));
      if (it.object) it.object.meshes = await Promise.all(it.object.meshes.map(embed));
    }
    items.push(it);
  }
  return { format: snap.format, version: snap.version, name: snap.name, root: ids.get(snap.root)!, items, geometry, library: refs };
}
