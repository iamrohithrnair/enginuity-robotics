 
 

import { DEG, mul, rotz, transl, type Mat } from "./math";
import type { Item, Workspace } from "./types";

export const isLocked = (it: Item) => (it as Item & { locked?: boolean }).locked === true || it.params?.Locked === "1";





export function dragSubject(ws: Workspace, id: string): Item | null {
  const it = ws.items[id];
  if (!it || ["station", "program", "instruction", "folder", "notes", "python"].includes(it.type)) return null;
  if (it.type === "robot") {
    const base = it.parent ? ws.items[it.parent] : undefined;
    return base && base.type === "frame" ? base : it;
  }
  return it;
}

 
export function dragMotion(translate: number[] = [0, 0, 0], rotateZ = 0, pivot: number[] = [0, 0, 0]): Mat {
  const rot = mul(mul(transl(pivot[0], pivot[1], pivot[2]), rotz(rotateZ * DEG)), transl(-pivot[0], -pivot[1], -pivot[2]));
  return mul(transl(translate[0], translate[1], translate[2]), rot);
}
