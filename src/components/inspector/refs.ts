 
 
 

import { fk, kinematicsReady } from "@/engine/kinematics";
import { eye, inv, mul, type Mat } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { absPose, descendants, listItems } from "@/engine/workspace";

export interface RefOption {
  value: string;
  label: string;
}

 
export function refFrame(ws: Workspace, value: string): Mat {
  if (value === "station") return eye();
  const [id, part] = value.split("#");
  const it = ws.items[id];
  if (!it) return eye();
  const base = absPose(ws, id);
  if (it.type === "robot" && part === "flange" && it.robot && kinematicsReady()) return mul(base, fk(it.robot.model, it.robot.joints));
  return base;
}

 
export function parentRef(ws: Workspace, item: Item): string {
  const p = item.parent ? ws.items[item.parent] : undefined;
  if (!p || p.type === "station") return "station";
  if (p.type === "robot") return `${p.id}#flange`;
  return p.id;
}

export function referenceOptions(ws: Workspace, item: Item): RefOption[] {
  const excluded = new Set([item.id, ...descendants(ws, item.id).map((d) => d.id)]);
  const st = ws.activeStation ? ws.items[ws.activeStation] : undefined;
  const out: RefOption[] = [{ value: "station", label: st ? `${st.name} (station)` : "Station" }];
  for (const it of listItems(ws)) {
    if (excluded.has(it.id)) continue;
    if (it.type === "frame") out.push({ value: it.id, label: it.name || "(no name)" });
    else if (it.type === "robot") {
      out.push({ value: `${it.id}#base`, label: `${it.name} (base)` });
      out.push({ value: `${it.id}#flange`, label: `${it.name} (flange)` });
    }
  }
  const pr = parentRef(ws, item);
  if (!out.some((o) => o.value === pr) && item.parent && ws.items[item.parent]) out.push({ value: pr, label: ws.items[item.parent].name });
  return out;
}

 
export function poseIn(ws: Workspace, item: Item, ref: string): Mat {
  return mul(inv(refFrame(ws, ref)), absPose(ws, item.id));
}

 
export function absoluteFrom(ws: Workspace, ref: string, rel: Mat): Mat {
  return mul(refFrame(ws, ref), rel);
}
