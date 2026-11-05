// Builds program intermediates and invokes robot post-processors.
 
 
 
 
 
 
 
 

import { z } from "zod";
import { fk, ikClosest, ikTrack, jointsConfig } from "../kinematics";
import { SyncPost } from "../sync/post";
import { headerExtras, ownAxesTypes } from "../postHeader";
import { postFileName, storedPostName } from "../posts";
import { postAvailable, postPickFor } from "./posts";
import { isSynced } from "../sync/plan";
import { eye, interpolatePose, inv, mul, type Mat } from "../math";
import { CommandError, defineCommand, getCommand, ItemRef, status, type CmdCtx, type Services } from "../registry";
import type { InstructionData, Item, Workspace } from "../types";
import { absPose, childFrame, descendants, stationOf, toolPose } from "../workspace";
import { decisionPostComment } from "../decisions";
import { requireRef } from "../dispatch";
import { requireProgram } from "./programs";

export const GENERATOR_NAME = "Enginuity";
export const GENERATOR_VERSION = "1.0.0";

 
export interface GenSettings {
   
  maxDecimals: number;
   
  moveJType: number;
  moveLType: number;
  moveCType: number;
   
  moveNames: boolean;
   
  recalc: boolean;
   
  maxLines: number;
   
  inline: boolean;
  inlineDepth: number;
   
  splitMM: number;
   
  splitMinMM: number;
}

const num = (v: unknown, dflt: number) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? dflt : Number(v));
const flag = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

export function generationSettings(settings: Services["settings"]): GenSettings {
  return {
    maxDecimals: num(settings.MaxDecimalsPost ?? settings.MAX_DECIMALS_POST, 6),
    moveJType: num(settings.ProgMoveJType, 0),
    moveLType: num(settings.ProgMoveLType, 0),
    moveCType: num(settings.ProgMoveCType, 0),
    moveNames: flag(settings.ProgMoveNames),
    recalc: flag(settings.ProgRecalc),
    maxLines: num(settings.ProgMaxLines, -1),
    inline: flag(settings.ProgInlineSubprogs ?? settings.Prog_InlineSubPrograms),
    inlineDepth: num(settings.Prog_InlineSubProgramDepth, 99),
    splitMM: num(settings.MoveLSplitMM ?? settings.MoveL_Split_MM, -1),
    splitMinMM: num(settings.MoveLSplitMinMM ?? settings.MoveL_Split_MM_Min, 0.005),
  };
}

 

 
export function fmtG(v: number, precision = 6): string {
  const p = Math.max(1, Math.floor(precision));
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  if (v === 0) return Object.is(v, -0) ? "-0" : "0";
  const exp = v.toExponential(p - 1);
  const x = Number(exp.slice(exp.indexOf("e") + 1));
  const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (x < -4 || x >= p) {
    const [mant, e] = exp.split("e");
    const digits = e.replace(/^[+-]/, "");
    return `${trim(mant)}e${e[0] === "-" ? "-" : "+"}${digits.padStart(2, "0")}`;
  }
  return trim(v.toFixed(p - 1 - x));
}

 
export function fmtValue(v: number, precision: number, clampTiny = true): string {
  if (clampTiny && Math.abs(v) < 5e-7) return "0";
  return fmtG(v, precision);
}

 
export function eulerZYX(m: Mat): [number, number, number] {
  let rx: number, ry: number, rz: number;
  if (m[8] > 1 - 1e-10) {
    ry = -Math.PI / 2;
    rz = 0;
    rx = Math.atan2(-m[6], m[5]);
  } else if (m[8] < -1 + 1e-10) {
    ry = Math.PI / 2;
    rz = 0;
    rx = Math.atan2(m[6], m[5]);
  } else {
    ry = Math.atan2(-m[8], Math.sqrt(m[0] * m[0] + m[4] * m[4]));
    rz = Math.atan2(m[4], m[0]);
    rx = Math.atan2(m[9], m[10]);
  }
  return [(rz * 180) / Math.PI, (ry * 180) / Math.PI, (rx * 180) / Math.PI];
}

 
export function fmtPose(m: Mat, precision: number): string {
  const [a, b, c] = eulerZYX(m);
  return `p(${[m[3], m[7], m[11], a, b, c].map((v) => fmtValue(v, precision)).join(",")})`;
}

 
export function fmtJoints(q: number[], precision: number): string {
  return `[${q.map((v, i) => fmtValue(v, precision, i < q.length - 1)).join(",")}]`;
}

 
export function poseFromP(x: number, y: number, z: number, a: number, b: number, c: number): Mat {
  const [ra, rb, rc] = [(a * Math.PI) / 180, (b * Math.PI) / 180, (c * Math.PI) / 180];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(ra), Math.sin(ra), Math.cos(rb), Math.sin(rb), Math.cos(rc), Math.sin(rc)];
  return [cb * ca, ca * sc * sb - cc * sa, sc * sa + cc * ca * sb, x, cb * sa, cc * ca + sc * sb * sa, cc * sb * sa - ca * sc, y, -sb, cb * sc, cc * cb, z, 0, 0, 0, 1];
}





export function pyStr(s: string): string {
  if (!s.includes('"""') && !s.endsWith('"') && !s.endsWith("\\")) return `r"""${s}"""`;
  return JSON.stringify(s);
}

 
function pyIoVar(name: string): string {
  const m = /^(?:IO_|AO_)?(\d+)$/.exec(name.trim());
  if (m) return String(Number(m[1]));
  return `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
}

 
function pyIoValue(value: string): string {
  return /^-?\d+$/.test(value.trim()) ? String(Number(value.trim())) : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const f3 = (v: number) => v.toFixed(3);

 
export const sanitizeProgramName = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, "");

function stamp(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

 

export interface Intermediate {
   
  text: string;
  post: string;
   
  program: string;
  robot: string;
   
  total: number;
   
  programs: string[];
  warnings: string[];
}

export interface IntermediateOptions {
  settings: GenSettings;
  post?: string;
  date?: Date;
  apiPort?: number;
  folder?: string;
   
  postParams?: [string, Uint8Array][];
}

 
export function buildIntermediate(ws: Workspace, progId: string, opts: IntermediateOptions): Intermediate {
  const prog = ws.items[progId];
  const robot = prog?.program?.robot ? ws.items[prog.program.robot] : undefined;
  if (!robot?.robot) throw new CommandError("Invalid robot for program");
  const rd = robot.robot;
  const s = opts.settings;
  const P = s.maxDecimals;
  const post = (opts.post ?? rd.postProcessor ?? "").replace(/\.py$/i, "");
  const station = stationOf(ws, progId)?.id;
  const programsByName = new Map<string, Item>();
  for (const it of station ? descendants(ws, station) : []) if (it.type === "program" && !programsByName.has(it.name)) programsByName.set(it.name, it);

  const robotAbs = absPose(ws, robot.id);
   
  const sync = isSynced(ws, robot) ? new SyncPost(ws, robot) : null;
  const out: string[] = [];
  const warnings: string[] = [];
  let total = 0;
  let lastFrame: string | null = null;
  let tool: Mat = toolPose(ws, robot.id);
   
  let curFrame: Mat = sync ? sync.frame() : rd.activeFrame && ws.items[rd.activeFrame] ? mul(inv(robotAbs), absPose(ws, rd.activeFrame)) : eye();
   
  const inFrame = (abs: Mat, q?: number[]): Mat => (sync ? sync.inFrame(abs, curFrame, q) : mul(inv(curFrame), mul(inv(robotAbs), abs)));
  const queue: Item[] = [];
  const queued = new Set<string>([progId]);
  const confOf = (q: number[]) => `[${jointsConfig(rd.model, q).slice(0, 3).map((v) => (v ? 1 : 0)).join(",")}]`;

   
  const targetJoints = (t: Item): number[] => {
    if (sync) return sync.joints(t.target?.joints);
    const stored = t.target?.joints?.length ? t.target.joints.slice() : rd.joints.slice();
    if (!s.recalc || t.target?.isJoint) return stored;
    const flange = mul(mul(inv(robotAbs), absPose(ws, t.id)), inv(tool));
    return ikClosest(rd.model, flange, stored) ?? stored;
  };

   
  let prevJoints: number[] = sync ? sync.joints() : rd.joints.slice();

  




  const emitSplitMoveL = (item: Item, t: Item): boolean => {
    if (!(s.splitMM > 0) || !t.parent || sync) return false;
    const frameAbs = childFrame(ws, t.parent);
    const prevTcpAbs = mul(mul(robotAbs, fk(rd.model, prevJoints)), tool);
    const from = mul(inv(frameAbs), prevTcpAbs);
    const to = t.pose;
    const d = Math.hypot(to[3] - from[3], to[7] - from[7], to[11] - from[11]);
    if (d <= s.splitMM || d < s.splitMinMM) return false;
    const n = Math.ceil(d / s.splitMM);
    const parent = item.parent ? ws.items[item.parent] : undefined;
    const index = parent ? parent.children.indexOf(item.id) : 0;
    out.push(`r.RunMessage(${pyStr(`Splitting Linear movement in ${n} (instruction ${index}: ${item.name})`)},True)`);
    let q = prevJoints.slice();
    for (let k = 1; k <= n; k++) {
      const pose = interpolatePose(from, to, k / n);
      const flange = mul(mul(inv(robotAbs), mul(frameAbs, pose)), inv(tool));
      q = ikTrack(rd.model, flange, q) ?? ikClosest(rd.model, flange, q) ?? q;
      out.push(`r.MoveL(${fmtPose(pose, P)},${fmtJoints(q, P)},${confOf(q)})`);
      total += 1;
    }
    prevJoints = q;
    return true;
  };

  const emitMove = (item: Item, ins: InstructionData) => {
    if (ins.kind === "movec") {
      const via = ins.target ? ws.items[ins.target] : undefined;
      const end = ins.target2 ? ws.items[ins.target2] : undefined;
      if (!ins.target && !ins.target2 && ins.pose && ins.pose2) {
         
        const q1 = ikClosest(rd.model, mul(mul(inv(robotAbs), ins.pose), inv(tool)), prevJoints) ?? prevJoints;
        const q2 = ikClosest(rd.model, mul(mul(inv(robotAbs), ins.pose2), inv(tool)), q1) ?? q1;
        const [p1, p2] = s.moveCType === 1 ? ["None", "None"] : [fmtPose(inFrame(ins.pose), P), fmtPose(inFrame(ins.pose2), P)];
        out.push(`r.MoveC(${p1},${fmtJoints(q1, P)},${p2},${fmtJoints(q2, P)},${confOf(q1)},${confOf(q2)})`);
        total += 1;
        prevJoints = q2;
        return;
      }
      if (!via || !end) throw new CommandError(`Target at instruction ${item.name} has been deleted`);
      const [j1, j2] = [targetJoints(via), targetJoints(end)];
      if (s.moveNames) out.push(`r._TargetNameVia=${pyStr(via.name)}`, `r._TargetName=${pyStr(end.name)}`);
      const [p1, p2] = s.moveCType === 1 ? ["None", "None"] : [fmtPose(via.pose, P), fmtPose(end.pose, P)];
      out.push(`r.MoveC(${p1},${fmtJoints(j1, P)},${p2},${fmtJoints(j2, P)},${confOf(j1)},${confOf(j2)})`);
      total += 1;
      prevJoints = j2;
      return;
    }
    const linear = ins.moveType === "linear" || ins.moveType === "search";
    const fn = linear ? "MoveL" : "MoveJ";
    const type = linear ? s.moveLType : s.moveJType;
    let joints: number[];
    let pose: Mat | null;
    let isJoint: boolean;
    let name: string | null = null;
    if (ins.target) {
      const t = ws.items[ins.target];
      if (!t?.target) throw new CommandError(`Target at instruction ${item.name} has been deleted`);
      if (linear && type !== 1 && !t.target.isJoint && emitSplitMoveL(item, t)) return;
      joints = targetJoints(t);
      pose = t.pose;
      isJoint = !!t.target.isJoint;
      name = t.name;
    } else {
       
      joints = sync ? sync.joints(ins.joints ?? ins.refJoints) : ins.joints?.slice() ?? rd.joints.slice();
      pose = ins.pose ? inFrame(ins.pose, ins.refJoints) : null;
      isJoint = !ins.pose;
    }
    if (s.moveNames && name !== null) out.push(`r._TargetName=${pyStr(name)}`);
    const jointOnly = type === 1 || (type === 0 && isJoint) || !pose;
    if (jointOnly) out.push(`r.${fn}(None,${fmtJoints(joints, P)},None)`);
    else out.push(`r.${fn}(${fmtPose(pose!, P)},${fmtJoints(joints, P)},${confOf(joints)})`);
    total += 1;
    prevJoints = joints;
  };

  const emitInstructions = (p: Item, depth: number, stack: Set<string>) => {
    for (const c of p.children) {
      const item = ws.items[c];
      const ins = item?.instruction;
      if (!ins) continue;
      switch (ins.kind) {
        case "move":
        case "movec":
          emitMove(item, ins);
          break;
        case "frame": {
          const f = ins.frame ? ws.items[ins.frame] : undefined;
           
          const pose = f && !(ins.forcePose && ins.pose) ? (sync ? sync.frameOf(f.id) : mul(inv(robotAbs), absPose(ws, f.id))) : ins.pose ?? eye();
          curFrame = pose;
          const line = `r.setFrame(${fmtPose(pose, P)},-1,${pyStr(f?.name ?? "")})`;
          if (line !== lastFrame) out.push(line);
          lastFrame = line;
          break;
        }
        case "tool": {
          const t = ins.tool ? ws.items[ins.tool] : undefined;
          tool = (t && !(ins.forcePose && ins.pose) ? t.pose : ins.pose) ?? t?.pose ?? eye();
          out.push(`r.setTool(${fmtPose(tool, P)},-1,${pyStr(t?.name ?? "")})`);
          break;
        }
        case "speed": {
          const sp = ins.speed;
          if (!sp) break;
          const set = [sp.jointAccel, sp.joint, sp.linearAccel, sp.linear].filter((v) => v >= 0).length;
          if (set === 1 && sp.linear >= 0) out.push(`r.setSpeed(${f3(sp.linear)})`);
          else {
            if (sp.jointAccel >= 0) out.push(`r.setAccelerationJoints(${f3(sp.jointAccel)})`);
            if (sp.joint >= 0) out.push(`r.setSpeedJoints(${f3(sp.joint)})`);
            if (sp.linearAccel >= 0) out.push(`r.setAcceleration(${f3(sp.linearAccel)})`);
            if (sp.linear >= 0) out.push(`r.setSpeed(${f3(sp.linear)})`);
          }
          break;
        }
        case "rounding":
          out.push(`r.setZoneData(${f3(ins.rounding ?? -1)})`);
          break;
        case "pause":
          out.push(`r.Pause(${(ins.pauseMs ?? -1).toFixed(1)})`);
          break;
        case "print":
          out.push(`r.RunMessage(${pyStr(ins.text ?? item.name)})`);
          break;
        case "code": {
          const text = ins.text ?? item.name;
          const type = ins.codeType ?? 1;
          if (type === 3) out.push(`r.RunMessage(${pyStr(text)},True)`);
          else if (type === 4) out.push(`r.RunMessage(${pyStr(text)})`);
          else if (type === 0) {
            const callee = programsByName.get(text);
            if (callee && s.inline && depth < s.inlineDepth && !stack.has(callee.id)) {
               
              stack.add(callee.id);
              emitInstructions(callee, depth + 1, stack);
              stack.delete(callee.id);
            } else {
              if (callee && stack.has(callee.id) && s.inline) warnings.push(`Recursive call detected!! ${text}`);
              out.push(`r.RunCode(${pyStr(text)}, True)`);
              total += 1;
              if (callee && !queued.has(callee.id)) {
                queued.add(callee.id);
                queue.push(callee);
              }
            }
          } else {
            out.push(`r.RunCode(${pyStr(text)})`);
            total += 1;
          }
          break;
        }
        case "io": {
          const io = ins.io;
          if (!io) break;
          if (io.mode === "wait") {
            const t = io.timeoutMs !== undefined && io.timeoutMs > 0 ? Math.trunc(io.timeoutMs) : -1;
            out.push(`r.waitDI(${pyIoVar(io.name)},${pyIoValue(io.value)},${t})`);
          } else if (io.analog) out.push(`r.setAO(${pyIoVar(io.name)},'${io.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')`);
          else out.push(`r.setDO(${pyIoVar(io.name)},${pyIoValue(io.value)})`);
          break;
        }
         
        case "decision":
          out.push(`r.RunMessage(${pyStr(decisionPostComment(item))},True)`);
          break;
         
         
        default:
          break;
      }
    }
  };

  const name = sanitizeProgramName(prog.name);
  const date = opts.date ?? new Date();
  const programs = [name];
  out.push(`r.ProgStart(${pyStr(name)})`);
  out.push(`r.RunMessage(${pyStr(`Program generated by ${GENERATOR_NAME} v${GENERATOR_VERSION} for ${robot.name} on ${stamp(date)}`)},True)`);
  out.push(`r.RunMessage(${pyStr("Using nominal kinematics.")},True)`);
  emitInstructions(prog, 0, new Set([progId]));
  out.push(`r.ProgFinish(${pyStr(name)})`);
  for (let i = 0; i < queue.length; i++) {
    const sub = queue[i];
    const subName = sanitizeProgramName(sub.name);
    programs.push(subName);
    out.push(`r.ProgStart(${pyStr(subName)})`);
    emitInstructions(sub, 0, new Set([sub.id]));
    out.push(`r.ProgFinish(${pyStr(subName)})`);
  }
  out.push(`r.ProgSave(${pyStr(opts.folder ?? "")},${pyStr(name)},False,False)`);

   
  const axes: string[] = ownAxesTypes(rd);
  if (sync) axes.push(...sync.extTypes());
  const extras = headerExtras(ws, robot, { maxLines: s.maxLines, params: opts.postParams, warnings });
  const ip = robot.params?.ip ?? robot.params?.IP ?? "127.0.0.1";
  const ctor =
    `r = RobotPost(${pyStr(post)},${pyStr(robot.name)},${sync ? sync.axes : rd.model.nq}, axes_type=[${axes.join(",")}], native_name=${pyStr(rd.nativeName || robot.name)}, ` +
    `ip_com=${pyStr(ip)}, api_port=${opts.apiPort ?? 20500}, prog_ptr=${prog.handle}, robot_ptr=${robot.handle}${extras.args})`;
  const header = [
    `# ${GENERATOR_NAME} Python Intermediate file to generate robot programs.`,
    `# Program name: ${name}`,
    "# This file requires the post processor: ",
    `#   ${post}`,
    "# to generate your robot program.",
    "# This is a temporary file and you can delete it once you have generated your program.",
    "# ",
    "# Enginuity reads this file without executing it.",
    "",
  ];
   
  const text = [...header, "", `print('Total instructions: ${total}')`, ...extras.pre, ctor, "", ...out, ""].join("\r\n");
  return { text, post, program: name, robot: robot.name, total, programs, warnings };
}

 
const robotOf = (ws: Workspace, prog: Item): string | undefined => (prog.program?.robot && ws.items[prog.program.robot]?.robot ? prog.program.robot : undefined);










async function robotPostForGeneration(ctx: CmdCtx, prog: Item, popup: boolean): Promise<string | undefined> {
  const robotId = robotOf(ctx.ws, prog);
  const posts = ctx.services.posts;
  if (!robotId || !posts) return undefined;
  const robot = ctx.ws.items[robotId];
  const name = postFileName(robot.robot!.postProcessor ?? "");
  if (await postAvailable(ctx, name)) return name;
   
  if (popup && posts.pick && (ctx.services.view?.clients() ?? 1) > 0) {
    const chosen = await posts.pick(await postPickFor(ctx, robot));
    const found = chosen ? await postAvailable(ctx, storedPostName(chosen)) : null;
    if (found) {
      const cur = ctx.ws.items[robotId];
      ctx.tx.set(robotId, { robot: { ...cur.robot!, postProcessor: found } });
      return found;
    }
  }
  if (!name) throw new CommandError(`Select a Post Processor for the robot ${robot.name} (the robot has no post processor). Choose one with post.choose; post.pickList lists them.`);
  return name;
}

 
const generatingStatus = (name: string) => `Generating program. Please wait... (0%) ${name}`;






async function generateOne(ctx: CmdCtx, prog: Item, opts: { post?: string; folder?: string; popup: boolean }) {
  const { ws, services } = ctx;
  if (!services.post) throw new CommandError("Program generation runs on the server");
  const post = opts.post ?? (await robotPostForGeneration(ctx, prog, opts.popup));
  const inter = buildIntermediate(ws, prog.id, {
    settings: generationSettings(services.settings),
    post,
    apiPort: num(services.settings.RC_API_PORT, 20500),
    postParams: robotOf(ws, prog) ? services.itemData?.(robotOf(ws, prog)!) : undefined,
  });
  const res = await services.post({ post: inter.post, program: { intermediate: inter.text, program: inter.program }, outDir: opts.folder });
  if (!res.ok) {
    const error = res.error ?? "Program generation failed";
    if (opts.popup) {
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      const [first, ...rest] = error.split("\n");
      const body = `${esc(first)}${rest.length ? `<br><br><span style="color:#d33;font-family:var(--font-mono)">${esc(rest.join("\n"))}</span>` : ""}${res.log ? `<br><br>Process output:<br><span style="font-family:var(--font-mono)">${esc(res.log)}</span>` : ""}`;
      void services.ask?.(body, ["OK"], `Python Post Processor output: ${inter.program}`);
    }
    return { ok: false as const, error, log: res.log, inter };
  }
  const files = res.files.map((f) => {
    const binary = (f as { encoding?: string }).encoding === "base64";
    const size = binary ? Math.floor((f.content.length * 3) / 4) : f.content.length;
    const content = binary ? `(binary file, ${size} bytes${(f as { path?: string }).path ? `, saved as ${(f as { path?: string }).path}` : ""})` : f.content;
    return { name: f.name, binary, path: (f as { path?: string }).path, lines: binary ? 0 : f.content.split("\n").length, content };
  });
  services.emit?.({ type: "program-generated", program: prog.name, post: inter.post, files: files.map((f) => ({ name: f.name, content: f.content })) });
  return { ok: true as const, files, log: res.log, inter };
}

defineCommand({
  name: "program.generate",
  title: "Generate Program",
  description:
    "Generate robot code for a program with the robot's post processor (F6) or a given one, optionally into a sub-folder ('Generate Robot Program as...', Shift+F6). Returns the generated files (text files with their content), the intermediate call stream and the instruction count. Program calls to other programs of the station are generated as subprograms.",
  category: "program",
  shortcut: "F6",
  readonly: true,
  undoable: false,
  spec: "R-POSTGEN-20..50",
  schema: z.object({
    program: ItemRef.optional(),
    post: z.string().optional().describe("post processor name; see post.list for every available post (names such as ABB_RAPID_IRC5, KUKA_KRC2, Fanuc_RJ3, Motoman, Post_Generic, Universal_Robots) and the user's own posts"),
    folder: z.string().optional().describe("sub-folder of the Enginuity programs folder"),
  }),
  async run(ctx, p) {
    const prog = requireProgram(ctx.ws, p.program);
    status(ctx, generatingStatus(prog.name));
    const r = await generateOne(ctx, prog, { post: p.post, folder: p.folder, popup: ctx.origin === "ui" });
    if (!r.ok) throw new CommandError(r.error);
    status(ctx, `Done generating ${r.inter.program}`);
    return { post: r.inter.post, program: r.inter.program, total: r.inter.total, files: r.files, log: r.log, warnings: r.inter.warnings, intermediate: r.inter.text };
  },
});

defineCommand({
  name: "program.generateMany",
  title: "Generate Program(s)",
  description:
    "Generate robot code for several programs (F6 with several programs selected), in order, stopping at the first failure: one 'Generating <name> ...' status each, then 'Done generating programs (generated/tried generated)'. A failure opens the 'Failed to generate pogram(s)' window listing the failed program and a log per program. Python programs among them run in the program-generation run mode (their robot commands become a program generated with the post processor). Without programs given, the selected programs are used.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "X-GENLOG-01 (FUN_10039d3cc, REA 2471)",
  schema: z.object({ programs: z.array(ItemRef).optional(), folder: z.string().optional() }),
  async run(ctx, p) {
    const { ws, services } = ctx;
    const items = (p.programs ? p.programs.map((r) => requireRef(ws, r)) : ws.selection.map((s) => ws.items[s]).filter(Boolean)).filter((i) => i.type === "program" || i.type === "python");
    if (!items.length) {
      status(ctx, "No available programs to generate.");
      return { generated: 0, tried: 0, programs: [] };
    }
    let generated = 0;
    let tried = 0;
    let failedList = "";
    let logs = "";
    const results: { program: string; ok: boolean; files?: string[]; error?: string; python?: Record<string, unknown> }[] = [];
    for (const prog of items) {
      if (prog.type === "python") {
         
         
        const res = (await getCommand("python.runMode")?.run(ctx, { item: prog.id, mode: "generate", show: true })) as Record<string, unknown> | undefined;
        tried += 1;
        generated += 1;
        results.push({ program: prog.name, ok: true, python: res });
        continue;
      }
      status(ctx, `Generating ${prog.name} ...`);
       
      const r = await generateOne(ctx, prog, { folder: p.folder, popup: false }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), log: "" }));
      tried += 1;
      const text = r.ok ? r.log : [r.error, r.log].filter(Boolean).join("\n");
      logs += `<br>---------------------------------<br>Log for program ${prog.name}:<br>${text.replace(/\n/g, "<br>")}<br>`;
      if (r.ok) {
        generated += 1;
        results.push({ program: prog.name, ok: true, files: r.files.map((f) => f.name) });
      } else {
        failedList += `<br>${prog.name}`;
        results.push({ program: prog.name, ok: false, error: r.error });
         
        break;
      }
    }
    status(ctx, `Done generating programs (${generated}/${tried} generated)`);
    if (generated !== tried && ctx.origin === "ui") {
       
      void services.ask?.(`Warning.<br>Problems occurred generating the following programs:<br>${failedList}${logs}`, ["OK"], "Failed to generate pogram(s)");
    }
    return { generated, tried, programs: results };
  },
});
