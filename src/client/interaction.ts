// Handles item activation, selection gestures and viewport interaction shortcuts.
"use client";

 
 
 

import { useEffect } from "react";
import type { Item } from "@/engine/types";
import { navStyle } from "@/engine/view";
import { activeToolOf } from "@/engine/workspace";
import { openScriptEditor } from "@/components/scripts/uiStore";
import { cmd, cmdx, selectNow, setStatus } from "./api";
import { pushView, useRC } from "./store";

const state = () => useRC.getState();
const ws = () => state().ws;
const selection = () => ws()?.selection ?? [];

 
export function pickItem(label: string, items: Item[], title = "Select one item"): Promise<Item | null> {
  return new Promise((resolve) => {
    if (!items.length) return resolve(null);
    useRC.setState({
      picker: {
        title,
        label,
        items: items.map((i) => i.id),
        onPick: (id) => {
          useRC.setState({ picker: null });
          resolve(id ? ws()?.items[id] ?? null : null);
        },
      },
    });
  });
}

const programsOf = () => Object.values(ws()?.items ?? {}).filter((i) => i.type === "program" && inActiveStation(i.id));

function inActiveStation(id: string): boolean {
  const w = ws();
  if (!w) return false;
  let cur = w.items[id];
  while (cur?.parent) cur = w.items[cur.parent];
  return cur?.id === w.activeStation;
}





export async function runProgramUI(programId?: string) {
  const w = ws();
  if (!w) return;
  let id = programId;
  if (!id) {
    const sel = w.selection.map((s) => w.items[s]).find((i) => i?.type === "program" || i?.type === "instruction");
    id = sel?.type === "program" ? sel.id : sel?.type === "instruction" ? sel.parent ?? undefined : undefined;
  }
  if (!id) {
    const progs = programsOf();
    if (progs.length === 1) id = progs[0].id;
    else if (progs.length > 1) id = (await pickItem("Select a program to run", progs))?.id;
    else setStatus("No program to run");
  }
  if (id) await cmd("program.run", { program: id });
}






export async function activateItem(id: string, opts: { alt?: boolean } = {}) {
  const w = ws();
  const it = w?.items[id];
  if (!w || !it) return;
  if (!inActiveStation(id) && it.type !== "station") {
    let st = it;
    while (st.parent) st = w.items[st.parent];
    useRC.setState({
      dialogs: [
        ...state().dialogs,
        {
          id: `local-activate-${st.id}`,
          title: "Station not active",
          html: `The selected item belongs to the station <strong>${st.name}</strong>, currently not active. Do you want to make this station active?`,
          buttons: ["No", "Yes"],
        },
      ],
    });
    return;
  }
  switch (it.type) {
    case "station":
      if (w.activeStation !== id) await cmd("station.setActive", { station: id });
      return;
    case "target":
      await cmd("target.moveTo", { target: id, alt: !!opts.alt });
      return;
    case "program":
      await runProgramUI(id);
      return;
    case "script":
       
      openScriptEditor(id, { run: true });
      return;
    case "python":
       
      await cmd((w.busy ?? []).includes(id) ? "python.stop" : "python.run", { item: id });
      return;
    case "instruction": {
      const t = it.instruction?.target;
      if (t && w.items[t]) await cmd("target.moveTo", { target: t });
      return;
    }
    case "folder":
      window.dispatchEvent(new CustomEvent("rc-expand", { detail: { id, exclusive: true } }));
      pushView({ action: "fit", items: [id, ...descendantIds(id)] });
      return;
    case "object":
      if (opts.alt) {
        await getWithRobot(it);
        return;
      }
      await selectNow([id]);
      useRC.setState({ rightPanel: "inspector" });
      return;
    default:
      await selectNow([id]);
      useRC.setState({ rightPanel: "inspector" });
  }
}

function descendantIds(id: string): string[] {
  const w = ws();
  const out: string[] = [];
  const walk = (i: string) => {
    for (const c of w?.items[i]?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}






async function getWithRobot(obj: Item) {
  const w = ws();
  if (!w) return;
  const robots = Object.values(w.items).filter((i) => i.type === "robot" && inActiveStation(i.id));
  const picked = w.selection.map((s) => w.items[s]).find((i) => i?.type === "robot");
  const robot = picked ?? (robots.length === 1 ? robots[0] : undefined);
  if (!robot) return setStatus("Select robot first");
  const tool = activeToolOf(w, robot.id);
  await cmd("item.setParent", { item: obj.id, parent: tool?.id ?? robot.id, keepAbsolute: true });
}

 
export async function answerLocalDialog(id: string, button: string) {
  useRC.setState({ dialogs: state().dialogs.filter((d) => d.id !== id) });
  if (id.startsWith("local-activate-") && button === "Yes") await cmd("station.setActive", { station: id.slice("local-activate-".length) });
}









export async function escapeCascade() {
  const st = state();
  useRC.setState({ moveMode: "default", holdPan: false });
  if (st.drag) return window.dispatchEvent(new CustomEvent("rc-drag-cancel"));
  if (st.preview) {
    useRC.setState({ preview: null });
    return setStatus("Robot preview hidden");
  }
  if (st.picker) return st.picker.onPick("");
  if (st.renameFor) return useRC.setState({ renameFor: null });
  if (st.paletteOpen || st.libraryOpen || st.settingsOpen || st.codeView || st.colorFor || st.measureOpen || st.aboutOpen || st.helpOpen) {
    return useRC.setState({ paletteOpen: false, libraryOpen: false, settingsOpen: false, codeView: null, colorFor: null, measureOpen: false, aboutOpen: false, helpOpen: false });
  }
  if (!st.ws) return;
  const r = await cmd<{ step: string | null }>("view.escape", {}, { quiet: true });
  if (r?.step) return;
  if (st.jointList) return useRC.setState({ jointList: null });
  if (st.rightPanel !== "none") return useRC.setState({ rightPanel: "none" });
  await cmd("view.escape", { final: true }, { quiet: true });
}





export function sendKeyEvent(e: KeyboardEvent, pressed: boolean) {
  if (!state().apiEvents || e.repeat) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  const key = qtKey(e);
  if (!key) return;
   
  const mods = (e.shiftKey ? 0x02000000 : 0) | (e.metaKey ? 0x04000000 : 0) | (e.altKey ? 0x08000000 : 0) | (e.ctrlKey ? 0x10000000 : 0);
  void fetch("/api/uievent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 10, ints: [pressed ? 1 : 0, key, mods] }) }).catch(() => undefined);
}

 
function qtKey(e: KeyboardEvent): number {
  const named: Record<string, number> = {
    Escape: 0x01000000, Tab: 0x01000001, Backspace: 0x01000003, Enter: 0x01000004, Insert: 0x01000006, Delete: 0x01000007,
    Home: 0x01000010, End: 0x01000011, ArrowLeft: 0x01000012, ArrowUp: 0x01000013, ArrowRight: 0x01000014, ArrowDown: 0x01000015,
    PageUp: 0x01000016, PageDown: 0x01000017, Shift: 0x01000020, Control: 0x01000021, Meta: 0x01000022, Alt: 0x01000023, " ": 0x20,
  };
  if (named[e.key] !== undefined) return named[e.key];
  const f = /^F(\d{1,2})$/.exec(e.key);
  if (f) return 0x01000030 + Number(f[1]) - 1;
  if (e.key.length === 1) return e.key.toUpperCase().charCodeAt(0);
  return 0;
}





export function previewTargets() {
  const w = ws();
  if (!w) return;
  const targets = w.selection.map((id) => w.items[id]).filter((i) => i?.type === "target" && i.target?.robot && w.items[i.target.robot]);
  if (!targets.length) return setStatus("Select targets to preview");
  const robot = targets[0].target!.robot!;
  useRC.setState({ preview: { robot, joints: targets.filter((t) => t.target!.robot === robot).map((t) => t.target!.joints) } });
}

 
export function revealInTree() {
  const sel = selection();
  if (!sel.length) return setStatus("Nothing selected");
  void selectNow([sel[0]]);
  window.dispatchEvent(new CustomEvent("rc-reveal", { detail: { id: sel[0] } }));
}

 
export async function renameUI() {
  const sel = selection();
  let id = sel[0];
  if (!id) {
    const items = Object.values(ws()?.items ?? {}).filter((i) => inActiveStation(i.id) && i.type !== "instruction");
    id = (await pickItem("What item do you want to rename?<br>(rename items faster using F2 key in selecting the item in the tree)", items))?.id ?? "";
  }
  if (id) useRC.setState({ renameFor: id });
}

 
export function fitSelection() {
  const sel = selection();
  if (!sel.length) return setStatus("Select object to reframe on");
  pushView({ action: "fit", items: sel });
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};








export function useInteraction() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
       
       
      if (navStyle(state().settings) === "classic" && (e.altKey || e.key === "Alt")) {
        const meta = e.metaKey || e.ctrlKey;
        if (meta) useRC.setState({ holdPan: true, moveMode: "default" });
        else if (e.key === "Alt" || e.key === "Shift") useRC.setState({ moveMode: e.shiftKey ? "tools" : "references" });
      }
      if (e.code === "Space" && !e.repeat && !e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void cmd("sim.fastToggle", {}, { quiet: true });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") useRC.setState({ moveMode: "default", holdPan: false });
      else if ((e.key === "Meta" || e.key === "Control") && state().holdPan) useRC.setState({ holdPan: false, moveMode: e.altKey ? "references" : "default" });
      else if (e.key === "Shift" && e.altKey && navStyle(state().settings) === "classic") useRC.setState({ moveMode: "references" });
      if (typing(e.target)) return;
      if (e.code === "Space" && !e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!selection().length) void cmd("sim.fastToggle", {}, { quiet: true });
      }
    };
    const blur = () => useRC.setState({ moveMode: "default", holdPan: false });
    const onCopy = async (e: ClipboardEvent, cut: boolean) => {
      if (typing(e.target)) return;
      e.preventDefault();
      const r = await cmd<{ clipboardText: string | null }>(cut ? "edit.cut" : "edit.copy", {});
      const text = r?.clipboardText;
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
           
        }
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain");
      void cmdx("edit.paste", text ? { text } : {}).then((r) => {
        if (!r.ok) useRC.getState().toast({ kind: "error", title: "Paste", body: r.error ?? "" });
      });
    };
    const copy = (e: ClipboardEvent) => void onCopy(e, false);
    const cut = (e: ClipboardEvent) => void onCopy(e, true);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
}
