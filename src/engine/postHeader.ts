 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { absPose } from "./workspace";
import { inv, mul, type Mat } from "./math";
import type { Item, RobotData, Workspace } from "./types";
import { syncAxes } from "./sync/axes";
import { fk } from "./kinematics";
import { eulerZYX } from "./commands/generate";

 
export function fmtF6(v: number): string {
  const s = v.toFixed(6);
  return (v < 0 || Object.is(v, -0)) && !s.startsWith("-") ? `-${s}` : s;
}

 
export function fmtPoseF6(m: Mat): string {
  const [a, b, c] = eulerZYX(m);
  return `p(${[m[3], m[7], m[11], a, b, c].map(fmtF6).join(",")})`;
}

 
export function ownAxesTypes(rd: RobotData): string[] {
  const out = rd.model.joints.slice(0, rd.model.nq).map((j) => (j.kind === "linear" ? "'L'" : "'R'"));
  while (out.length < rd.model.nq) out.push("'R'");
  return out;
}

 
function cell(rd: RobotData, col: number, row: number): number | undefined {
  const h = rd.header;
  if (!h || h.length < 4) return undefined;
  const rows = Math.round(h[2]) || 20;
  return h[col * rows + row];
}






export function legacyPostId(rd: RobotData): number {
  return cell(rd, 3, 2) ?? 500;
}






export function passesPulses(name: string, rd: RobotData): boolean {
  if (Math.abs(legacyPostId(rd) - 3.4) < 0.5) return true;
  const n = name.toLowerCase();
  return n.includes("motoman") || n.includes("yaskawa") || n.startsWith("gsk") || n.startsWith("epson") || n.startsWith("cloos");
}

 
function pulsesOf(rd: RobotData): number[] {
  return Array.from({ length: rd.model.nq }, (_, j) => cell(rd, 49, j) ?? 0);
}






export function pulsesList(ws: Workspace, robot: Item, warnings: string[]): string {
  const rd = robot.robot!;
  if (!passesPulses(robot.name, rd)) return "";
  const vals = pulsesOf(rd).map(fmtF6);
  const ext: string[] = [];
  let ok = true;
  for (const a of syncAxes(ws, robot)) {
    const p = pulsesOf(a.item.robot!).slice(0, a.nq);
    if (p.some((v) => v === 0)) {
      warnings.push(`Warning! Pulses/degree not properly set for the mechanism: ${a.item.name}`);
      ok = false;
      break;
    }
    ext.push(...p.map(fmtF6));
  }
  if (ok) vals.push(...ext);
  return `[${vals.join(",")}]`;
}





export function railPose(ws: Workspace, robot: Item): Mat | null {
  const rail = syncAxes(ws, robot).find((a) => a.side === "robot");
  if (!rail) return null;
  const end = mul(absPose(ws, rail.item.id), fk(rail.item.robot!.model, rail.item.robot!.joints));
  return mul(inv(end), absPose(ws, robot.id));
}





export function turntablePose(ws: Workspace, robot: Item): Mat | null {
  const axes = syncAxes(ws, robot);
  const table = axes.find((a) => a.side === "part");
  if (!table) return null;
  const rail = axes.find((a) => a.side === "robot");
  const ref = absPose(ws, rail ? rail.item.id : robot.id);
  return mul(inv(ref), absPose(ws, table.item.id));
}

 
export function isPostParam(name: string): boolean {
  return name.toLowerCase().startsWith("post_") && /^[a-zA-Z0-9_]+$/.test(name);
}





export function postParams(params: [string, Uint8Array][]): { pre: string[]; args: string } {
  const use = params.filter(([n]) => isPostParam(n));
  if (!use.length) return { pre: [], args: "" };
  const pre = ["import base64", ...use.map(([n, v]) => `${n} = base64.b64decode(b'${Buffer.from(v).toString("base64")}')`)];
  return { pre, args: use.map(([n]) => `, ${n}=${n}`).join("") };
}

export interface HeaderExtras {
   
  pre: string[];
   
  args: string;
}

 
export function headerExtras(ws: Workspace, robot: Item, opts: { maxLines: number; params?: [string, Uint8Array][]; warnings: string[] }): HeaderExtras {
  let args = "";
  const pulses = pulsesList(ws, robot, opts.warnings);
  if (pulses) args += `, pulses_x_deg=${pulses}`;
  if (opts.maxLines > 0) args += `, lines_x_prog=${Math.trunc(opts.maxLines)}`;
  const synced = (robot.robot?.sync?.length ?? 0) > 0;
  const table = synced ? turntablePose(ws, robot) : null;
  if (table) args += `, pose_turntable=${fmtPoseF6(table)}`;
  const rail = synced ? railPose(ws, robot) : null;
  if (rail) args += `, pose_rail=${fmtPoseF6(rail)}`;
  const pp = postParams(opts.params ?? []);
  return { pre: pp.pre, args: args + pp.args };
}
