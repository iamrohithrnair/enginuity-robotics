 
 
 

import { fk, kinematicsReady, linkFrames } from "../kinematics";
import { eye, mul, type Mat } from "../math";
import type { GeometryStore } from "../registry";
import type { Item, Workspace } from "../types";
import { meshInfo, transformedBox } from "./geometry";
import type { ItemPhysics } from "./types";

 
export class Frames {
  private absMemo = new Map<string, Mat>();
  private childMemo = new Map<string, Mat>();
  constructor(
    private ws: Workspace,
    private joints: (robot: Item) => number[],
  ) {}

   
  abs(id: string): Mat {
    const hit = this.absMemo.get(id);
    if (hit) return hit;
    const it = this.ws.items[id];
    const m = !it || it.type === "station" ? eye() : mul(this.child(it.parent), it.pose);
    this.absMemo.set(id, m);
    return m;
  }

   
  child(id: string | null): Mat {
    if (!id) return eye();
    const hit = this.childMemo.get(id);
    if (hit) return hit;
    const it = this.ws.items[id];
    let m: Mat;
    if (!it || it.type === "station") m = eye();
    else if (it.type === "robot" && it.robot && kinematicsReady()) m = mul(this.abs(id), fk(it.robot.model, this.joints(it)));
    else m = this.abs(id);
    this.childMemo.set(id, m);
    return m;
  }

   
  links(robot: Item): Mat[] {
    if (!robot.robot || !kinematicsReady()) return [];
    const base = this.abs(robot.id);
    return linkFrames(robot.robot.model, this.joints(robot)).map((f) => mul(base, f));
  }
}

export interface BodySpec {
   
  key: string;
  item: string;
  name: string;
  kind: "link" | "tool" | "object";
  link?: number;
   
  meshes: string[];
   
  pose: Mat;
   
  carrier: string | null;
   
  parentObject: string | null;
  settings: ItemPhysics;
  locked: boolean;
   
  sig: string;
}

 
const SKIP = new Set(["program", "instruction", "python", "notes", "script", "machining", "target", "camera", "curve"]);

 
export function collectSpecs(ws: Workspace, stationId: string, frames: Frames): BodySpec[] {
  const out: BodySpec[] = [];
  const walk = (id: string, carrier: string | null, parentObject: string | null) => {
    const it = ws.items[id];
    if (!it || SKIP.has(it.type)) return;
    let nextCarrier = carrier;
    let nextObject = parentObject;
    if (it.type === "robot" && it.robot) {
      if (it.visible) {
        const fr = frames.links(it);
        it.robot.links.forEach((meshes, li) => {
          const ids = meshes.map((m) => m.geometry);
           
          if (!ids.length || !fr[li]) return;
          out.push({ key: `${it.id}#${li}`, item: it.id, name: `${it.name} link ${li}`, kind: "link", link: li, meshes: ids, pose: fr[li], carrier: it.id, parentObject: null, settings: {}, locked: false, sig: `link|${ids.join(",")}` });
        });
      }
      nextCarrier = it.id;
    } else if (it.type === "tool") {
      const ids = (it.tool?.meshes ?? []).map((m) => m.geometry);
       
      if (it.visible && ids.length) out.push({ key: it.id, item: it.id, name: it.name, kind: "tool", meshes: ids, pose: frames.child(it.parent), carrier: it.parent, parentObject: null, settings: {}, locked: false, sig: `tool|${ids.join(",")}` });
      nextCarrier = it.id;
    } else if (it.type === "object") {
      const ids = (it.object?.meshes ?? []).map((m) => m.geometry);
      if (it.visible && ids.length) {
        const settings = it.physics ?? {};
        const locked = it.locked === true || it.params?.Locked === "1";
        out.push({
          key: it.id,
          item: it.id,
          name: it.name,
          kind: "object",
          meshes: ids,
          pose: frames.abs(it.id),
          carrier,
          parentObject,
          settings,
          locked,
          sig: `object|${ids.join(",")}|${carrier ?? ""}|${parentObject ?? ""}|${locked ? 1 : 0}|${JSON.stringify(settings)}`,
        });
      }
      nextObject = it.id;
    }
    for (const c of it.children) walk(c, nextCarrier, nextObject);
  };
  for (const c of ws.items[stationId]?.children ?? []) walk(c, null, null);
  return out;
}







export function floorHeight(store: GeometryStore, specs: BodySpec[]): number {
  let low = Infinity;
  for (const s of specs) {
    for (const g of s.meshes) {
      const info = meshInfo(store, g);
      if (!info) continue;
      low = Math.min(low, transformedBox(info.min, info.max, s.pose).min[2]);
    }
  }
  return low < -50 ? low : 0;
}
