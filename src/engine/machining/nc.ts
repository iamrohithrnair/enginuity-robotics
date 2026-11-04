 
 
 
 
 
 
 
 
 

export interface NcPoint {
  p: [number, number, number];
   
  n: [number, number, number];
   
  feed: number | null;
}

export type NcEvent =
  | { kind: "spindle"; rpm: number }
  | { kind: "spindleCW" }
  | { kind: "spindleCCW" }
  | { kind: "toolChange"; tool: number }
   
  | { kind: "mcode"; code: number; text: string; params: Record<string, number> }
   
  | { kind: "io"; code: 62 | 63 | 64 | 65; port: number }
  | { kind: "extruder"; e: number };

export interface NcPath {
  points: NcPoint[];
   
  events: { at: number; event: NcEvent }[];
  warnings: string[];
}

export class NcError extends Error {
  constructor(
    message: string,
    readonly title: string,
  ) {
    super(message);
  }
}

export const NC_EXTENSIONS = ["cnc", "nc", "gcode", "g-code", "ngc", "tap", "mpf", "nci", "anc", "knc", "ncl", "clt", "apt", "aptsource", "cls", "acl"];
export const APT_EXTENSIONS = new Set(["apt", "aptsource", "cls", "acl", "clt", "ncl"]);

export const MSG = {
  helix: "Helix movements are not supported. Use small circular or linear movements instead.",
  arc: "Invalid/inconsistent circular move.<br>Use I,J,K parameters to properly define the center of the circle. Make sure to properly set the G91.1 or G01.1 code to define the arc center as relative or absolute.<br><br>Change the default behavior in Tools-Options-CAM-Other.<br>Ignore similar warnings?",
  perRev: "Speed per revolution not supported. Ignore similar warnings?",
  thread: "Unknown thread cycle. Using G81 instead.",
  cutterComp: "Warning: Cutter compensation not supported",
  toolComp: "Tool compensation is not supported<br>Ignore similar warnings?",
  aptGoto: "APT movement instruction must have format GOTO/x,y,z,i,j,k",
  aptFeed: "APT tool speed must have format FEDRAT/ IPM|MMPM, 123.4",
  aptFeedAssumed: "APT tool speed must have format FEDRAT/ IPM|MMPM, 123.4<br>MMPM is assumed.",
  aptUnits: "Units must be set as UNITS/ MM|INCH",
  gTitle: "G-Code import error",
  aptTitle: "APT import error",
  noPath: "Current 3D printing settings do not produce any result. Use appropriate 3D printing parameters for the selected part.",
};

const Z_UP: [number, number, number] = [0, 0, 1];

 
function arcPoints(from: number[], to: number[], center: number[], cw: boolean, plane: 0 | 1 | 2, full: boolean): number[][] {
   
  const [u, v, w] = plane === 0 ? [0, 1, 2] : plane === 1 ? [2, 0, 1] : [1, 2, 0];
  const r = Math.hypot(from[u] - center[u], from[v] - center[v]);
  const a0 = Math.atan2(from[v] - center[v], from[u] - center[u]);
  let a1 = Math.atan2(to[v] - center[v], to[u] - center[u]);
  let sweep = a1 - a0;
  if (cw && sweep >= -1e-9) sweep -= 2 * Math.PI;
  if (!cw && sweep <= 1e-9) sweep += 2 * Math.PI;
  if (full) sweep = cw ? -2 * Math.PI : 2 * Math.PI;
  a1 = a0 + sweep;
  const tol = 0.01;
  const byChord = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI;
  const step = Math.min((5 * Math.PI) / 180, byChord);
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const out: number[][] = [];
  for (let k = 1; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    const p = [0, 0, 0];
    p[u] = center[u] + r * Math.cos(a);
    p[v] = center[v] + r * Math.sin(a);
    p[w] = from[w] + ((to[w] - from[w]) * k) / n;
    out.push(k === n ? to.slice() : p);
  }
  return out;
}

type Cycle = { r: number; z: number; retract: "R" | "initial"; initial: number };

const stripComment = (line: string) => line.replace(/\([^)]*\)/g, " ").replace(/;.*$/, "");

 
export function parseGcode(text: string): NcPath {
  const points: NcPoint[] = [];
  const events: NcPath["events"] = [];
  const warnings = new Set<string>();
  let pos = [0, 0, 0];
  let motion = 0;  
  let absolute = true;
  let arcAbsolute = false;  
  let unit = 1;
  let feed = 0;  
  let plane: 0 | 1 | 2 = 0;
  let extrude: number | null = null;
  let cycle: Cycle | null = null;
  let retractMode: "R" | "initial" = "initial";
  let lastS: number | null = null;
  const push = (p: number[], rapid: boolean) => {
    points.push({ p: [p[0], p[1], p[2]], n: Z_UP, feed: rapid ? null : feed || null });
  };
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const raw = stripComment(lines[li]).toUpperCase();
    if (!raw.trim() || /^\s*%/.test(raw)) continue;
    const words = [...raw.matchAll(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)].map((m) => ({ k: m[1], v: Number(m[2]), raw: m[2] }));
    if (!words.length) continue;
    const word = (k: string) => words.find((w) => w.k === k)?.v;
    const gs = words.filter((w) => w.k === "G").map((w) => w.v);
    const ms = words.filter((w) => w.k === "M").map((w) => w.v);
    for (const g of gs) {
      if (g === 0) motion = 0;
      else if (g === 1) motion = 1;
      else if (g === 2) motion = 2;
      else if (g === 3) motion = 3;
      else if (g === 17) plane = 0;
      else if (g === 18) plane = 1;
      else if (g === 19) plane = 2;
      else if (g === 20) unit = 25.4;
      else if (g === 21) unit = 1;
      else if (g === 90) absolute = true;
      else if (g === 91) absolute = false;
      else if (Math.abs(g - 90.1) < 1e-6) arcAbsolute = true;
      else if (Math.abs(g - 91.1) < 1e-6) arcAbsolute = false;
      else if (g === 40) {
         
      } else if (g === 41 || g === 42) warnings.add(MSG.cutterComp);
      else if (g === 43 || g === 44 || g === 49) {
        if (g !== 49) warnings.add(MSG.toolComp);
      } else if (g === 95) warnings.add(MSG.perRev);
      else if (g === 94) {
         
      } else if (g === 98) retractMode = "initial";
      else if (g === 99) retractMode = "R";
      else if (g === 80) {
        cycle = null;
        motion = 0;
      } else if (g >= 81 && g <= 89) {
        if (g !== 81 && g !== 82 && g !== 83 && g !== 73) warnings.add(MSG.thread);
        motion = 81;
      }
    }
    const f = word("F");
    if (f !== undefined) feed = (f * unit) / 60;
    const s = word("S");
     
    const spindleS = ms.every((m) => m === 3 || m === 4 || m === 5);
    if (s !== undefined && spindleS && s !== lastS) {
      events.push({ at: points.length, event: { kind: "spindle", rpm: s } });
      lastS = s;
    }
    const t = word("T");
    for (const m of ms) {
      if (m === 3) events.push({ at: points.length, event: { kind: "spindleCW" } });
      else if (m === 4) events.push({ at: points.length, event: { kind: "spindleCCW" } });
      else if (m === 6 && t !== undefined) events.push({ at: points.length, event: { kind: "toolChange", tool: t } });
      else if (m === 62 || m === 63 || m === 64 || m === 65) events.push({ at: points.length, event: { kind: "io", code: m, port: word("P") ?? 0 } });
      else if (m !== 5 && m !== 2 && m !== 30 && m !== 0 && m !== 1 && m !== 6) {
        const rest = words.filter((w) => w.k !== "M" && w.k !== "G" && w.k !== "N");
        const text = [String(m), ...rest.map((w) => `${w.k}${w.raw}`)].join(" ");
        events.push({ at: points.length, event: { kind: "mcode", code: m, text, params: Object.fromEntries(rest.map((w) => [w.k, w.v])) } });
      }
    }
    if (t !== undefined && !ms.includes(6)) events.push({ at: points.length, event: { kind: "toolChange", tool: t } });
    const e = word("E");
    const hasXYZ = ["X", "Y", "Z"].some((k) => word(k) !== undefined);
    if (!hasXYZ) continue;
    const target = pos.slice();
    (["X", "Y", "Z"] as const).forEach((k, i) => {
      const v = word(k);
      if (v !== undefined) target[i] = absolute ? v * unit : pos[i] + v * unit;
    });
    if (e !== undefined && e !== extrude) {
      events.push({ at: points.length, event: { kind: "extruder", e } });
      extrude = e;
    }
    if (motion === 81) {
       
      const prev = cycle as Cycle | null;
      const r: number = word("R") !== undefined ? word("R")! * unit : prev?.r ?? pos[2];
      const z: number = word("Z") !== undefined ? word("Z")! * unit : prev?.z ?? pos[2];
      cycle = { r, z, retract: retractMode, initial: prev?.initial ?? pos[2] };
      const x = word("X") !== undefined ? target[0] : pos[0];
      const y = word("Y") !== undefined ? target[1] : pos[1];
      push([x, y, pos[2]], true);
      push([x, y, r], true);
      push([x, y, z], false);
      const back = cycle.retract === "R" ? r : Math.max(cycle.initial, r);
      push([x, y, back], true);
      pos = [x, y, back];
      continue;
    }
    if (motion === 2 || motion === 3) {
      const [u, v, w] = plane === 0 ? [0, 1, 2] : plane === 1 ? [2, 0, 1] : [1, 2, 0];
      if (Math.abs(target[w] - pos[w]) > 1e-6) throw new NcError(MSG.helix, MSG.gTitle);
      const ijk = [word("I"), word("J"), word("K")];
      const rWord = word("R");
      let center: number[];
      if (rWord !== undefined) {
        const r = rWord * unit;
        const dx = target[u] - pos[u];
        const dy = target[v] - pos[v];
        const d = Math.hypot(dx, dy);
        if (d < 1e-9 || d > 2 * Math.abs(r) + 1e-6) {
          warnings.add(MSG.arc);
          push(target, false);
          pos = target;
          continue;
        }
        const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
        const cw = motion === 2;
         
        const side = (cw ? -1 : 1) * (r > 0 ? 1 : -1);
        center = [0, 0, 0];
        center[u] = pos[u] + dx / 2 - (side * h * dy) / d;
        center[v] = pos[v] + dy / 2 + (side * h * dx) / d;
        center[w] = pos[w];
      } else {
        const off = [ijk[0] ?? 0, ijk[1] ?? 0, ijk[2] ?? 0].map((x) => x * unit);
        center = arcAbsolute ? off : [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]];
        const r0 = Math.hypot(pos[u] - center[u], pos[v] - center[v]);
        const r1 = Math.hypot(target[u] - center[u], target[v] - center[v]);
        if (Math.abs(r0 - r1) > Math.max(0.01, 0.002 * r0)) {
          warnings.add(MSG.arc);
          push(target, false);
          pos = target;
          continue;
        }
      }
      const full = Math.hypot(target[u] - pos[u], target[v] - pos[v]) < 1e-9;
      for (const p of arcPoints(pos, target, center, motion === 2, plane, full)) push(p, false);
      pos = target;
      continue;
    }
    push(target, motion === 0);
    pos = target;
  }
  return { points, events, warnings: [...warnings] };
}

 
export function parseApt(text: string): NcPath {
  const points: NcPoint[] = [];
  const events: NcPath["events"] = [];
  const warnings = new Set<string>();
  let unit = 1;
  let feed = 0;
  let rapidNext = false;
  let axis: [number, number, number] = Z_UP;
   
  const statements: string[] = [];
  let acc = "";
  for (const l of text.split(/\r?\n/)) {
    const line = l.replace(/\$\$.*$/, "").trimEnd();
    if (line.endsWith("$")) {
      acc += line.slice(0, -1);
      continue;
    }
    statements.push((acc + line).trim());
    acc = "";
  }
  for (const st of statements) {
    if (!st) continue;
    const m = /^([A-Z0-9]+)\s*(?:\/\s*(.*))?$/i.exec(st);
    if (!m) continue;
    const cmd = m[1].toUpperCase();
    const args = (m[2] ?? "").split(",").map((s) => s.trim()).filter((s) => s.length);
    if (cmd === "UNITS") {
      const u = (args[0] ?? "").toUpperCase();
      if (u === "MM") unit = 1;
      else if (u === "INCH" || u === "INCHES") unit = 25.4;
      else throw new NcError(MSG.aptUnits, MSG.aptTitle);
    } else if (cmd === "FEDRAT") {
      const nums = args.map(Number).filter((v) => Number.isFinite(v));
      const mode = args.find((a) => /^(IPM|MMPM|IPR|MMPR)$/i.test(a))?.toUpperCase();
      if (!nums.length) throw new NcError(MSG.aptFeed, MSG.aptTitle);
      if (!mode) warnings.add(MSG.aptFeedAssumed);
      if (mode === "IPR" || mode === "MMPR") warnings.add(MSG.perRev);
      feed = ((mode === "IPM" ? 25.4 : 1) * nums[0]) / 60;
    } else if (cmd === "RAPID") rapidNext = true;
    else if (cmd === "GOTO") {
      const nums = args.map(Number);
      if ((nums.length !== 3 && nums.length !== 6) || nums.some((v) => !Number.isFinite(v))) throw new NcError(MSG.aptGoto, MSG.aptTitle);
      if (nums.length === 6) {
        const l = Math.hypot(nums[3], nums[4], nums[5]);
        if (l > 1e-12) axis = [nums[3] / l, nums[4] / l, nums[5] / l];
      }
      points.push({ p: [nums[0] * unit, nums[1] * unit, nums[2] * unit], n: axis, feed: rapidNext ? null : feed || null });
      rapidNext = false;
    } else if (cmd === "LOADTL" || cmd === "TOOL") {
      const n = Number(args[0]);
      if (Number.isFinite(n)) events.push({ at: points.length, event: { kind: "toolChange", tool: n } });
    } else if (cmd === "SPINDL") {
      const n = args.map(Number).find((v) => Number.isFinite(v));
      if (args.some((a) => /^OFF$/i.test(a))) continue;
      if (n !== undefined) events.push({ at: points.length, event: { kind: "spindle", rpm: n } });
      if (args.some((a) => /^CLW$/i.test(a))) events.push({ at: points.length, event: { kind: "spindleCW" } });
      if (args.some((a) => /^CCLW$/i.test(a))) events.push({ at: points.length, event: { kind: "spindleCCW" } });
    } else if (cmd === "CUTCOM") warnings.add(MSG.cutterComp);
  }
  return { points, events, warnings: [...warnings] };
}

export function isAptFile(fileName: string): boolean {
  const ext = fileName.replace(/^.*\./, "").toLowerCase();
  return APT_EXTENSIONS.has(ext);
}

 
export function parseNc(fileName: string, text: string): NcPath {
  return isAptFile(fileName) ? parseApt(text) : parseGcode(text);
}
