 
 
 
 
 
 
 
 
 

import { DEG, type Mat } from "../math";
import type { DhJoint, RobotModel } from "../types";

 
export const MECHANISM_TYPES: { code: number; label: string }[] = [
  { code: 1, label: "1 rotative axis" },
  { code: 2, label: "2 rotative axes" },
  { code: 4, label: "1 linear axis" },
  { code: 5, label: "2 linear axes (T bot)" },
  { code: 12, label: "1 linear + 1 rotative axis" },
  { code: 10, label: "2-finger gripper" },
  { code: 6, label: "3 linear axes (H bot)" },
  { code: 20, label: "3 axes (generic)" },
  { code: 9, label: "4 axes SCARA robot" },
  { code: 17, label: "4 axes SCARA robot (T=axis 1)" },
  { code: 14, label: "4 axes SCARA robot (T=axis 2)" },
  { code: 15, label: "4 axes mobile robot (AGV)" },
  { code: 21, label: "4 axes (generic)" },
  { code: 13, label: "5 axes CNC" },
  { code: 22, label: "5 axes (generic)" },
  { code: 19, label: "6 axes CNC" },
  { code: 25, label: "6 axes CNC (generic)" },
  { code: 7, label: "6 axes industrial robot" },
  { code: 11, label: "6 axes collaborative robot" },
  { code: 16, label: "6 axes mechanism" },
  { code: 23, label: "6 axes generic" },
  { code: 8, label: "7 axes industrial robot" },
  { code: 24, label: "7 axes generic" },
];

 
export const MAKE_ROBOT = { "1R": 1, "2R": 2, "3R": 3, "1T": 4, "2T": 5, "3T": 6, "6DOF": 7, "7DOF": 8, SCARA: 9, GRIPPER: 10, "6COBOT": 11, "1T1R": 12, "5XCNC": 13, "3T1R": 15, GENERIC: 16 } as const;

 
export const MECHANISM_PARAMS: Record<number, string[]> = {
  2: ["Angle 2 α (deg)", "Length 2 a (mm)"],
  5: ["a1 (mm)", "d1 (mm)", "a2 (mm)", "d2 (mm)"],
  6: ["a1 (mm)", "d1 (mm)", "a2 (mm)", "d2 (mm)", "a3 (mm)", "d3 (mm)"],
  7: ["d1", "a1", "d2", "a2", "a3", "d4", "d6", "θ1 offset", "θ2 offset", "θ3 offset", "θ4 offset", "θ5 offset", "θ6 offset", "a5", "d5"],
  8: ["d1", "d3", "d5", "d7", "θ1 offset", "θ2 offset", "θ3 offset", "θ4 offset", "θ5 offset", "θ6 offset", "θ7 offset"],
  9: ["a1 (mm)", "a2 (mm)", "d3 (mm)"],
  10: ["Gripper ratio"],
  11: ["d1", "a2", "a3", "d4", "d5", "d6", "θ1 offset", "θ2 offset", "θ3 offset", "θ4 offset", "θ5 offset", "θ6 offset"],
  12: ["d1 (mm)", "θ2 offset (deg)", "Angle (deg)"],
  13: ["d1", "d2", "d3", "θ4 offset", "θ5 offset", "a5", "d5", "Swap axes 1 and 2 (>0)"],
  14: ["a3 (mm)", "a4 (mm)", "d1 (mm)"],
  15: ["d1 (mm)", "d2 (mm)", "d3 (mm)", "θ4 offset (deg)", "α4 (deg)"],
  17: ["a3 (mm)", "a4 (mm)", "d1 (mm)"],
  18: ["d1", "a1", "d2", "a2", "a3", "d4", "d6", "θ1 offset", "θ2 offset", "θ3 offset", "θ4 offset", "θ5 offset", "θ6 offset", "a5", "d5", "passive 1", "passive 2", "passive 3", "passive 4"],
  19: ["d1", "d2", "d3", "θ4 offset", "θ5 offset", "θ6 offset", "a4", "a5", "a6", "d4", "d5", "d6"],
  20: ["α2", "a2", "θ2", "d2", "α3", "a3", "θ3", "type 1", "type 2", "type 3"],
  21: ["α2", "a2", "θ2", "d2", "α3", "a3", "θ3", "d3", "α4", "a4", "θ4", "type 1", "type 2", "type 3", "type 4"],
  22: ["α2", "a2", "θ2", "d2", "α3", "a3", "θ3", "d3", "α4", "a4", "θ4", "d4", "α5", "a5", "θ5", "type 1", "type 2", "type 3", "type 4", "type 5", "Swap axes 1 and 2 (>0)"],
  23: ["d1", "α2", "a2", "θ2", "d2", "α3", "a3", "θ3", "d3", "α4", "a4", "θ4", "d4", "α5", "a5", "θ5", "d5", "α6", "a6", "θ6", "d6"],
  24: ["d1", "α2", "a2", "θ2", "d2", "α3", "a3", "θ3", "d3", "α4", "a4", "θ4", "d4", "α5", "a5", "θ5", "d5", "α6", "a6", "θ6", "d6", "α7", "a7", "θ7", "d7"],
  25: ["d1", "α2", "a2", "θ2", "d2", "α3", "a3", "θ3", "d3", "α4", "a4", "θ4", "d4", "α5", "a5", "θ5", "d5", "α6", "a6", "θ6", "d6"],
};

 
type Row = [alpha: number, a: number, theta: number, d: number, prismatic: number];

export interface MechanismKinematics {
   
  mech: number;
   
  nq: number;
   
  nlinks: number;
  rows: Row[];
   
  swap12: boolean;
   
  gripperRatio?: number;
   
  passive?: number[];
}

const H = Math.PI / 2;

 
export function mechanismKinematics(type: number, params: number[] = []): MechanismKinematics {
  const p = (i: number) => params[i] ?? 0;
  const g = (i: number) => p(i) * DEG;
  const z: Row = [0, 0, 0, 0, 0];
  const out = (mech: number, rows: Row[], extra: Partial<MechanismKinematics> = {}): MechanismKinematics => ({ mech, nq: rows.length, nlinks: rows.length + 1, rows, swap12: false, ...extra });
  switch (type) {
    case 1:
      return out(0, [z]);
    case 2:
      return out(0, [z, [g(0), p(1), 0, 0, 0]]);
    case 3:
      return out(0, [z, z, z]);
    case 4:
      return out(0, [[0, 0, 0, 0, 1]]);
    case 5:
      return out(0, [
        [0, p(0), 0, p(1), 1],
        [H, p(2), 0, p(3), 1],
      ]);
    case 6:
      return out(0, [
        [0, p(0), 0, p(1), 1],
        [H, p(2), H, p(3), 1],
        [H, p(4), 0, p(5), 1],
      ]);
    case 7:
    case 18: {
      const rows: Row[] = [
        [0, 0, g(7), p(0), 0],
        [-H, p(1), g(8), p(2), 0],
        [0, p(3), g(9), 0, 0],
        [-H, p(4), g(10), p(5), 0],
        [H, 0, g(11), p(14), 0],
        [-H, p(13), g(12), p(6), 0],
      ];
      if (type === 18) return out(1, rows, { nlinks: 9, passive: [8, 9, p(15), p(16), p(17), p(18)] });
      return out(Math.abs(p(13)) < 1e-4 && Math.abs(p(14)) < 1e-4 ? 1 : 8, rows);
    }
    case 8:
      return out(23, [
        [0, 0, g(4), p(0), 0],
        [-H, 0, g(5), 0, 0],
        [H, 0, g(6), p(1), 0],
        [-H, 0, g(7), 0, 0],
        [H, 0, g(8), p(2), 0],
        [-H, 0, g(9), 0, 0],
        [H, 0, g(10), p(3), 0],
      ]);
    case 9:
      return out(2, [z, [0, p(0), 0, 0, 0], [0, p(1), 0, -p(2), 1], [Math.PI, 0, 0, 0, 0]]);
    case 10:
      return out(15, [[0, 0, 0, 0, 1]], { nlinks: 3, gripperRatio: params.length > 0 ? p(0) : undefined });
    case 11:
      return out(6, [
        [0, 0, g(6), p(0), 0],
        [H, 0, g(7), 0, 0],
        [0, p(1), g(8), 0, 0],
        [0, p(2), g(9), p(3), 0],
        [-H, 0, g(10), p(4), 0],
        [H, 0, g(11), p(5), 0],
      ]);
    case 12:
      return out(0, [
        [-g(2), 0, 0, p(0), 1],
        [g(2), 0, g(1), 0, 0],
      ]);
    case 13:
      return out(
        0,
        [
          [0, 0, 0, p(0), 1],
          [H, 0, H, p(1), 1],
          [H, 0, 0, p(2), 1],
          [0, 0, g(3), 0, 0],
          [H, p(5), g(4), p(6), 0],
        ],
        { swap12: p(7) > 0 },
      );
    case 14:
      return out(2, [
        [0, 0, 0, p(2), 0],
        [0, 0, 0, 0, 1],
        [0, p(0), 0, 0, 0],
        [Math.PI, p(1), 0, 0, 0],
      ]);
    case 15:
      return out(21, [
        [0, 0, 0, p(0), 1],
        [0, 0, 0, p(1), 1],
        [0, 0, 0, p(2), 1],
        [g(4), 0, g(3), 0, 0],
      ]);
    case 16:
      return out(22, [
        [0, 0, 0, 0, 1],
        [0, 0, 0, 0, 1],
        [0, 0, 0, 0, 1],
        z,
        z,
        z,
      ]);
    case 17:
      return out(2, [
        [0, 0, 0, p(2), 1],
        [0, 0, 0, 0, 0],
        [0, p(0), 0, 0, 0],
        [Math.PI, p(1), 0, 0, 0],
      ]);
    case 19:
      return out(0, [
        [0, 0, 0, p(0), 1],
        [H, 0, H, p(1), 1],
        [H, 0, 0, p(2), 1],
        [0, p(6), g(3), p(9), 0],
        [H, p(7), g(4), p(10), 0],
        [H, p(8), g(5), p(11), 0],
      ]);
    case 20:
      return out(0, [
        [0, 0, 0, 0, p(7)],
        [g(0), p(1), g(2), p(3), p(8)],
        [g(4), p(5), g(6), 0, p(9)],
      ]);
    case 21:
      return out(0, [
        [0, 0, 0, 0, p(11)],
        [g(0), p(1), g(2), p(3), p(12)],
        [g(4), p(5), g(6), p(7), p(13)],
        [g(8), p(9), g(10), 0, p(14)],
      ]);
    case 22:
      return out(
        0,
        [
          [0, 0, 0, 0, p(15)],
          [g(0), p(1), g(2), p(3), p(16)],
          [g(4), p(5), g(6), p(7), p(17)],
          [g(8), p(9), g(10), p(11), p(18)],
          [g(12), p(13), g(14), 0, p(19)],
        ],
        { swap12: p(20) > 0 },
      );
    case 23:
    case 25: {
      const k = type === 25 ? 1 : 0;
      return out(type === 23 ? -8 : 0, [
        [0, 0, 0, p(0), k],
        [g(1), p(2), g(3), p(4), k],
        [g(5), p(6), g(7), p(8), k],
        [g(9), p(10), g(11), p(12), 0],
        [g(13), p(14), g(15), p(16), 0],
        [g(17), p(18), g(19), p(20), 0],
      ]);
    }
    case 24:
      return out(-3, [
        [0, 0, 0, p(0), 0],
        [g(1), p(2), g(3), p(4), 0],
        [g(5), p(6), g(7), p(8), 0],
        [g(9), p(10), g(11), p(12), 0],
        [g(13), p(14), g(15), p(16), 0],
        [g(17), p(18), g(19), p(20), 0],
        [g(21), p(22), g(23), p(24), 0],
      ]);
    default:
      throw new Error(`Unknown mechanism type ${type}`);
  }
}






export function mechanismMap(k: MechanismKinematics, senses: number[]): number[] {
  const n = k.nq;
  const s = (i: number) => {
    const v = senses[i] ?? 1;
    return Number.isFinite(v) ? v : 1;
  };
  const a = new Array(n * n).fill(0);
  for (let j = 0; j < n; j++) a[j * n + j] = s(j);
  if (k.gripperRatio !== undefined) a[0] = s(0) * k.gripperRatio;
  if (n === 6 && Math.abs(senses[6] ?? 0) > 0) a[2 * n + 1] = senses[6];
  if (k.swap12 && n >= 2) {
    a[0] = 0;
    a[n + 1] = 0;
    a[1] = s(1);
    a[n] = s(0);
  }
  return a;
}

 
export function internalLimits(map: number[], n: number, lower: number[], upper: number[]): { lower: number[]; upper: number[] } {
  const lo: number[] = [];
  const hi: number[] = [];
  for (let j = 0; j < n; j++) {
    let l = 0;
    let h = 0;
    for (let k = 0; k < n; k++) {
      const c = map[j * n + k];
      if (!c) continue;
      const x = c * (lower[k] ?? -180);
      const y = c * (upper[k] ?? 180);
      l += Math.min(x, y);
      h += Math.max(x, y);
    }
    lo.push(l);
    hi.push(h);
  }
  return { lower: lo, upper: hi };
}

export interface MechanismSpec {
  type: number;
  params?: number[];
   
  base?: Mat;
  tool?: Mat;
  senses?: number[];
  lower?: number[];
  upper?: number[];
}

const I4 = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

 
export function buildMechanismModel(spec: MechanismSpec): { model: RobotModel; kin: MechanismKinematics } {
  const kin = mechanismKinematics(spec.type, spec.params ?? []);
  const n = kin.nq;
  const lower = Array.from({ length: n }, (_, i) => spec.lower?.[i] ?? -200);
  const upper = Array.from({ length: n }, (_, i) => spec.upper?.[i] ?? 200);
  const map = mechanismMap(kin, spec.senses ?? []);
  const lim = internalLimits(map, n, lower, upper);
  const joints: DhJoint[] = kin.rows.map(([alpha, a, theta, d, prismatic], j) => ({
    kind: prismatic ? "linear" : "rotary",
    alpha,
    a,
    theta,
    d,
    lower: lim.lower[j],
    upper: lim.upper[j],
  }));
  return {
    kin,
    model: {
      base: spec.base ?? I4(),
      flange: spec.tool ?? I4(),
      joints,
      nq: n,
      map,
      userLower: lower,
      userUpper: upper,
      polygon: [],
      mech: kin.mech,
       
      ...(kin.gripperRatio !== undefined || kin.mech === 15 ? { meshLinks: kin.nlinks } : {}),
    },
  };
}
