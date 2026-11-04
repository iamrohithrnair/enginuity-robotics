 
 
 
 
 
 
 
 
 
 

import { fk, jointsConfig } from "./kinematics";
import type { Mat } from "./math";
import type { Item } from "./types";

export interface PostKinematics {
   
  joints: number[];
   
  pose: number[][];
   
  config: number[];
}

const rows = (m: Mat): number[][] => [0, 1, 2, 3].map((r) => m.slice(r * 4, r * 4 + 4));

 
export function jointOnlyTargets(intermediate: string): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  for (const line of intermediate.split("\n")) {
    if (!/^r\.Move[JLC]\(/.test(line)) continue;
    for (const m of line.matchAll(/(?:\(|,)None,\s*\[([^\]]*)\]/g)) {
      const q = m[1].split(",").filter((s) => s.trim()).map(Number);
      const key = q.join(",");
      if (q.some((v) => !Number.isFinite(v)) || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
  }
  return out;
}






export function postKinematics(intermediate: string, items: Record<string, Item>): PostKinematics[] {
  const handle = Number(/\brobot_ptr=(\d+)/.exec(intermediate)?.[1] ?? NaN);
  if (!(handle > 0)) return [];
  const robot = Object.values(items).find((it) => it.handle === handle);
  const model = robot?.robot?.model;
  if (!model) return [];
  return jointOnlyTargets(intermediate).map((joints) => {
    const q = Array.from({ length: model.nq }, (_, i) => (Number.isFinite(joints[i]) ? joints[i] : 0));
    return { joints, pose: rows(fk(model, q)), config: jointsConfig(model, q) };
  });
}
