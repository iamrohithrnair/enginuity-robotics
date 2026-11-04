 
 
 
 

import type { Mat } from "./math";
import type { RobotModel } from "./types";

interface CoreExports {
  memory: WebAssembly.Memory;
  rc_alloc(len: number): number;
  rc_free(ptr: number, len: number): void;
  rc_fk(model: number, modelLen: number, q: number, out: number): number;
  rc_link_frames(model: number, modelLen: number, q: number, out: number): number;
  rc_ik_closest(model: number, modelLen: number, pose: number, seed: number, out: number): number;
  rc_ik_track(model: number, modelLen: number, pose: number, seed: number, out: number): number;
  rc_ik_all(model: number, modelLen: number, pose: number, out: number, max: number): number;
  rc_ik_all_seeded(model: number, modelLen: number, pose: number, seed: number, out: number, max: number): number;
  rc_config(model: number, modelLen: number, q: number, out: number): number;
  rc_clamp(model: number, modelLen: number, q: number, nq: number, out: number): number;
  rc_within_limits(model: number, modelLen: number, q: number): number;
  rc_mesh_create(v: number, nFloats: number): number;
  rc_mesh_free(id: number): void;
  rc_collide(a: number, poseA: number, b: number, poseB: number, clearance: number): number;
  rc_robotfile_parse(bytes: number, len: number): number;
  rc_result_ptr(): number;
  rc_result_len(): number;
}

let core: CoreExports | null = null;
let loading: Promise<CoreExports> | null = null;

async function loadBytes(): Promise<ArrayBuffer> {
  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const buf = await readFile(path.join(  process.cwd(), "public", "wasm", "rc_core.wasm"));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  const res = await fetch("/wasm/rc_core.wasm");
  return res.arrayBuffer();
}

export async function initKinematics(): Promise<void> {
  if (core) return;
  if (!loading) {
    loading = loadBytes()
      .then((b) => WebAssembly.instantiate(b, {}))
      .then((r) => (r.instance.exports as unknown) as CoreExports);
  }
  core = await loading;
}

export const kinematicsReady = () => core !== null;

function need(): CoreExports {
  if (!core) throw new Error("kinematics core not initialised; call initKinematics() first");
  return core;
}

const flatCache = new WeakMap<RobotModel, Float64Array>();

 
export function flattenModel(m: RobotModel): Float64Array {
  const hit = flatCache.get(m);
  if (hit) return hit;
  const ndh = m.joints.length;
  const nq = m.nq;
  const poly = m.polygon ?? [];
  const params = m.mechParams ?? [];
  const v = new Float64Array(35 + ndh * 7 + ndh * nq + 2 * nq + 1 + poly.length * 2 + 2 + params.length);
  v[0] = ndh;
  v[1] = nq;
  v[2] = m.mech ?? 1;
  v.set(m.base, 3);
  v.set(m.flange, 19);
  let o = 35;
  for (const j of m.joints) {
    v[o] = j.kind === "linear" ? 1 : 0;
    v[o + 1] = j.alpha;
    v[o + 2] = j.a;
    v[o + 3] = j.theta;
    v[o + 4] = j.d;
    v[o + 5] = j.lower;
    v[o + 6] = j.upper;
    o += 7;
  }
  v.set(m.map, o);
  o += ndh * nq;
  v.set(m.userLower, o);
  o += nq;
  v.set(m.userUpper, o);
  o += nq;
  v[o++] = poly.length;
  for (const p of poly) {
    v[o++] = p[0];
    v[o++] = p[1];
  }
  v[o++] = meshCount(m);
  v[o++] = params.length;
  v.set(params, o);
  flatCache.set(m, v);
  return v;
}

 
export const meshCount = (m: RobotModel) => m.meshLinks ?? m.joints.length + 1;

 
export function simpleModel(rows: { alpha: number; a: number; theta: number; d: number; lower: number; upper: number; kind?: "rotary" | "linear" }[], base?: Mat, flange?: Mat): RobotModel {
  const n = rows.length;
  const map = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) map[i * n + i] = 1;
  const eye = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return {
    base: base ?? eye,
    flange: flange ?? eye,
    joints: rows.map((r) => ({ kind: r.kind ?? "rotary", alpha: r.alpha, a: r.a, theta: r.theta, d: r.d, lower: r.lower, upper: r.upper })),
    nq: n,
    map,
    userLower: rows.map((r) => r.lower),
    userUpper: rows.map((r) => r.upper),
    polygon: [],
    mech: 1,
  };
}

function withF64<T>(arrays: Float64Array[], outLen: number, fn: (ptrs: number[], out: number) => T): { r: T; out: Float64Array } {
  const c = need();
  const ptrs = arrays.map((a) => {
    const p = c.rc_alloc(a.byteLength);
    new Float64Array(c.memory.buffer, p, a.length).set(a);
    return p;
  });
  const outPtr = c.rc_alloc(Math.max(8, outLen * 8));
  const r = fn(ptrs, outPtr);
  const out = new Float64Array(c.memory.buffer, outPtr, outLen).slice();
  ptrs.forEach((p, i) => c.rc_free(p, arrays[i].byteLength));
  c.rc_free(outPtr, Math.max(8, outLen * 8));
  return { r, out };
}

export function fk(model: RobotModel, q: number[]): Mat {
  const flat = flattenModel(model);
  const { out } = withF64([flat, Float64Array.from(q)], 16, ([m, qq], o) => need().rc_fk(m, flat.length, qq, o));
  return Array.from(out);
}






export function linkFrames(model: RobotModel, q: number[]): Mat[] {
  const flat = flattenModel(model);
  const n = meshCount(model) + 1;
  const { out } = withF64([flat, Float64Array.from(q)], n * 16, ([m, qq], o) => need().rc_link_frames(m, flat.length, qq, o));
  return Array.from({ length: n }, (_, i) => Array.from(out.slice(i * 16, i * 16 + 16)));
}






function referenceIk(model: RobotModel, seed: number[]): number[] | null {
  if (model.mech !== 15 && model.mech !== 17) return null;
  return Array.from({ length: model.nq }, (_, i) => seed[i] ?? 0);
}

export function ikClosest(model: RobotModel, pose: Mat, seed: number[]): number[] | null {
  const keep = referenceIk(model, seed);
  if (keep) return keep;
  const flat = flattenModel(model);
  const dof = model.nq;
  const { r, out } = withF64([flat, Float64Array.from(pose), Float64Array.from(seed)], dof, ([m, p, s], o) =>
    need().rc_ik_closest(m, flat.length, p, s, o),
  );
  return r === 1 ? Array.from(out) : null;
}

export function ikTrack(model: RobotModel, pose: Mat, seed: number[]): number[] | null {
  const keep = referenceIk(model, seed);
  if (keep) return keep;
  const flat = flattenModel(model);
  const dof = model.nq;
  const { r, out } = withF64([flat, Float64Array.from(pose), Float64Array.from(seed)], dof, ([m, p, s], o) =>
    need().rc_ik_track(m, flat.length, p, s, o),
  );
  return r === 1 ? Array.from(out) : null;
}

 
export interface IkSolution {
  joints: number[];
  primary: boolean;
  





  extras: number[];
}

const IK_ROW_TAIL = 10;





export function ikAllDetailed(model: RobotModel, pose: Mat, max = 64, current?: number[]): IkSolution[] {
  const flat = flattenModel(model);
  const n = model.nq;
  const w = n + IK_ROW_TAIL;
  const seed = Float64Array.from({ length: n }, (_, i) => current?.[i] ?? 0);
  const { r, out } = withF64([flat, Float64Array.from(pose), seed], w * max, ([m, p, s], o) => need().rc_ik_all_seeded(m, flat.length, p, s, o, max));
  return Array.from({ length: r }, (_, i) => {
    const row = out.slice(i * w, (i + 1) * w);
    return { joints: Array.from(row.slice(0, n)), primary: row[n] > 5, extras: Array.from(row.slice(n + 2, n + 2 + row[n + 1])) };
  });
}

export function ikAll(model: RobotModel, pose: Mat, max = 64, current?: number[]): number[][] {
  return ikAllDetailed(model, pose, max, current).map((s) => s.joints);
}

 
export function jointsConfig(model: RobotModel, q: number[]): number[] {
  const flat = flattenModel(model);
  const { out } = withF64([flat, Float64Array.from(q)], 4, ([m, qq], o) => need().rc_config(m, flat.length, qq, o));
  return Array.from(out);
}

 
export function clampJoints(model: RobotModel, q: number[]): number[] {
  const flat = flattenModel(model);
  const { out } = withF64([flat, Float64Array.from(q)], model.nq, ([m, qq], o) => need().rc_clamp(m, flat.length, qq, q.length, o));
  return Array.from(out);
}

export function withinLimits(model: RobotModel, q: number[]): boolean {
  const flat = flattenModel(model);
  const { r } = withF64([flat, Float64Array.from(q)], 1, ([m, qq]) => need().rc_within_limits(m, flat.length, qq));
  return r === 1;
}

export function meshCreate(triangles: Float32Array): number {
  const c = need();
  const p = c.rc_alloc(triangles.byteLength);
  new Float32Array(c.memory.buffer, p, triangles.length).set(triangles);
  const id = c.rc_mesh_create(p, triangles.length);
  c.rc_free(p, triangles.byteLength);
  return id;
}

export const meshFree = (id: number) => need().rc_mesh_free(id);

export function collide(a: number, poseA: Mat, b: number, poseB: Mat, clearance = 0): boolean {
  const { r } = withF64([Float64Array.from(poseA), Float64Array.from(poseB)], 1, ([pa, pb]) => need().rc_collide(a, pa, b, pb, clearance));
  return r === 1;
}

export interface ParsedRobotFile {
  json: Record<string, unknown>;
  floats: Float32Array;
}

 
export function parseRobotFile(bytes: Uint8Array): ParsedRobotFile {
  const c = need();
  const p = c.rc_alloc(bytes.byteLength);
  new Uint8Array(c.memory.buffer, p, bytes.length).set(bytes);
  const n = c.rc_robotfile_parse(p, bytes.length);
  c.rc_free(p, bytes.byteLength);
  const resPtr = c.rc_result_ptr();
  const resLen = c.rc_result_len();
  const buf = new Uint8Array(c.memory.buffer, resPtr, resLen).slice();
  if (n < 0) throw new Error(JSON.parse(new TextDecoder().decode(buf)).error ?? "invalid robot file");
  const jsonLen = new DataView(buf.buffer).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + jsonLen)));
  let off = 4 + jsonLen;
  off += (4 - (off % 4)) % 4;
  const floats = new Float32Array(buf.buffer.slice(off));
  return { json, floats };
}






export function writeRdkFile(station: unknown, payload: Float32Array, julianDay: number): { bytes: Uint8Array; report: { records: number; indices: Record<string, number>; skipped: unknown[] } } {
  const c = need() as CoreExports & { rc_rdk_write(json: number, jsonLen: number, floats: number, nFloats: number, day: number): number };
  const js = new TextEncoder().encode(JSON.stringify(station));
  const pj = c.rc_alloc(js.byteLength);
  new Uint8Array(c.memory.buffer, pj, js.byteLength).set(js);
  const pf = c.rc_alloc(payload.byteLength);
  new Float32Array(c.memory.buffer, pf, payload.length).set(payload);
  const n = c.rc_rdk_write(pj, js.byteLength, pf, payload.length, julianDay);
  c.rc_free(pj, js.byteLength);
  c.rc_free(pf, payload.byteLength);
  const buf = new Uint8Array(c.memory.buffer, c.rc_result_ptr(), c.rc_result_len()).slice();
  if (n < 0) throw new Error(JSON.parse(new TextDecoder().decode(buf)).error ?? "station file not written");
  const rl = new DataView(buf.buffer).getUint32(0, true);
  return { report: JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + rl))), bytes: buf.subarray(4 + rl) };
}





export function parseRdkFile(bytes: Uint8Array): ParsedRobotFile {
  const c = need() as CoreExports & { rc_rdk_parse(bytes: number, len: number): number };
  const p = c.rc_alloc(bytes.byteLength);
  new Uint8Array(c.memory.buffer, p, bytes.length).set(bytes);
  const n = c.rc_rdk_parse(p, bytes.length);
  c.rc_free(p, bytes.byteLength);
  const buf = new Uint8Array(c.memory.buffer, c.rc_result_ptr(), c.rc_result_len()).slice();
  if (n < 0) throw new Error(JSON.parse(new TextDecoder().decode(buf)).error ?? "invalid station file");
  const jsonLen = new DataView(buf.buffer).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + jsonLen)));
  let off = 4 + jsonLen;
  off += (4 - (off % 4)) % 4;
  return { json, floats: new Float32Array(buf.buffer.slice(off)) };
}
