 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { linkFrames } from "./kinematics";
import { mul, type Mat } from "./math";
import type { GeometryStore } from "./registry";
import type { Item, Workspace } from "./types";
import { absPose, childFrame, descendants } from "./workspace";

export const SIM_FORMAT = "enginuity-sim";
export const SIM_FORMAT_VERSION = 1;

 
export const SIM_TEXTS = {
  pressStart: "Press START to record",
  recording: "Recording...",
  recorded: (seconds: number) => `Simulation of ${seconds.toFixed(1)} seconds recorded.`,
  recordFirst: "Record a simulation first",
  noProgram: "No available program. Add a new program.",
  saved: "Simulation saved successfully: ",
  saveTitle: "Export simulation...",
} as const;

export interface SimBodyMesh {
  geometry: string;
  color: [number, number, number, number];
}

export interface SimBody {
   
  key: string;
  item: string;
  name: string;
   
  link: number;
  meshes: SimBodyMesh[];
}

 
export function withJoints(ws: Workspace, joints: Record<string, number[]> | undefined): Workspace {
  if (!joints || !Object.keys(joints).length) return ws;
  const items = { ...ws.items };
  for (const [id, q] of Object.entries(joints)) {
    const r = items[id];
    if (r?.robot) items[id] = { ...r, robot: { ...r.robot, joints: q } };
  }
  return { ...ws, items };
}

const visibleChain = (ws: Workspace, it: Item) => {
  for (let cur: Item | undefined = it; cur; cur = cur.parent ? ws.items[cur.parent] : undefined) if (!cur.visible) return false;
  return true;
};

 
export function stationBodies(ws: Workspace, stationId: string): { body: SimBody; pose: Mat | null }[] {
  const out: { body: SimBody; pose: Mat | null }[] = [];
  for (const it of descendants(ws, stationId)) {
    const shown = visibleChain(ws, it);
    if (it.type === "robot" && it.robot) {
      const base = absPose(ws, it.id);
      const frames = shown ? linkFrames(it.robot.model, it.robot.joints) : [];
      it.robot.links.forEach((meshes, li) => {
        if (!meshes.length) return;
        const body: SimBody = { key: `${it.id}:${li}`, item: it.id, name: li ? `${it.name} link ${li}` : `${it.name} base`, link: li, meshes: meshes.map((m) => ({ geometry: m.geometry, color: it.color ?? m.color })) };
        out.push({ body, pose: shown && frames[li] ? mul(base, frames[li]) : null });
      });
    } else if ((it.type === "object" && it.object) || (it.type === "tool" && it.tool)) {
      const data = it.object ?? it.tool!;
      if (!data.meshes.length) continue;
       
      const holder = it.type === "tool" ? childFrame(ws, it.parent) : absPose(ws, it.id);
      const pose = data.geometryPose ? mul(holder, data.geometryPose) : holder;
      const body: SimBody = { key: it.id, item: it.id, name: it.name, link: -1, meshes: data.meshes.map((m) => ({ geometry: m.geometry, color: it.color ?? m.color })) };
      out.push({ body, pose: shown ? pose : null });
    }
  }
  return out;
}

 
export const recordingName = (name: string) => name.replace(/ /g, "-");

 
export class SimRecording {
  bodies: SimBody[] = [];
  private index = new Map<string, number>();
   
  times: [number, number][] = [];
   
  samples: Float32Array[] = [];

  constructor(
    public station: string,
    public name: string,
    public program: string | null = null,
  ) {}

   
  add(ws: Workspace, real: number, sim: number) {
    const snap = stationBodies(ws, this.station);
    for (const { body } of snap) {
      if (this.index.has(body.key)) continue;
       
      this.index.set(body.key, this.bodies.length);
      this.bodies.push(body);
    }
    const row = new Float32Array(this.bodies.length * 12).fill(NaN);
    for (const { body, pose } of snap) {
      if (!pose) continue;
      row.set(pose.slice(0, 12), this.index.get(body.key)! * 12);
    }
    this.times.push([real, sim]);
    this.samples.push(row);
  }

   
  get seconds() {
    return this.times.length ? this.times[this.times.length - 1][0] : 0;
  }
}

export interface SimRecorderState {
  recording: boolean;
   
  seconds: number;
  samples: number;
  name: string | null;
  program: string | null;
  station: string | null;
}

 
export interface SimRecorderService {
  start(opts: { station: string; name: string; program?: string | null; programName?: string | null }): void;
   
  stop(): boolean;
  state(): SimRecorderState;
  recording(): SimRecording | null;
}







export function createSimRecorder(getWs: () => Workspace, now: () => number = () => Date.now()) {
  let rec: SimRecording | null = null;
  let on = false;
  let t0 = 0;
  let last = 0;
  let sim = 0;
  let program: string | null = null;
  let seenBusy = false;
  const live = new Map<string, number[]>();
  const sample = () => {
    if (!rec) return;
    const ws = withJoints(getWs(), Object.fromEntries(live));
    const t = now();
    sim += ((t - last) / 1000) * (ws.simulationSpeed || 1);
    last = t;
    if (!ws.items[rec.station]) return void (on = false);
    rec.add(ws, (t - t0) / 1000, sim);
  };
  const service: SimRecorderService & {
    tick(): void;
    onEvent(e: { type: string; [k: string]: unknown }): void;
    readonly active: boolean;
  } = {
    start({ station, name, program: prog, programName }) {
       
      rec = new SimRecording(station, recordingName(programName ?? name), programName ?? null);
      on = true;
      t0 = last = now();
      sim = 0;
      program = prog ?? null;
      seenBusy = false;
      sample();
    },
    stop() {
      if (!on) return false;
       
      on = false;
      program = null;
      return true;
    },
    state() {
      return { recording: on, seconds: rec?.seconds ?? 0, samples: rec?.samples.length ?? 0, name: rec?.name ?? null, program: rec?.program ?? null, station: rec?.station ?? null };
    },
    recording: () => rec,
    tick() {
      if (!on) return;
      sample();
      if (program) {
        const busy = (getWs().busy ?? []).includes(program);
        if (busy) seenBusy = true;
         
        else if (seenBusy || now() - t0 > 3000) service.stop();
      }
    },
    onEvent(e) {
      if (e.type === "live" && typeof e.robot === "string" && Array.isArray(e.joints)) live.set(e.robot, e.joints as number[]);
      else if (e.type === "live-end" && typeof e.robot === "string") live.delete(e.robot);
    },
    get active() {
      return on;
    },
  };
  return service;
}

export interface SimPayload {
  format: typeof SIM_FORMAT;
  version: typeof SIM_FORMAT_VERSION;
  title: string;
  station: string;
  program: string | null;
   
  generator: string;
   
  geometries: string[];
  bodies: { name: string; meshes: { g: number; color: [number, number, number, number] }[] }[];
   
  times: [number, number][];
   
  poses: string;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const f32b64 = (a: Float32Array) => toBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

 
export function simPayload(rec: SimRecording, store: GeometryStore, title: string, generator = "Enginuity"): SimPayload {
  if (!rec.samples.length) throw new Error(SIM_TEXTS.recordFirst);
  const gIndex = new Map<string, number>();
  const geometries: string[] = [];
  const bodies = rec.bodies.map((b) => ({
    name: b.name,
    meshes: b.meshes.flatMap((m) => {
      let g = gIndex.get(m.geometry);
      if (g === undefined) {
        const t = store.get(m.geometry);
        if (!t?.length) return [];
        g = geometries.length;
        gIndex.set(m.geometry, g);
        geometries.push(f32b64(t));
      }
      return [{ g, color: m.color.map((c) => r3(c)) as [number, number, number, number] }];
    }),
  }));
  const n = rec.bodies.length;
  const all = new Float32Array(rec.samples.length * n * 12).fill(NaN);
  rec.samples.forEach((row, i) => all.set(row, i * n * 12));
  return {
    format: SIM_FORMAT,
    version: SIM_FORMAT_VERSION,
    title,
    station: rec.name,
    program: rec.program,
    generator,
    geometries,
    bodies,
    times: rec.times.map(([a, b]) => [r3(a), r3(b)]),
    poses: f32b64(all),
  };
}

 
export function decodePoses(p: SimPayload): (number[] | null)[][] {
  const bin = atob(p.poses);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const f = new Float32Array(bytes.buffer);
  const n = p.bodies.length;
  return p.times.map((_, s) =>
    Array.from({ length: n }, (_, b) => {
      const v = Array.from(f.subarray((s * n + b) * 12, (s * n + b + 1) * 12));
      return v.some((x) => Number.isNaN(x)) ? null : v;
    }),
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);





export function simHtml(payload: SimPayload, viewerJs: string): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const js = viewerJs.replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(payload.generator)}">
<title>${esc(payload.title)}</title>
<style>
:root{--ink-1:#1d1d1f;--ink-2:#55555a;--ink-3:#8a8a8f;--fill-1:rgba(255,255,255,.72);--fill-2:rgba(0,0,0,.05);--well:#f2f2f4;--accent:#0a84ff;--accent-ink:#fff;--font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
html,body{margin:0;height:100%;background:linear-gradient(#f7f7f8,#e6e7ea);font:13px var(--font-ui);color:var(--ink-1);overflow:hidden}
#mb-view{position:fixed;inset:0}
#mb-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:14px;background:var(--fill-1);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 1px 0 rgba(0,0,0,.06),0 6px 24px rgba(0,0,0,.08);min-width:min(560px,calc(100vw - 32px));box-sizing:border-box}
#mb-bar button{border:0;border-radius:9px;background:var(--accent);color:var(--accent-ink);font:600 12px var(--font-ui);height:28px;min-width:64px;cursor:pointer}
#mb-bar input[type=range]{flex:1;accent-color:var(--accent)}
#mb-time{font:500 12px var(--font-ui);color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
#mb-title{position:fixed;left:16px;top:14px;font:600 13px var(--font-ui);color:var(--ink-2)}
#mb-error{position:fixed;inset:0;display:none;align-items:center;justify-content:center;color:var(--ink-2)}
</style>
</head>
<body>
<div id="mb-view"></div>
<div id="mb-title">${esc(payload.title)}</div>
<div id="mb-bar"><button id="mb-play" type="button">Pause</button><input id="mb-seek" type="range" min="0" max="1000" value="0" aria-label="Time"><span id="mb-time"></span></div>
<div id="mb-error"></div>
<script id="mb-sim" type="application/json">${json}</script>
<script>${js}</script>
</body>
</html>
`;
}
