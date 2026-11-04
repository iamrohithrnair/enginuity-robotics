"use client";

import type { Workspace, WorkspacePatch } from "@/engine/types";
import { pushView, useRC, type ServerDialog } from "./store";

 
export function setStatus(text: string, ms = 10000) {
  useRC.setState({ status: { text, at: Date.now(), ms } });
}

 
export function selectNow(ids: string[], mode: "replace" | "toggle" = "replace") {
  const st = useRC.getState();
  if (st.ws) {
    let next = ids;
    if (mode === "toggle") {
      const s = new Set(st.ws.selection);
      for (const id of ids) {
        if (s.has(id)) s.delete(id);
        else s.add(id);
      }
      next = [...s];
    }
    useRC.setState({ ws: { ...st.ws, selection: next } });
  }
  return cmd("edit.select", { items: ids, mode }, { quiet: true });
}

export interface CmdResponse<T> {
  ok: boolean;
  result: T | null;
  error: string | null;
  code: string | null;
}

 
export async function cmdx<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<CmdResponse<T>> {
  try {
    const res = await fetch("/api/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, params }),
    });
    return (await res.json()) as CmdResponse<T>;
  } catch (err) {
    return { ok: false, result: null, error: String(err), code: "connection" };
  }
}

 
export async function cmd<T = unknown>(name: string, params: Record<string, unknown> = {}, opts: { quiet?: boolean } = {}): Promise<T | null> {
  const body = await cmdx<T>(name, params);
  if (!body.ok) {
    if (!opts.quiet) {
      if (body.code === "connection") useRC.getState().toast({ kind: "error", title: "Connection problem", body: body.error ?? "" });
      else useRC.getState().toast({ kind: "error", title: "Action failed", body: body.error ?? name });
    }
    return null;
  }
  return body.result;
}

 
export async function answerDialog(id: string, button: string, text?: string) {
  useRC.setState({ dialogs: useRC.getState().dialogs.filter((d) => d.id !== id) });
  await fetch("/api/dialog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(text === undefined ? { id, button } : { id, button, text }) });
}

let source: EventSource | null = null;






let pending: WorkspacePatch[] = [];
let flushScheduled = false;
 
function flushPatches() {
  flushScheduled = false;
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  useRC.getState().applyMany(batch);
   
  if (batch.some((p) => !p.physics)) void refreshUndo();
}
function queuePatch(p: WorkspacePatch) {
  pending.push(p);
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestAnimationFrame === "function" && document.visibilityState === "visible") requestAnimationFrame(flushPatches);
  else setTimeout(flushPatches, 16);
}

 
 
 
 
 
interface Track {
  samples: { t: number; q: number[] }[];
  ended: boolean;
}
const tracks = new Map<string, Track>();
 
const offsets: { at: number; v: number }[] = [];
let playing = 0;
 
const playbackDelay = () => (polling ? 300 : 110);

function liveSample(robot: string, q: number[], t?: number) {
  const now = Date.now();
  const at = t ?? now;
  offsets.push({ at: now, v: now - at });
  while (offsets.length > 1 && now - offsets[0].at > 4000) offsets.shift();
  const tr = tracks.get(robot) ?? { samples: [], ended: false };
  tr.ended = false;
  tr.samples.push({ t: at, q });
  tracks.set(robot, tr);
  if (!playing) playing = requestAnimationFrame(playFrame);
}

function liveEnd(robot: string) {
  const tr = tracks.get(robot);
  if (tr) tr.ended = true;
  else {
    const lj = { ...useRC.getState().liveJoints };
    delete lj[robot];
    useRC.setState({ liveJoints: lj });
  }
}

function playFrame() {
  playing = 0;
  const offset = Math.min(...offsets.map((o) => o.v));
  const tp = Date.now() - offset - playbackDelay();
  const next: Record<string, number[]> = {};
  const done: string[] = [];
  for (const [id, tr] of tracks) {
    const s = tr.samples;
    while (s.length > 2 && s[1].t <= tp) s.shift();
    let q = s[s.length - 1].q;
    if (s.length >= 2 && tp < s[1].t) {
      const a = Math.min(1, Math.max(0, (tp - s[0].t) / Math.max(1, s[1].t - s[0].t)));
      q = s[0].q.map((v, i) => v + ((s[1].q[i] ?? v) - v) * a);
    } else if (tp < s[0].t) q = s[0].q;
    next[id] = q;
    if (tr.ended && tp >= s[s.length - 1].t) done.push(id);
  }
  const lj = { ...useRC.getState().liveJoints, ...next };
  for (const id of done) {
    tracks.delete(id);
    delete lj[id];
  }
  useRC.setState({ liveJoints: lj });
  if (tracks.size) playing = requestAnimationFrame(playFrame);
}

 
const STREAM_GRACE_MS = 5000;
let polling = false;

export function connect() {
  if (source || polling) return;
  source = new EventSource("/api/events");
  let heard = false;
  source.onopen = () => useRC.setState({ connected: true });
  source.onerror = () => useRC.setState({ connected: false });
  source.onmessage = (msg) => {
    heard = true;
    handleServerEvent(JSON.parse(msg.data) as { type: string; [k: string]: unknown });
  };
   
  setTimeout(() => {
    if (heard || !source) return;
    source.close();
    source = null;
    void poll();
  }, STREAM_GRACE_MS);
}

 
async function poll() {
  polling = true;
  const client = Math.random().toString(36).slice(2);
  let after: number | null = null;
  for (;;) {
    try {
      const r = await fetch(`/api/poll?client=${client}${after === null ? "" : `&after=${after}`}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const { seq, events } = (await r.json()) as { seq: number; events: { type: string; [k: string]: unknown }[] };
      useRC.setState({ connected: true });
      after = seq;
      for (const e of events) handleServerEvent(e);
    } catch {
      useRC.setState({ connected: false });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function handleServerEvent(e: { type: string; [k: string]: unknown }) {
  {
    if (e.type !== "patch") flushPatches();
    const st = useRC.getState();
    switch (e.type) {
      case "snapshot":
        st.setSnapshot(e.ws as Workspace);
        void refreshUndo();
         
        void fetch("/api/trace")
          .then((r) => r.json())
          .then((d: { paths?: Record<string, number[][]> }) => useRC.setState({ trace: d.paths ?? {} }))
          .catch(() => undefined);
        break;
      case "patch":
        queuePatch(e.patch as Parameters<typeof st.apply>[0]);
        break;
      case "live":
        liveSample(String(e.robot), e.joints as number[], typeof e.t === "number" ? e.t : undefined);
        break;
      case "live-end":
        liveEnd(String(e.robot));
        break;
      case "status":
        useRC.setState({ status: { text: String(e.text), at: Date.now(), ms: Number(e.ms ?? 10000) } });
        break;
      case "dialog":
        useRC.setState({ dialogs: [...useRC.getState().dialogs, e as unknown as ServerDialog] });
        break;
      case "dialog-close":
        useRC.setState({ dialogs: useRC.getState().dialogs.filter((d) => d.id !== e.id) });
        break;
      case "sim-instruction":
        useRC.setState({ currentInstruction: { ...useRC.getState().currentInstruction, [String(e.program)]: (e.instruction as string | null) ?? null } });
        break;
      case "collisions":
        useRC.setState({ collisions: (e.items as string[]) ?? [] });
        break;
      case "joint-list":
        useRC.setState({ jointList: { robot: String(e.robot), rows: e.rows as number[][] } });
        break;
      case "undo":
        useRC.setState({ undo: e.undo as { undo: string[]; redo: string[] } });
        break;
      case "view":
        pushView(e as never);
        break;
      case "settings":
        useRC.setState({ settings: e.settings as Record<string, unknown> });
        break;
      case "program-generated":
        useRC.setState({ codeView: { program: String(e.program), post: String(e.post), files: e.files as { name: string; content: string }[] } });
        break;
       
      case "ui-action":
      case "screenshot-request":
      case "view-pick-request":
        window.dispatchEvent(new CustomEvent(`rc-${e.type}`, { detail: e }));
        break;
      case "api-events":
        useRC.setState({ apiEvents: Number(e.count ?? 0) > 0 });
        break;
      case "trace": {
        const tr = useRC.getState().trace;
        const id = String(e.robot);
        const next = [...(tr[id] ?? []), ...((e.samples as number[][]) ?? [])];
        useRC.setState({ trace: { ...tr, [id]: next.length > 4000 ? next.slice(next.length - 4000) : next } });
        break;
      }
      case "trace-reset":
        useRC.setState({ trace: {} });
        break;
    }
    for (const fn of serverEventListeners) fn(e);
  }
}

type ServerEventListener = (e: { type: string; [k: string]: unknown }) => void;
const serverEventListeners = new Set<ServerEventListener>();

 
export function onServerEvent(fn: ServerEventListener): () => void {
  serverEventListeners.add(fn);
  return () => {
    serverEventListeners.delete(fn);
  };
}

export async function refreshUndo() {
  const res = await cmd<{ undo: string[]; redo: string[] }>("edit.undoStack", {}, { quiet: true });
  if (res) useRC.setState({ undo: res });
}

export async function loadSettings() {
  const r = await fetch("/api/settings");
  useRC.setState({ settings: await r.json() });
}

 
export async function saveSettings(values: Record<string, unknown>): Promise<string | undefined> {
  const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
  const { _message, ...settings } = (await r.json()) as Record<string, number | string | boolean>;
  useRC.setState({ settings });
  return typeof _message === "string" ? _message : undefined;
}
