// Serializes meshes, tool files and uncompressed export archives.
 
 
 

import type { Mat } from "./math";

export interface ExportMesh {
   
  triangles: Float32Array;
  color: [number, number, number, number];
}

const normalOf = (t: Float32Array, o: number): [number, number, number] => {
  const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
  const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
};

 
export function transformTriangles(t: Float32Array, m: Mat): Float32Array {
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    const x = t[i], y = t[i + 1], z = t[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

 
export function writeSTL(meshes: ExportMesh[], header = "Enginuity"): Uint8Array {
  const n = meshes.reduce((k, m) => k + m.triangles.length / 9, 0);
  const out = new Uint8Array(84 + n * 50);
  out.set(new TextEncoder().encode(header.slice(0, 80)));
  const dv = new DataView(out.buffer);
  dv.setUint32(80, n, true);
  let o = 84;
  for (const m of meshes) {
    for (let t = 0; t < m.triangles.length; t += 9) {
      const nrm = normalOf(m.triangles, t);
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, nrm[k], true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, m.triangles[t + k], true);
      o += 50;
    }
  }
  return out;
}

 
export function writePLY(meshes: ExportMesh[]): Uint8Array {
  const nt = meshes.reduce((k, m) => k + m.triangles.length / 9, 0);
  const head = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\ncomment Enginuity\nelement vertex ${nt * 3}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\nelement face ${nt}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const out = new Uint8Array(head.length + nt * 3 * 16 + nt * 13);
  out.set(head);
  const dv = new DataView(out.buffer);
  let o = head.length;
  const c255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (const m of meshes) {
    const rgba = m.color.map(c255);
    for (let i = 0; i < m.triangles.length; i += 3) {
      dv.setFloat32(o, m.triangles[i], true);
      dv.setFloat32(o + 4, m.triangles[i + 1], true);
      dv.setFloat32(o + 8, m.triangles[i + 2], true);
      for (let k = 0; k < 4; k++) dv.setUint8(o + 12 + k, rgba[k]);
      o += 16;
    }
  }
  for (let f = 0; f < nt; f++) {
    dv.setUint8(o, 3);
    for (let k = 0; k < 3; k++) dv.setInt32(o + 1 + k * 4, f * 3 + k, true);
    o += 13;
  }
  return out;
}

 
export function writeWRL(meshes: ExportMesh[]): Uint8Array {
  const f = (v: number) => (Math.abs(v) < 1e-9 ? "0" : Number(v.toPrecision(9)).toString());
  let s = "#VRML V2.0 utf8\n# Enginuity\n";
  for (const m of meshes) {
    const pts: string[] = [];
    for (let i = 0; i < m.triangles.length; i += 3) pts.push(`${f(m.triangles[i])} ${f(m.triangles[i + 1])} ${f(m.triangles[i + 2])}`);
    const idx: string[] = [];
    for (let t = 0; t < m.triangles.length / 9; t++) idx.push(`${t * 3}, ${t * 3 + 1}, ${t * 3 + 2}, -1`);
    s += `Shape {\n  appearance Appearance { material Material { diffuseColor ${f(m.color[0])} ${f(m.color[1])} ${f(m.color[2])} transparency ${f(1 - m.color[3])} } }\n`;
    s += `  geometry IndexedFaceSet {\n    solid FALSE\n    coord Coordinate { point [\n      ${pts.join(",\n      ")}\n    ] }\n    coordIndex [\n      ${idx.join(",\n      ")}\n    ]\n  }\n}\n`;
  }
  return new TextEncoder().encode(s);
}

 

const ADLER = 65521;
function adler32(b: Uint8Array): number {
  let a = 1, c = 0;
  for (let i = 0; i < b.length; i++) {
    a = (a + b[i]) % ADLER;
    c = (c + a) % ADLER;
  }
  return ((c << 16) | a) >>> 0;
}

 
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let k = 0; k < blocks; k++) {
    const chunk = data.subarray(k * 65535, Math.min(data.length, (k + 1) * 65535));
    out[o] = k === blocks - 1 ? 1 : 0;
    out[o + 1] = chunk.length & 0xff;
    out[o + 2] = chunk.length >> 8;
    out[o + 3] = ~chunk.length & 0xff;
    out[o + 4] = (~chunk.length >> 8) & 0xff;
    out.set(chunk, o + 5);
    o += 5 + chunk.length;
  }
  const a = adler32(data);
  out[o] = a >>> 24;
  out[o + 1] = (a >>> 16) & 0xff;
  out[o + 2] = (a >>> 8) & 0xff;
  out[o + 3] = a & 0xff;
  return out;
}

 
export function qCompress(data: Uint8Array): Uint8Array {
  const z = zlibStored(data);
  const out = new Uint8Array(4 + z.length);
  new DataView(out.buffer).setUint32(0, data.length, false);
  out.set(z, 4);
  return out;
}







export function writeToolFile(name: string, tcp: Mat, meshes: ExportMesh[]): Uint8Array {
  return qCompress(writeShapeStream(name, tcp, meshes));
}






export function writeSldFile(name: string, meshes: ExportMesh[]): Uint8Array {
  return writeShapeStream(name, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], meshes);
}

function writeShapeStream(name: string, tcp: Mat, meshes: ExportMesh[]): Uint8Array {
  const rows = 16, cols = 100;
  const head = new Float64Array(rows * cols);
  head[0] = 1;
  head[1] = rows * cols;
  head[2] = rows;
  head[3] = cols;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) head[10 * rows + c * 4 + r] = tcp[r * 4 + c];
  [...name].slice(0, 160).forEach((ch, k) => (head[90 * rows + k] = ch.codePointAt(0)!));
  const shapes = meshes.filter((m) => m.triangles.length);
  const size = head.byteLength + 8 + shapes.reduce((n, m) => n + 8 + 16 + (m.triangles.length / 3) * 14, 0) + 16;
  const out = new Uint8Array(size);
  out.set(new Uint8Array(head.buffer));
  const dv = new DataView(out.buffer);
  let o = head.byteLength;
  dv.setBigInt64(o, BigInt(shapes.length), true);
  o += 8;
  for (const m of shapes) {
    dv.setBigInt64(o, BigInt(m.triangles.length / 9), true);
    o += 8;
    for (let k = 0; k < 4; k++) dv.setFloat32(o + k * 4, m.color[k], true);
    o += 16;
    for (let t = 0; t < m.triangles.length; t += 9) {
       
      const [nx, ny, nz] = normalOf(m.triangles, t);
      const th = Math.acos(Math.max(-1, Math.min(1, nz)));
      let ph = Math.atan2(ny, nx);
      if (ph < 0) ph += 2 * Math.PI;
      const b0 = Math.round((th / Math.PI) * 255), b1 = Math.round((ph / (2 * Math.PI)) * 255) % 256;
      for (let v = 0; v < 3; v++) {
        dv.setFloat32(o, m.triangles[t + v * 3], true);
        dv.setFloat32(o + 4, m.triangles[t + v * 3 + 1], true);
        dv.setFloat32(o + 8, m.triangles[t + v * 3 + 2], true);
        dv.setUint8(o + 12, b0);
        dv.setUint8(o + 13, b1);
        o += 14;
      }
    }
  }
  dv.setBigInt64(o, BigInt(0), true);  
  dv.setBigInt64(o + 8, BigInt(0), true);  
  return out;
}

 

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

 
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);  
    l.setUint32(14, crc, true);
    l.setUint32(18, f.data.length, true);
    l.setUint32(22, f.data.length, true);
    l.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, f.data);
    central.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let o = 0;
  for (const b of [...locals, ...central, end]) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
