// Collects visible station meshes with their world transforms and colors.
 
 
 

import { linkFrames } from "../kinematics";
import { mul } from "../math";
import type { GeometryStore } from "../registry";
import type { Workspace } from "../types";
import { absPose, childFrame, descendants } from "../workspace";
import type { RasterMesh } from "./raster";

export function sceneMeshes(ws: Workspace, store: GeometryStore, stationId: string, joints?: Record<string, number[]>): RasterMesh[] {
  const out: RasterMesh[] = [];
  for (const it of descendants(ws, stationId)) {
    if (!it.visible) continue;
    if (it.type === "robot" && it.robot) {
      const base = absPose(ws, it.id);
      const frames = linkFrames(it.robot.model, joints?.[it.id] ?? it.robot.joints);
      it.robot.links.forEach((meshes, li) => {
        const f = frames[li];
        if (!f) return;
        const pose = mul(base, f);
        for (const m of meshes) {
          const triangles = store.get(m.geometry);
          if (triangles?.length) out.push({ triangles, pose, color: it.color ?? m.color });
        }
      });
    } else if ((it.type === "object" && it.object) || (it.type === "tool" && it.tool)) {
      const data = it.object ?? it.tool!;
       
      const holder = it.type === "tool" ? childFrame(ws, it.parent) : absPose(ws, it.id);
      const pose = data.geometryPose ? mul(holder, data.geometryPose) : holder;
      for (const m of data.meshes) {
        const triangles = store.get(m.geometry);
        if (triangles?.length) out.push({ triangles, pose, color: it.color ?? m.color });
      }
    }
  }
  return out;
}
