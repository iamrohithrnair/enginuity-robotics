 
 
 

import { parse3DS, parseDAE, parseGLTF, parsePLY, parseSLP, parseVRML, type MeshPart } from "./meshformats";

export type { MeshPart };

export function parseSTL(bytes: Uint8Array): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  const verts: number[] = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) verts.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (verts.length % 9 !== 0 || verts.length === 0) throw new Error("Invalid STL file");
  return Float32Array.from(verts);
}

export function parseOBJ(bytes: Uint8Array): Float32Array {
  const text = new TextDecoder().decode(bytes);
  const v: number[][] = [];
  const out: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "v") v.push([Number(t[1]), Number(t[2]), Number(t[3])]);
    else if (t[0] === "f") {
      const idx = t.slice(1).map((s) => {
        const k = parseInt(s.split("/")[0], 10);
        return k < 0 ? v.length + k : k - 1;
      });
      for (let i = 1; i + 1 < idx.length; i++) for (const j of [idx[0], idx[i], idx[i + 1]]) out.push(...(v[j] ?? [0, 0, 0]));
    }
  }
  if (!out.length) throw new Error("Invalid OBJ file");
  return Float32Array.from(out);
}

 
export const MESH_EXTENSIONS = new Set(["stl", "obj", "ply", "wrl", "vrml", "wrml", "3ds", "dae", "glb", "gltf", "slp"]);

 
export function parseMeshParts(name: string, bytes: Uint8Array): MeshPart[] {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "stl":
      return [{ triangles: parseSTL(bytes) }];
    case "obj":
      return [{ triangles: parseOBJ(bytes) }];
    case "ply":
      return parsePLY(bytes);
    case "wrl":
    case "vrml":
    case "wrml":
      return parseVRML(bytes);
    case "3ds":
      return parse3DS(bytes);
    case "dae":
      return parseDAE(bytes);
    case "glb":
    case "gltf":
      return parseGLTF(bytes, name.replace(/^.*[\\/]/, ""));
    case "slp":
      return parseSLP(bytes);
  }
  throw new Error(`Unsupported file format: .${ext}`);
}

export function parseMesh(name: string, bytes: Uint8Array): Float32Array {
  const parts = parseMeshParts(name, bytes);
  if (parts.length === 1) return parts[0].triangles;
  const out = new Float32Array(parts.reduce((n, p) => n + p.triangles.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p.triangles, o);
    o += p.triangles.length;
  }
  return out;
}

export function scaleMesh(tri: Float32Array, s: number): Float32Array {
  if (s === 1) return tri;
  const out = new Float32Array(tri.length);
  for (let i = 0; i < tri.length; i++) out[i] = tri[i] * s;
  return out;
}

export function boundingBox(tri: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], tri[i + k]);
      max[k] = Math.max(max[k], tri[i + k]);
    }
  }
  return { min, max };
}

 
export function boxMesh(sx: number, sy: number, sz: number): Float32Array {
  const x = sx / 2, y = sy / 2;
  const v = [
    [-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0],
    [-x, -y, sz], [x, -y, sz], [x, y, sz], [-x, y, sz],
  ];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}

export function cylinderMesh(r: number, h: number, n = 48): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)], p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    out.push(0, 0, 0, p1[0], p1[1], 0, p0[0], p0[1], 0);
    out.push(0, 0, h, p0[0], p0[1], h, p1[0], p1[1], h);
    out.push(p0[0], p0[1], 0, p1[0], p1[1], 0, p1[0], p1[1], h);
    out.push(p0[0], p0[1], 0, p1[0], p1[1], h, p0[0], p0[1], h);
  }
  return Float32Array.from(out);
}

export function sphereMesh(r: number, seg = 24): Float32Array {
  const out: number[] = [];
  const pt = (i: number, j: number) => {
    const th = (i / seg) * Math.PI, ph = (j / seg) * 2 * Math.PI;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r + r * Math.cos(th)];
  };
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return Float32Array.from(out);
}
