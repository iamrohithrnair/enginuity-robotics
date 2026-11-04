"use client";

 
 
 

import { create } from "zustand";
import { cmd, cmdx } from "@/client/api";
import { scriptRunView, type ScriptRunResult, type ScriptRunView } from "@/engine/scripts";

interface ScriptEditorUI {
  open: boolean;
   
  item: string | null;
   
  draft: { name: string; code: string } | null;
   
  autoRun: boolean;
   
  nonce: number;
   
  running: string | null;
   
  live: string[];
  result: ScriptRunView | null;
   
  keepOnError: boolean;
}

export const useScriptEditor = create<ScriptEditorUI>(() => ({ open: false, item: null, draft: null, autoRun: false, nonce: 0, running: null, live: [], result: null, keepOnError: false }));

export function openScriptEditor(item: string | null, opts: { run?: boolean; draft?: { name: string; code: string } } = {}) {
  useScriptEditor.setState((s) => ({
    open: true,
    item,
    draft: opts.draft ?? null,
    autoRun: Boolean(opts.run),
    nonce: s.nonce + 1,
    ...(s.running ? {} : { live: [], result: null }),
  }));
}

export function closeScriptEditor() {
  useScriptEditor.setState({ open: false, autoRun: false });
}

export function appendLive(line: string) {
  useScriptEditor.setState((s) => ({ live: s.live.length >= 2000 ? [...s.live.slice(-1500), line] : [...s.live, line] }));
}

 
export async function runScript(code: string, name: string) {
  if (useScriptEditor.getState().running) return;
  const run = `ed-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  useScriptEditor.setState({ running: run, live: [], result: null });
  const r = await cmdx<ScriptRunResult>("script.run", { code, name, run, keepOnError: useScriptEditor.getState().keepOnError });
  const result: ScriptRunView =
    r.ok && r.result
      ? scriptRunView(r.result, code)
      : { name, code, ok: false, error: { message: r.error ?? "The script did not run", line: null }, logs: [], truncated: false, calls: 0, ms: 0, created: [], changed: [], deleted: [], counts: { created: 0, changed: 0, deleted: 0 }, generated: [], undo: null, reverted: false };
  useScriptEditor.setState({ running: null, result });
}

export function stopScript() {
  const run = useScriptEditor.getState().running;
  if (run) void cmd("script.stop", { run }, { quiet: true });
}
