 
 
 
 
 

import { inv, mul, type Mat } from "../math";
import type { RGBA } from "./camera";

export interface RasterMesh {
   
  triangles: Float32Array;
   
  pose: Mat;
  color: RGBA;
}

export interface RasterCamera {
   
  pose: Mat;
   
  fov: number;
  near: number;
  far: number;
  width: number;
  height: number;
  ortho?: boolean;
}

export interface RasterLights {
  bg: RGBA;
  ambient: RGBA;
  diffuse: RGBA;
  specular: RGBA;
}

export interface RasterImage {
  width: number;
  height: number;
   
  rgba: Uint8ClampedArray;
   
  depth: Float32Array;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

 
type V3 = [number, number, number];

function clipNear(poly: V3[], near: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = a[2] >= near;
    const inb = b[2] >= near;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (near - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]);
    }
  }
  return out;
}

 
export function rasterize(meshes: RasterMesh[], cam: RasterCamera, lights: RasterLights): RasterImage {
  const W = Math.max(1, Math.round(cam.width));
  const H = Math.max(1, Math.round(cam.height));
  const rgba = new Uint8ClampedArray(W * H * 4);
  const depth = new Float32Array(W * H).fill(Infinity);
  const bg = lights.bg;
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = bg[0] * 255;
    rgba[i * 4 + 1] = bg[1] * 255;
    rgba[i * 4 + 2] = bg[2] * 255;
    rgba[i * 4 + 3] = 255;
  }
  const near = Math.max(1e-3, cam.near);
  const far = cam.far;
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
  const f = H / 2 / tanHalf;
   
  const orthoScale = cam.ortho ? H / 2 / (tanHalf * ((near + far) / 2)) : 0;
  const cx = W / 2;
  const cy = H / 2;
  const project = (p: V3): [number, number, number] =>
    cam.ortho ? [cx + p[0] * orthoScale, cy + p[1] * orthoScale, p[2]] : [cx + (f * p[0]) / p[2], cy + (f * p[1]) / p[2], p[2]];
  const toCam = inv(cam.pose);

  for (const mesh of meshes) {
    const m = mul(toCam, mesh.pose);
    const t = mesh.triangles;
    const [r0, g0, b0] = mesh.color;
    for (let k = 0; k + 8 < t.length; k += 9) {
      const tri: V3[] = [];
      for (let v = 0; v < 3; v++) {
        const x = t[k + v * 3];
        const y = t[k + v * 3 + 1];
        const z = t[k + v * 3 + 2];
        tri.push([m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]]);
      }
      if (tri[0][2] < near && tri[1][2] < near && tri[2][2] < near) continue;
      if (tri[0][2] > far && tri[1][2] > far && tri[2][2] > far) continue;
       
      const e1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]];
      const e2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1];
      let ny = e1[2] * e2[0] - e1[0] * e2[2];
      let nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx, ny, nz);
      if (nl === 0) continue;
      nx /= nl;
      ny /= nl;
      nz /= nl;
       
      const c = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
      const cl = Math.hypot(c[0], c[1], c[2]) || 1;
      const lambert = Math.abs((nx * -c[0] + ny * -c[1] + nz * -c[2]) / cl);
      const spec = cam.ortho ? Math.abs(nz) ** 32 : lambert ** 32;
      const shade = (base: number, ch: number) => clamp01(base * (lights.ambient[ch] + lights.diffuse[ch] * lambert) + lights.specular[ch] * spec * 0.35);
      const cr = shade(r0, 0) * 255;
      const cg = shade(g0, 1) * 255;
      const cb = shade(b0, 2) * 255;

      const poly = cam.ortho ? tri : clipNear(tri, near);
      if (poly.length < 3) continue;
      const pts = poly.map(project);
       
      for (let j = 1; j + 1 < pts.length; j++) {
        const a = pts[0];
        const b = pts[j];
        const d = pts[j + 1];
        const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        if (Math.abs(area) < 1e-12) continue;
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], d[0])));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], d[0])));
        const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], d[1])));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], d[1])));
        if (minX > maxX || minY > maxY) continue;
         
        const za = cam.ortho ? a[2] : 1 / a[2];
        const zb = cam.ortho ? b[2] : 1 / b[2];
        const zd = cam.ortho ? d[2] : 1 / d[2];
        const inv2 = 1 / area;
        for (let py = minY; py <= maxY; py++) {
          const sy = py + 0.5;
          for (let px = minX; px <= maxX; px++) {
            const sx = px + 0.5;
            const w0 = ((b[0] - sx) * (d[1] - sy) - (b[1] - sy) * (d[0] - sx)) * inv2;
            const w1 = ((d[0] - sx) * (a[1] - sy) - (d[1] - sy) * (a[0] - sx)) * inv2;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const zi = w0 * za + w1 * zb + w2 * zd;
            const z = cam.ortho ? zi : 1 / zi;
            if (z < near || z > far) continue;
            const idx = py * W + px;
            if (z >= depth[idx]) continue;
            depth[idx] = z;
            rgba[idx * 4] = cr;
            rgba[idx * 4 + 1] = cg;
            rgba[idx * 4 + 2] = cb;
          }
        }
      }
    }
  }
  return { width: W, height: H, rgba, depth };
}

 
export function toGray(img: RasterImage): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * img.rgba[i * 4] + 0.587 * img.rgba[i * 4 + 1] + 0.114 * img.rgba[i * 4 + 2]);
  return out;
}





export function toDepth32(img: RasterImage, near: number, far: number): Uint32Array {
  const out = new Uint32Array(img.width * img.height);
  const span = far - near;
  for (let i = 0; i < out.length; i++) {
    const z = img.depth[i];
    if (!Number.isFinite(z) || span <= 0) continue;
    out[i] = Math.round((1 - clamp01((z - near) / span)) * 0xffffffff);
  }
  return out;
}
