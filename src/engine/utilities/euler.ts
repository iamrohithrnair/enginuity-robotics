// Converts rigid poses between supported Euler-angle and quaternion formats.
 
 
 
 
 
 
 
 
 
 
 

import { DEG, mulAll, rotx, roty, rotz, transl, type Mat } from "../math";

export const EULER_FORMATS = ["RX:RYp:RZpp", "RZ:RYp:RXpp", "RZ:RYp:RZpp", "RZ:RXp:RZpp", "RX:RY:RZ", "RZ:RY:RX", "Quaternion"] as const;
export const JOINT_FORMAT = -1;

 
export function eulerToPose(row: number[], format: number): Mat {
  const [x, y, z, a = 0, b = 0, c = 0] = row;
  const t = transl(x, y, z);
  switch (format) {
    case 0:
      return mulAll(t, rotx(a * DEG), roty(b * DEG), rotz(c * DEG));
    case 1:
      return mulAll(t, rotz(a * DEG), roty(b * DEG), rotx(c * DEG));
    case 2:
      return mulAll(t, rotz(a * DEG), roty(b * DEG), rotz(c * DEG));
    case 3:
      return mulAll(t, rotz(a * DEG), rotx(b * DEG), rotz(c * DEG));
    case 4:
      return mulAll(t, rotz(c * DEG), roty(b * DEG), rotx(a * DEG));
    case 5:
      return mulAll(t, rotx(c * DEG), roty(b * DEG), rotz(a * DEG));
    case 6: {
      const q = [row[3] ?? 1, row[4] ?? 0, row[5] ?? 0, row[6] ?? 0];
      const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      const [w, qx, qy, qz] = q.map((v) => v / n);
      return [
        1 - 2 * qy * qy - 2 * qz * qz, 2 * qx * qy - 2 * qz * w, 2 * qx * qz + 2 * qy * w, x,
        2 * qx * qy + 2 * qz * w, 1 - 2 * qx * qx - 2 * qz * qz, 2 * qy * qz - 2 * qx * w, y,
        2 * qx * qz - 2 * qy * w, 2 * qy * qz + 2 * qx * w, 1 - 2 * qx * qx - 2 * qy * qy, z,
        0, 0, 0, 1,
      ];
    }
    default:
      throw new Error(`Unknown Euler format ${format}`);
  }
}

const atan2d = (y: number, x: number) => Math.atan2(y, x) / DEG;

 
export function poseToEuler(m: Mat, format: number): number[] {
  const p = [m[3], m[7], m[11]];
  const r = (i: number, j: number) => m[i * 4 + j];
  switch (format) {
    case 0: {
       
      const sb = Math.max(-1, Math.min(1, r(0, 2)));
      if (sb > 1 - 1e-10) return [...p, 0, 90, atan2d(r(1, 0), r(1, 1))];
      if (sb < -1 + 1e-10) return [...p, 0, -90, atan2d(r(1, 0), r(1, 1))];
      const cb = Math.sqrt(1 - sb * sb);
      return [...p, atan2d(-r(1, 2) / cb, r(2, 2) / cb), atan2d(sb, cb), atan2d(-r(0, 1) / cb, r(0, 0) / cb)];
    }
    case 1:
    case 4: {
       
      let alpha: number, beta: number, gamma: number;
      if (r(2, 0) > 1 - 1e-10) {
        beta = -90;
        alpha = 0;
        gamma = atan2d(-r(1, 2), r(1, 1));
      } else if (r(2, 0) < -1 + 1e-10) {
        beta = 90;
        alpha = 0;
        gamma = atan2d(r(1, 2), r(1, 1));
      } else {
        beta = atan2d(-r(2, 0), Math.hypot(r(0, 0), r(1, 0)));
        gamma = atan2d(r(1, 0), r(0, 0));
        alpha = atan2d(r(2, 1), r(2, 2));
      }
      return format === 1 ? [...p, gamma, beta, alpha] : [...p, alpha, beta, gamma];
    }
    case 2: {
       
      const cb = r(2, 2);
      if (cb > 1 - 1e-10) return [...p, 0, 0, atan2d(r(1, 0), r(0, 0))];
      if (cb < -1 + 1e-10) return [...p, 0, 180, atan2d(r(1, 0), r(1, 1))];
      const sb = Math.sqrt(1 - cb * cb);
      return [...p, atan2d(r(1, 2) / sb, r(0, 2) / sb), atan2d(sb, cb), atan2d(r(2, 1) / sb, -r(2, 0) / sb)];
    }
    case 3: {
       
      if (r(2, 2) > 1 - 1e-10) return [...p, 0, 0, atan2d(r(1, 0), r(0, 0))];
      if (r(2, 2) < -1 + 1e-10) return [...p, 0, 180, atan2d(r(1, 0), r(0, 0))];
      return [...p, atan2d(r(0, 2), -r(1, 2)), atan2d(Math.hypot(r(0, 2), r(1, 2)), r(2, 2)), atan2d(r(2, 0), r(2, 1))];
    }
    case 5: {
       
      const t = [r(0, 0), r(1, 0), r(2, 0), 0, r(0, 1), r(1, 1), r(2, 1), 0, r(0, 2), r(1, 2), r(2, 2), 0, 0, 0, 0, 1];
      const [, , , ga, be, al] = poseToEuler(t, 1);
      return [...p, -ga, -be, -al];
    }
    case 6: {
      const tr = r(0, 0) + r(1, 1) + r(2, 2);
      let w: number, x: number, y: number, z: number;
      if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        w = 0.25 * s;
        x = (r(2, 1) - r(1, 2)) / s;
        y = (r(0, 2) - r(2, 0)) / s;
        z = (r(1, 0) - r(0, 1)) / s;
      } else if (r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2)) {
        const s = Math.sqrt(1 + r(0, 0) - r(1, 1) - r(2, 2)) * 2;
        w = (r(2, 1) - r(1, 2)) / s;
        x = 0.25 * s;
        y = (r(0, 1) + r(1, 0)) / s;
        z = (r(0, 2) + r(2, 0)) / s;
      } else if (r(1, 1) > r(2, 2)) {
        const s = Math.sqrt(1 + r(1, 1) - r(0, 0) - r(2, 2)) * 2;
        w = (r(0, 2) - r(2, 0)) / s;
        x = (r(0, 1) + r(1, 0)) / s;
        y = 0.25 * s;
        z = (r(1, 2) + r(2, 1)) / s;
      } else {
        const s = Math.sqrt(1 + r(2, 2) - r(0, 0) - r(1, 1)) * 2;
        w = (r(1, 0) - r(0, 1)) / s;
        x = (r(0, 2) + r(2, 0)) / s;
        y = (r(1, 2) + r(2, 1)) / s;
        z = 0.25 * s;
      }
      if (w < 0) [w, x, y, z] = [-w, -x, -y, -z];
      return [...p, w, x, y, z];
    }
    default:
      throw new Error(`Unknown Euler format ${format}`);
  }
}
