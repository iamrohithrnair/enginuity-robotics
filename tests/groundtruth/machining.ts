 
 
 
 
 
 
 
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { fk, parseRdkFile } from "@/engine/kinematics";
import { matrixColumns, type RdkMatrix } from "@/engine/commands/rdk";
import { pathFrameItem, projectApt, projectLinks } from "@/engine/machining/project";
import type { AptCol } from "@/engine/machining/apt";
import { inv, mul, type Mat } from "@/engine/math";
import type { Item, MachiningKind, Workspace } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import { engine } from "../helpers";
import { STATIONS_DIR } from "./groundtruth";

 
export const EXACT_MM = 1e-5;
 
export const EXACT_DEG = 1e-4;

export interface ProjectReport {
  station: string;
  project: string;
  kind: MachiningKind;
  algorithm: number;
  approach: string;
  retract: string;
   
  apt: "exact" | "differs" | "none";
  aptNote?: string;
   
  storedMoves: number;
  ourMoves: number;
   
  sameMotions: boolean;
   
  rms: number | null;
  max: number | null;
  rotMax: number | null;
  




  fkMax: number | null;
  fkRotMax: number | null;
   
  stale: boolean;
   
  restored?: string;
   
  names: { stored: number; ours: number; same: boolean; first?: string };
  ratio?: number;
  message?: string;
  status: "pass" | "positions" | "fail" | "no-program" | "error";
  reason?: string;
}

const isMotion = (it: Item) => it.instruction?.kind === "move" || it.instruction?.kind === "movec";

interface Motion {
  type: "J" | "L" | "C";
  poses: Mat[];
}

function motions(ws: Workspace, prog: string): Motion[] {
  return ws.items[prog].children
    .map((c) => ws.items[c])
    .filter(isMotion)
    .map((it) => {
      const d = it.instruction!;
      if (d.kind === "movec") return { type: "C" as const, poses: [d.pose, d.pose2].filter((p): p is Mat => !!p) };
      return { type: d.moveType === "joint" ? ("J" as const) : ("L" as const), poses: d.pose ? [d.pose] : [] };
    });
}





export function rigidFit(a: number[][], b: number[][]): { R: number[][]; rms: number; max: number } {
  const n = a.length;
  const ca = [0, 1, 2].map((k) => a.reduce((s, p) => s + p[k], 0) / n);
  const cb = [0, 1, 2].map((k) => b.reduce((s, p) => s + p[k], 0) / n);
  const S = [0, 1, 2].map((i) => [0, 1, 2].map((j) => b.reduce((s, p, k) => s + (p[i] - cb[i]) * (a[k][j] - ca[j]), 0)));
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
   
  const A = N.map((r) => r.slice());
  const V: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] * A[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (A[i][i] > A[best][best]) best = i;
  const [w, x, y, z] = [V[0][best], V[1][best], V[2][best], V[3][best]];
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  let ss = 0;
  let max = 0;
  for (let k = 0; k < n; k++) {
    let e2 = 0;
    for (let i = 0; i < 3; i++) e2 += (R[i][0] * (b[k][0] - cb[0]) + R[i][1] * (b[k][1] - cb[1]) + R[i][2] * (b[k][2] - cb[2]) - (a[k][i] - ca[i])) ** 2;
    ss += e2;
    max = Math.max(max, Math.sqrt(e2));
  }
  return { R, rms: Math.sqrt(ss / n), max };
}

 
function rotationGap(a: Mat[], b: Mat[], R: number[][]): number {
  let worst = 0;
  for (let k = 0; k < a.length; k++) {
     
    let tr = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let rb = 0;
        for (let l = 0; l < 3; l++) rb += R[i][l] * b[k][l * 4 + j];
        tr += a[k][i * 4 + j] * rb;
      }
    }
    worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * 180) / Math.PI);
  }
  return worst;
}

 
function poseRxyz(c: number[]): Mat {
  const [x, y, z, r, p, w] = c.slice(1, 7);
  const [cr, sr, cp, sp, cw, sw] = [Math.cos(r), Math.sin(r), Math.cos(p), Math.sin(p), Math.cos(w), Math.sin(w)];
  return [cp * cw, -cp * sw, sp, x, cr * sw + sr * sp * cw, cr * cw - sr * sp * sw, -sr * cp, y, sr * sw - cr * sp * cw, sr * cw + cr * sp * sw, cr * cp, z, 0, 0, 0, 1];
}

 
function compareApt(ours: AptCol[], stored: AptCol[]): { same: boolean; note?: string } {
  const n = Math.max(ours.length, stored.length);
  for (let c = 0; c < n; c++) {
    const a = ours[c];
    const b = stored[c];
    if (!a || !b || a[0] !== b[0]) return { same: false, note: `column ${c}: ours ${a ? a[0] : "-"} stored ${b ? b[0] : "-"} (${ours.length} / ${stored.length} columns)` };
    const rows = a[0] === 7 || a[0] === 100 ? 2 : 7;
    for (let r = 1; r < rows; r++) if (Math.abs(a[r] - b[r]) > 1e-6) return { same: false, note: `column ${c} row ${r}: ${a[r]} vs ${b[r]}` };
  }
  return { same: true };
}

 
function reasonOf(m: { algorithm: number; robotRows: number; nq: number; hasInput: boolean; storedProgram: boolean; stale: boolean }): string | undefined {
  if (!m.storedProgram) return "no stored program";
  if (m.stale) return "the stored program is older than the stored APT path (more moves than the path)";
  if (!m.hasInput) return "no input (no object, curves or APT path)";
  if (m.algorithm >= 2) return "robot holds the object (Algorithm 2/3) is not implemented";
  if (m.robotRows > 1 + m.nq) return "synchronized external axes (turntable / rail optimisation) are not implemented";
  return undefined;
}

 
function poseGap(a: Mat, b: Mat): [number, number] {
  const d = mul(inv(a), b);
  return [Math.hypot(d[3], d[7], d[11]), (Math.acos(Math.min(1, Math.max(-1, (d[0] + d[5] + d[10] - 1) / 2))) * 180) / Math.PI];
}

 
async function restoreSolveState(e: Awaited<ReturnType<typeof engine>>, project: Item, rp: number[][]): Promise<string | undefined> {
  const ws = e.ws;
  const m = project.machining!;
  const { robot, tool } = projectLinks(ws, m);
  const c4 = rp.find((c) => c[0] === 4);
  const c5 = rp.find((c) => c[0] === 5);
  if (!robot) return undefined;
  const notes: string[] = [];
  const item = pathFrameItem(ws, m);
  if (c4 && item && item.parent) {
    const want = mul(absPose(ws, robot.id), poseRxyz(c4));
    const [mm, deg] = poseGap(absPose(ws, item.id), want);
    if (mm > 1e-9 || deg > 1e-9) {
      await e.run("item.setPose", { item: item.id, pose: mul(inv(absPose(ws, item.parent)), want) });
      notes.push(`path frame ${mm.toPrecision(3)} mm ${deg.toPrecision(3)} deg`);
    }
  }
  if (c5 && tool) {
    const want = poseRxyz(c5);
    const [mm, deg] = poseGap(tool.pose ?? want, want);
    if (mm > 1e-9 || deg > 1e-9) {
      await e.run("item.setPose", { item: tool.id, pose: want });
      notes.push(`TCP ${mm.toPrecision(3)} mm ${deg.toPrecision(3)} deg`);
    }
  }
  return notes.length ? notes.join(", ") : undefined;
}

export async function analyzeMachiningStation(file: string): Promise<ProjectReport[]> {
  const bytes = new Uint8Array(readFileSync(path.join(STATIONS_DIR, file)));
  const parsed = parseRdkFile(bytes);
  type Src = { kind: string; name: string; apt_path?: RdkMatrix; robot_path?: RdkMatrix; program?: number };
  const sources = (parsed.json as unknown as { items: Src[] }).items.filter((i) => i.kind === "machining");
  if (!sources.length) return [];
  const e = await engine();
  await e.run("station.openRdk", { base64: Buffer.from(bytes).toString("base64") });
  const ws = e.ws;
  const out: ProjectReport[] = [];
  for (const src of sources) {
    const item = Object.values(ws.items).find((i) => i.type === "machining" && i.name === src.name);
    if (!item?.machining) continue;
    const m = item.machining;
    const algorithm = Number(m.settings.Algorithm ?? 0);
    const rep: ProjectReport = {
      station: file,
      project: src.name,
      kind: m.kind,
      algorithm,
      approach: m.approach,
      retract: m.retract,
      apt: "none",
      storedMoves: 0,
      ourMoves: 0,
      sameMotions: false,
      rms: null,
      max: null,
      rotMax: null,
      fkMax: null,
      fkRotMax: null,
      stale: false,
      names: { stored: 0, ours: 0, same: false },
      status: "no-program",
    };
     
    const storedApt = matrixColumns(parsed.floats, src.apt_path);
    let hasInput = false;
    try {
      const ours = projectApt({ ws, store: e.services.geometry }, m);
      hasInput = true;
      if (storedApt.length) {
        const c = compareApt(ours, storedApt);
        rep.apt = c.same ? "exact" : "differs";
        if (c.note) rep.aptNote = c.note;
      }
    } catch (err) {
      rep.aptNote = (err as Error).message;
    }
    const robot = m.robot ? ws.items[m.robot] : undefined;
    const rp = matrixColumns(parsed.floats, src.robot_path);
    const motionCount = (cols: number[][]) => cols.filter((c) => c[0] === 2 || c[0] === 9).length;
    rep.stale = !!storedApt.length && motionCount(rp) > motionCount(storedApt) + 1;
    const reason = reasonOf({ algorithm, robotRows: rp[0]?.length ?? 0, nq: robot?.robot?.model.nq ?? 6, hasInput, storedProgram: !!m.program && !!ws.items[m.program], stale: rep.stale });
    if (!m.program || !ws.items[m.program]) {
      rep.reason = reason;
      out.push(rep);
      continue;
    }
     
    const storedNames = ws.items[m.program].children.map((c) => ws.items[c].name);
    const stored = motions(ws, m.program);
    rep.storedMoves = stored.length;
     
     
     
     
     
    if ((rp[0]?.length ?? 0) <= 1 + (robot?.robot?.model.nq ?? 6)) rep.restored = await restoreSolveState(e, item, rp);
    try {
      const r = (await e.run("machining.update", { project: item.id })) as unknown as { ratio: number; message: string };
      rep.ratio = r.ratio;
      rep.message = r.message;
    } catch (err) {
      rep.status = "error";
      rep.message = (err as Error).message;
      rep.reason = reason ?? "error";
      out.push(rep);
      continue;
    }
    const prog = ws.items[item.machining!.program!] ? item.machining!.program! : m.program;
    const ours = motions(ws, ws.items[item.id].machining!.program ?? prog);
    const ourNames = ws.items[ws.items[item.id].machining!.program ?? prog].children.map((c) => ws.items[c].name);
    rep.ourMoves = ours.length;
    rep.sameMotions = ours.length === stored.length && ours.every((o, k) => o.type === stored[k].type && o.poses.length === stored[k].poses.length);
    rep.names.stored = storedNames.length;
    rep.names.ours = ourNames.length;
    const firstName = storedNames.findIndex((n, k) => n !== ourNames[k]);
    rep.names.same = storedNames.length === ourNames.length && firstName < 0;
    if (!rep.names.same) {
      const k = firstName < 0 ? Math.min(storedNames.length, ourNames.length) : firstName;
      rep.names.first = `#${k}: stored "${storedNames[k] ?? "-"}" ours "${ourNames[k] ?? "-"}"`;
    }
    if (rep.sameMotions && stored.length >= 3) {
      const a = stored.flatMap((s) => s.poses);
      const b = ours.flatMap((s) => s.poses);
      const fit = rigidFit(
        a.map((p) => [p[3], p[7], p[11]]),
        b.map((p) => [p[3], p[7], p[11]]),
      );
      rep.rms = fit.rms;
      rep.max = fit.max;
      rep.rotMax = rotationGap(a, b, fit.R);
    }
    const model = robot?.robot?.model;
    if (rep.sameMotions && stored.length >= 3 && model && rp.length && rp[0].length === 1 + model.nq) {
       
      const t5 = rp.find((c) => c[0] === 5);
      const tcp = t5 ? poseRxyz(t5) : null;
      const poses: Mat[] = [];
       
       
      for (let i = 0; tcp && i < rp.length; i++) {
        const c = rp[i];
        if (c[0] === 1 || c[0] === 2) poses.push(mul(fk(model, c.slice(1, 1 + model.nq)), tcp));
        else if (c[0] === 9 && i + 1 < rp.length) {
          poses.push(mul(fk(model, c.slice(1, 1 + model.nq)), tcp), mul(fk(model, rp[i + 1].slice(1, 1 + model.nq)), tcp));
          i++;
        }
      }
      const b = ours.flatMap((o) => o.poses);
      if (poses.length === b.length) {
        const fit = rigidFit(
          poses.map((p) => [p[3], p[7], p[11]]),
          b.map((p) => [p[3], p[7], p[11]]),
        );
        rep.fkMax = fit.max;
        rep.fkRotMax = rotationGap(poses, b, fit.R);
      }
    }
    const exact = (max: number | null, rot: number | null) => max !== null && rot !== null && max < EXACT_MM && rot < EXACT_DEG;
    const posOk = rep.sameMotions && ((rep.max !== null && rep.max < EXACT_MM) || (rep.fkMax !== null && rep.fkMax < EXACT_MM));
    rep.status = exact(rep.max, rep.rotMax) || exact(rep.fkMax, rep.fkRotMax) ? "pass" : posOk ? "positions" : "fail";
    if (rep.status !== "pass") rep.reason = reason;
    out.push(rep);
  }
  return out;
}
