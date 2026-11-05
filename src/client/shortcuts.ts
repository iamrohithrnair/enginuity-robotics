// Maps keyboard events to configured actions and guarded program commands.
"use client";

import { useEffect } from "react";
import { effectiveShortcut, MAIN_ACTIONS } from "@/engine/actions";
import { cmd, setStatus } from "./api";
import "./defaultActions";
import { escapeCascade, renameUI, sendKeyEvent } from "./interaction";
import { useRC, viewState } from "./store";
import { runAction } from "./uiActions";

 
 
 
 
 
 

export interface Shortcut {
  keys: string;
  label: string;
  action: () => void;
   
  global?: boolean;
}

const CLIPBOARD = new Set(["Ctrl+C", "Ctrl+X", "Ctrl+V"]);

const sel = () => useRC.getState().ws?.selection ?? [];

async function checkProgram() {
  const ws = useRC.getState().ws;
  const s = sel().map((id) => ws?.items[id]).find(Boolean);
   
  if (s?.type === "python") return void cmd("python.run", { item: s.id });
  const p = s?.type === "program" ? s.id : s?.type === "instruction" ? s.parent ?? undefined : undefined;
  if (!p) return setStatus("Select program to validate");
  const name = ws?.items[p]?.name ?? "";
  setStatus(`Checking collisions for program ${name}`);
  const u = await cmd<[number, number, number, number, string]>("program.update", { program: p, checkCollisions: true }, { quiet: true });
  if (!u) return;
  if (u[3] >= 1) setStatus(`${name} program check success. No collisions detected.`);
  else if (u[4]) setStatus(u[4].replace(/<br>/g, " ").replace(/<[^>]+>/g, ""));
  else setStatus(`${name} program check failed. Path failed at instruction ${u[0] + 1} (one or more targets are not reachable, a linear move is not possible or the robot tool and reference frames are not properly set).`);
}






const EXTRA: Shortcut[] = [
  { keys: "Delete", label: "Delete", action: () => sel().length && void cmd("item.delete", { items: sel() }) },
  { keys: "Escape", label: "Stop / Clear selection", action: () => void escapeCascade(), global: true },
  { keys: "F2", label: "Rename Item…", action: () => void renameUI() },
  { keys: "Shift+F5", label: "Check Path and Collisions", action: () => void checkProgram() },
  { keys: "Ctrl+Shift+Z", label: "Redo", action: () => void runAction("actionRedo") },
  { keys: "Ctrl+K", label: "Command Palette", action: () => useRC.setState({ paletteOpen: true }), global: true },
];

 
export function currentShortcuts(settings: Record<string, unknown> = useRC.getState().settings): Shortcut[] {
  const out: Shortcut[] = [];
  for (const a of MAIN_ACTIONS) {
    const keys = effectiveShortcut(a, settings);
    if (keys && !CLIPBOARD.has(keys)) out.push({ keys, label: a.text, action: () => void runAction(a.name) });
  }
  return [...out, ...EXTRA.filter((x) => !out.some((o) => o.keys === x.keys))];
}

 
export const SHORTCUTS: Shortcut[] = currentShortcuts({});

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

 
export function eventKeys(e: KeyboardEvent): string {
  const parts: string[] = [];
  const ctrl = isMac() ? e.metaKey : e.ctrlKey;
  if (ctrl) parts.push("Ctrl");
  if (e.shiftKey && !["*", "+"].includes(e.key)) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let k = e.key;
  if (e.altKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.altKey && e.code === "Slash") k = "/";
  else if (e.code === "Space") k = "Space";
  else if (k.length === 1) k = k.toUpperCase();
  if (k === "Del") k = "Delete";
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return "";
  parts.push(k);
  return parts.join("+");
}

export function prettyKeys(keys: string): string {
  if (!isMac()) return keys;
  return keys.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥");
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      sendKeyEvent(e, true);
       
      if (viewState().blockKeys) {
        e.preventDefault();
        return;
      }
      const keys = eventKeys(e);
      if (!keys) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const sc = currentShortcuts().find((s) => s.keys === keys);
      if (!sc) return;
      if (typing && !sc.global) return;
      e.preventDefault();
      sc.action();
    };
    const onKeyUp = (e: KeyboardEvent) => sendKeyEvent(e, false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
