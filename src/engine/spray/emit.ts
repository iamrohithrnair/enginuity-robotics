// Emits spray particles and counts target hits for each gun update.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import type { Mat } from "../math";
import type { SprayConfig, Vec3 } from "./options";
import { quatFromPose } from "./particles";
import type { Rng } from "./rng";
import { castSegment, NO_HIT, type SprayTarget } from "./target";

const f = Math.fround;

export interface EmitSink {
  (pos: Vec3, quat: [number, number, number, number], rgba: [number, number, number, number]): void;
}

export interface EmitCounts {
  in: number;
  out: number;
}





export function emitOnce(cfg: SprayConfig, M: Mat, target: SprayTarget | null, rng: Rng, sink: EmitSink): EmitCounts {
  const counts: EmitCounts = { in: 0, out: 0 };
  const quat = quatFromPose(M);
   
  const toObj = (x: number, y: number, z: number): Vec3 => [
    f(M[3] + M[1] * y + x * M[0] + z * M[2]),
    f(M[7] + M[5] * y + x * M[4] + z * M[6]),
    f(M[11] + M[9] * y + x * M[8] + z * M[10]),
  ];
  const near = cfg.near;
  const far = cfg.far;
  const nearColor: [number, number, number, number] = [f(near[9]), f(near[10]), f(near[11]), f(near[12])];

  const segment = (p1: Vec3, p2: Vec3) => {
    if (!cfg.project) {
      sink(p1, quat, nearColor);
      counts.out++;
      return;
    }
    const ey = f(p1[1] - p2[1]);
    const ex = f(p1[0] - p2[0]);
    const ez = f(p1[2] - p2[2]);
    const len = f(Math.sqrt(f(f(f(ey * ey) + f(ex * ex)) + f(ez * ez))));
    const hit = target ? castSegment(target, p1, p2) : null;
    const d = hit ? hit.d : NO_HIT;
    if (len <= d || !hit) {
      counts.out++;
      return;
    }
    const rest = f(len - d);
    const total = f(d + rest);
    const c = (k: number) => f((far[9 + k] * d + near[9 + k] * rest) / total);
    sink(hit.point, quat, [c(0), c(1), c(2), c(3)]);
    counts.in++;
  };

  const rnd = () => cfg.rand * 0.0001 * (rng() % 10000);
  const A = cfg.stepA;
  const B = cfg.stepB;
  if (cfg.shape === 2) {
    const [n0x, n0y, n0z] = [near[0], near[1], near[2]];
    const [f0x, f0y, f0z] = [far[0], far[1], far[2]];
    for (let i = 0; i < A; i++) {
      const r = rnd();
      const u = r + i;
      for (let j = 0; j <= B; j++) {
        const v = rnd() + j;
        const p1 = toObj(n0x + cfg.nearAVec[0] * u + cfg.nearBVec[0] * v, n0y + cfg.nearAVec[1] * u + cfg.nearBVec[1] * v, n0z + cfg.nearAVec[2] * u + cfg.nearBVec[2] * v);
        const p2 = toObj(f0x + cfg.farAVec[0] * u + cfg.farBVec[0] * v, f0y + cfg.farAVec[1] * u + cfg.farBVec[1] * v, f0z + cfg.farAVec[2] * u + cfg.farBVec[2] * v);
        segment(p1, p2);
      }
    }
  } else {
    for (let i = 0; i < A; i++) {
      const ang = cfg.angStep * (rnd() + i);
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      for (let j = 0; j <= B; j++) {
        const rho = (j === 0 ? 0 : rnd()) + j;
        const p1 = toObj(c * rho * cfg.nearAStep, s * rho * cfg.nearBStep, near[2]);
        const p2 = toObj(c * rho * cfg.farAStep, s * rho * cfg.farBStep, far[2]);
        segment(p1, p2);
      }
    }
  }
  return counts;
}
