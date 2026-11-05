// Renders station geometry into fitted PNG thumbnails.
 
 
 

import { inv, mul, type Mat } from "@/engine/math";
import type { GeometryStore } from "@/engine/registry";
import type { Workspace } from "@/engine/types";
import { encodePngCompressed } from "@/engine/utilities/png";
import { rasterize, type RasterMesh } from "@/engine/utilities/raster";
import { sceneMeshes } from "@/engine/utilities/scene";
import type { V3 } from "./builder";

export interface ThumbnailView {
   
  azimuth?: number;
  elevation?: number;
   
  fov?: number;
   
  zoom?: number;
   
  target?: V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

 
function lookAt(eye: V3, target: V3, up: V3 = [0, 0, 1]): Mat {
  const z = norm(sub(target, eye));
  let x = cross(z, up);
  if (Math.hypot(...x) < 1e-6) x = cross(z, [0, 1, 0]);
  x = norm(x);
  const y = cross(z, x);
  return [x[0], y[0], z[0], eye[0], x[1], y[1], z[1], eye[1], x[2], y[2], z[2], eye[2], 0, 0, 0, 1];
}

const FLOOR_KEY: [number, number, number, number] = [0.9, 0.9, 0.9, 1];





function fitCamera(points: V3[], min: V3, max: V3, view: ThumbnailView, aspect: number): Mat {
  const az = ((view.azimuth ?? -55) * Math.PI) / 180;
  const el = ((view.elevation ?? 26) * Math.PI) / 180;
  const dir: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const target: V3 = view.target ?? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const tanV = Math.tan(((view.fov ?? 30) * Math.PI) / 360);
  const tanH = tanV * aspect;
  let dist = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / tanV;
  const at = () => lookAt([target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist], target);
  let pose = at();
  for (let k = 0; k < 16; k++) {
    const toCam = inv(pose);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of points) {
      const z = toCam[8] * c[0] + toCam[9] * c[1] + toCam[10] * c[2] + toCam[11];
      const x = (toCam[0] * c[0] + toCam[1] * c[1] + toCam[2] * c[2] + toCam[3]) / (z * tanH);
      const y = (toCam[4] * c[0] + toCam[5] * c[1] + toCam[6] * c[2] + toCam[7]) / (z * tanV);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
     
    const right: V3 = [pose[0], pose[4], pose[8]];
    const down: V3 = [pose[1], pose[5], pose[9]];
    const mx = ((x0 + x1) / 2) * dist * tanH;
    const my = ((y0 + y1) / 2) * dist * tanV;
    for (let i = 0; i < 3; i++) target[i] += right[i] * mx * 0.8 + down[i] * my * 0.8;
    const need = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
    dist *= 1 + (need / 0.88 - 1) * 0.8;
    pose = at();
  }
  if (view.zoom && view.zoom !== 1) {
    dist /= view.zoom;
    pose = at();
  }
  return pose;
}

function floorMesh(cx: number, cy: number, r: number): RasterMesh {
  const a = [cx - r, cy - r, 0];
  const b = [cx + r, cy - r, 0];
  const c = [cx + r, cy + r, 0];
  const d = [cx - r, cy + r, 0];
  return { triangles: Float32Array.from([...a, ...b, ...c, ...a, ...c, ...d]), pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color: FLOOR_KEY };
}

 
const ALBEDO = { bg: [0, 0, 0, 1] as [number, number, number, number], ambient: [1, 1, 1, 1] as [number, number, number, number], diffuse: [0, 0, 0, 1] as [number, number, number, number], specular: [0, 0, 0, 1] as [number, number, number, number] };

 
function bounds(meshes: RasterMesh[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const p = m.pose;
    const t = m.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const x = p[0] * t[i] + p[1] * t[i + 1] + p[2] * t[i + 2] + p[3];
      const y = p[4] * t[i] + p[5] * t[i + 1] + p[6] * t[i + 2] + p[7];
      const z = p[8] * t[i] + p[9] * t[i + 1] + p[10] * t[i + 2] + p[11];
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
    }
  }
  return { min, max };
}

export async function renderThumbnail(ws: Workspace, store: GeometryStore, station: string, view: ThumbnailView, size: [number, number] = [640, 400]): Promise<Uint8Array> {
  const SS = 3;
  const W = size[0] * SS;
  const H = size[1] * SS;
  const scene = sceneMeshes(ws, store, station);
  const { min, max } = bounds(scene);
  const center: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, 0];
  const radius = Math.max(max[0] - min[0], max[1] - min[1], 1) / 2;
  const floorR = radius * 3 + 1500;
  const fov = view.fov ?? 30;
   
  const points: V3[] = [];
  for (const m of scene) {
    const p = m.pose;
    const t = m.triangles;
    const step = Math.max(3, Math.floor(t.length / 3 / 400) * 3);
    for (let i = 0; i + 2 < t.length; i += step) points.push([p[0] * t[i] + p[1] * t[i + 1] + p[2] * t[i + 2] + p[3], p[4] * t[i] + p[5] * t[i + 1] + p[6] * t[i + 2] + p[7], p[8] * t[i] + p[9] * t[i + 1] + p[10] * t[i + 2] + p[11]]);
  }
  const camPose = fitCamera(points, min, max, view, W / H);
  const img = rasterize([floorMesh(center[0], center[1], floorR), ...scene], { pose: camPose, fov, near: 50, far: 60000, width: W, height: H }, ALBEDO);

   
   
  const la = (((view.azimuth ?? -55) + 50) * Math.PI) / 180;
  const lightDir = norm([-Math.cos(la) * 0.7, -Math.sin(la) * 0.7, -1]);
  const D = 20000;
  const lightEye: V3 = [center[0] - lightDir[0] * D, center[1] - lightDir[1] * D, max[2] / 2 - lightDir[2] * D];
  const lightPose = lookAt(lightEye, [center[0], center[1], max[2] / 2], [0, 1, 0]);
  const LS = 2048;
  const cover = Math.hypot(max[0] - min[0], max[1] - min[1], max[2]) / 2 + 200;
  const lightFov = (2 * Math.atan(cover / D) * 180) / Math.PI;
  const shadow = rasterize(scene, { pose: lightPose, fov: lightFov, near: 100, far: 2 * D, width: LS, height: LS, ortho: true }, ALBEDO);
  const toLight = inv(lightPose);
  const lTan = Math.tan((lightFov * Math.PI) / 360);
  const lScale = LS / 2 / (lTan * ((100 + 2 * D) / 2));
  const lightDepth = (lx: number, ly: number) => {
    const ix = Math.floor(lx);
    const iy = Math.floor(ly);
    if (ix < 0 || iy < 0 || ix >= LS || iy >= LS) return Infinity;
    return shadow.depth[iy * LS + ix];
  };

  const f = H / 2 / Math.tan((fov * Math.PI) / 360);
  const eye: V3 = [camPose[3], camPose[7], camPose[11]];
   
  const P = new Float32Array(W * H * 3).fill(NaN);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const z = img.depth[i];
      if (!Number.isFinite(z)) continue;
      const cx = ((px + 0.5 - W / 2) * z) / f;
      const cy = ((py + 0.5 - H / 2) * z) / f;
      P[i * 3] = camPose[0] * cx + camPose[1] * cy + camPose[2] * z + camPose[3];
      P[i * 3 + 1] = camPose[4] * cx + camPose[5] * cy + camPose[6] * z + camPose[7];
      P[i * 3 + 2] = camPose[8] * cx + camPose[9] * cy + camPose[10] * z + camPose[11];
    }
  }
  const at = (i: number): V3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
   
  const step = (i: number, a: number, b: number, ok: (j: number) => boolean): V3 | null => {
    const z = img.depth[i];
    const da = ok(a) && Number.isFinite(img.depth[a]) ? Math.abs(img.depth[a] - z) : Infinity;
    const db = ok(b) && Number.isFinite(img.depth[b]) ? Math.abs(img.depth[b] - z) : Infinity;
    if (!Number.isFinite(da) && !Number.isFinite(db)) return null;
    const p = at(i);
    if (da <= db) return sub(at(a), p);
    const q = at(b);
    return sub(p, q);
  };
  const key = norm([-lightDir[0], -lightDir[1], -lightDir[2]]);
  const acc = new Float32Array(W * H * 3);
  const top = [0.965, 0.968, 0.975];
  const bottom = [0.9, 0.905, 0.915];
  const floorColor = [0.9, 0.905, 0.91];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const z = img.depth[i];
      const t = py / H;
      const bg = [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t];
      let rgb: number[];
      if (!Number.isFinite(z)) rgb = bg;
      else {
        const [wx, wy, wz] = at(i);
        const isFloor = Math.abs(wz) < 0.5;
         
        let n: V3 = [0, 0, 1];
        if (!isFloor) {
          const dx = step(i, i + 1, i - 1, () => px + 1 < W && px > 0);
          const dy = step(i, i + W, i - W, () => py + 1 < H && py > 0);
          if (dx && dy) n = norm(cross(dx, dy));
        }
        const v = norm(sub(eye, [wx, wy, wz]));
        if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] < 0) n = [-n[0], -n[1], -n[2]];
         
        const l = mul(toLight, [1, 0, 0, wx, 0, 1, 0, wy, 0, 0, 1, wz, 0, 0, 0, 1]);
        const lx = LS / 2 + l[3] * lScale;
        const ly = LS / 2 + l[7] * lScale;
        let blocked = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lightDepth(lx + dx * 1.5, ly + dy * 1.5) < l[11] - (isFloor ? 2 : 10)) blocked++;
        const lit = 1 - blocked / 9;
        const ndl = Math.max(0, n[0] * key[0] + n[1] * key[1] + n[2] * key[2]);
        const ndv = Math.max(0, n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
         
        const h = norm([key[0] + v[0], key[1] + v[1], key[2] + v[2]]);
        const spec = Math.pow(Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]), 40) * 0.18 * lit;
        const light = 0.36 + 0.1 * n[2] + 0.5 * ndl * (isFloor ? 0.55 + 0.45 * lit : 0.3 + 0.7 * lit) + 0.16 * ndv;
        const albedo = isFloor ? floorColor : [img.rgba[i * 4] / 255, img.rgba[i * 4 + 1] / 255, img.rgba[i * 4 + 2] / 255];
        rgb = albedo.map((a) => a * light + (isFloor ? 0 : spec));
         
        if (!isFloor) {
          let edge = false;
          for (const j of [i - 1, i + 1, i - W, i + W]) {
            const zj = img.depth[j];
            if (j < 0 || j >= W * H) continue;
            if (!Number.isFinite(zj) || zj - z > z * 0.02) edge = true;
          }
          if (edge) rgb = rgb.map((c) => c * 0.55);
        }
        if (isFloor) {
           
          const d = Math.hypot(wx - center[0], wy - center[1]);
          const fade = Math.min(1, Math.max(0, (d - radius * 1.1) / (radius * 1.6 + 600)));
          rgb = rgb.map((c, k) => c * (1 - fade) + bg[k] * fade);
        }
      }
      acc[i * 3] = rgb[0];
      acc[i * 3 + 1] = rgb[1];
      acc[i * 3 + 2] = rgb[2];
    }
  }
  const out = new Uint8Array(size[0] * size[1] * 3);
   
  for (let y = 0; y < size[1]; y++) {
    for (let x = 0; x < size[0]; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += acc[((y * SS + dy) * W + x * SS + dx) * 3 + k];
        out[(y * size[0] + x) * 3 + k] = Math.round(Math.min(1, s / (SS * SS)) * 255);
      }
    }
  }
  return encodePngCompressed({ width: size[0], height: size[1], channels: 3, data: out });
}

