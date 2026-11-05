// Converts poses between matrix, Euler, quaternion and robot-controller representations.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { axisAngle, DEG, mulAll, poseToQuat, rotx, roty, rotz, transl, type Mat } from "./math";

export type PoseFormatId = "fanuc" | "staubli" | "abb" | "ur-deg" | "ur-rad" | "quat" | "zyz" | "zxz" | "epson";

export interface PoseFormat {
  id: PoseFormatId;
   
  label: string;
   
  short: string;
   
  rot: string[];
   
  unit: "deg" | "rad" | "";
}

export const POSE_FORMATS: PoseFormat[] = [
  { id: "fanuc", label: "[X,Y,Z]mm | Ro[X,Y ,Z  ]deg - Fanuc/Motoman", short: "Fanuc/Motoman", rot: ["W", "P", "R"], unit: "deg" },
  { id: "staubli", label: "[X,Y,Z]mm | Rot[X,Y',Z'']deg - Stäubli/Mecademic/Denso", short: "Stäubli/Mecademic/Denso", rot: ["Rx", "Ry'", "Rz''"], unit: "deg" },
  { id: "abb", label: "[X,Y,Z]mm | Rot[Z,Y',X'']deg - ABB/KUKA/Nachi", short: "ABB/KUKA/Nachi", rot: ["Rz", "Ry'", "Rx''"], unit: "deg" },
  { id: "ur-deg", label: "[X,Y,Z]mm | Rot[u,v,w] deg   - UR (deg)", short: "UR (deg)", rot: ["u", "v", "w"], unit: "deg" },
  { id: "ur-rad", label: "[X,Y,Z]mm | Rot[u,v,w] rad   - UR (rad)", short: "UR (rad)", rot: ["u", "v", "w"], unit: "rad" },
  { id: "quat", label: "[X,Y,Z]mm | Quaternion[q1-q4]- ABB RAPID", short: "ABB RAPID quaternion", rot: ["q1", "q2", "q3", "q4"], unit: "" },
  { id: "zyz", label: "[X,Y,Z]mm | Rot[Z,Y',Z'']deg - Adept/Comau/Kawasaki", short: "Adept/Comau/Kawasaki", rot: ["Rz", "Ry'", "Rz''"], unit: "deg" },
  { id: "zxz", label: "[X,Y,Z]mm | Rot[Z,X',Z'']deg - CATIA/SolidWorks", short: "CATIA/SolidWorks", rot: ["Rz", "Rx'", "Rz''"], unit: "deg" },
  { id: "epson", label: "[X,Y,Z]mm | Rot[Z,Y ,X  ]deg - Epson/CRS", short: "Epson/CRS", rot: ["Rz", "Ry", "Rx"], unit: "deg" },
];

 
export const DEFAULT_POSE_FORMAT: PoseFormatId = "abb";

export const poseFormat = (id: PoseFormatId | string): PoseFormat => POSE_FORMATS.find((f) => f.id === id) ?? POSE_FORMATS[2];

const EPS = 1e-9;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
 
const r = (m: Mat, i: number, j: number) => m[i * 4 + j];
const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

 
function zyx(m: Mat): [number, number, number] {
  const s = -r(m, 2, 0);
  if (s > 1 - EPS) return [Math.atan2(-r(m, 0, 1), r(m, 1, 1)), Math.PI / 2, 0];
  if (s < -1 + EPS) return [Math.atan2(-r(m, 0, 1), r(m, 1, 1)), -Math.PI / 2, 0];
  return [Math.atan2(r(m, 1, 0), r(m, 0, 0)), Math.asin(clamp1(s)), Math.atan2(r(m, 2, 1), r(m, 2, 2))];
}

 
function xyz(m: Mat): [number, number, number] {
  const s = r(m, 0, 2);
  if (s > 1 - EPS || s < -1 + EPS) return [Math.atan2(r(m, 2, 1), r(m, 1, 1)), s > 0 ? Math.PI / 2 : -Math.PI / 2, 0];
  return [Math.atan2(-r(m, 1, 2), r(m, 2, 2)), Math.asin(clamp1(s)), Math.atan2(-r(m, 0, 1), r(m, 0, 0))];
}

 
function zyz(m: Mat): [number, number, number] {
  const c = r(m, 2, 2);
  if (c > 1 - EPS) return [Math.atan2(r(m, 1, 0), r(m, 0, 0)), 0, 0];
  if (c < -1 + EPS) return [Math.atan2(-r(m, 0, 1), r(m, 1, 1)), Math.PI, 0];
  return [Math.atan2(r(m, 1, 2), r(m, 0, 2)), Math.acos(clamp1(c)), Math.atan2(r(m, 2, 1), -r(m, 2, 0))];
}

 
function zxz(m: Mat): [number, number, number] {
  const c = r(m, 2, 2);
  if (c > 1 - EPS || c < -1 + EPS) return [Math.atan2(r(m, 1, 0), r(m, 0, 0)), c > 0 ? 0 : Math.PI, 0];
  return [Math.atan2(r(m, 0, 2), -r(m, 1, 2)), Math.acos(clamp1(c)), Math.atan2(r(m, 2, 0), r(m, 2, 1))];
}

 
function quat(m: Mat): [number, number, number, number] {
  let q = poseToQuat(m);
  const n = Math.hypot(...q) || 1;
  q = q.map((v) => v / n) as [number, number, number, number];
  if (q[0] < 0) q = q.map((v) => -v) as [number, number, number, number];
  return q;
}

 
function rotvec(m: Mat): [number, number, number] {
  const [w, x, y, z] = quat(m);
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) return [2 * x, 2 * y, 2 * z];
  const angle = 2 * Math.atan2(s, w);
  return [(x / s) * angle, (y / s) * angle, (z / s) * angle];
}

function quatToMat(w: number, x: number, y: number, z: number): Mat {
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n;
  x /= n;
  y /= n;
  z /= n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0,
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0,
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

 
export function poseToFormat(m: Mat, fmt: PoseFormatId | string): number[] {
  const p = [m[3], m[7], m[11]];
  const d = (a: number[]) => a.map((v) => clean(v / DEG));
  switch (poseFormat(fmt).id) {
    case "fanuc": {
      const [a, b, c] = zyx(m);
      return [...p, ...d([c, b, a])];
    }
    case "staubli":
      return [...p, ...d(xyz(m))];
    case "abb":
      return [...p, ...d(zyx(m))];
    case "ur-deg":
      return [...p, ...d(rotvec(m))];
    case "ur-rad":
      return [...p, ...rotvec(m).map(clean)];
    case "quat":
      return [...p, ...quat(m).map(clean)];
    case "zyz":
      return [...p, ...d(zyz(m))];
    case "zxz":
      return [...p, ...d(zxz(m))];
    case "epson": {
      const [a, b, c] = xyz(m);
      return [...p, ...d([c, b, a])];
    }
  }
}

 
export function formatToPose(v: number[], fmt: PoseFormatId | string): Mat {
  const [x, y, z] = v;
  const T = transl(x ?? 0, y ?? 0, z ?? 0);
  const a = (v[3] ?? 0) * DEG;
  const b = (v[4] ?? 0) * DEG;
  const c = (v[5] ?? 0) * DEG;
  switch (poseFormat(fmt).id) {
    case "fanuc":
      return mulAll(T, rotz(c), roty(b), rotx(a));
    case "staubli":
      return mulAll(T, rotx(a), roty(b), rotz(c));
    case "abb":
      return mulAll(T, rotz(a), roty(b), rotx(c));
    case "ur-deg":
    case "ur-rad": {
      const k = poseFormat(fmt).id === "ur-deg" ? DEG : 1;
      const rv = [(v[3] ?? 0) * k, (v[4] ?? 0) * k, (v[5] ?? 0) * k];
      const angle = Math.hypot(rv[0], rv[1], rv[2]);
      if (angle < 1e-15) return T;
      return mulAll(T, axisAngle([rv[0] / angle, rv[1] / angle, rv[2] / angle], angle));
    }
    case "quat":
      return mulAll(T, quatToMat(v[3] ?? 1, v[4] ?? 0, v[5] ?? 0, v[6] ?? 0));
    case "zyz":
      return mulAll(T, rotz(a), roty(b), rotz(c));
    case "zxz":
      return mulAll(T, rotz(a), rotx(b), rotz(c));
    case "epson":
      return mulAll(T, rotx(c), roty(b), rotz(a));
  }
}

 
export const fieldCount = (fmt: PoseFormatId | string) => 3 + poseFormat(fmt).rot.length;






export function parsePoseText(text: string, fmt: PoseFormatId | string): Mat | null {
  const nums = (text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length >= 16) return nums.slice(0, 16);
  const n = fieldCount(fmt);
  if (nums.length < n) return null;
  return formatToPose(nums.slice(0, n), fmt);
}
