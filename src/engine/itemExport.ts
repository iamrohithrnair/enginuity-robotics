// Collects item geometry and writes exports in supported mesh formats.
 
 

import { type ExportMesh, transformTriangles, writePLY, writeSldFile, writeSTL, writeToolFile, writeWRL } from "./exporters";
import { mul, type Mat } from "./math";
import type { GeometryStore } from "./registry";
import type { Item, MeshRef, Workspace } from "./types";
import { absPose, childFrame } from "./workspace";

export const ITEM_EXPORT_FORMATS = ["stl", "ply", "wrl", "sld", "tool"] as const;
export type ItemExportFormat = (typeof ITEM_EXPORT_FORMATS)[number];





export function exportFileName(name: string, ext: string): string {
  const base = name.replace(/[ ().]/g, "-").replace(/--/g, "-") || "item";
  return `${base}.${ext}`;
}

function meshesOf(it: Item): { meshes: MeshRef[]; geometryPose?: Mat } {
  if (it.object) return { meshes: it.object.meshes, geometryPose: it.object.geometryPose };
  if (it.tool) return { meshes: it.tool.meshes, geometryPose: it.tool.geometryPose };
  return { meshes: [] };
}





export function collectMeshes(ws: Workspace, store: GeometryStore, items: Item[]): ExportMesh[] {
  const out: ExportMesh[] = [];
  for (const it of items) {
    const { meshes, geometryPose } = meshesOf(it);
    let frame: Mat | undefined = geometryPose;
    if (items.length > 1) {
      const holder = it.type === "tool" ? childFrame(ws, it.parent) : absPose(ws, it.id);
      frame = geometryPose ? mul(holder, geometryPose) : holder;
    }
    for (const m of meshes) {
      const t = store.get(m.geometry);
      if (!t?.length) continue;
      out.push({ triangles: frame ? transformTriangles(t, frame) : t, color: m.color });
    }
  }
  return out;
}

export function writeItemExport(ws: Workspace, store: GeometryStore, items: Item[], format: ItemExportFormat, fileName: string): { bytes: Uint8Array; fileName: string } {
  const name = fileName.toLowerCase().endsWith(`.${format}`) ? fileName : `${fileName}.${format}`;
  if (format === "tool") {
    const tool = items[0];
    if (items.length !== 1 || tool.type !== "tool") throw new Error("Select a tool to save as a .tool file");
    return { bytes: writeToolFile(tool.name, tool.pose, collectMeshes(ws, store, [tool])), fileName: name };
  }
  const meshes = collectMeshes(ws, store, items);
  if (!meshes.length) throw new Error("There is no geometry to save");
  const bytes =
    format === "stl" ? writeSTL(meshes) : format === "ply" ? writePLY(meshes) : format === "sld" ? writeSldFile(items.length === 1 ? items[0].name : name.replace(/\.sld$/i, ""), meshes) : writeWRL(meshes);
  return { bytes, fileName: name };
}
