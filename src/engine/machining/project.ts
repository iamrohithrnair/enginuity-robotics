 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { objectCurves, objectPoints } from "../curves";
import { checkCollisions } from "../collision";
import { fk, ikAllDetailed, jointsConfig, withinLimits } from "../kinematics";
import { eye, inv, mul, type Mat } from "../math";
import type { GeometryStore } from "../registry";
import { DEFAULT_PATH_TOLERANCES, type PathTolerances } from "../sim/linear-path";
import type { InstructionData, Item, MachiningData, RobotModel, Workspace } from "../types";
import { absPose, activeToolOf, childFrame, stationOf } from "../workspace";
import { addApproachRetract, APT, curveApt, MARKER, pointApt, type AptCol, type ApproachCol, type WeldSettings } from "./apt";
import { parseNc, type NcEvent, NcError } from "./nc";
import { num, on, parseApproach } from "./settings";
import { arcCheck, linearCheck } from "./pathcheck";
import { pointFrames, rotZCandidates, rotz, targetColumns } from "./solver";

export interface PlannedMove {
  kind: "joint" | "linear";
   
  pose: Mat;
  joints: number[] | null;
}

export type PlanItem = { type: "ins"; data: InstructionData } | { type: "move"; move: PlannedMove } | { type: "movec"; via: PlannedMove; end: PlannedMove };

export interface ProjectSolution {
  items: PlanItem[];
  ok: boolean;
  ratio: number;
  message: string;
  points: number;
   
  toolpath: { poses: Mat[]; bad: number[] };
  warnings: string[];
   
  apt: AptCol[];
   
  rotation: number;
   
  rotations: number[];
}

export class MachiningError extends Error {
  constructor(
    message: string,
    readonly title = "Robot Machining Project",
  ) {
    super(message);
  }
}

export const MESSAGES = {
  solved: "Path solved successfully.",
  unreachable: "The robot can't reach all targets in the path.<br>Try changing the preferred orientation or the position of the part..",
  notSmooth: "The robot cannot complete the path smoothly.",
  noStart: "Can't find a start point",
  noInput: "Select an APT file, curve or points",
  noRobot: "Select a robot first",
};

interface Ctx {
  ws: Workspace;
  store: GeometryStore;
}

 
export function projectLinks(ws: Workspace, m: MachiningData): { robot: Item | null; frame: Item | null; tool: Item | null } {
  const robot = m.robot && ws.items[m.robot]?.robot ? ws.items[m.robot] : null;
  const frame = (m.frame && ws.items[m.frame]) || (robot?.robot?.activeFrame ? ws.items[robot.robot.activeFrame] : null) || null;
  const tool = (m.tool && ws.items[m.tool]) || (robot ? activeToolOf(ws, robot.id) ?? null : null);
  return { robot, frame, tool };
}

const weldSettings = (s: MachiningData["settings"]): WeldSettings => ({
  OffsetNormalMM: num(s.OffsetNormalMM),
  OffsetSideMM: num(s.OffsetSideMM),
  CutStartMM: num(s.CutStartMM),
  CutEndMM: num(s.CutEndMM),
  FlareStartMM: num(s.FlareStartMM),
  FlareStartDeg: num(s.FlareStartDeg, 30),
  FlareEndMM: num(s.FlareEndMM),
  FlareEndDeg: num(s.FlareEndDeg, 30),
});

 

const f32 = Math.fround;

 
function ncApt(m: MachiningData, warnings: string[]): AptCol[] {
  const nc = m.input?.nc;
  if (!nc?.text) throw new MachiningError(MESSAGES.noInput);
  let path;
  try {
    path = parseNc(nc.file, nc.text);
  } catch (e) {
    if (e instanceof NcError) throw new MachiningError(e.message, e.title);
    throw e;
  }
  warnings.push(...path.warnings);
  if (!path.points.length) throw new MachiningError(m.kind === "print3d" ? "Current 3D printing settings do not produce any result. Use appropriate 3D printing parameters for the selected part." : MESSAGES.noInput);
  const events = new Map<number, NcEvent[]>();
  for (const { at, event } of path.events) events.set(at, [...(events.get(at) ?? []), event]);
  const out: AptCol[] = [];
  let feed: number | null | undefined;
  let rpm = 0;
  path.points.forEach((q, i) => {
    for (const e of events.get(i) ?? []) {
      if (e.kind === "spindle") {
        rpm = e.rpm;
        out.push([APT.spindle, rpm, 0, 0, 0, 0, 0]);
      } else if (e.kind === "spindleCW" || e.kind === "spindleCCW") out.push([APT.spindle, rpm, e.kind === "spindleCW" ? 1 : -1, 0, 0, 0, 0]);
      else if (e.kind === "toolChange") out.push([APT.toolChange, e.tool, 0, 0, 0, 0, 0]);
      else if (e.kind === "io") out.push([APT.io, e.code, e.port, 0, 0, 0, 0]);
      else if (e.kind === "extruder") out.push([APT.io, 69, e.e, 0, 0, 0, 0]);
      else out.push(...textColumns(6.4, e.text.replace(/^M/i, "")));
    }
    if (q.feed !== feed) {
      out.push([APT.speed, q.feed === null ? -1 : q.feed, 0, 0, 0, 0, 0]);
      feed = q.feed;
    }
    out.push([APT.move, q.p[0], q.p[1], q.p[2], q.n[0], q.n[1], q.n[2]]);
  });
  return out;
}

 
function textColumns(type: number, text: string): AptCol[] {
  const codes = Array.from(text).map((c) => c.charCodeAt(0));
  const cols: AptCol[] = [];
  for (let i = 0; i === 0 || i < codes.length; i += 6) {
    const chunk = codes.slice(i, i + 6);
    while (chunk.length < 6) chunk.push(0);
    cols.push([i === 0 ? type : 0, ...chunk]);
  }
  return cols;
}

 
export function projectApt(ctx: Ctx, m: MachiningData, warnings: string[] = []): AptCol[] {
  const s = m.settings;
  const approach: ApproachCol[] = parseApproach(m.approach);
  const retract: ApproachCol[] = parseApproach(m.retract);
  const rapid = Math.trunc(num(s.RapidApproachRetract, 1));
  if (m.kind === "curve" || m.kind === "weld" || m.kind === "point") {
    const obj = m.input?.object ? ctx.ws.items[m.input.object] : undefined;
    if (!obj) throw new MachiningError(MESSAGES.noInput);
    if (m.kind === "point") {
       
      const pts = objectPoints(obj);
      const idx = m.input?.curves?.length ? m.input.curves.filter((i) => pts[i]) : pts.map((_, i) => i);
      if (!idx.length) throw new MachiningError(MESSAGES.noInput);
      const flip = new Set(m.input?.flipped ?? []);
      const points = idx.map((i) => {
        const r = pts[i];
         
        const row = r.length >= 6 ? r : [r[0], r[1], r[2], 0, 0, 1];
        return { row: row.slice(0, 6).map(f32), flip: flip.has(i) };
      });
      return addApproachRetract(pointApt(points, num(s.PointApproach, 20), num(s.SpeedOperation, 50)), approach, retract, rapid, true);
    }
    const all = objectCurves(obj);
    const idx = m.input?.curves?.length ? m.input.curves.filter((i) => all[i]) : all.map((_, i) => i);
    if (!idx.length) throw new MachiningError(MESSAGES.noInput);
    const rev = new Set(m.input?.reversed ?? []);
     
    const curves = idx.map((i) => ({ rows: all[i].points.map((r) => (r.length >= 6 ? r : [r[0], r[1], r[2], 0, 0, 1]).slice(0, 6).map(f32)), reversed: rev.has(i) }));
    return curveApt(curves, {
      approachRetractAll: on(s.ApproachRetractAll),
      joinTol: num(s.JoinCurvesTol, 0.5),
      speedOp: num(s.SpeedOperation, 50),
      rapid,
      approach,
      retract,
      weld: weldSettings(s),
    });
  }
   
  const input = m.input?.nc?.text ? ncApt(m, warnings) : m.input?.apt?.length ? m.input.apt.map((c) => c.slice()) : null;
  if (!input) throw new MachiningError(MESSAGES.noInput);
  return addApproachRetract(input, approach, retract, rapid, false);
}

 






export function pathFrameItem(ws: Workspace, m: MachiningData): Item | null {
  const obj = m.input?.object ? ws.items[m.input.object] ?? null : null;
  if (m.kind === "machining" || m.kind === "print3d") return projectLinks(ws, m).frame ?? obj;
  return obj;
}

function pathFrameAbs(ws: Workspace, m: MachiningData): Mat {
  const it = pathFrameItem(ws, m);
  return it ? absPose(ws, it.id) : eye();
}

interface Solved {
   
  thetas: number[];
  joints: (number[] | null)[];
   
  bad: number[];
   
  noStart: boolean;
}

 
const configOf = (model: RobotModel, q: number[]) => {
  const c = jointsConfig(model, q);
  return 4 * c[0] + 2 * c[1] + c[2];
};

 
const linf = (a: number[], b: number[]) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - (b[i] ?? 0))), 0);






















function solvePath(
  model: RobotModel,
  apt: AptCol[],
  targets: number[],
  frames: Mat[],
  o: { candidates: number[]; toolOrientation: Mat; tcp: Mat; preferred: number[]; tol: PathTolerances; collides?: (q: number[]) => boolean },
): Solved {
  const n = frames.length;
  const nc = o.candidates.length;
  const out: Solved = { thetas: frames.map(() => o.candidates[0] ?? 0), joints: frames.map(() => null), bad: [], noStart: false };
  if (!n || !nc) return out;
  const tcpInv = inv(o.tcp);
  const turns = o.candidates.map((t) => mul(rotz(t), o.toolOrientation));
  const poseOf = (k: number, c: number) => mul(frames[k], turns[c]);
  const solutions = (fl: Mat) =>
    ikAllDetailed(model, fl, 64, o.preferred)
      .map((s) => s.joints)
      .filter((q) => withinLimits(model, q));
  const solCache = new Map<number, number[][]>();
  const solutionsAt = (k: number, c: number) => {
    const key = k * nc + c;
    let s = solCache.get(key);
    if (!s) {
      s = solutions(mul(poseOf(k, c), tcpInv));
      if (k === 0 || solCache.size < 4096) solCache.set(key, s);
    }
    return s;
  };

   
  let feasible = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7]);
  for (let k = 0; k < n && feasible.size; k++) {
    const reach = new Set<number>();
    for (let c = 0; c < nc; c++) {
      for (const q of solutionsAt(k, c)) reach.add(configOf(model, q));
      if ([...feasible].every((cfg) => reach.has(cfg))) break;
    }
    feasible = new Set([...feasible].filter((cfg) => reach.has(cfg)));
  }
  const prefCfg = o.preferred.length === model.nq ? configOf(model, o.preferred) : -1;
  const cfg = !feasible.size ? -1 : feasible.has(prefCfg) ? prefCfg : Math.min(...feasible);
  let c = cfg < 0 ? 0 : Math.max(0, o.candidates.findIndex((_, x) => solutionsAt(0, x).some((q) => configOf(model, q) === cfg)));

   
  const tried = new Set<number>();
  const untried = (k: number, from: number) => {
    for (let x = from; x < nc; x++) if (!tried.has(k * nc + x) && solutionsAt(k, x).length) return x;
    return -1;
  };
  let q = o.preferred.slice(0, model.nq);
  let prev: Mat | null = null;
  let k = 0;
  while (k < n) {
    if (k === 0) {
       
      tried.add(c);
      let best: number[] | null = null;
      for (const s of solutionsAt(0, c)) if ((cfg < 0 || configOf(model, s) === cfg) && (!best || linf(s, q) < linf(best, q))) best = s;
      if (!best) {
        q = o.preferred.slice(0, model.nq);
        c = untried(0, c);
        if (c < 0) {
          out.noStart = true;
          out.bad = frames.map((_, i) => i);
          return out;
        }
        continue;
      }
      q = best;
      prev = poseOf(0, c);
    }
    const arc = apt[targets[k]][0] === APT.arcVia && k + 1 < n;
    const to = poseOf(k, c);
    const r = arc ? arcCheck(model, q, prev!, to, poseOf(k + 1, c), o.tcp, o.tol) : linearCheck(model, q, prev!, to, o.tcp, o.tol);
    tried.add(k * nc + c);
    if (arc) tried.add((k + 1) * nc + c);
    const last = r.samples[r.samples.length - 1];
    const ok = r.code === 0 && !(o.collides && o.collides(last));
    if (!ok) {
      c = untried(k, c);
      if (c < 0) {
         
        for (let i = k; i < n; i++) out.bad.push(i);
        return out;
      }
      continue;
    }
    if (arc) {
      out.joints[k] = r.samples[Math.round(r.samples.length / 2) - 1].slice();
      out.thetas[k] = o.candidates[c];
      out.joints[k + 1] = last.slice();
      out.thetas[k + 1] = o.candidates[c];
      prev = poseOf(k + 1, c);
      k += 2;
    } else {
      out.joints[k] = last.slice();
      out.thetas[k] = o.candidates[c];
      prev = to;
      k += 1;
    }
    q = last;
    c = 0;
  }
  return out;
}

 

const speedIns = (v: number): InstructionData => ({ kind: "speed", speed: { linear: v, joint: -1, linearAccel: -1, jointAccel: -1 } });
const callIns = (text: string): InstructionData => ({ kind: "code", codeType: 0, text });

 
const fixed = (v: number, digits: number) => v.toFixed(digits);

 
export function planProject(ctx: Ctx, m: MachiningData, opts: { programName?: string; tolerances?: PathTolerances } = {}): ProjectSolution {
  const { ws } = ctx;
  const { robot, frame, tool } = projectLinks(ws, m);
  if (!robot?.robot) throw new MachiningError(MESSAGES.noRobot);
  const warnings: string[] = [];
  const s = m.settings;
  const ev = m.events;
  const apt = projectApt(ctx, m, warnings);
  const targets = targetColumns(apt);
  if (!targets.length) throw new MachiningError(MESSAGES.noInput);

  const model = robot.robot.model;
  const baseAbs = absPose(ws, robot.id);
  const ref = frame ? absPose(ws, frame.id) : childFrame(ws, robot.parent);
  const tcp = tool?.pose ?? eye();
  const pathRel = mul(inv(baseAbs), pathFrameAbs(ws, m));
  const frames = pointFrames(apt, targets, {
    m: mul(pathRel, m.frameOffset ?? eye()),
    pathToTool: m.pathToTool ?? eye(),
    algorithm: num(s.Algorithm),
    orientX: [num(s.OrientXaxis_X, -1), num(s.OrientXaxis_Y), num(s.OrientXaxis_Z)],
    orientX2: [num(s.OrientXaxis2_X, -2), num(s.OrientXaxis2_Y), num(s.OrientXaxis2_Z, 2)],
     
    orientTol: 0.03490658503988659,
     
    follow: {
      angle: on(s.FollowAngleOn) ? num(s.FollowAngle, 45) : 99999,
      step: on(s.FollowStepOn) ? num(s.FollowStep, 90) : 0,
      realign: on(s.FollowRealignOn) ? num(s.FollowRealign, 10) : -1,
    },
  });
  const st = stationOf(ws, robot.id);
  const collides = on(s.AvoidCollisions) && st ? (q: number[]) => checkCollisions(ws, ctx.store, st.id, 0, { [robot.id]: q }).some((pair) => pair.a === robot.id || pair.b === robot.id) : undefined;
  const preferred = m.startJoints?.length === model.nq ? m.startJoints : robot.robot.joints;
  const sol = solvePath(model, apt, targets, frames, {
    candidates: rotZCandidates(num(s.RotZ_Range, 180), num(s.RotZ_Step, 20)),
    toolOrientation: m.toolOrientation ?? eye(),
    tcp,
    preferred,
    tol: opts.tolerances ?? DEFAULT_PATH_TOLERANCES,
    collides,
  });
  const toolOri = m.toolOrientation ?? eye();
   
  const refInv = inv(ref);
  const poses = frames.map((f, k) => mul(refInv, mul(baseAbs, mul(mul(f, rotz(sol.thetas[k])), toolOri))));
  const byColumn = new Map<number, number>(targets.map((c, k) => [c, k]));

   
  const items: PlanItem[] = [];
  const ins = (data: InstructionData) => items.push({ type: "ins", data });
   
   
   
  const anyCase = (text: string, key: string, value: string) => text.replace(new RegExp(key, "gi"), () => value);
  const names = (tpl: string) =>
    anyCase(anyCase(anyCase(anyCase(String(tpl ?? ""), "%REF%", frame?.name ?? "RefUnset"), "%TOOL%", tool?.name ?? "ToolUnset"), "%ROBOT%", robot.name), "%PROGNAME%", opts.programName ?? "");
  const call = (tpl: unknown, value?: number, digits = 0) => {
    let text = names(String(tpl ?? ""));
    if (value !== undefined) text = text.replace(/%1/, fixed(value, digits));
    ins(callIns(text));
  };
  const rapidSpeed = num(s.SpeedRapid, num(ev.RapidSpeed, 1000));
  if (on(ev.CallProgStartOn) && ev.CallProgStart) call(ev.CallProgStart);
  if (on(ev.RoundingOn)) ins({ kind: "rounding", rounding: num(ev.Rounding, 1) });
  let lastSpeed = -999;
  let header = false;
   
   
   
  const move = (k: number, kind: PlannedMove["kind"]): PlannedMove => {
    const q = sol.joints[k];
    return { kind, pose: q ? mul(refInv, mul(baseAbs, mul(fk(model, q), tcp))) : poses[k], joints: q };
  };
  const markerCall: Record<number, [string, string]> = {
    [MARKER.pathStart]: ["CallPathStartOn", "CallPathStart"],
    [MARKER.approach]: ["CallApproachOn", "CallApproach"],
    [MARKER.retract]: ["CallRetractOn", "CallRetract"],
    [MARKER.action]: ["CallActionOn", "CallAction"],
    [MARKER.pathFinish]: ["CallPathFinishOn", "CallPathFinish"],
  };
  for (let c = 0; c < apt.length; c++) {
    const col = apt[c];
    const type = col[0];
    if (type === APT.move || type === APT.arcVia) {
      const k = byColumn.get(c)!;
      if (!header) {
         
        header = true;
        if (frame) ins({ kind: "frame", frame: frame.id });
        if (tool) {
          ins({ kind: "tool", tool: tool.id });
          ins({ kind: "event", event: { action: "show", objects: [tool.id] } });
        }
        if (sol.joints[k]) items.push({ type: "move", move: move(k, "joint") });
      }
      if (type === APT.move) {
        if (sol.joints[k]) items.push({ type: "move", move: move(k, "linear") });
      } else {
        const kEnd = byColumn.get(c + 1);
        if (kEnd !== undefined && sol.joints[k] && sol.joints[kEnd]) items.push({ type: "movec", via: move(k, "linear"), end: move(kEnd, "linear") });
        c++;
      }
      continue;
    }
    if (type === APT.speed) {
      if (col[1] !== lastSpeed) {
        ins(speedIns(col[1] <= 0 ? rapidSpeed : col[1]));
        lastSpeed = col[1];
      }
      continue;
    }
     
    lastSpeed = -999;
    if (type === APT.marker) {
      const mk = markerCall[Math.round(col[1])];
      if (mk && on(ev[mk[0]]) && ev[mk[1]]) call(ev[mk[1]]);
    } else if (type === APT.spindle) {
      if (col[2] < 0 && ev.SpindleCCW) call(ev.SpindleCCW);
      else if (col[2] > 0 && ev.SpindleCW) call(ev.SpindleCW);
      if (ev.SpindleRPM) call(ev.SpindleRPM, col[1], 1);
    } else if (type === APT.toolChange) {
      if (ev.ToolChange) call(ev.ToolChange, col[1], 0);
    } else if (type === APT.io) {
      ioEvent(col, ev, call, ins);
    } else if (type >= 6 && type < 7) {
       
      let text = "";
      let j = c;
      do {
        for (let r = 1; r < 7; r++) if (apt[j][r] > 0) text += String.fromCharCode(Math.trunc(apt[j][r]));
        j++;
      } while (j < apt.length && apt[j][0] === 0);
      c = j - 1;
      textEvent(type, text, ev, names, ins);
    } else if (type === 10) ins({ kind: "pause", pauseMs: col[1] * 1000 });
    else if (type === 11) ins({ kind: "rounding", rounding: col[1] });
    else if (type === 8) ins({ kind: "pause", pauseMs: -1 });
  }
  if (on(ev.CallProgFinishOn) && ev.CallProgFinish) call(ev.CallProgFinish);

  const total = targets.length;
  const okCount = total - sol.bad.length;
  const ratio = total ? okCount / total : 0;
  const message = sol.noStart ? MESSAGES.noStart : sol.bad.length ? MESSAGES.unreachable : MESSAGES.solved;
  return {
    items,
    ok: !sol.bad.length,
    ratio,
    message,
    points: total,
    toolpath: { poses, bad: sol.bad },
    warnings,
    apt,
    rotation: sol.thetas[0] ?? 0,
    rotations: sol.thetas,
  };
}

 
function ioEvent(col: AptCol, ev: MachiningData["events"], call: (tpl: unknown, value?: number, digits?: number) => void, ins: (d: InstructionData) => void) {
  const code = Math.round(col[1]);
  const port = col[2];
  const out = (key: string, value: string) => {
    const tpl = String(ev[key] ?? "default");
    if (tpl.trim() === "default") ins({ kind: "io", io: { mode: "set", name: String(Math.round(port)), value } });
    else if (tpl) call(tpl, port, 0);
  };
  if (code === 4) ins({ kind: "pause", pauseMs: port });
  else if (code === 62) out("IO_OnMotion", "1");
  else if (code === 63) out("IO_OffMotion", "0");
  else if (code === 64) out("IO_On", "1");
  else if (code === 65) out("IO_Off", "0");
  else if (code === 66) ins({ kind: "io", io: { mode: "wait", name: String(Math.round(port)), value: String(Math.round(col[3])), timeoutMs: col[4] > 0 ? col[4] : undefined } });
   
  else if (code === 69 && ev.Extruder) call(ev.Extruder, port, 5);
}

 
function textEvent(type: number, text: string, ev: MachiningData["events"], names: (t: string) => string, ins: (d: InstructionData) => void) {
  const near = (v: number) => Math.abs(type - v) < 0.01;
  if (near(6.0)) ins({ kind: "print", text });
  else if (near(6.1)) ins({ kind: "code", codeType: 3, text });
  else if (near(6.2)) ins({ kind: "code", codeType: 0, text });
  else if (near(6.3)) ins({ kind: "code", codeType: 1, text });
  else if (near(6.4)) {
     
    const words = text.split(" ").filter(Boolean);
    let tpl = names(String(ev.Mcode ?? ""));
    if (tpl.includes("%2")) tpl = tpl.replaceAll("%2", text);
    if (words.length) tpl = tpl.replace(/%1/, words[0]);
    tpl = tpl.replace(/%([A-Za-z])/g, (_, k: string) => words.find((w) => w[0]?.toUpperCase() === k.toUpperCase())?.slice(1) ?? "0");
    ins({ kind: "code", codeType: 0, text: tpl });
  }
}
