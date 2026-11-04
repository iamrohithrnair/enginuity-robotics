 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fk, ikAll, parseRdkFile, withinLimits } from "@/engine/kinematics";
import { inv, mul, type Mat } from "@/engine/math";
import type { Item, RobotModel, Workspace } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import { engine, LIBRARY_KIND_DIR } from "../helpers";

 
export const STATIONS_DIR = LIBRARY_KIND_DIR("stations");
export const hasMirror = () => existsSync(STATIONS_DIR) && readdirSync(STATIONS_DIR).some((f) => f.endsWith(".rdk"));
export const stationFiles = () =>
  readdirSync(STATIONS_DIR)
    .filter((f) => /\.rdka?$/i.test(f))
    .sort();

export interface PairResult {
  station: string;
  source: "target" | "move";
  item: string;
  program?: string;
  index?: number;
  robot: string;
  mech: number;
  nq: number;
   
  ext: number;
   
  extMap: "none" | "mapped" | "unmapped";
  isJoint: boolean;
   
  tool: "active" | "other" | "flange" | "program" | "stored";
  




  frame: "target" | "linked" | "stored@base" | "stored@abs" | "stored@root" | "default";
  posErr: number;
  rotErr: number;
   
  ik: boolean | null;
   
  ikNearest?: number;
  ikCount?: number;
  



  ikSingular?: boolean;
  inLimits: boolean;
  




  segment?: string;
  segmentSize?: number;
   
  segmentExtent?: number;
  rigidPos?: number;
  rigidRot?: number;
   
  unreachable: boolean;
   
  sharedJoints: boolean;
   
  carried: boolean;
  joints?: number[];
   
  error?: string;
}

export interface StationReport {
  station: string;
  ok: boolean;
  error?: string;
  aligned: boolean;
  results: PairResult[];
  skippedTargets: number;
  skippedMoves: number;
   
  errors: {
    robot: string;
    mech: number;
    source: string;
    item: string;
    error: string;
  }[];
}

type Raw = Record<string, unknown> & {
  index: number;
  kind: string;
  name: string;
};

const R2D = 180 / Math.PI;

 
export function poseError(a: Mat, b: Mat): { pos: number; rot: number } {
  const pos = Math.hypot(a[3] - b[3], a[7] - b[7], a[11] - b[11]);
   
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += a[k * 4 + i] * b[k * 4 + i];
  const c = Math.min(1, Math.max(-1, (tr - 1) / 2));
  return { pos, rot: Math.acos(c) * R2D };
}

function dfs(ws: Workspace, id: string, out: Item[]) {
  const it = ws.items[id];
  if (!it) return;
  if (it.type !== "instruction") out.push(it);
  for (const c of it.children) dfs(ws, c, out);
}

function descendants(ws: Workspace, id: string): Item[] {
  const out: Item[] = [];
  dfs(ws, id, out);
  return out.slice(1);
}

function ancestors(ws: Workspace, id: string): Item[] {
  const out: Item[] = [];
  let cur = ws.items[id]?.parent ? ws.items[ws.items[id].parent!] : undefined;
  while (cur) {
    out.push(cur);
    cur = cur.parent ? ws.items[cur.parent] : undefined;
  }
  return out;
}





export function storedJoints(nq: number, q: number[]): number[] {
  if (nq < 6 && q.length === 6 && q.slice(nq).every((v) => v === 0)) return q.slice(0, nq);
  return q;
}

 
function jointDistance(robot: Item, a: number[], b: number[]): number {
  const m = robot.robot!.model;
  let worst = 0;
  for (let i = 0; i < m.nq; i++) {
    const linear = m.joints[i]?.kind === "linear";
    let d = a[i] - b[i];
    if (!linear) d = ((((d + 180) % 360) + 360) % 360) - 180;
    worst = Math.max(worst, Math.abs(d));
  }
  return worst;
}





function externalMechs(ws: Workspace, robot: Item, frameId: string | null): Item[][] {
  const near = (id: string | null) => (id ? ancestors(ws, id).filter((a) => a.type === "robot" && a.id !== robot.id && a.robot) : []);
  const robotSide = near(robot.id);
  const partSide = frameId ? near(frameId).filter((m) => !robotSide.includes(m)) : [];
  const orders = [[...robotSide, ...partSide]];
  if (robotSide.length && partSide.length) orders.push([...partSide, ...robotSide]);
  return orders;
}

 
function withMechJoints<T>(mechs: Item[], extra: number[], fn: () => T): T | null {
  const saved = mechs.map((m) => m.robot!.joints);
  let k = 0;
  for (const m of mechs) {
    const n = m.robot!.model.nq;
    if (k + n > extra.length) break;
    m.robot!.joints = extra.slice(k, k + n);
    k += n;
  }
  try {
    return k === extra.length ? fn() : null;
  } finally {
    mechs.forEach((m, i) => (m.robot!.joints = saved[i]));
  }
}

 
function carriedByOther(ws: Workspace, robot: Item, id: string | null): boolean {
  if (!id) return false;
  const own = new Set([robot.id, ...ancestors(ws, robot.id).map((a) => a.id)]);
  return ancestors(ws, id).some((a) => a.type === "robot" && !own.has(a.id)) || (ws.items[id]?.type === "robot" && !own.has(id));
}

interface Candidate {
  tool: PairResult["tool"];
  pose: Mat;
}

function toolCandidates(ws: Workspace, robot: Item): Candidate[] {
  const out: Candidate[] = [];
  const active = robot.robot!.activeTool;
   
   
  const flangeNow = mul(absPose(ws, robot.id), fk(robot.robot!.model, robot.robot!.joints));
  for (const t of descendants(ws, robot.id)) {
    if (t.type !== "tool") continue;
    const pose = t.parent === robot.id ? t.pose : mul(inv(flangeNow), absPose(ws, t.id));
    out.push({ tool: t.id === active ? "active" : "other", pose });
  }
  out.push({
    tool: "flange",
    pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  return out;
}

interface TargetCandidate {
  frame: PairResult["frame"];
  pose: () => Mat;
}

 
function compare(
  ws: Workspace,
  robot: Item,
  q: number[],
  targets: TargetCandidate[],
  frameId: string | null,
  candidates: Candidate[],
): {
  posErr: number;
  rotErr: number;
  tool: PairResult["tool"];
  frame: PairResult["frame"];
  toolPose: Mat;
  extMap: PairResult["extMap"];
  target: Mat;
  robotAbs: Mat;
} {
  const m = robot.robot!.model;
  const nq = m.nq;
  const own = q.slice(0, nq);
  const extra = q.slice(nq);
  const evalWith = () => {
    const base = absPose(ws, robot.id);
    const flange = mul(base, fk(m, own));
    let best = {
      posErr: Infinity,
      rotErr: Infinity,
      tool: "flange" as PairResult["tool"],
      frame: targets[0].frame,
      toolPose: candidates[0]?.pose,
      target: targets[0].pose(),
      robotAbs: base,
    };
    for (const t of targets) {
      const target = t.pose();
      for (const c of candidates) {
        const e = poseError(mul(flange, c.pose), target);
        if (e.pos + e.rot < best.posErr + best.rotErr)
          best = {
            posErr: e.pos,
            rotErr: e.rot,
            tool: c.tool,
            frame: t.frame,
            toolPose: c.pose,
            target,
            robotAbs: base,
          };
      }
    }
    return best;
  };
  if (!extra.length) return { ...evalWith(), extMap: "none" };
  let best: ReturnType<typeof evalWith> | null = null;
  for (const order of externalMechs(ws, robot, frameId)) {
    const r = withMechJoints(order, extra, evalWith);
    if (r && (!best || r.posErr + r.rotErr < best.posErr + best.rotErr)) best = r;
  }
  if (best) return { ...best, extMap: "mapped" };
  return { ...evalWith(), extMap: "unmapped" };
}

 
export const IK_TOL = 0.01;

 
function wristSingularSign(m: RobotModel, q: number[]): number | null {
  if (m.nq !== 6) return null;
  const t = fk(m, q);
  for (const s of [-1, 1]) {
    const c = q.slice(0, 6);
    c[3] += 10;
    c[5] += s * 10;
    const e = poseError(fk(m, c), t);
    if (e.pos < 1e-6 && e.rot < 1e-7) return s;
  }
  return null;
}





function hadamard(m: RobotModel, q: number[]): number {
  if (m.nq !== 6) return 1;
  const t0 = fk(m, q);
  const cols = q.slice(0, 6).map((_, k) => {
    const c = q.slice(0, 6);
    c[k] += 1e-3;
    const t = fk(m, c);
     
    const r = (i: number, j: number) => t0[0 * 4 + i] * t[0 * 4 + j] + t0[1 * 4 + i] * t[1 * 4 + j] + t0[2 * 4 + i] * t[2 * 4 + j];
    return [t[3] - t0[3], t[7] - t0[7], t[11] - t0[11], ((r(2, 1) - r(1, 2)) / 2) * 1000, ((r(0, 2) - r(2, 0)) / 2) * 1000, ((r(1, 0) - r(0, 1)) / 2) * 1000];
  });
  const a = cols.map((c) => c.slice());
  let det = 1;
  for (let i = 0; i < 6; i++) {
    let p = i;
    for (let r = i + 1; r < 6; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-300) return 0;
    if (p !== i) [a[p], a[i]] = [a[i], a[p]];
    det *= a[i][i];
    for (let r = i + 1; r < 6; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < 6; c++) a[r][c] -= f * a[i][c];
    }
  }
  return Math.abs(det) / cols.reduce((acc, c) => acc * Math.hypot(...c), 1);
}







function ikCheck(robot: Item, q: number[], robotAbs: Mat, target: Mat, toolPose: Mat): { ok: boolean; nearest: number; count: number; singular: boolean } {
  const m = robot.robot!.model;
  const flangeInBase = mul(mul(inv(robotAbs), target), inv(toolPose));
  const sols = ikAll(m, flangeInBase, 64, q.slice(0, m.nq));
  const sigma = wristSingularSign(m, q);
  const norm = (v: number[]) => {
    if (sigma === null) return v;
    const c = v.slice();
    c[5] -= sigma * c[3];
    c[3] = 0;
    return c;
  };
  const nearest = sols.reduce((a, s) => Math.min(a, jointDistance(robot, norm(s), norm(q))), Infinity);
  return {
    ok: nearest < IK_TOL,
    nearest,
    count: sols.length,
    singular: sigma !== null || hadamard(m, q) < 1e-6,
  };
}

 
const hasIk = (robot: Item) => robot.robot!.model.mech !== 15;

 
class Segments {
  private segs = new Map<string, { pairs: PairResult[]; implied: Mat[][]; rel: Mat[] }>();

  add(key: string, r: PairResult, robotAbs: Mat, robot: Item, q: number[], tcps: Candidate[], rel: Mat) {
    const flange = mul(robotAbs, fk(robot.robot!.model, q.slice(0, robot.robot!.model.nq)));
    const s = this.segs.get(key) ?? { pairs: [], implied: [], rel: [] };
    s.pairs.push(r);
    s.implied.push(tcps.map((c) => mul(mul(flange, c.pose), inv(rel))));
    s.rel.push(rel);
    this.segs.set(key, s);
  }

   
  finish() {
    for (const [key, s] of this.segs) {
      if (s.pairs.length < 2) continue;
      let best = { pos: Infinity, rot: Infinity };
      for (let c = 0; c < s.implied[0].length; c++) {
        let pos = 0;
        let rot = 0;
        for (const imp of s.implied) {
          const e = poseError(imp[c], s.implied[0][c]);
          pos = Math.max(pos, e.pos);
          rot = Math.max(rot, e.rot);
        }
        if (pos + rot < best.pos + best.rot) best = { pos, rot };
      }
      const extent = s.rel.reduce((a, r) => Math.max(a, poseError(r, s.rel[0]).pos), 0);
      for (const r of s.pairs)
        Object.assign(r, {
          segment: key,
          segmentSize: s.pairs.length,
          segmentExtent: extent,
          rigidPos: best.pos,
          rigidRot: best.rot,
        });
    }
  }
}

 
export async function analyzeStation(file: string, opts: { ikMovesPerProgram?: number } = {}): Promise<StationReport> {
  const ikPerProgram = opts.ikMovesPerProgram ?? 25;
  const bytes = new Uint8Array(readFileSync(path.join(STATIONS_DIR, file)));
  const rep: StationReport = {
    station: file,
    ok: false,
    aligned: false,
    results: [],
    skippedTargets: 0,
    skippedMoves: 0,
    errors: [],
  };
  const guard = <T>(robot: Item, source: string, item: string, fn: () => T): T | null => {
    try {
      return fn();
    } catch (err) {
      rep.errors.push({
        robot: robot.name,
        mech: robot.robot!.model.mech,
        source,
        item,
        error: String(err instanceof Error ? err.message : err),
      });
      return null;
    }
  };
  const e = await engine();
  let rawItems: Raw[];
  try {
    rawItems = (parseRdkFile(bytes).json as { items: Raw[] }).items;
    await e.run("station.openRdk", {
      base64: Buffer.from(bytes).toString("base64"),
    });
  } catch (err) {
    rep.error = String(err instanceof Error ? err.message : err);
    return rep;
  }
  const ws = e.ws;
  const stationId = ws.activeStation!;
   
  const imported = descendants(ws, stationId);
  const raws = rawItems.filter((r) => r.kind !== "station");
  rep.aligned = imported.length === raws.length && imported.every((it, i) => it.name === raws[i].name);
  if (!rep.aligned) {
    rep.error = `alignment ${imported.length} imported vs ${raws.length} raw`;
    return rep;
  }
  const byRaw = new Map<number, Item>();
  const rawOf = new Map<string, Raw>();
  raws.forEach((r, i) => {
    byRaw.set(r.index, imported[i]);
    rawOf.set(imported[i].id, r);
  });
  const robots = imported.filter((i) => i.type === "robot" && i.robot);
  const segments = new Segments();
  const pick = (ref: unknown): Item | undefined => {
    const it = typeof ref === "number" && ref >= 0 ? byRaw.get(ref) : undefined;
    return it?.type === "robot" ? it : undefined;
  };

   
  const shared = new Set<string>();
  const byJoints = groupBy(
    imported.filter((t) => t.type === "target" && t.target?.joints.length),
    (t) => `${t.target!.robot ?? ""}|${t.target!.joints.join(",")}`,
  );
  for (const group of Object.values(byJoints)) {
    if (group.length < 2) continue;
    const p0 = absPose(ws, group[0].id);
    if (group.some((t) => poseError(absPose(ws, t.id), p0).pos > 1)) group.forEach((t) => shared.add(t.id));
  }

   
  for (const t of imported) {
    if (t.type !== "target" || !t.target) continue;
    const robot = (t.target.robot ? ws.items[t.target.robot] : undefined) ?? (robots.length === 1 ? robots[0] : undefined);
    const q = robot?.robot ? storedJoints(robot.robot.model.nq, t.target.joints) : t.target.joints;
    if (!robot?.robot || q.length < robot.robot.model.nq) {
      rep.skippedTargets++;
      continue;
    }
    const tcps = toolCandidates(ws, robot);
    const c = guard(robot, "target", t.name, () => compare(ws, robot, q, [{ frame: "target", pose: () => absPose(ws, t.id) }], t.parent, tcps));
    if (!c) continue;
    const m = robot.robot.model;
    const ikr = c.extMap === "unmapped" || !hasIk(robot) ? null : guard(robot, "target-ik", t.name, () => ikCheck(robot, q, c.robotAbs, c.target, c.toolPose));
    const result: PairResult = {
      station: file,
      source: "target",
      item: t.name,
      robot: robot.name,
      mech: m.mech,
      nq: m.nq,
      ext: q.length - m.nq,
      extMap: c.extMap,
      isJoint: t.target.isJoint,
      tool: c.tool,
      frame: c.frame,
      posErr: c.posErr,
      rotErr: c.rotErr,
      ik: ikr ? ikr.ok : null,
      ikNearest: ikr?.nearest,
      ikCount: ikr?.count,
      ikSingular: ikr?.singular,
      inLimits: withinLimits(m, q.slice(0, m.nq)),
      unreachable: !!rawOf.get(t.id)?.unreachable,
      sharedJoints: shared.has(t.id),
      carried: c.extMap === "none" && carriedByOther(ws, robot, t.parent),
      joints: q,
    };
    rep.results.push(result);
    if (c.extMap !== "unmapped") segments.add(`targets of ${t.parent ? ws.items[t.parent]?.name : "?"} · ${robot.name}`, result, c.robotAbs, robot, q, tcps, t.pose);
  }

   
  for (const raw of raws) {
    if (raw.kind !== "program") continue;
    const prog = byRaw.get(raw.index)!;
    const robot = pick(raw.robot) ?? (robots.length === 1 ? robots[0] : undefined);
    const list = (raw.instructions as Record<string, unknown>[] | undefined) ?? [];
    if (!robot?.robot) {
      rep.skippedMoves += list.filter((i) => i.type === 0 && i.target === -1).length;
      continue;
    }
    const m = robot.robot.model;
    const base = () => absPose(ws, robot.id);
     
    const carriers = ancestors(ws, robot.id).filter((a) => a.type === "robot");
    const root = carriers.length ? carriers[carriers.length - 1] : null;
    let frameId: string | null = robot.robot.activeFrame ?? null;
    let frames: TargetCandidate[] = [
      {
        frame: "default",
        pose: () => (frameId && ws.items[frameId] ? absPose(ws, frameId) : base()),
      },
    ];
    let tcp: Candidate[] | null = null;
    let ikDone = 0;
    let segment = 0;
    for (const ins of list) {
      if (ins.type === 3 || ins.type === 4) segment++;
      if (ins.type === 3) {
        const ref = byRaw.get(Number(ins.ref));
        const stored = Array.isArray(ins.pose) ? (ins.pose as Mat) : null;
        frameId = ref?.id ?? null;
        frames = [];
        if (ref) frames.push({ frame: "linked", pose: () => absPose(ws, ref.id) });
        if (stored) {
          frames.push({ frame: "stored@base", pose: () => mul(base(), stored) }, { frame: "stored@abs", pose: () => stored });
          if (root)
            frames.push({
              frame: "stored@root",
              pose: () => mul(absPose(ws, root.id), stored),
            });
        }
        if (!frames.length) frames.push({ frame: "default", pose: base });
      } else if (ins.type === 4) {
        const ref = byRaw.get(Number(ins.ref));
        tcp = [];
        if (ref?.type === "tool") tcp.push({ tool: "program", pose: ref.pose });
        if (Array.isArray(ins.pose)) tcp.push({ tool: "stored", pose: ins.pose as Mat });
        if (!tcp.length) tcp = null;
      } else if ((ins.type === 0 && ins.target === -1 && Array.isArray(ins.joints) && Array.isArray(ins.pose)) || (ins.type === 1 && Array.isArray(ins.poses))) {
         
        const embedded: [number[], Mat, boolean, string][] =
          ins.type === 0
            ? [[ins.joints as number[], ins.pose as Mat, !!ins.unreachable, String(ins.name)]]
            : (ins.poses as (Mat | null)[]).flatMap((pose, k) =>
                pose ? [[(ins.joints as number[][])[k], pose, !!(ins.unreachable as boolean[])[k], `${ins.name} #${k + 1}`] as [number[], Mat, boolean, string]] : [],
              );
        for (const [joints, pose, unreachable, label] of embedded) {
          const q = storedJoints(m.nq, joints);
          if (q.length < m.nq) {
            rep.skippedMoves++;
            continue;
          }
          const rel = pose;
          const targets = frames.map((f) => ({
            frame: f.frame,
            pose: () => mul(f.pose(), rel),
          }));
          const tcps = tcp ?? toolCandidates(ws, robot);
          const c = guard(robot, "move", label, () => compare(ws, robot, q, targets, frameId, tcps));
          if (!c) continue;
          const doIk = c.extMap !== "unmapped" && hasIk(robot) && ikDone < ikPerProgram;
          if (doIk) ikDone++;
          const ikr = doIk ? guard(robot, "move-ik", label, () => ikCheck(robot, q, c.robotAbs, c.target, c.toolPose)) : null;
          const result: PairResult = {
            station: file,
            source: "move",
            item: label,
            program: prog.name,
            index: Number(ins.index),
            robot: robot.name,
            mech: m.mech,
            nq: m.nq,
            ext: q.length - m.nq,
            extMap: c.extMap,
            isJoint: !!ins.is_joint,
            tool: c.tool,
            frame: c.frame,
            posErr: c.posErr,
            rotErr: c.rotErr,
            ik: ikr ? ikr.ok : null,
            ikNearest: ikr?.nearest,
            ikCount: ikr?.count,
            ikSingular: ikr?.singular,
            inLimits: withinLimits(m, q.slice(0, m.nq)),
            unreachable,
            sharedJoints: false,
            carried: c.extMap === "none" && carriedByOther(ws, robot, frameId),
          };
           
          if ((ikr && !ikr.ok) || !result.inLimits || c.posErr >= EXACT.pos || c.rotErr >= EXACT.rot) result.joints = q;
          rep.results.push(result);
          if (c.extMap !== "unmapped") segments.add(`${prog.name} #${segment}`, result, c.robotAbs, robot, q, tcps, rel);
        }
      }
    }
  }
  segments.finish();
  rep.ok = true;
  return rep;
}

export interface GroupStats {
  n: number;
  fkExact: number;
   
  fkRigid: number;
  fkClose: number;
  medianPos: number;
  maxPos: number;
  medianRot: number;
  maxRot: number;
  ikChecked: number;
  ikOk: number;
  outOfLimits: number;
}

export const EXACT = { pos: 0.01, rot: 0.001 };
export const CLOSE = { pos: 1, rot: 0.1 };

export const fkExact = (r: PairResult) => r.posErr < EXACT.pos && r.rotErr < EXACT.rot;
export const fkRigid = (r: PairResult) => fkExact(r) || ((r.segmentSize ?? 0) >= 2 && (r.segmentExtent ?? 0) > 10 && r.rigidPos! < EXACT.pos && r.rigidRot! < EXACT.rot);






export const consistent = (r: PairResult) => !r.unreachable && !r.sharedJoints && !r.carried && r.extMap !== "unmapped" && !(r.mech === 15 && r.source === "target");

export function stats(rs: PairResult[]): GroupStats {
  const med = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const pos = rs.map((r) => r.posErr);
  const rot = rs.map((r) => r.rotErr);
  return {
    n: rs.length,
    fkExact: rs.filter(fkExact).length,
    fkRigid: rs.filter(fkRigid).length,
    fkClose: rs.filter((r) => r.posErr < CLOSE.pos && r.rotErr < CLOSE.rot).length,
    medianPos: med(pos),
    maxPos: pos.reduce((a, b) => Math.max(a, b), 0),
    medianRot: med(rot),
    maxRot: rot.reduce((a, b) => Math.max(a, b), 0),
    ikChecked: rs.filter((r) => r.ik !== null).length,
    ikOk: rs.filter((r) => r.ik === true).length,
    outOfLimits: rs.filter((r) => !r.inLimits).length,
  };
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}
