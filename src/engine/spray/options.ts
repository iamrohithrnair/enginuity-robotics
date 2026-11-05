// Parses spray-gun options, particle shapes and emission-rate settings.
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { parseQColor } from "./qcolor";

export type Vec3 = [number, number, number];

 
export interface SprayMatrix {
  rows: number;
  cols: number;
  data: number[];
}

export type ParticleShape =
   
  | { kind: "sphere"; radius: number; facets: number; scale: Vec3 | null }
   
  | { kind: "cube"; size: Vec3 }
   
  | { kind: "mesh"; vertices: number[]; normals: number[] };

export interface SprayConfig {
   
  shape: 1 | 2;
   
  project: boolean;
   
  stepA: number;
  stepB: number;
   
  rand: number;
   
  near: number[];
   
  far: number[];
  particle: ParticleShape;
   
  angStep: number;
  nearAStep: number;
  nearBStep: number;
  farAStep: number;
  farBStep: number;
   
  nearAVec: Vec3;
  nearBVec: Vec3;
  farAVec: Vec3;
  farBVec: Vec3;
}

 
export const DEFAULT_NEAR = [0, 0, -10, 50, 0, -10, 0, 100, -10, 0, 0, 1, 0.8, 0, 0, 0];
export const DEFAULT_FAR = [0, 0, 400, 200, 0, 400, 0, 400, 400, 1, 0, 0, 0.2, 0, 0, 0];
export const DEFAULT_PARTICLE: ParticleShape = { kind: "sphere", radius: 10, facets: 8, scale: null };





export function qtToInt(s: string): number {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) return 0;
  const v = Number(t);
  return Number.isSafeInteger(v) && v >= -2147483648 && v <= 2147483647 ? v : 0;
}

 
export function qtToDouble(s: string): number {
  const t = s.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (/^[+-]?inf(inity)?$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^nan$/i.test(t)) return NaN;
  return 0;
}

const sub3 = (a: number[], ai: number, b: number[], bi: number): Vec3 => [a[ai] - b[bi], a[ai + 1] - b[bi + 1], a[ai + 2] - b[bi + 2]];
const len3 = (v: Vec3) => Math.sqrt(v[1] * v[1] + v[0] * v[0] + v[2] * v[2]);

 
export function parseParticle(spec: string): ParticleShape | null {
  if (/^cube/i.test(spec)) {
     
    const parts = spec.slice(5).split(",");
    if (parts.length < 3) return { kind: "cube", size: [10, 10, 10] };
    return { kind: "cube", size: [qtToDouble(parts[0]), qtToDouble(parts[1]), qtToDouble(parts[2])] };
  }
  if (/^sphere/i.test(spec)) {
    const parts = spec.slice(7).split(",");
    const radius = qtToDouble(parts[0]);
    let facets = 12;
    let scale: Vec3 | null = null;
    if (parts.length >= 2) {
      facets = qtToInt(parts[1]);
      if (parts.length >= 5) scale = [qtToDouble(parts[2]), qtToDouble(parts[3]), qtToDouble(parts[4])];
    }
     
    return { kind: "sphere", radius, facets: facets < 3 ? 2 : facets, scale };
  }
  return null;
}





export function particleFromGeometry(m: SprayMatrix | null | undefined): ParticleShape | null {
  if (!m || !(m.rows > 5 && m.cols > 2)) return null;
  const n = Math.floor(m.cols / 3) * 3;
  const vertices: number[] = [];
  const normals: number[] = [];
  for (let c = 0; c < n; c++) {
    const o = c * m.rows;
    vertices.push(Math.fround(m.data[o]), Math.fround(m.data[o + 1]), Math.fround(m.data[o + 2]));
    normals.push(Math.fround(m.data[o + 3]), Math.fround(m.data[o + 4]), Math.fround(m.data[o + 5]));
  }
  return { kind: "mesh", vertices, normals };
}

 
export function parseSprayConfig(options: string, volume?: SprayMatrix | null, geometry?: SprayMatrix | null): SprayConfig {
  const near = DEFAULT_NEAR.slice();
  const far = DEFAULT_FAR.slice();
  let particle: ParticleShape | null = particleFromGeometry(geometry);
  let shape: 1 | 2 = 1;
  let project = true;
  let stepA = 1;
  let stepB = 0;
  let rand = 1;

  if (volume && volume.rows > 0 && volume.cols > 0) {
    const rows = Math.min(16, volume.rows);
    for (let r = 0; r < rows; r++) near[r] = volume.data[r] ?? 0;
    if (volume.cols !== 1) for (let r = 0; r < rows; r++) far[r] = volume.data[volume.rows + r] ?? 0;
  }

  for (const token of (options ?? "").split(" ").filter((t) => t.length > 0)) {
    if (token.startsWith("STEP=")) {
      const parts = token.slice(5).split("x");
      if (parts.length > 1) {
        stepA = qtToInt(parts[0]);
        stepB = qtToInt(parts[1]);
      }
    } else if (token.startsWith("RAND=")) {
      rand = qtToInt(token.slice(5).split("x")[0]);
    } else if (token.startsWith("ELLYPSE")) {
      shape = 1;
    } else if (token.startsWith("RECTANGLE")) {
      shape = 2;
    } else if (token.startsWith("NO_PROJECT")) {
       
      project = false;
      near[2] = 0;
      near[5] = 0;
      near[8] = 0;
    } else if (token.startsWith("PROJECT")) {
      project = true;
    } else if (/^particle=/i.test(token)) {
      let spec = token.slice(9);
      if (spec.endsWith(")")) spec = spec.slice(0, -1);
      particle = parseParticle(spec) ?? particle;
    } else if (/^color=/i.test(token)) {
      const c = parseQColor(token.slice(6));
      for (let k = 0; k < 4; k++) {
        near[9 + k] = c[k];
        far[9 + k] = c[k];
      }
    }
  }

  particle ??= DEFAULT_PARTICLE;
  const rawB = stepB;
  stepA = Math.max(stepA, 1);
  stepB = Math.max(stepB, 0);

  const cfg: SprayConfig = {
    shape,
    project,
    stepA,
    stepB,
    rand,
    near,
    far,
    particle,
    angStep: 0,
    nearAStep: 0,
    nearBStep: 0,
    farAStep: 0,
    farBStep: 0,
    nearAVec: [0, 0, 0],
    nearBVec: [0, 0, 0],
    farAVec: [0, 0, 0],
    farBVec: [0, 0, 0],
  };
  if (shape === 2) {
    const ia = 1 / stepA;
    cfg.nearAVec = sub3(near, 3, near, 0).map((v) => v * ia) as Vec3;
    cfg.farAVec = sub3(far, 3, far, 0).map((v) => v * ia) as Vec3;
    if (rawB >= 1) {
      const ib = 1 / rawB;
      cfg.nearBVec = sub3(near, 6, near, 0).map((v) => v * ib) as Vec3;
      cfg.farBVec = sub3(far, 6, far, 0).map((v) => v * ib) as Vec3;
    }
  } else {
    cfg.angStep = (2 * Math.PI) / stepA;
    if (rawB >= 1) {
      cfg.nearAStep = len3(sub3(near, 3, near, 0)) / rawB;
      cfg.nearBStep = len3(sub3(near, 6, near, 0)) / rawB;
      cfg.farAStep = len3(sub3(far, 3, far, 0)) / rawB;
      cfg.farBStep = len3(sub3(far, 6, far, 0)) / rawB;
    }
  }
  return cfg;
}

 
export const particlesPerUpdate = (cfg: SprayConfig) => cfg.stepA * (cfg.stepB + 1);
