// Finds the nearest axis-aligned orientation for a coordinate frame.
 
 
 

import { mul, type Mat } from "./math";

 
export const AXIS_ROTATIONS: Mat[] = (() => {
  const out: Mat[] = [];
  const dirs: number[][][] = [
     
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  ];
  for (let turn = 0; turn < 4; turn++) {
    const c = Math.round(Math.cos((turn * Math.PI) / 2)), s = Math.round(Math.sin((turn * Math.PI) / 2));
    const rz: Mat = [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const [x, y, z] of dirs) out.push(mul([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1], rz));
  }
  return out;
})();

 
function rotationAngle(a: Mat, b: Mat): number {
  const tr = a[0] * b[0] + a[4] * b[4] + a[8] * b[8] + a[1] * b[1] + a[5] * b[5] + a[9] * b[9] + a[2] * b[2] + a[6] * b[6] + a[10] * b[10];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}





export function alignedOrientation(pose: Mat): { pose: Mat; changed: boolean } {
  let best = pose;
  let bestAngle = Infinity;
  for (const r of AXIS_ROTATIONS) {
    const d = rotationAngle(pose, r);
    if (d < bestAngle) {
      bestAngle = d;
      best = r;
    }
  }
  const out: Mat = [best[0], best[1], best[2], pose[3], best[4], best[5], best[6], pose[7], best[8], best[9], best[10], pose[11], 0, 0, 0, 1];
  return { pose: out, changed: bestAngle > 1e-6 };
}
