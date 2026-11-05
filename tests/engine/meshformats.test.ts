// Verifies mesh-format readers preserve triangulation, transforms, and material colors.
 
import { describe, expect, it } from "vitest";
import { DRACO_NOT_SUPPORTED } from "@/engine/meshformats";
import { MESH_EXTENSIONS, parseMeshParts } from "@/engine/meshio";
import { engine } from "../helpers";

const enc = (s: string) => new TextEncoder().encode(s);
const tri = (parts: { triangles: Float32Array }[]) => parts.reduce((n, p) => n + p.triangles.length / 9, 0);
const round = (a: Float32Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);

describe("PLY", () => {
  const header = (format: string) =>
    `ply\nformat ${format} 1.0\ncomment made by RoboCraft tests\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  it("reads ASCII quads with face colours as a triangle fan", () => {
    const parts = parseMeshParts("q.ply", enc(header("ascii") + "0 0 0\n10 0 0\n10 10 0\n0 10 0\n4 0 1 2 3 255 0 0\n"));
    expect(parts.length).toBe(1);
    expect(tri(parts)).toBe(2);
    expect(parts[0].color).toEqual([1, 0, 0, 1]);
    expect(round(parts[0].triangles)).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 0, 10, 10, 0, 0, 10, 0]);
  });
  it("reads binary little-endian files", () => {
    const head = enc(header("binary_little_endian"));
    const body = new DataView(new ArrayBuffer(4 * 12 + 1 + 16 + 3));
    [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]].forEach((v, k) => v.forEach((c, j) => body.setFloat32((k * 3 + j) * 4, c, true)));
    body.setUint8(48, 4);
    [0, 1, 2, 3].forEach((v, k) => body.setInt32(49 + k * 4, v, true));
    body.setUint8(65, 0);
    body.setUint8(66, 128);
    body.setUint8(67, 255);
    const bytes = new Uint8Array(head.length + body.byteLength);
    bytes.set(head);
    bytes.set(new Uint8Array(body.buffer), head.length);
    const parts = parseMeshParts("q.ply", bytes);
    expect(tri(parts)).toBe(2);
    expect(parts[0].color![2]).toBe(1);
    expect(parts[0].color![1]).toBeCloseTo(128 / 255);
  });
});

describe("VRML", () => {
  it("V2.0: Transform, Shape, Material and IndexedFaceSet", () => {
    const wrl = `#VRML V2.0 utf8
# exported
DEF Root Transform {
  translation 100 0 0
  rotation 0 0 1 1.5707963
  children [
    Shape {
      appearance Appearance { material Material { diffuseColor 1 0 0 transparency 0.25 } }
      geometry IndexedFaceSet { coord Coordinate { point [ 0 0 0, 10 0 0, 0 10 0 ] } coordIndex [ 0, 1, 2, -1 ] }
    }
  ]
}`;
    const parts = parseMeshParts("a.wrl", enc(wrl));
    expect(parts.length).toBe(1);
    expect(parts[0].color).toEqual([1, 0, 0, 0.75]);
     
    expect(round(parts[0].triangles).slice(3, 6)).toEqual([100, 10, 0]);
  });
  it("V1.0: Separator, Material, Coordinate3, IndexedFaceSet", () => {
    const wrl = `#VRML V1.0 ascii
Separator {
  Material { diffuseColor 0 1 0 }
  Coordinate3 { point [ 0 0 0, 1 0 0, 1 1 0, 0 1 0 ] }
  IndexedFaceSet { coordIndex [ 0, 1, 2, 3, -1 ] }
}`;
    const parts = parseMeshParts("b.vrml", enc(wrl));
    expect(tri(parts)).toBe(2);
    expect(parts[0].color).toEqual([0, 1, 0, 1]);
  });
});

 
function chunk(id: number, ...body: Uint8Array[]): Uint8Array {
  const len = 6 + body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, id, true);
  dv.setUint32(2, len, true);
  let o = 6;
  for (const b of body) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
const cstr = (s: string) => enc(s + "\0");
const u16s = (...v: number[]) => {
  const b = new Uint8Array(v.length * 2);
  v.forEach((x, k) => new DataView(b.buffer).setUint16(k * 2, x, true));
  return b;
};
const f32s = (...v: number[]) => {
  const b = new Uint8Array(v.length * 4);
  v.forEach((x, k) => new DataView(b.buffer).setFloat32(k * 4, x, true));
  return b;
};

describe("3DS", () => {
  it("reads meshes and their material colours", () => {
    const mat = chunk(0xafff, chunk(0xa000, cstr("Red")), chunk(0xa020, chunk(0x0011, Uint8Array.from([255, 0, 0]))));
    const mesh = chunk(
      0x4100,
      chunk(0x4110, u16s(3), f32s(0, 0, 0, 5, 0, 0, 0, 5, 0)),
      chunk(0x4120, u16s(1), u16s(0, 1, 2, 0), chunk(0x4130, cstr("Red"), u16s(1, 0))),
    );
    const file = chunk(0x4d4d, chunk(0x3d3d, mat, chunk(0x4000, cstr("Box"), mesh)));
    const parts = parseMeshParts("box.3ds", file);
    expect(parts).toEqual([{ triangles: Float32Array.from([0, 0, 0, 5, 0, 0, 0, 5, 0]), color: [1, 0, 0, 1] }]);
  });
});

describe("COLLADA", () => {
  it("reads triangles placed by the visual scene with the bound material colour", () => {
    const dae = `<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <library_effects><effect id="fx"><profile_COMMON><technique sid="t"><phong><diffuse><color>0 0 1 1</color></diffuse></phong></technique></profile_COMMON></effect></library_effects>
  <library_materials><material id="blue"><instance_effect url="#fx"/></material></library_materials>
  <library_geometries><geometry id="g"><mesh>
    <source id="pos"><float_array id="pa" count="9">0 0 0 1 0 0 0 1 0</float_array></source>
    <vertices id="v"><input semantic="POSITION" source="#pos"/></vertices>
    <triangles count="1" material="m"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node><translate>0 0 7</translate>
    <instance_geometry url="#g"><bind_material><technique_common><instance_material symbol="m" target="#blue"/></technique_common></bind_material></instance_geometry>
  </node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;
    const parts = parseMeshParts("t.dae", enc(dae));
    expect(parts.length).toBe(1);
    expect(parts[0].color).toEqual([0, 0, 1, 1]);
    expect(round(parts[0].triangles)).toEqual([0, 0, 7, 1, 0, 7, 0, 1, 7]);
  });
});

function glb(json: object, bin: Uint8Array): Uint8Array {
  const pad = (b: Uint8Array, fill: number) => {
    const n = Math.ceil(b.length / 4) * 4;
    const out = new Uint8Array(n).fill(fill);
    out.set(b);
    return out;
  };
  const j = pad(enc(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const out = new Uint8Array(12 + 8 + j.length + 8 + b.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  dv.setUint32(20 + j.length, b.length, true);
  dv.setUint32(24 + j.length, 0x004e4942, true);
  out.set(b, 28 + j.length);
  return out;
}

describe("glTF", () => {
  const positions = f32s(0, 0, 0, 2, 0, 0, 0, 2, 0);
  const indices = u16s(0, 1, 2);
  const bin = new Uint8Array(positions.length + indices.length + 2);
  bin.set(positions);
  bin.set(indices, positions.length);
  const json = (extra: object = {}) => ({
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0, translation: [0, 0, 3] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...extra,
  });
  it("GLB: node transforms, indices and base colour", () => {
    const parts = parseMeshParts("m.glb", glb(json(), bin));
    expect(parts[0].color).toEqual([0.5, 0.5, 0.5, 1]);
    expect(round(parts[0].triangles)).toEqual([0, 0, 3, 2, 0, 3, 0, 2, 3]);
  });
  it(".gltf with an embedded data URI buffer", () => {
    const j = json({ buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${Buffer.from(bin).toString("base64")}` }] });
    expect(tri(parseMeshParts("m.gltf", enc(JSON.stringify(j))))).toBe(1);
  });
  it("Draco-compressed meshes are refused with RoboDK's message", () => {
    expect(() => parseMeshParts("d.glb", glb(json({ extensionsUsed: ["KHR_draco_mesh_compression"] }), bin))).toThrow(DRACO_NOT_SUPPORTED + "d.glb");
  });
});

describe("SLP and the open path", () => {
  it("reads Pro/E render files with their colours", () => {
    const slp = "solid part\ncolor 0.2 0.4 0.6\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid\n";
    const parts = parseMeshParts("p.slp", enc(slp));
    expect(parts[0].color).toEqual([0.2, 0.4, 0.6, 1]);
    expect(tri(parts)).toBe(1);
  });
  it("file.open keeps one mesh per colour on the new object", async () => {
    const e = await engine();
    const wrl = `#VRML V2.0 utf8
Shape { appearance Appearance { material Material { diffuseColor 1 0 0 } } geometry IndexedFaceSet { coord Coordinate { point [0 0 0, 1 0 0, 0 1 0] } coordIndex [0 1 2 -1] } }
Shape { appearance Appearance { material Material { diffuseColor 0 0 1 } } geometry IndexedFaceSet { coord Coordinate { point [0 0 1, 1 0 1, 0 1 1] } coordIndex [0 1 2 -1] } }`;
    const r = await e.run("file.open", { fileName: "two.wrl", base64: Buffer.from(wrl).toString("base64") });
    const obj = e.ws.items[String(r.id)];
    expect(obj.object!.meshes.map((m) => m.color)).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ]);
    expect([...MESH_EXTENSIONS].sort()).toEqual(["3ds", "dae", "glb", "gltf", "obj", "ply", "slp", "stl", "vrml", "wrl", "wrml"]);
  });
});
