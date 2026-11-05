// Parses PLY, VRML, 3DS, Collada, glTF and SLP meshes.
 
 
 
 

export type RGBA = [number, number, number, number];
export interface MeshPart {
   
  triangles: Float32Array;
  color?: RGBA;
   
  normals?: Float32Array;
}

 
class PartBuilder {
  private parts = new Map<string, { color?: RGBA; data: number[] }>();
  add(color: RGBA | undefined, a: number[], b: number[], c: number[]) {
    const key = color ? color.map((v) => v.toFixed(3)).join(",") : "-";
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { color, data: [] }));
    p.data.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
   
  addPolygon(color: RGBA | undefined, pts: number[][]) {
    for (let i = 1; i + 1 < pts.length; i++) this.add(color, pts[0], pts[i], pts[i + 1]);
  }
  result(format: string): MeshPart[] {
    const out = [...this.parts.values()].filter((p) => p.data.length).map((p) => ({ triangles: Float32Array.from(p.data), ...(p.color ? { color: p.color } : {}) }));
    if (!out.length) throw new Error(`Invalid ${format} file: no triangles found`);
    return out;
  }
}

 
 

type M4 = number[];
const I4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul4(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const T4 = (x: number, y: number, z: number): M4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S4 = (x: number, y: number, z: number): M4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
 
function R4(x: number, y: number, z: number, angle: number): M4 {
  const n = Math.hypot(x, y, z) || 1;
  x /= n;
  y /= n;
  z /= n;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1];
}
 
function Q4(x: number, y: number, z: number, w: number): M4 {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0, 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0, 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}
const apply = (m: M4, p: number[]) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
const isIdentity = (m: M4) => m.every((v, i) => Math.abs(v - I4()[i]) < 1e-12);

 

const PLY_TYPES: Record<string, [number, (dv: DataView, o: number, le: boolean) => number]> = {
  char: [1, (dv, o) => dv.getInt8(o)],
  int8: [1, (dv, o) => dv.getInt8(o)],
  uchar: [1, (dv, o) => dv.getUint8(o)],
  uint8: [1, (dv, o) => dv.getUint8(o)],
  short: [2, (dv, o, le) => dv.getInt16(o, le)],
  int16: [2, (dv, o, le) => dv.getInt16(o, le)],
  ushort: [2, (dv, o, le) => dv.getUint16(o, le)],
  uint16: [2, (dv, o, le) => dv.getUint16(o, le)],
  int: [4, (dv, o, le) => dv.getInt32(o, le)],
  int32: [4, (dv, o, le) => dv.getInt32(o, le)],
  uint: [4, (dv, o, le) => dv.getUint32(o, le)],
  uint32: [4, (dv, o, le) => dv.getUint32(o, le)],
  float: [4, (dv, o, le) => dv.getFloat32(o, le)],
  float32: [4, (dv, o, le) => dv.getFloat32(o, le)],
  double: [8, (dv, o, le) => dv.getFloat64(o, le)],
  float64: [8, (dv, o, le) => dv.getFloat64(o, le)],
};

interface PlyProp {
  name: string;
  type: string;
  list?: { count: string; item: string };
}

export function parsePLY(bytes: Uint8Array): MeshPart[] {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const endIdx = head.indexOf("end_header");
  if (!head.startsWith("ply") || endIdx < 0) throw new Error("Invalid PLY file");
  let dataStart = endIdx + "end_header".length;
  if (head[dataStart] === "\r") dataStart++;
  if (head[dataStart] === "\n") dataStart++;
  let format = "ascii";
  const elements: { name: string; count: number; props: PlyProp[] }[] = [];
  for (const line of head.slice(0, endIdx).split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "format") format = t[1];
    else if (t[0] === "element") elements.push({ name: t[1], count: Number(t[2]), props: [] });
    else if (t[0] === "property" && elements.length) {
      const el = elements[elements.length - 1];
      if (t[1] === "list") el.props.push({ name: t[4], type: "list", list: { count: t[2], item: t[3] } });
      else el.props.push({ name: t[2], type: t[1] });
    }
  }
  const verts: number[][] = [];
  const vcolors: (RGBA | undefined)[] = [];
  const faces: { idx: number[]; color?: RGBA }[] = [];
  const colorOf = (rec: Record<string, number>, props: PlyProp[]): RGBA | undefined => {
    const r = rec.red ?? rec.diffuse_red, g = rec.green ?? rec.diffuse_green, b = rec.blue ?? rec.diffuse_blue;
    if (r === undefined || g === undefined || b === undefined) return undefined;
    const isFloat = props.some((p) => /red/.test(p.name) && /float|double/.test(p.type));
    const k = isFloat ? 1 : 1 / 255;
    return [r * k, g * k, b * k, rec.alpha !== undefined ? rec.alpha * k : 1];
  };
  const handle = (el: (typeof elements)[number], rec: Record<string, number>, list: number[] | undefined) => {
    if (el.name === "vertex") {
      verts.push([rec.x, rec.y, rec.z]);
      vcolors.push(colorOf(rec, el.props));
    } else if (el.name === "face" && list) faces.push({ idx: list, color: colorOf(rec, el.props) });
  };
  if (format === "ascii") {
    const text = new TextDecoder().decode(bytes.subarray(dataStart));
    const tok = text.split(/\s+/).filter(Boolean);
    let i = 0;
    for (const el of elements) {
      for (let n = 0; n < el.count; n++) {
        const rec: Record<string, number> = {};
        let list: number[] | undefined;
        for (const p of el.props) {
          if (p.list) {
            const c = Number(tok[i++]);
            list = tok.slice(i, i + c).map(Number);
            i += c;
          } else rec[p.name] = Number(tok[i++]);
        }
        handle(el, rec, list);
      }
    }
  } else {
    const le = format === "binary_little_endian";
    if (!le && format !== "binary_big_endian") throw new Error(`Invalid PLY file: format ${format}`);
    const dv = new DataView(bytes.buffer, bytes.byteOffset + dataStart, bytes.byteLength - dataStart);
    let o = 0;
    const read = (type: string) => {
      const t = PLY_TYPES[type];
      if (!t) throw new Error(`Invalid PLY file: type ${type}`);
      const v = t[1](dv, o, le);
      o += t[0];
      return v;
    };
    for (const el of elements) {
      for (let n = 0; n < el.count; n++) {
        const rec: Record<string, number> = {};
        let list: number[] | undefined;
        for (const p of el.props) {
          if (p.list) {
            const c = read(p.list.count);
            list = [];
            for (let k = 0; k < c; k++) list.push(read(p.list.item));
          } else rec[p.name] = read(p.type);
        }
        handle(el, rec, list);
      }
    }
  }
  const b = new PartBuilder();
  for (const f of faces) {
    const pts = f.idx.map((k) => verts[k]).filter(Boolean);
    if (pts.length >= 3) b.addPolygon(f.color ?? vcolors[f.idx[0]], pts);
  }
  return b.result("PLY");
}

 

type VNode = { type: string; fields: Record<string, VValue> };
type VValue = VNode | VValue[] | number | string;

function vrmlTokens(text: string): string[] {
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"|#[^\n]*|[{}[\]]|[^\s,{}[\]"#]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[0][0] !== "#") out.push(m[0]);
  return out;
}

const isNum = (t: string | undefined) => t !== undefined && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t);

function parseVrml(text: string): VNode[] {
  const tok = vrmlTokens(text);
  const defs = new Map<string, VNode>();
  let i = 0;
  const node = (): VNode | null => {
    let name: string | undefined;
    if (tok[i] === "USE") {
      i += 2;
      return defs.get(tok[i - 1]) ?? null;
    }
    if (tok[i] === "DEF") {
      name = tok[i + 1];
      i += 2;
    }
    const type = tok[i++];
    if (tok[i] !== "{") return null;
    i++;
    const n: VNode = { type, fields: {} };
    if (name) defs.set(name, n);
    const children: VValue[] = [];
    while (i < tok.length && tok[i] !== "}") {
       
      if (tok[i + 1] === "{" || tok[i] === "DEF" || tok[i] === "USE") {
        const before = i;
        const c = node();
        if (c) children.push(c);
        if (i === before) i++;
        continue;
      }
      const field = tok[i++];
      if (field === "ROUTE") {
        i += 3;
        continue;
      }
      n.fields[field] = value();
    }
    if (children.length) n.fields.__children = children;
    i++;
    return n;
  };
  const value = (): VValue => {
    const t = tok[i];
    if (t === "[") {
      i++;
      const list: VValue[] = [];
      while (i < tok.length && tok[i] !== "]") {
        if (isNum(tok[i])) list.push(Number(tok[i++]));
        else if (tok[i + 1] === "{" || tok[i] === "DEF" || tok[i] === "USE") {
          const n = node();
          if (n) list.push(n);
        } else list.push(tok[i++]);
      }
      i++;
      return list;
    }
    if (isNum(t)) {
      const nums: number[] = [];
      while (isNum(tok[i])) nums.push(Number(tok[i++]));
      return nums.length === 1 ? nums[0] : nums;
    }
    if (tok[i + 1] === "{" || t === "DEF" || t === "USE") return node() ?? "";
    i++;
    return t;
  };
  const roots: VNode[] = [];
  while (i < tok.length) {
    const before = i;
    if (tok[i] === "PROTO" || tok[i] === "EXTERNPROTO") break;
    const n = node();
    if (n) roots.push(n);
    if (i === before) i++;
  }
  return roots;
}

const nums = (v: VValue | undefined): number[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "number") as number[]) : typeof v === "number" ? [v] : []);

export function parseVRML(bytes: Uint8Array): MeshPart[] {
  const text = new TextDecoder().decode(bytes);
  if (!/^#VRML/.test(text)) throw new Error("Invalid VRML file");
  const v1 = /^#VRML V1/.test(text);
  const b = new PartBuilder();
  const roots = parseVrml(text);
  const faceSet = (m: M4, ifs: VNode, coords: number[], color: RGBA | undefined, ccw = true) => {
    const idx = nums(ifs.fields.coordIndex);
    let poly: number[][] = [];
    const flush = () => {
      if (poly.length >= 3) b.addPolygon(color, ccw ? poly : poly.slice().reverse());
      poly = [];
    };
    for (const k of idx) {
      if (k < 0) flush();
      else if (k * 3 + 2 < coords.length) poly.push(apply(m, [coords[k * 3], coords[k * 3 + 1], coords[k * 3 + 2]]));
    }
    flush();
  };
  const materialColor = (mat: VNode | undefined): RGBA | undefined => {
    if (!mat) return undefined;
    const d = nums(mat.fields.diffuseColor);
    if (d.length < 3) return undefined;
    const t = nums(mat.fields.transparency)[0] ?? 0;
    return [d[0], d[1], d[2], 1 - t];
  };
  if (v1) {
     
     
    const walk = (n: VNode, st: { m: M4; coords: number[]; color?: RGBA }) => {
      switch (n.type) {
        case "Separator":
        case "TransformSeparator": {
          const inner = { ...st };
          for (const c of (n.fields.__children as VNode[] | undefined) ?? []) walk(c, inner);
          break;
        }
        case "Material":
          st.color = materialColor(n);
          break;
        case "Coordinate3":
          st.coords = nums(n.fields.point);
          break;
        case "Translation":
          st.m = mul4(st.m, T4(...(nums(n.fields.translation).concat([0, 0, 0]).slice(0, 3) as [number, number, number])));
          break;
        case "Rotation": {
          const r = nums(n.fields.rotation);
          if (r.length === 4) st.m = mul4(st.m, R4(r[0], r[1], r[2], r[3]));
          break;
        }
        case "Scale":
          st.m = mul4(st.m, S4(...(nums(n.fields.scaleFactor).concat([1, 1, 1]).slice(0, 3) as [number, number, number])));
          break;
        case "MatrixTransform": {
          const a = nums(n.fields.matrix);
           
          if (a.length === 16) st.m = mul4(st.m, [a[0], a[4], a[8], a[12], a[1], a[5], a[9], a[13], a[2], a[6], a[10], a[14], 0, 0, 0, 1]);
          break;
        }
        case "Transform": {
          const t = nums(n.fields.translation), r = nums(n.fields.rotation), s = nums(n.fields.scaleFactor);
          if (t.length === 3) st.m = mul4(st.m, T4(t[0], t[1], t[2]));
          if (r.length === 4) st.m = mul4(st.m, R4(r[0], r[1], r[2], r[3]));
          if (s.length === 3) st.m = mul4(st.m, S4(s[0], s[1], s[2]));
          break;
        }
        case "IndexedFaceSet":
          faceSet(st.m, n, st.coords, st.color);
          break;
      }
    };
    for (const r of roots) walk(r, { m: I4(), coords: [] });
    return b.result("VRML");
  }
  const children = (n: VNode): VNode[] => {
    const c = n.fields.children;
    return Array.isArray(c) ? (c.filter((x) => typeof x === "object") as VNode[]) : c && typeof c === "object" ? [c as VNode] : [];
  };
  const walk = (n: VNode, m: M4) => {
    switch (n.type) {
      case "Transform": {
        const t = nums(n.fields.translation), r = nums(n.fields.rotation), s = nums(n.fields.scale), c = nums(n.fields.center), so = nums(n.fields.scaleOrientation);
         
        let x = m;
        if (t.length === 3) x = mul4(x, T4(t[0], t[1], t[2]));
        if (c.length === 3) x = mul4(x, T4(c[0], c[1], c[2]));
        if (r.length === 4) x = mul4(x, R4(r[0], r[1], r[2], r[3]));
        if (s.length === 3) {
          if (so.length === 4) x = mul4(x, R4(so[0], so[1], so[2], so[3]));
          x = mul4(x, S4(s[0], s[1], s[2]));
          if (so.length === 4) x = mul4(x, R4(so[0], so[1], so[2], -so[3]));
        }
        if (c.length === 3) x = mul4(x, T4(-c[0], -c[1], -c[2]));
        for (const ch of children(n)) walk(ch, x);
        break;
      }
      case "Shape": {
        const geo = n.fields.geometry as VNode | undefined;
        const app = n.fields.appearance as VNode | undefined;
        const color = materialColor(app?.fields?.material as VNode | undefined);
        if (geo?.type === "IndexedFaceSet") {
          const coord = geo.fields.coord as VNode | undefined;
          faceSet(m, geo, nums(coord?.fields?.point), color, geo.fields.ccw !== "FALSE");
        }
        break;
      }
      default:
        for (const ch of children(n)) walk(ch, m);
    }
  };
  for (const r of roots) walk(r, I4());
  return b.result("VRML");
}

 

export function parse3DS(bytes: Uint8Array): MeshPart[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || dv.getUint16(0, true) !== 0x4d4d) throw new Error("Invalid 3DS file");
  const materials = new Map<string, RGBA>();
  const b = new PartBuilder();
  const cstr = (o: number) => {
    let e = o;
    while (e < bytes.length && bytes[e] !== 0) e++;
    return { s: new TextDecoder("latin1").decode(bytes.subarray(o, e)), next: e + 1 };
  };
  const readColor = (start: number, end: number): RGBA | undefined => {
    for (let o = start; o + 6 <= end; ) {
      const id = dv.getUint16(o, true), len = dv.getUint32(o + 2, true);
      if (id === 0x0011 || id === 0x0012) return [bytes[o + 6] / 255, bytes[o + 7] / 255, bytes[o + 8] / 255, 1];
      if (id === 0x0010 || id === 0x0013) return [dv.getFloat32(o + 6, true), dv.getFloat32(o + 10, true), dv.getFloat32(o + 14, true), 1];
      o += Math.max(6, len);
    }
    return undefined;
  };
  const readPercent = (start: number, end: number): number | undefined => {
    for (let o = start; o + 6 <= end; ) {
      const id = dv.getUint16(o, true), len = dv.getUint32(o + 2, true);
      if (id === 0x0030) return dv.getUint16(o + 6, true) / 100;
      if (id === 0x0031) return dv.getFloat32(o + 6, true);
      o += Math.max(6, len);
    }
    return undefined;
  };
   
  const meshes: { verts: number[][]; faces: number[][]; faceMat: Map<number, string> }[] = [];
  const walk = (start: number, end: number, depth: number) => {
    for (let o = start; o + 6 <= end; ) {
      const id = dv.getUint16(o, true);
      const len = dv.getUint32(o + 2, true);
      if (len < 6 || o + len > end) break;
      const body = o + 6;
      if (id === 0x4d4d || id === 0x3d3d) walk(body, o + len, depth + 1);
      else if (id === 0xafff) {
        let name = "";
        let color: RGBA | undefined;
        let transp = 0;
        for (let p = body; p + 6 <= o + len; ) {
          const cid = dv.getUint16(p, true), clen = dv.getUint32(p + 2, true);
          if (clen < 6) break;
          if (cid === 0xa000) name = cstr(p + 6).s;
          else if (cid === 0xa020) color = readColor(p + 6, p + clen);
          else if (cid === 0xa050) transp = readPercent(p + 6, p + clen) ?? 0;
          p += clen;
        }
        if (name && color) materials.set(name, [color[0], color[1], color[2], 1 - transp]);
      } else if (id === 0x4000) {
        const { next } = cstr(body);
        walk(next, o + len, depth + 1);
      } else if (id === 0x4100) {
        const mesh = { verts: [] as number[][], faces: [] as number[][], faceMat: new Map<number, string>() };
        meshes.push(mesh);
        for (let p = body; p + 6 <= o + len; ) {
          const cid = dv.getUint16(p, true), clen = dv.getUint32(p + 2, true);
          if (clen < 6) break;
          if (cid === 0x4110) {
            const n = dv.getUint16(p + 6, true);
            for (let k = 0; k < n; k++) mesh.verts.push([dv.getFloat32(p + 8 + k * 12, true), dv.getFloat32(p + 12 + k * 12, true), dv.getFloat32(p + 16 + k * 12, true)]);
          } else if (cid === 0x4120) {
            const n = dv.getUint16(p + 6, true);
            for (let k = 0; k < n; k++) mesh.faces.push([dv.getUint16(p + 8 + k * 8, true), dv.getUint16(p + 10 + k * 8, true), dv.getUint16(p + 12 + k * 8, true)]);
             
            for (let q = p + 8 + n * 8; q + 6 <= p + clen; ) {
              const sid = dv.getUint16(q, true), slen = dv.getUint32(q + 2, true);
              if (slen < 6) break;
              if (sid === 0x4130) {
                const { s, next } = cstr(q + 6);
                const cnt = dv.getUint16(next, true);
                for (let k = 0; k < cnt; k++) mesh.faceMat.set(dv.getUint16(next + 2 + k * 2, true), s);
              }
              q += slen;
            }
          }
          p += clen;
        }
      }
      o += len;
    }
  };
  walk(0, bytes.length, 0);
  for (const mesh of meshes)
    mesh.faces.forEach((f, k) => {
      const [a, c, d] = f.map((i) => mesh.verts[i]);
      if (a && c && d) b.add(materials.get(mesh.faceMat.get(k) ?? ""), a, c, d);
    });
  return b.result("3DS");
}

 

interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

 
function parseXml(text: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>"']|"[^"]*"|'[^']*')*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[4] ?? ""))) attrs[a[1]] = (a[2] ?? a[3]).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
      const n: XNode = { name: m[3].replace(/^.*:/, ""), attrs, children: [], text: "" };
      top.children.push(n);
      if (!m[5]) stack.push(n);
    } else if (m[6]) top.text += m[6];
  }
  return root;
}

const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => c.name === name);
function* all(n: XNode, name: string): Generator<XNode> {
  for (const c of n.children) {
    if (c.name === name) yield c;
    yield* all(c, name);
  }
}
const floats = (s: string) => s.trim().split(/\s+/).filter(Boolean).map(Number);

export function parseDAE(bytes: Uint8Array): MeshPart[] {
  const doc = parseXml(new TextDecoder().decode(bytes));
  const collada = kid(doc, "COLLADA");
  if (!collada) throw new Error("Invalid COLLADA file");
  const byId = new Map<string, XNode>();
  for (const n of all(collada, "geometry")) if (n.attrs.id) byId.set(n.attrs.id, n);
  const ids = new Map<string, XNode>();
  const index = (n: XNode) => {
    if (n.attrs.id) ids.set(n.attrs.id, n);
    n.children.forEach(index);
  };
  index(collada);
  const ref = (url: string | undefined) => (url ? ids.get(url.replace(/^#/, "")) : undefined);
  const effectColor = (effect: XNode | undefined): RGBA | undefined => {
    if (!effect) return undefined;
    for (const tech of all(effect, "technique")) {
      for (const shading of tech.children) {
        const diffuse = kid(shading, "diffuse");
        const c = kid(diffuse, "color");
        if (c) {
          const v = floats(c.text);
          const tr = kid(kid(shading, "transparency"), "float");
          const alpha = tr ? Number(tr.text) : (v[3] ?? 1);
          return [v[0], v[1], v[2], Number.isFinite(alpha) ? alpha : 1];
        }
      }
    }
    return undefined;
  };
  const materialColor = (matId: string | undefined) => effectColor(ref(kid(ref(matId), "instance_effect")?.attrs.url));
  const b = new PartBuilder();
  const emitGeometry = (geo: XNode, m: M4, bind: Map<string, string>) => {
    const mesh = kid(geo, "mesh");
    if (!mesh) return;
    const sources = new Map<string, number[]>();
    for (const src of kids(mesh, "source")) {
      const fa = kid(src, "float_array");
      if (fa && src.attrs.id) sources.set(src.attrs.id, floats(fa.text));
    }
    const vertices = kid(mesh, "vertices");
    const posInput = kids(vertices, "input").find((i) => i.attrs.semantic === "POSITION");
    const positions = sources.get((posInput?.attrs.source ?? "").replace(/^#/, "")) ?? [];
    for (const prim of mesh.children) {
      if (!["triangles", "polylist", "polygons", "trifans", "tristrips"].includes(prim.name)) continue;
      const inputs = kids(prim, "input");
      const stride = Math.max(1, ...inputs.map((i) => Number(i.attrs.offset ?? 0) + 1));
      const vOff = Number(inputs.find((i) => i.attrs.semantic === "VERTEX")?.attrs.offset ?? 0);
      const color = materialColor(bind.get(prim.attrs.material ?? "") ?? prim.attrs.material);
      const pt = (k: number) => apply(m, [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]]);
      const polys: number[][] = [];
      if (prim.name === "triangles") {
        const p = floats(kids(prim, "p").map((x) => x.text).join(" "));
        for (let k = 0; k + 3 * stride <= p.length; k += 3 * stride) polys.push([p[k + vOff], p[k + stride + vOff], p[k + 2 * stride + vOff]]);
      } else if (prim.name === "polylist") {
        const vc = floats(kid(prim, "vcount")?.text ?? "");
        const p = floats(kid(prim, "p")?.text ?? "");
        let o = 0;
        for (const c of vc) {
          const poly: number[] = [];
          for (let k = 0; k < c; k++) poly.push(p[(o + k) * stride + vOff]);
          polys.push(poly);
          o += c;
        }
      } else {
        for (const pe of kids(prim, "p")) {
          const p = floats(pe.text);
          const poly: number[] = [];
          for (let k = 0; k + stride <= p.length; k += stride) poly.push(p[k + vOff]);
          if (prim.name === "tristrips") for (let k = 0; k + 2 < poly.length; k++) polys.push(k % 2 ? [poly[k + 1], poly[k], poly[k + 2]] : [poly[k], poly[k + 1], poly[k + 2]]);
          else polys.push(poly);
        }
      }
      for (const poly of polys) b.addPolygon(color, poly.map(pt));
    }
  };
  const nodeMatrix = (n: XNode): M4 => {
    let m = I4();
    for (const c of n.children) {
      const v = floats(c.text);
      if (c.name === "matrix" && v.length === 16) m = mul4(m, v);
      else if (c.name === "translate" && v.length === 3) m = mul4(m, T4(v[0], v[1], v[2]));
      else if (c.name === "rotate" && v.length === 4) m = mul4(m, R4(v[0], v[1], v[2], (v[3] * Math.PI) / 180));
      else if (c.name === "scale" && v.length === 3) m = mul4(m, S4(v[0], v[1], v[2]));
    }
    return m;
  };
  const visit = (n: XNode, parent: M4) => {
    const m = mul4(parent, nodeMatrix(n));
    for (const ig of kids(n, "instance_geometry")) {
      const geo = ref(ig.attrs.url);
      if (!geo) continue;
      const bind = new Map<string, string>();
      for (const im of all(ig, "instance_material")) if (im.attrs.symbol) bind.set(im.attrs.symbol, im.attrs.target);
      emitGeometry(geo, m, bind);
    }
    for (const inode of kids(n, "instance_node")) {
      const target = ref(inode.attrs.url);
      if (target) visit(target, m);
    }
    for (const c of kids(n, "node")) visit(c, m);
  };
  const scene = ref(kid(kid(collada, "scene"), "instance_visual_scene")?.attrs.url) ?? [...all(collada, "visual_scene")][0];
  if (scene) for (const n of kids(scene, "node")) visit(n, I4());
  else for (const geo of byId.values()) emitGeometry(geo, I4(), new Map());
  return b.result("COLLADA");
}

 

 
export const DRACO_NOT_SUPPORTED = "This type of object file compression is not supported (draco): ";

export function parseGLTF(bytes: Uint8Array, name = "model.gltf"): MeshPart[] {
  let json: Record<string, unknown>;
  let bin: Uint8Array | undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 12 && dv.getUint32(0, true) === 0x46546c67) {
     
    let o = 12;
    json = {};
    while (o + 8 <= bytes.length) {
      const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
      const chunk = bytes.subarray(o + 8, o + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      o += 8 + len;
    }
  } else json = JSON.parse(new TextDecoder().decode(bytes));
  const used = (json.extensionsUsed as string[] | undefined) ?? [];
  if (used.includes("KHR_draco_mesh_compression")) throw new Error(DRACO_NOT_SUPPORTED + name);
  const buffers = ((json.buffers as { uri?: string }[]) ?? []).map((buf, k) => {
    if (buf.uri === undefined) {
      if (k === 0 && bin) return bin;
      throw new Error("Invalid glTF file: missing binary buffer");
    }
    const m = /^data:[^,]*;base64,(.*)$/.exec(buf.uri);
    if (!m) throw new Error(`glTF buffers in separate files are not supported (${buf.uri}). Use a .glb file.`);
    return Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  });
  type View = { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number };
  type Accessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string };
  const views = (json.bufferViews as View[]) ?? [];
  const accessors = (json.accessors as Accessor[]) ?? [];
  const COMP: Record<number, [number, (d: DataView, o: number) => number]> = {
    5120: [1, (d, o) => d.getInt8(o)],
    5121: [1, (d, o) => d.getUint8(o)],
    5122: [2, (d, o) => d.getInt16(o, true)],
    5123: [2, (d, o) => d.getUint16(o, true)],
    5125: [4, (d, o) => d.getUint32(o, true)],
    5126: [4, (d, o) => d.getFloat32(o, true)],
  };
  const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const read = (k: number): number[] => {
    const a = accessors[k];
    const n = SIZE[a.type] ?? 1;
    const [size, get] = COMP[a.componentType] ?? COMP[5126];
    const out: number[] = [];
    if (a.bufferView === undefined) return new Array(a.count * n).fill(0);
    const v = views[a.bufferView];
    const buf = buffers[v.buffer];
    const d = new DataView(buf.buffer, buf.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const stride = v.byteStride || size * n;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out.push(get(d, i * stride + c * size));
    return out;
  };
  type Prim = { attributes: Record<string, number>; indices?: number; material?: number; mode?: number; extensions?: Record<string, unknown> };
  const meshes = (json.meshes as { primitives: Prim[] }[]) ?? [];
  const materials = (json.materials as { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[]) ?? [];
  type GNode = { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
  const nodes = (json.nodes as GNode[]) ?? [];
  const b = new PartBuilder();
  const emit = (meshIdx: number, m: M4) => {
    for (const prim of meshes[meshIdx]?.primitives ?? []) {
      if (prim.extensions?.KHR_draco_mesh_compression) throw new Error(DRACO_NOT_SUPPORTED + name);
      const mode = prim.mode ?? 4;
      if (![4, 5, 6].includes(mode) || prim.attributes.POSITION === undefined) continue;
      const pos = read(prim.attributes.POSITION);
      const idx = prim.indices !== undefined ? read(prim.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
      const f = materials[prim.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor;
      const color: RGBA | undefined = f ? [f[0], f[1], f[2], f[3] ?? 1] : undefined;
      const pt = (k: number) => apply(m, [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
      if (mode === 4) for (let i = 0; i + 2 < idx.length; i += 3) b.add(color, pt(idx[i]), pt(idx[i + 1]), pt(idx[i + 2]));
      else if (mode === 5) for (let i = 0; i + 2 < idx.length; i++) b.add(color, pt(idx[i % 2 ? i + 1 : i]), pt(idx[i % 2 ? i : i + 1]), pt(idx[i + 2]));
      else for (let i = 1; i + 1 < idx.length; i++) b.add(color, pt(idx[0]), pt(idx[i]), pt(idx[i + 1]));
    }
  };
  const local = (n: GNode): M4 => {
    if (n.matrix?.length === 16) {
      const a = n.matrix;  
      return [a[0], a[4], a[8], a[12], a[1], a[5], a[9], a[13], a[2], a[6], a[10], a[14], 0, 0, 0, 1];
    }
    let m = I4();
    if (n.translation) m = mul4(m, T4(n.translation[0], n.translation[1], n.translation[2]));
    if (n.rotation) m = mul4(m, Q4(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]));
    if (n.scale) m = mul4(m, S4(n.scale[0], n.scale[1], n.scale[2]));
    return m;
  };
  const visit = (k: number, parent: M4, depth = 0) => {
    const n = nodes[k];
    if (!n || depth > 256) return;
    const m = mul4(parent, local(n));
    if (n.mesh !== undefined) emit(n.mesh, m);
    for (const c of n.children ?? []) visit(c, m, depth + 1);
  };
  const scenes = (json.scenes as { nodes?: number[] }[]) ?? [];
  const sceneIdx = (json.scene as number | undefined) ?? 0;
  if (scenes[sceneIdx]?.nodes) for (const k of scenes[sceneIdx].nodes!) visit(k, I4());
  else meshes.forEach((_, k) => emit(k, I4()));
  return b.result("glTF");
}

 

 
export function parseSLP(bytes: Uint8Array): MeshPart[] {
  const b = new PartBuilder();
  let color: RGBA | undefined;
  let v: number[][] = [];
  for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "color" && t.length >= 4) color = [Number(t[1]), Number(t[2]), Number(t[3]), 1];
    else if (t[0] === "vertex" && t.length >= 4) v.push([Number(t[1]), Number(t[2]), Number(t[3])]);
    else if (t[0] === "endloop") {
      if (v.length >= 3) b.addPolygon(color, v);
      v = [];
    }
  }
  return b.result("SLP");
}

export { I4, isIdentity };
