 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { fk, withinLimits } from "../kinematics";
import { inv, mul, poseDistance, type Mat } from "../math";
import { circularPath, linearPath, type PathAxes } from "../sim/linear-path";
import { closestJoints, describePathError, ERROR_INVALID_ARC, ERROR_KINEMATIC, pathTolerances, solveGoal, trapezoidTime, type MotionState, type MoveResult, type PlanOptions } from "../sim/planner";
import type { Item, Workspace } from "../types";
import { absPoseWith, combinedJoints, syncAxes, syncBaseAbs, type SyncAxis } from "./axes";

 
export class SyncKinematics {
  readonly nq: number;
  readonly dof: number;
  constructor(
    readonly ws: Workspace,
    readonly robot: Item,
    readonly axes: SyncAxis[] = syncAxes(ws, robot),
  ) {
    this.nq = robot.robot!.model.nq;
    this.dof = this.nq + axes.reduce((n, a) => n + a.nq, 0);
  }
   
  fill(q: number[] | undefined, cur?: number[]): number[] {
    const base = cur ?? combinedJoints(this.ws, this.robot);
    return Array.from({ length: this.dof }, (_, i) => (q && Number.isFinite(q[i]) ? q[i] : base[i] ?? 0));
  }
  over(q: number[]): Map<string, number[]> {
    const m = new Map<string, number[]>([[this.robot.id, q.slice(0, this.nq)]]);
    for (const a of this.axes) m.set(a.item.id, Array.from({ length: a.nq }, (_, k) => (Number.isFinite(q[a.at + k]) ? q[a.at + k] : a.item.robot!.joints[k] ?? 0)));
    return m;
  }
  robotBase(q: number[]): Mat {
    return absPoseWith(this.ws, this.robot.id, this.over(q));
  }
   
  base(q: number[]): Mat {
    return syncBaseAbs(this.ws, this.robot, this.over(q), this.axes);
  }
   
  tcp(q: number[], tool: Mat): Mat {
    const over = this.over(q);
    const tcpAbs = mul(mul(absPoseWith(this.ws, this.robot.id, over), fk(this.robot.robot!.model, q.slice(0, this.nq))), tool);
    return mul(inv(syncBaseAbs(this.ws, this.robot, over, this.axes)), tcpAbs);
  }
   
  flangeGoal(q: number[], p: Mat, tool: Mat): Mat {
    const over = this.over(q);
    return mul(mul(inv(absPoseWith(this.ws, this.robot.id, over)), mul(syncBaseAbs(this.ws, this.robot, over, this.axes), p)), inv(tool));
  }
   
  withinLimits(q: number[]): boolean {
    if (!withinLimits(this.robot.robot!.model, q.slice(0, this.nq))) return false;
    return this.axes.every((a) => withinLimits(a.item.robot!.model, q.slice(a.at, a.at + a.nq)));
  }
}

 
export const isSynced = (ws: Workspace, robot: Item | undefined) => syncAxes(ws, robot).length > 0;

 
export function syncMotionFrame(ws: Workspace, robot: Item, joints: number[]): Mat {
  const rd = robot.robot!;
  const k = new SyncKinematics(ws, robot);
  if (rd.framePose && rd.framePose.length === 16) return rd.framePose;
  const f = rd.activeFrame && ws.items[rd.activeFrame] ? rd.activeFrame : null;
   
   
  return f ? mul(inv(k.base(joints)), absPoseWith(ws, f, k.over(joints))) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

 
export function syncFrameOf(ws: Workspace, robot: Item, frameId: string, joints: number[]): Mat {
  const k = new SyncKinematics(ws, robot);
  return mul(inv(k.base(joints)), absPoseWith(ws, frameId, k.over(joints)));
}

 
function jointSamples(a: number[], b: number[], stepDeg = 1): number[][] {
  const maxd = Math.max(0, ...a.map((v, i) => Math.abs(b[i] - v)));
  const n = Math.max(1, Math.ceil(maxd / (stepDeg > 0 ? stepDeg : 1) - 1e-9));
  return Array.from({ length: n + 1 }, (_, k) => a.map((v, i) => v + ((b[i] - v) * k) / n));
}

 
const maxDelta = (a: number[], b: number[], from = 0, to = a.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs((b[i] ?? 0) - (a[i] ?? 0)));
  return m;
};

interface Goal {
   
  q?: number[];
   
  p?: Mat;
   
  ext?: number[];
   
  ref?: number[];
}






export function planSyncMove(ws: Workspace, robot: Item, st: MotionState, insItem: Item, opts: PlanOptions = {}): MoveResult {
  const ins = insItem.instruction!;
  const rd = robot.robot!;
  const model = rd.model;
  const k = new SyncKinematics(ws, robot);
  const nq = k.nq;
  const cur = k.fill(st.joints);
  const name = insItem.name;
  const fail = (kind: NonNullable<MoveResult["error"]>["kind"], text: string, flags = ERROR_KINEMATIC, samples: number[][] = []): MoveResult => ({
    ok: false,
    joints: samples.at(-1) ?? cur,
    samples,
    time: 0,
    distance: 0,
    error: { kind, text, flags },
  });
  const unreachable = () => fail("unreachable", `Target at instruction<br><strong>${name}</strong><br>is not reachable.`);
  const program = insItem.parent ? ws.items[insItem.parent]?.name ?? "" : "";
  const notPossible = (code: number, samples: number[][]) =>
    fail("path", `Movement at instruction<br><strong>${program}:${name}</strong><br>is not possible.<br><br>Description:<br>${describePathError(code)}`, code, samples);
  const stepDeg = opts.stepDeg ?? 1;
  const pathTol = pathTolerances(opts);
   
  const fallback = model.mech === 0 ? (goal: Mat, seed: number[]) => closestJoints(model, goal, seed) : undefined;

   
  const goalOf = (which: "target" | "target2", pose?: Mat, refJoints?: number[]): Goal | "deleted" | null => {
    const id = ins[which];
    if (id) {
      const t = ws.items[id];
      if (!t) return "deleted";
      const stored = t.target?.joints ?? [];
      if (t.target?.isJoint && stored.length) return { q: k.fill(stored, cur) };
      return { p: mul(st.frame, t.pose), ext: k.fill(stored, cur), ref: stored.length >= nq ? stored.slice(0, nq) : undefined };
    }
    if (which === "target" && ins.joints?.length) return { q: k.fill(ins.joints, cur) };
    if (pose) {
       
      const ext = k.fill(refJoints, cur);
      return { p: mul(inv(k.base(ext)), pose), ext, ref: refJoints && refJoints.length >= nq ? refJoints.slice(0, nq) : undefined };
    }
    return null;
  };
   
  const solve = (g: Goal): number[] | null => {
    if (g.q) return g.q;
    const ext = g.ext!;
    const flange = k.flangeGoal(ext, g.p!, st.tool);
    const q = solveGoal(model, flange, g.ref, cur.slice(0, nq));
    return q ? [...q, ...ext.slice(nq)] : null;
  };

  if (ins.kind === "move") {
    const g = goalOf("target", ins.pose, ins.refJoints);
    if (g === "deleted") return fail("deleted", `Target at instruction ${name} has been deleted`);
    if (!g) return fail("undefined", `Target at instruction<br><strong>${name}</strong><br>is not defined.`);
    const end = solve(g);
    if (ins.moveType === "linear" || ins.moveType === "search") {
      if (!end) return unreachable();
      const from = k.tcp(cur, st.tool);
      const to = g.p ?? k.tcp(end, st.tool);
      const { mm } = poseDistance(from, to);
      if (mm <= 0.001) {
         
        const d = maxDelta(cur, end);
        const profile = { d, v: st.speed.joint, a: st.speed.jointAccel };
        return { ok: true, joints: end, samples: jointSamples(cur, end, stepDeg), profile, time: trapezoidTime(d, profile.v, profile.a), distance: mm };
      }
       
      const path = linearPath({ model, start: cur.slice(0, nq), from, to, tool: st.tool, tol: pathTol, axes: pathAxes(k, cur, end, st.tool), fallback });
      if (path.code) return notPossible(path.code, path.samples);
      const profile = { d: mm, v: st.speed.linear, a: st.speed.linearAccel };
      return { ok: true, joints: path.samples.at(-1)!, samples: path.samples, profile, time: trapezoidTime(mm, profile.v, profile.a), distance: mm };
    }
     
    if (!end || !k.withinLimits(end)) return unreachable();
    const d = maxDelta(cur, end);
    const profile = { d, v: st.speed.joint, a: st.speed.jointAccel };
    return { ok: true, joints: end, samples: jointSamples(cur, end, stepDeg), profile, time: trapezoidTime(d, profile.v, profile.a), distance: jointPathLength(k, cur, end, st.tool) };
  }

  if (ins.kind === "movec") {
    const a = goalOf("target", ins.pose);
    const b = goalOf("target2", ins.pose2);
    if (a === "deleted" || b === "deleted") return fail("deleted", `Target at instruction ${name} has been deleted`);
    if (!a?.p && !a?.q) return fail("undefined", "Robtargets are not properly defined. Select two targets before adding a move circular instruction.");
    if (!b?.p && !b?.q) return fail("undefined", "Robtargets are not properly defined. Select two targets before adding a move circular instruction.");
    const end = solve(b);
    if (!end) return fail("unreachable", `Target/s at instruction<br><strong>${name}</strong><br>are not reachable.`);
    const p0 = k.tcp(cur, st.tool);
    const p1 = a.p ?? k.tcp(a.q!, st.tool);
    const p2 = b.p ?? k.tcp(end, st.tool);
     
     
    const arc = circularPath({ model, start: cur.slice(0, nq), from: p0, via: p1, to: p2, tool: st.tool, tol: pathTol, axes: pathAxes(k, cur, end, st.tool), fallback });
    if (!arc) return notPossible(ERROR_INVALID_ARC, [cur.slice()]);
    if (arc.code) return notPossible(arc.code, arc.samples);
    const profile = { d: arc.length, v: st.speed.linear, a: st.speed.linearAccel };
    return { ok: true, joints: arc.samples.at(-1)!, samples: arc.samples, profile, time: trapezoidTime(arc.length, profile.v, profile.a), distance: arc.length };
  }
  return fail("undefined", "Not a move instruction");
}





function pathAxes(k: SyncKinematics, start: number[], end: number[], tool: Mat): PathAxes {
  const { nq, dof } = k;
  const full = (s: number) => start.map((v, j) => (j < nq ? v : v + (end[j] - v) * s));
  return {
    extAt: (s) => full(s).slice(nq),
    extDelta: maxDelta(start, end, nq, dof),
    flangeGoal: (p, s) => k.flangeGoal(full(s), p, tool),
  };
}





function jointPathLength(k: SyncKinematics, a: number[], b: number[], tool: Mat): number {
  const n = Math.max(1, Math.ceil(maxDelta(a, b)));
  let len = 0;
  let prev = k.tcp(a, tool);
  for (let i = 1; i <= n; i++) {
    const q = a.map((v, j) => v + ((b[j] - v) * i) / n);
    const p = k.tcp(q, tool);
    len += Math.hypot(p[3] - prev[3], p[7] - prev[7], p[11] - prev[11]);
    prev = p;
  }
  return len;
}
