// Composes USD scene layers into meshes, materials and physics metadata.
 
 
 
 
 
 

import fs from "node:fs/promises";
import path from "node:path";
import type { MeshPart, RGBA } from "@/engine/meshformats";
import { parseLayer, primAt, type Arc, type Layer, type PrimSpec, type PropSpec } from "./usd-layer";

 
export interface AssetFiles {
   
  get(relPath: string): Promise<Uint8Array | null>;
   
  stat?(relPath: string): Promise<{ size: number; sha256?: string } | undefined>;
   
  list?(): Promise<string[]>;
}

export interface SimReadyPhysics {
   
  mass?: number;
   
  density?: number;
  staticFriction?: number;
  dynamicFriction?: number;
  restitution?: number;
  rigidBody?: boolean;
  kinematic?: boolean;
  collisionApproximation?: string;
}

export interface ConvertOptions {
   
  textures?: boolean;
   
  textureBudgetBytes?: number;
   
  maxTriangles?: number;
   
  colorCacheFile?: string | null;
  onProgress?(p: { phase: "layers" | "geometry" | "materials" | "textures" | "mesh"; file?: string }): void;
}

export interface ConvertedAsset {
   
  parts: MeshPart[];
  triangles: number;
   
  bbox: { min: [number, number, number]; max: [number, number, number] };
  metersPerUnit: number;
  upAxis: "Y" | "Z";
  physics?: SimReadyPhysics;
   
  files: string[];
  warnings: string[];
}

const GREY: RGBA = [0.72, 0.73, 0.75, 1];
const CREASE_COS = Math.cos((40 * Math.PI) / 180);
 
const SKIP_LAYER = /(^|\/)(MuJoCo|Newton|PhysX)\/[^/]+\.usda?$|instances_(mujoco|newton|physx)\.usda$/i;

 
 

type M4 = number[];
const I4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul4(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const T4 = (x: number, y: number, z: number): M4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S4 = (x: number, y: number, z: number): M4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
function Rax(axis: 0 | 1 | 2, deg: number): M4 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  if (axis === 1) return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
 
function Q4(x: number, y: number, z: number, w: number): M4 {
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n;
  y /= n;
  z /= n;
  w /= n;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0, 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0, 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}
function inv4(m: M4): M4 {
   
  const [a, b, c, , d, e, f, , g, h, k] = m;
  const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-30;
  const r = [A / det, -(b * k - c * h) / det, (b * f - c * e) / det, -(d * k - f * g) / det, (a * k - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  const t = [m[3], m[7], m[11]];
  return [r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]), r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]), r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]), 0, 0, 0, 1];
}
const det3 = (m: M4) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
 
const fromUsdMatrix = (a: ArrayLike<number>): M4 => [a[0], a[4], a[8], a[12], a[1], a[5], a[9], a[13], a[2], a[6], a[10], a[14], 0, 0, 0, 1];

 

 
function flat(v: unknown): ArrayLike<number> | undefined {
  if (v === undefined || v === null) return undefined;
  if (ArrayBuffer.isView(v)) return v as unknown as ArrayLike<number>;
  if (!Array.isArray(v)) return typeof v === "number" ? [v] : undefined;
  return Array.isArray(v[0]) ? (v as unknown[]).flat(2).map(Number) : (v as unknown[]).map(Number);
}
const vec = (v: unknown): number[] | undefined => {
  const f = flat(v);
  return f ? Array.from(f) : undefined;
};
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const assetOf = (v: unknown): string | undefined => (typeof v === "string" ? v : v && typeof v === "object" && "assetPath" in v ? (v as Arc).assetPath : undefined);

 
function resolveAsset(from: string, asset: string): string {
  asset = asset.replace(/\\/g, "/");
  if (/^[a-z]+:/i.test(asset) || asset.startsWith("/")) return asset.replace(/^\/+/, "");
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), asset));
}

 

interface Stack {
  root: Layer;
   
  layers: Layer[];
}
 
interface Op {
  layer: Layer;
  spec: PrimSpec;
  stack: Stack;
}
 
interface CPrim {
  name: string;
  ops: Op[];
}

class Composer {
  private layers = new Map<string, Promise<Layer | null>>();
  private stacks = new Map<string, Promise<Stack | null>>();
  files = new Set<string>();
  private af: AssetFiles;
  private warnings: string[];
  private progress?: ConvertOptions["onProgress"];
  constructor(af: AssetFiles, warnings: string[], progress?: ConvertOptions["onProgress"]) {
    this.af = af;
    this.warnings = warnings;
    this.progress = progress;
  }

  layer(p: string): Promise<Layer | null> {
    let l = this.layers.get(p);
    if (!l)
      this.layers.set(
        p,
        (l = (async () => {
          this.progress?.({ phase: /geometr/i.test(p) ? "geometry" : "layers", file: p });
          const bytes = await this.af.get(p);
          if (!bytes) {
            this.warnings.push(`missing layer ${p}`);
            return null;
          }
          this.files.add(p);
          try {
            return parseLayer(bytes, p);
          } catch (e) {
            this.warnings.push(`cannot parse layer ${p}: ${(e as Error).message}`);
            return null;
          }
        })()),
      );
    return l;
  }

  stack(p: string, seen = new Set<string>()): Promise<Stack | null> {
    let s = this.stacks.get(p);
    if (!s)
      this.stacks.set(
        p,
        (s = (async () => {
          const root = await this.layer(p);
          if (!root) return null;
          const layers = [root];
          seen.add(p);
          for (const sub of (root.meta.subLayers as unknown[] | undefined) ?? []) {
            const a = assetOf(sub);
            if (!a) continue;
            const sp = resolveAsset(p, a);
            if (seen.has(sp) || SKIP_LAYER.test(sp)) continue;
            const st = await this.stack(sp, seen);
            if (st) layers.push(...st.layers);
          }
          return { root, layers };
        })()),
      );
    return s;
  }

   
  async at(stack: Stack, primPath: string, depth = 0): Promise<Op[]> {
    const ops: Op[] = [];
    for (const layer of stack.layers) {
      const spec = primAt(layer, primPath);
      if (spec) ops.push({ layer, spec, stack });
    }
    return this.expand(ops, depth);
  }

   
  async expand(ops: Op[], depth = 0): Promise<Op[]> {
    if (depth > 40) throw new Error("USD composition is too deep (reference cycle?)");
    const out = [...ops];
     
    for (let k = 0; k < out.length; k++) {
      for (const [set, variants] of out[k].spec.variantSets) {
        let sel: string | undefined;
        for (const o of out) {
          const vs = o.spec.meta.variantSelection as Record<string, string> | undefined;
          if (vs && vs[set] !== undefined) {
            sel = vs[set];
            break;
          }
        }
        const body = sel !== undefined ? variants.get(sel) : undefined;
        if (body && !out.some((o) => o.spec === body)) out.push({ layer: out[k].layer, spec: body, stack: out[k].stack });
      }
    }
    const arcs: { arc: Arc; op: Op }[] = [];
    for (const key of ["inherits", "references", "payload", "specializes"])
      for (const op of out) for (const arc of (op.spec.meta[key] as Arc[] | undefined) ?? []) if (arc && typeof arc === "object") arcs.push({ arc, op });
    for (const { arc, op } of arcs) {
      let stack: Stack | null = op.stack;
      let target = arc.primPath;
      if (arc.assetPath) {
        const p = resolveAsset(op.layer.path, arc.assetPath);
        if (SKIP_LAYER.test(p)) continue;
        stack = await this.stack(p);
        if (!stack) continue;
        if (!target) {
          const dp = stack.root.meta.defaultPrim as string | undefined;
          target = dp ? `/${dp.replace(/^\//, "")}` : undefined;
          if (!target) {
             
            const first = stack.root.root.children.keys().next().value;
            if (first) target = `/${first}`;
          }
        }
      }
      if (!stack || !target) continue;
      for (const o of await this.at(stack, target, depth + 1)) if (!out.some((x) => x.spec === o.spec)) out.push(o);
    }
    return out;
  }

  async children(c: CPrim): Promise<CPrim[]> {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const o of c.ops)
      for (const n of o.spec.children.keys())
        if (!seen.has(n)) {
          seen.add(n);
          names.push(n);
        }
    const out: CPrim[] = [];
    for (const name of names) {
      const ops: Op[] = [];
      for (const o of c.ops) {
        const s = o.spec.children.get(name);
        if (s) ops.push({ layer: o.layer, spec: s, stack: o.stack });
      }
      out.push({ name, ops: await this.expand(ops) });
    }
    return out;
  }
}

const typeOf = (c: CPrim) => c.ops.find((o) => o.spec.typeName)?.spec.typeName;
const isDefined = (c: CPrim) => c.ops.some((o) => o.spec.specifier === "def");
const isClass = (c: CPrim) => c.ops.find((o) => o.spec.specifier !== "over")?.spec.specifier === "class";
function attr(c: CPrim, name: string): { value: unknown; prop: PropSpec; op: Op } | undefined {
  for (const op of c.ops) {
    const prop = op.spec.props.get(name);
    if (prop && prop.value !== undefined) return { value: prop.value, prop, op };
  }
  return undefined;
}
function rel(c: CPrim, name: string): { targets: string[]; op: Op } | undefined {
  for (const op of c.ops) {
    const prop = op.spec.props.get(name);
    if (prop?.targets?.length) return { targets: prop.targets, op };
  }
  return undefined;
}
function meta(c: CPrim, key: string): unknown {
  for (const op of c.ops) if (op.spec.meta[key] !== undefined) return op.spec.meta[key];
  return undefined;
}
function interpOf(c: CPrim, name: string): string | undefined {
  for (const op of c.ops) {
    const m = op.spec.props.get(name)?.meta?.interpolation;
    if (typeof m === "string") return m;
  }
  return undefined;
}
const apiSchemas = (c: CPrim) => c.ops.flatMap((o) => (Array.isArray(o.spec.meta.apiSchemas) ? (o.spec.meta.apiSchemas as string[]) : []));

 
function localXform(c: CPrim): { m: M4; reset: boolean } {
  const order = attr(c, "xformOpOrder")?.value;
  let m = I4();
  let reset = false;
  if (!Array.isArray(order)) return { m, reset };
  for (const raw of order as string[]) {
    if (raw === "!resetXformStack!") {
      reset = true;
      m = I4();
      continue;
    }
    const invert = raw.startsWith("!invert!");
    const name = invert ? raw.slice(8) : raw;
    const v = attr(c, name)?.value;
    const op = name.split(":")[1] ?? "";
    let x: M4 | undefined;
    const a = vec(v);
    if (op === "transform" && a?.length === 16) x = fromUsdMatrix(a);
    else if (op === "translate" && a) x = T4(a[0], a[1], a[2]);
    else if (op === "scale" && a) x = a.length === 1 ? S4(a[0], a[0], a[0]) : S4(a[0], a[1], a[2]);
    else if (op === "orient" && a?.length === 4) x = Q4(a[0], a[1], a[2], a[3]);
    else if (/^rotate[XYZ]$/.test(op) && a) x = Rax("XYZ".indexOf(op[6]) as 0 | 1 | 2, a[0]);
    else if (/^rotate[XYZ]{3}$/.test(op) && a) {
       
      const axes = op.slice(6);
      x = I4();
      for (let k = 0; k < 3; k++) x = mul4(Rax("XYZ".indexOf(axes[k]) as 0 | 1 | 2, a["XYZ".indexOf(axes[k])]), x);
    }
    if (x) m = mul4(m, invert ? inv4(x) : x);
  }
  return { m, reset };
}

 

 
class FBuf {
  a = new Float32Array(1 << 12);
  n = 0;
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Float32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  get data() {
    return this.a.slice(0, this.n);
  }
}

interface Bucket {
  color: RGBA;
  pos: FBuf;
  nrm: FBuf;
}

 
function simplify(buckets: Bucket[], maxTriangles: number, bbox: { min: number[]; max: number[] }): number {
  const size = [0, 1, 2].map((k) => Math.max(bbox.max[k] - bbox.min[k], 1e-6));
  let total = buckets.reduce((s, b) => s + b.pos.n / 9, 0);
  let cells = Math.ceil(Math.sqrt(maxTriangles) * 1.2);
  for (let iter = 0; iter < 12 && total > maxTriangles; iter++, cells = Math.floor(cells * 0.75)) {
    const cell = Math.max(...size) / cells;
     
    const rep = new Map<string, number[]>();
    total = 0;
    for (const b of buckets) {
      const p = b.pos.a, nr = b.nrm.a;
      const out = new FBuf(), outN = new FBuf();
      const seen = new Set<string>();
      const key = (k: number) => `${Math.floor((p[k] - bbox.min[0]) / cell)},${Math.floor((p[k + 1] - bbox.min[1]) / cell)},${Math.floor((p[k + 2] - bbox.min[2]) / cell)}`;
      for (let t = 0; t < b.pos.n; t += 9) {
        const ks = [key(t), key(t + 3), key(t + 6)];
        if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) continue;
        const tk = [...ks].sort().join("|");
        if (seen.has(tk)) continue;
        seen.add(tk);
        out.reserve(9);
        outN.reserve(9);
        for (let v = 0; v < 9; v += 3) {
          let q = rep.get(ks[v / 3]);
          if (!q) rep.set(ks[v / 3], (q = [p[t + v], p[t + v + 1], p[t + v + 2]]));
          out.a[out.n++] = q[0];
          out.a[out.n++] = q[1];
          out.a[out.n++] = q[2];
          outN.a[outN.n++] = nr[t + v];
          outN.a[outN.n++] = nr[t + v + 1];
          outN.a[outN.n++] = nr[t + v + 2];
        }
      }
      b.pos = out;
      b.nrm = outN;
      total += out.n / 9;
    }
  }
  return total;
}

 

interface Binding {
  target: string;
  stack: Stack;
}

class Converter {
  comp: Composer;
  warnings: string[] = [];
  buckets = new Map<string, Bucket>();
  materials = new Map<string, Promise<RGBA>>();
  physics: SimReadyPhysics = {};
  massSum = 0;
  textureBytes = 0;
  colorCache: Record<string, number[]> | undefined;
  colorCacheDirty = false;
  bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  private af: AssetFiles;
  private opts: ConvertOptions;
  constructor(af: AssetFiles, opts: ConvertOptions) {
    this.af = af;
    this.opts = opts;
    this.comp = new Composer(af, this.warnings, opts.onProgress);
  }

  bucket(color: RGBA): Bucket {
    const key = color.map((v) => v.toFixed(3)).join(",");
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { color, pos: new FBuf(), nrm: new FBuf() }));
    return b;
  }

  async walk(c: CPrim, parent: M4, root: M4, binding: Binding | undefined, depth: number): Promise<void> {
    if (depth > 64 || !isDefined(c) || isClass(c)) return;
    if (meta(c, "active") === false) return;
    if (attr(c, "visibility")?.value === "invisible") return;
    const purpose = attr(c, "purpose")?.value;
    if (purpose === "guide" || purpose === "proxy") return;
    const type = typeOf(c) ?? "";
    if (/^(Material|Shader|NodeGraph|GeomSubset|PhysicsScene|Physics\w*Joint|Camera|\w*Light|BasisCurves|Points|Skeleton|SkelAnimation)$/.test(type)) return;
    this.collectPhysics(c);
    const { m: local, reset } = localXform(c);
    const m = mul4(reset ? root : parent, local);
    const b = rel(c, "material:binding");
    if (b) binding = { target: b.targets[0], stack: b.op.stack };
    if (type === "Mesh") await this.mesh(c, m, binding);
    else if (type === "PointInstancer") this.warnings.push("PointInstancer prims are not supported (skipped)");
    else if (/^(Cube|Sphere|Cylinder|Cone|Capsule)$/.test(type)) this.warnings.push(`${type} primitives are not supported (skipped)`);
    for (const ch of await this.comp.children(c)) await this.walk(ch, m, root, binding, depth + 1);
  }

  collectPhysics(c: CPrim) {
    const ph = this.physics;
    const api = apiSchemas(c);
    const num = (n: string) => {
      const v = attr(c, n)?.value;
      return typeof v === "number" && isFinite(v) ? v : undefined;
    };
    if (api.includes("PhysicsRigidBodyAPI")) {
      ph.rigidBody = (attr(c, "physics:rigidBodyEnabled")?.value as boolean | undefined) ?? true;
      const k = attr(c, "physics:kinematicEnabled")?.value;
      if (typeof k === "boolean") ph.kinematic = k;
      const mass = num("physics:mass");
      if (mass) ph.mass = mass;
    } else {
      const mass = num("physics:mass");
      if (mass && typeOf(c) === "Mesh") this.massSum += mass;
    }
    const d = num("physics:density");
    if (d && ph.density === undefined) ph.density = d;
    const approx = attr(c, "physics:approximation")?.value;
    if (typeof approx === "string" && !ph.collisionApproximation) ph.collisionApproximation = approx;
    const pm = rel(c, "material:binding:physics");
    if (pm && ph.staticFriction === undefined) this.pendingPhysicsMaterial ??= pm;
  }
  pendingPhysicsMaterial: { targets: string[]; op: Op } | undefined;

  async physicsMaterial() {
    const pm = this.pendingPhysicsMaterial;
    if (!pm) return;
    const ops = await this.comp.at(pm.op.stack, pm.targets[0]);
    const c: CPrim = { name: "", ops };
    const num = (n: string) => {
      const v = attr(c, n)?.value;
      return typeof v === "number" && isFinite(v) ? v : undefined;
    };
    const ph = this.physics;
    ph.staticFriction ??= num("physics:staticFriction");
    ph.dynamicFriction ??= num("physics:dynamicFriction");
    ph.restitution ??= num("physics:restitution");
    ph.density ??= num("physics:density");
  }

  async mesh(c: CPrim, m: M4, binding: Binding | undefined) {
    const points = flat(attr(c, "points")?.value);
    const counts = flat(attr(c, "faceVertexCounts")?.value);
    const indices = flat(attr(c, "faceVertexIndices")?.value);
    if (!points || !counts || !indices || !points.length) return;
    const np = points.length / 3;
    const flip = (det3(m) < 0) !== (attr(c, "orientation")?.value === "leftHanded");
     
    const inv = inv4(m);
    const nm = [inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]];
     
    let normals = flat(attr(c, "normals")?.value), nInterp = interpOf(c, "normals") ?? "vertex", nIdx: ArrayLike<number> | undefined;
    const pv = attr(c, "primvars:normals");
    if (pv) {
      normals = flat(pv.value);
      nInterp = interpOf(c, "primvars:normals") ?? "vertex";
      nIdx = flat(attr(c, "primvars:normals:indices")?.value);
    }
    let nFace = 0;
    for (let f = 0; f < counts.length; f++) nFace += counts[f];
    const nOk = normals && normals.length >= 3 && ((nInterp === "faceVarying" && (nIdx?.length ?? normals.length / 3) >= nFace) || (nInterp === "vertex" && (nIdx?.length ?? normals.length / 3) >= np) || (nInterp === "uniform" && (nIdx?.length ?? normals.length / 3) >= counts.length) || nInterp === "constant");
     
    const faceColor = new Array<RGBA | undefined>(counts.length);
    for (const ch of await this.comp.children(c)) {
      if (typeOf(ch) !== "GeomSubset") continue;
      const et = attr(ch, "elementType")?.value;
      if (et && et !== "face") continue;
      const b = rel(ch, "material:binding");
      const idx = flat(attr(ch, "indices")?.value);
      if (!b || !idx) continue;
      const col = await this.materialColor({ target: b.targets[0], stack: b.op.stack });
      for (let k = 0; k < idx.length; k++) if (idx[k] < counts.length) faceColor[idx[k]] = col;
    }
    let base = binding ? await this.materialColor(binding) : undefined;
    if (!base) {
      const dc = vec(attr(c, "primvars:displayColor")?.value);
      base = dc && dc.length >= 3 && (interpOf(c, "primvars:displayColor") ?? "constant") === "constant" ? [linearToSrgb(dc[0]), linearToSrgb(dc[1]), linearToSrgb(dc[2]), 1] : GREY;
    }
     
    let acc: Float64Array | undefined;
    if (!nOk) {
      acc = new Float64Array(np * 3);
      for (let f = 0, o = 0; f < counts.length; o += counts[f], f++) {
        const n = counts[f];
        for (let k = 1; k + 1 < n; k++) {
          const a = indices[o] * 3, b = indices[o + k] * 3, cc = indices[o + k + 1] * 3;
          const ux = points[b] - points[a], uy = points[b + 1] - points[a + 1], uz = points[b + 2] - points[a + 2];
          const vx = points[cc] - points[a], vy = points[cc + 1] - points[a + 1], vz = points[cc + 2] - points[a + 2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          for (const p of [a, b, cc]) {
            acc[p] += nx;
            acc[p + 1] += ny;
            acc[p + 2] += nz;
          }
        }
      }
    }
    const P = [0, 0, 0], N = [0, 0, 0];
    const bb = this.bbox;
    const emit = (bk: Bucket, pi: number, nx: number, ny: number, nz: number) => {
      const x = points[pi * 3], y = points[pi * 3 + 1], z = points[pi * 3 + 2];
      P[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
      P[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
      P[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
      N[0] = nm[0] * nx + nm[1] * ny + nm[2] * nz;
      N[1] = nm[3] * nx + nm[4] * ny + nm[5] * nz;
      N[2] = nm[6] * nx + nm[7] * ny + nm[8] * nz;
      const l = Math.hypot(N[0], N[1], N[2]) || 1;
      const pa = bk.pos.a, na = bk.nrm.a;
      for (let d = 0; d < 3; d++) {
        pa[bk.pos.n++] = P[d];
        na[bk.nrm.n++] = N[d] / l;
        if (P[d] < bb.min[d]) bb.min[d] = P[d];
        if (P[d] > bb.max[d]) bb.max[d] = P[d];
      }
    };
    const fn = [0, 0, 0];
    const vn = (f: number, fv: number, pi: number): [number, number, number] => {
      if (nOk && normals) {
        let k = nInterp === "faceVarying" ? fv : nInterp === "vertex" ? pi : nInterp === "uniform" ? f : 0;
        if (nIdx) k = nIdx[k];
        return [normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]];
      }
      const ax = acc![pi * 3], ay = acc![pi * 3 + 1], az = acc![pi * 3 + 2];
      const l = Math.hypot(ax, ay, az) || 1;
      return (ax * fn[0] + ay * fn[1] + az * fn[2]) / l < CREASE_COS ? [fn[0], fn[1], fn[2]] : [ax / l, ay / l, az / l];
    };
    for (let f = 0, o = 0; f < counts.length; o += counts[f], f++) {
      const n = counts[f];
      if (n < 3) continue;
      const bk = this.bucket(faceColor[f] ?? base);
      if (!nOk) {
         
        fn[0] = fn[1] = fn[2] = 0;
        for (let k = 0; k < n; k++) {
          const a = indices[o + k] * 3, b = indices[o + ((k + 1) % n)] * 3;
          fn[0] += (points[a + 1] - points[b + 1]) * (points[a + 2] + points[b + 2]);
          fn[1] += (points[a + 2] - points[b + 2]) * (points[a] + points[b]);
          fn[2] += (points[a] - points[b]) * (points[a + 1] + points[b + 1]);
        }
        const l = Math.hypot(fn[0], fn[1], fn[2]) || 1;
        fn[0] /= l;
        fn[1] /= l;
        fn[2] /= l;
      }
      bk.pos.reserve((n - 2) * 9);
      bk.nrm.reserve((n - 2) * 9);
      for (let k = 1; k + 1 < n; k++) {
        const tri = flip ? [0, k + 1, k] : [0, k, k + 1];
        if (tri.some((t) => !(indices[o + t] < np))) continue;
        for (const t of tri) {
          const pi = indices[o + t];
          const nv = vn(f, o + t, pi);
          emit(bk, pi, nv[0], nv[1], nv[2]);
        }
      }
    }
  }

  async materialColor(b: Binding): Promise<RGBA> {
    const key = `${b.stack.root.path}|${b.target}`;
    let p = this.materials.get(key);
    if (!p) this.materials.set(key, (p = this.resolveMaterial(b)));
    return p;
  }

  async resolveMaterial(b: Binding): Promise<RGBA> {
    this.opts.onProgress?.({ phase: "materials", file: b.target });
    const mat: CPrim = { name: b.target, ops: await this.comp.at(b.stack, b.target) };
     
    const shaders: CPrim[] = [];
    const find = async (c: CPrim, d: number) => {
      for (const ch of await this.comp.children(c)) {
        if (typeOf(ch) === "Shader") shaders.push(ch);
        else if (d < 3) await find(ch, d + 1);
      }
    };
    await find(mat, 0);
    let color: number[] | undefined, texture: { path: string } | undefined, tint: number[] | undefined, opacity = 1;
    for (const s of shaders) {
      const id = attr(s, "info:id")?.value;
      if (id === "UsdPreviewSurface") {
        const conn = rel(s, "inputs:diffuseColor");
        const dc = vec(attr(s, "inputs:diffuseColor")?.value);
        if (conn && !texture) {
           
          const target = conn.targets[0].split(".")[0];
          const tex: CPrim = { name: target, ops: await this.comp.at(conn.op.stack, target) };
          const file = attr(tex, "inputs:file");
          const a = file && assetOf(file.value);
          if (a) texture = { path: resolveAsset(file.op.layer.path, a) };
          const fb = vec(attr(tex, "inputs:fallback")?.value);
          if (fb && !color) color = fb.slice(0, 3);
        }
        if (dc && !conn) color = dc;
        const op = attr(s, "inputs:opacity")?.value;
        if (typeof op === "number") opacity = op;
      } else {
        const src = assetOf(attr(s, "info:mdl:sourceAsset")?.value) ?? "";
        if (!/OmniPBR|OmniSurface|OmniGlass/i.test(src) && !attr(s, "inputs:diffuse_color_constant")) continue;
        const dc = vec(attr(s, "inputs:diffuse_color_constant")?.value);
        const t = vec(attr(s, "inputs:diffuse_tint")?.value);
        const file = attr(s, "inputs:diffuse_texture");
        const a = file && assetOf(file.value);
        if (a && !texture) texture = { path: resolveAsset(file.op.layer.path, a) };
        if (dc && !color) color = dc;
        if (t) tint = t;
        if (/OmniGlass/i.test(src)) opacity = Math.min(opacity, 0.35);
      }
    }
    let rgb: number[] | undefined;
    if (texture && this.opts.textures !== false) {
      const avg = await this.textureColor(texture.path);
      if (avg) rgb = tint ? avg.map((v, k) => linearToSrgb(Math.pow(v, 2.2) * tint![k])) : avg;
    }
    if (!rgb && color) {
      const lin = tint ? color.map((v, k) => v * tint![k]) : color;
      rgb = lin.slice(0, 3).map((v) => linearToSrgb(clamp01(v)));
    }
    if (!rgb) return GREY;
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]), clamp01(opacity)];
  }

   
  async textureColor(p: string): Promise<number[] | undefined> {
    const st = await this.af.stat?.(p);
    const cacheFile = this.opts.colorCacheFile === undefined ? path.join(process.cwd(), "data/simready/texture-colors.json") : this.opts.colorCacheFile;
    if (st?.sha256 && cacheFile) {
      if (!this.colorCache) {
        try {
          this.colorCache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
        } catch {
          this.colorCache = {};
        }
      }
      const hit = this.colorCache![st.sha256];
      if (hit) return hit;
    }
    const budget = this.opts.textureBudgetBytes ?? 32 * 1024 * 1024;
    if (st && this.textureBytes + st.size > budget) {
      this.warnings.push(`texture ${p} skipped (texture budget ${Math.round(budget / 1048576)} MB)`);
      return undefined;
    }
    this.opts.onProgress?.({ phase: "textures", file: p });
    const bytes = await this.af.get(p);
    if (!bytes) {
      this.warnings.push(`missing texture ${p}`);
      return undefined;
    }
    this.textureBytes += bytes.length;
    this.comp.files.add(p);
    try {
      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(bytes).resize(16, 16, { fit: "fill" }).toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
      const px = info.width * info.height, ch = info.channels;
      const wide = data.length >= px * ch * 2;
      const sample = (i: number) => (wide ? data.readUInt16LE(i * 2) / 65535 : data[i] / 255);
      const sum = [0, 0, 0];
      for (let i = 0; i < px; i++) for (let k = 0; k < 3; k++) sum[k] += sample(i * ch + Math.min(k, ch - 1));
      const avg = sum.map((s) => s / px);
      if (st?.sha256 && cacheFile && this.colorCache) {
        this.colorCache[st.sha256] = avg.map((v) => Math.round(v * 1e4) / 1e4);
        this.colorCacheDirty = true;
      }
      return avg;
    } catch (e) {
      this.warnings.push(`texture ${p} unreadable: ${(e as Error).message}`);
      return undefined;
    }
  }

  async saveColorCache() {
    const file = this.opts.colorCacheFile === undefined ? path.join(process.cwd(), "data/simready/texture-colors.json") : this.opts.colorCacheFile;
    if (!this.colorCacheDirty || !file || !this.colorCache) return;
    try {
       
      let current: Record<string, number[]> = {};
      try {
        current = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {}
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.part`;
      await fs.writeFile(tmp, JSON.stringify({ ...current, ...this.colorCache }));
      await fs.rename(tmp, file);
    } catch {
       
    }
  }
}

 
export async function convertSimReadyAsset(rootUsd: string, files: AssetFiles, opts: ConvertOptions = {}): Promise<ConvertedAsset> {
  const cv = new Converter(files, opts);
  const stack = await cv.comp.stack(rootUsd);
  if (!stack) throw new Error(`SimReady root layer not found or unreadable: ${rootUsd}${cv.warnings.length ? ` (${cv.warnings.join("; ")})` : ""}`);
  const lm = stack.root.meta;
  const metersPerUnit = typeof lm.metersPerUnit === "number" && lm.metersPerUnit > 0 ? lm.metersPerUnit : 0.01;
  const upAxis: "Y" | "Z" = lm.upAxis === "Z" ? "Z" : "Y";
  if (lm.metersPerUnit === undefined) cv.warnings.push("metersPerUnit not authored; assuming centimetres (USD default)");
   
  const k = metersPerUnit * 1000;
  const root = mul4(S4(k, k, k), upAxis === "Y" ? Rax(0, 90) : I4());
  const pseudo: CPrim = { name: "/", ops: stack.layers.map((layer) => ({ layer, spec: layer.root, stack })) };
  for (const c of await cv.comp.children(pseudo)) await cv.walk(c, root, root, undefined, 0);
  await cv.physicsMaterial();
  if (cv.physics.mass === undefined && cv.massSum > 0) cv.physics.mass = cv.massSum;
  opts.onProgress?.({ phase: "mesh" });
  const buckets = [...cv.buckets.values()].filter((b) => b.pos.n);
  let triangles = buckets.reduce((s, b) => s + b.pos.n / 9, 0);
  if (!triangles) throw new Error(`SimReady asset has no renderable meshes (${rootUsd})`);
  const max = opts.maxTriangles ?? 1_500_000;
  if (triangles > max) {
    const before = triangles;
    triangles = simplify(buckets, max, cv.bbox);
    cv.warnings.push(`simplified from ${before} to ${triangles} triangles (limit ${max})`);
     
    cv.bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const b of buckets)
      for (let i = 0; i < b.pos.n; i += 3)
        for (let d = 0; d < 3; d++) {
          cv.bbox.min[d] = Math.min(cv.bbox.min[d], b.pos.a[i + d]);
          cv.bbox.max[d] = Math.max(cv.bbox.max[d], b.pos.a[i + d]);
        }
  }
  await cv.saveColorCache();
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const physics = Object.fromEntries(Object.entries(cv.physics).filter(([, v]) => v !== undefined)) as SimReadyPhysics;
  return {
    parts: buckets.filter((b) => b.pos.n).map((b) => ({ triangles: b.pos.data, color: b.color, normals: b.nrm.data })),
    triangles,
    bbox: { min: cv.bbox.min.map(r) as [number, number, number], max: cv.bbox.max.map(r) as [number, number, number] },
    metersPerUnit,
    upAxis,
    ...(Object.keys(physics).length ? { physics } : {}),
    files: [...cv.comp.files],
    warnings: [...new Set(cv.warnings)],
  };
}
