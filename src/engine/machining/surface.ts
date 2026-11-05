// Builds target poses from picked surface points and tool orientations.
 
 

import { fk } from "../kinematics";
import { mul, type Mat } from "../math";
import type { Item, Workspace } from "../types";
import { absPose, toolPose } from "../workspace";






export function surfaceTargetPose(ws: Workspace, robot: Item, point: number[], normal: number[], mode: "normal" | "constant", rot: number[] = [0, 0, 0]): Mat {
  const tcp = mul(mul(absPose(ws, robot.id), fk(robot.robot!.model, robot.robot!.joints)), toolPose(ws, robot.id));
  let x = [tcp[0], tcp[4], tcp[8]];
  let z: number[];
  if (mode === "constant") z = [tcp[2], tcp[6], tcp[10]];
  else {
    const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    z = [-normal[0] / l, -normal[1] / l, -normal[2] / l];
     
    const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
    x = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]];
    if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const dd = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
    x = [x[0] - dd * z[0], x[1] - dd * z[1], x[2] - dd * z[2]];
    const lx = Math.hypot(x[0], x[1], x[2]);
    x = [x[0] / lx, x[1] / lx, x[2] / lx];
  }
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const pose: Mat = [x[0], y[0], z[0], point[0], x[1], y[1], z[1], point[1], x[2], y[2], z[2], point[2], 0, 0, 0, 1];
  const [rx, ry, rz] = rot.map((v) => (v * Math.PI) / 180);
  const R = (axis: 0 | 1 | 2, a: number): Mat => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (axis === 0) return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
    if (axis === 1) return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
    return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  };
  return mul(mul(mul(pose, R(0, rx)), R(1, ry)), R(2, rz));
}
