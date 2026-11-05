// Defines machining defaults and merges project-specific path settings.
 
 
 
 

import type { MachiningData, MachiningKind } from "../types";
import { APPROACH_KEYWORDS, type ApproachCol } from "./apt";








export const MACHINING_DEFAULTS: Record<string, number> = {
  Algorithm: 0,  
  RotZ_Range: 180,
  RotZ_Step: 20,
  VisibleNormals: 0,
  JoinCurvesTol: 0.5,
  AvoidCollisions: 0,
  AutoUpdate: 1,
  ApproachRetractAll: 1,
  FollowAngle: 45,
  FollowAngleOn: 1,
  FollowRealign: 10,
  FollowRealignOn: 1,
  FollowStep: 90,
  FollowStepOn: 0,
  OrientXaxis_X: -1,
  OrientXaxis_Y: 0,
  OrientXaxis_Z: 0,
  OrientXaxis2_X: -2,
  OrientXaxis2_Y: 0,
  OrientXaxis2_Z: 2,
  PointApproach: 20,
  RapidApproachRetract: 1,
  SpeedRapid: 1000,
  SpeedOperation: 50,
  TurntableActive: 1,
  TurntableOffset: 0,
  TurntableRZcomp: 1,
  TurntableKeepPos: 0,
  TrackActive: 0,
  TrackOffset: 0,
  TrackVector_X: -2,
  TrackVector_Y: -2,
  TrackVector_Z: -2,
   
  OffsetNormalMM: 0,
  OffsetSideMM: 0,
  CutStartMM: 0,
  CutEndMM: 0,
  FlareStartMM: 0,
  FlareEndMM: 0,
  FlareStartDeg: 0,
  FlareEndDeg: 0,
};

 
export const EVENT_DEFAULTS: Record<string, number | string> = {
  CallProgStart: "onStart",
  CallProgStartOn: 0,
  CallPathStart: "onPathStart",
  CallPathStartOn: 0,
  CallPathFinish: "onPathFinish",
  CallPathFinishOn: 0,
  CallApproach: "onApproach",
  CallApproachOn: 0,
  CallAction: "onPoint",
  CallActionOn: 0,
  CallRetract: "onRetract",
  CallRetractOn: 0,
  CallProgFinish: "onFinish",
  CallProgFinishOn: 0,
  SpindleRPM: "SetRPM(%1)",
  SpindleCW: "",
  SpindleCCW: "",
  ToolChange: "SetTool(%1)",
  Extruder: "Extruder(%1)",
  IO_On: "default",
  IO_Off: "default",
  Mcode: "M_RunCode(%1)",
  IO_OnMotion: "OutOnMov(%1)",
  IO_OffMotion: "OutOffMov(%1)",
  RoundingOn: 0,
  Rounding: 1,
  RapidSpeed: 1000,
};

 
export const OPTIM_DEFAULTS: Record<string, number> = { Tol: 0.5 };

 
export const DEFAULT_APPROACH = "Normal 100";

 
export interface ProjectDefaults {
  machining?: Record<string, number | string | boolean>;
  progEvents?: Record<string, number | string | boolean>;
  approach?: string;
  retract?: string;
}

 
export function savedDefaults(value: unknown): ProjectDefaults {
  if (typeof value !== "string" || !value) return {};
  try {
    const d = JSON.parse(value) as unknown;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as ProjectDefaults) : {};
  } catch {
    return {};
  }
}

export function newMachining(kind: MachiningKind, robot: string | null, settings: Record<string, number | string | boolean> = {}, saved: ProjectDefaults = {}): MachiningData {
  const s: Record<string, number | string | boolean> = { ...MACHINING_DEFAULTS, ...saved.machining, ...settings };
  const events: Record<string, number | string | boolean> = { ...EVENT_DEFAULTS, ...saved.progEvents };
  if (kind === "weld") {
     
    Object.assign(events, { CallPathStart: "ArcStart", CallPathStartOn: 1, CallPathFinish: "ArcEnd", CallPathFinishOn: 1 });
  }
  return { kind, robot, frame: null, tool: null, settings: s, events, optimAxes: { ...OPTIM_DEFAULTS }, approach: saved.approach ?? DEFAULT_APPROACH, retract: saved.retract ?? DEFAULT_APPROACH, input: null, pathToTool: null, program: null, result: null, toolpath: null };
}






export function projectName(kind: MachiningKind, count: number): string {
  switch (kind) {
    case "machining":
      return `Machining${count} settings`;
    case "curve":
      return `Path${count} settings`;
    case "weld":
      return `Weld${count} settings`;
    case "point":
      return "Point settings";
    case "print3d":
      return "Print3D settings";
  }
}

 
export function programName(project: string): string {
  const m = /^(.*?)[ _]settings$/i.exec(project);
  const base = m ? m[1] : project;
  return base.trim() ? base : project;
}

 
export function ncProjectNames(fileName: string): { project: string; program: string } {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const clean = base.replace(/[ -]/g, "_").replace(/__+/g, "_");
  return { project: `${clean} Settings`, program: clean };
}










export function parseApproach(spec: string): ApproachCol[] {
  const out: ApproachCol[] = [];
  for (const part of String(spec ?? "").split(/[;\n]/)) {
    const text = part.trim();
    if (!text || /^none$/i.test(text)) continue;
    const tokens = text.split(/[\s,\t]+/).filter(Boolean);
    const lower = text.toLowerCase();
    const kw = APPROACH_KEYWORDS.find(([word]) => lower.includes(word.toLowerCase()));
    const numbers = tokens.map(Number).filter((v) => Number.isFinite(v));
    let code: number;
    let values: number[];
    if (kw) {
      code = kw[1];
      values = numbers;
    } else if (/^-?\d+(\.\d+)?$/.test(tokens[0])) {
      code = Number(tokens[0]);
      values = numbers.slice(1);
    } else throw new Error(`Unknown: ${text}`);
    out.push([code, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0]);
  }
  return out;
}

 
export function mergeParams(base: Record<string, number | string | boolean>, value: unknown): Record<string, number | string | boolean> {
  const obj = typeof value === "string" ? (value.trim() ? (JSON.parse(value) as Record<string, unknown>) : {}) : (value as Record<string, unknown>) ?? {};
  const out = { ...base };
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

export const num = (v: number | string | boolean | undefined, d = 0): number => {
  const n = typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
  return Number.isFinite(n) ? n : d;
};
export const on = (v: number | string | boolean | undefined) => num(v) !== 0;
