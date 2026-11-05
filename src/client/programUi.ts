// Coordinates instruction editors, program dialogs and script actions.
"use client";

 
 
 
 

import { create } from "zustand";
import { selectedProgram } from "@/engine/actions";
import type { Item } from "@/engine/types";
import { cmd, cmdx, onServerEvent, setStatus } from "./api";
import { pickItem } from "./interaction";
import { useRC } from "./store";
import { registerUiAction } from "./uiActions";

export type ProgramDialog =
  | { kind: "edit-instruction"; instruction: string }
  | { kind: "event-insert"; program: string | null }
  | { kind: "configs"; target: string; robot: string; original: number[] }
  | { kind: "generate-as"; programs: string[] }
  | { kind: "python-confirm"; item: string | null; instruction: string | null; name: string; code: string; hash: string }
  | { kind: "python-edit"; item: string }
  | { kind: "number"; title: string; label: string; value: number; decimals: number; min: number; max: number; onOk: (v: number) => void }
  | { kind: "vector"; title: string; label: string; onOk: (v: [number, number, number]) => void }
  | { kind: "text"; title: string; label: string; value: string; onOk: (v: string) => void };

interface ProgramUiState {
  dialogs: (ProgramDialog & { id: number })[];
  open(d: ProgramDialog): void;
  close(id: number): void;
}

let nextId = 1;

export const useProgramUi = create<ProgramUiState>((set) => ({
  dialogs: [],
  open: (d) => set((s) => ({ dialogs: [...s.dialogs.filter((x) => x.kind !== d.kind || x.kind === "number" || x.kind === "text"), { ...d, id: nextId++ }] })),
  close: (id) => set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) })),
}));

const open = (d: ProgramDialog) => useProgramUi.getState().open(d);
const ws = () => useRC.getState().ws;
const selectedIds = (type: Item["type"]) => {
  const w = ws();
  return w ? w.selection.filter((id) => w.items[id]?.type === type) : [];
};

 
export const openInstructionEditor = (instruction: string) => open({ kind: "edit-instruction", instruction });
 
export const openEventInsert = (program: string | null) => open({ kind: "event-insert", program });
export const openPythonEditor = (item: string) => open({ kind: "python-edit", item });

 
export function askNumber(title: string, label: string, value: number, opts: { decimals?: number; min?: number; max?: number } = {}): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    open({
      kind: "number",
      title,
      label,
      value,
      decimals: opts.decimals ?? 3,
      min: opts.min ?? -999999,
      max: opts.max ?? 999999,
      onOk: (v) => {
        done = true;
        resolve(v);
      },
    });
    const unsub = useProgramUi.subscribe((s) => {
      if (!s.dialogs.some((d) => d.kind === "number" && d.label === label)) {
        unsub();
        if (!done) resolve(null);
      }
    });
  });
}

export function askText(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    open({
      kind: "text",
      title,
      label,
      value,
      onOk: (v) => {
        done = true;
        resolve(v);
      },
    });
    const unsub = useProgramUi.subscribe((s) => {
      if (!s.dialogs.some((d) => d.kind === "text" && d.label === label)) {
        unsub();
        if (!done) resolve(null);
      }
    });
  });
}

export function askVector(title: string, label: string): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    let done = false;
    open({
      kind: "vector",
      title,
      label,
      onOk: (v) => {
        done = true;
        resolve(v);
      },
    });
    const unsub = useProgramUi.subscribe((s) => {
      if (!s.dialogs.some((d) => d.kind === "vector")) {
        unsub();
        if (!done) resolve(null);
      }
    });
  });
}

 
export function openConfigs(targetId: string) {
  const w = ws();
  const t = w?.items[targetId];
  if (!w || !t?.target) return setStatus("Select a target");
  const robotId = t.target.robot && w.items[t.target.robot]?.robot ? t.target.robot : Object.values(w.items).find((i) => i.type === "robot")?.id;
  if (!robotId) return setStatus("Select robot first");
  open({ kind: "configs", target: targetId, robot: robotId, original: w.items[robotId].robot!.joints.slice() });
}

 
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    setStatus("The clipboard is not available in this browser context");
  }
}

 
export async function offsetTargetsUI(instructions: string[]) {
  const v = await askVector("Offset Targets", "Set shift value for the selected targets (mm)");
  if (v) await cmd("instruction.offsetTargets", { instructions, offset: v });
}

 
export async function toolShiftUI(instructions: string[], axis: "Tx" | "Ty" | "Tz" | "Rx" | "Ry" | "Rz") {
  const unit = axis.startsWith("R") ? "deg" : "mm";
  const v = await askNumber("Enter value", `Enter a relative TCP shift ${axis} (${unit})`, 1, { decimals: 3 });
  if (v !== null) await cmd("instruction.relativeToolShift", { instructions, axis, value: v });
}

 
export function runScriptUI() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".py,text/x-python";
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((code) => cmd("python.runScript", { name: f.name, code }));
  };
  input.click();
}

 
export async function savePythonAs(item: string) {
  const r = await cmd<{ name: string; code: string }>("python.saveAs", { item });
  if (!r) return;
  const url = URL.createObjectURL(new Blob([r.code], { type: "text/x-python" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = r.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

 
export async function savePythonAll(items: string[]) {
  const r = await cmd<{ name: string; code: string }[]>("python.saveAll", { items });
  for (const f of r ?? []) {
    const url = URL.createObjectURL(new Blob([f.code], { type: "text/x-python" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const isBusy = (id: string) => !!useRC.getState().ws?.busy?.includes(id);

 
function scriptEnd(id: string, startMs = 3000, endMs = 120_000): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let started = isBusy(id);
    const timer = setInterval(() => {
      if (isBusy(id)) started = true;
      const waited = Date.now() - t0;
      if ((started && !isBusy(id)) || (!started && waited > startMs) || waited > endMs) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}





export async function displayPythonPaths(items: string[], show: boolean) {
  for (const item of items) {
    const r = await quiet("python.runMode", { item, mode: "path", show });
    if (!show) continue;
    if (!r.ok || (r.result as { pending?: boolean } | undefined)?.pending) break;
    await scriptEnd(item);
  }
}





async function f5() {
  const w = ws();
  if (!w) return;
  const targets = selectedIds("target");
  if (targets.length) {
    await cmd("target.preview", { targets });
    return;
  }
  const py = selectedIds("python")[0];
  if (py) {
    await cmd("python.run", { item: py });
    return;
  }
  const prog = selectedProgram(w);
  if (prog) await cmd("program.check", { program: prog });
  else setStatus("Select program to validate");
}

let installed = false;

 
export function installProgramUi() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  onServerEvent((e) => {
    switch (e.type) {
      case "edit-instruction":
        openInstructionEditor(String(e.instruction));
        break;
      case "reveal":
        window.dispatchEvent(new CustomEvent("rc-reveal", { detail: { id: String(e.item) } }));
        break;
      case "preview-targets":
        useRC.setState({ preview: { robot: String(e.robot), joints: e.joints as number[][] } });
        break;
      case "python-confirm":
        open({
          kind: "python-confirm",
          item: (e.item as string | null) ?? null,
          instruction: (e.instruction as string | null) ?? null,
          name: String(e.name),
          code: String(e.code),
          hash: String(e.hash),
        });
        break;
    }
  });
  registerUiAction("actionAdd_Event", () => openEventInsert(ws() ? (selectedProgram(ws()!) ?? null) : null));
  registerUiAction("actionAdd_Robot_Change", async () => {
    const w = ws();
    if (!w) return;
    const robots = Object.values(w.items).filter((i) => i.type === "robot");
    const sel = robots.find((r) => w.selection.includes(r.id));
    const robot = sel ?? (await pickItem("Select a robot", robots));
    if (robot) await cmd("program.addInstruction", { kind: "robot", robot: robot.id, ...(selectedProgram(w) ? { program: selectedProgram(w) } : {}) });
  });
  registerUiAction("actionPreview_Targets", f5);
  registerUiAction("actionChange_target_configuration", () => {
    const t = selectedIds("target")[0];
    if (t) openConfigs(t);
    else setStatus("Select a target");
  });
  registerUiAction("actionGenerate_program", () => {
    const w = ws();
    if (!w) return;
    const progs = selectedIds("program");
    const p = selectedProgram(w);
    if (!progs.length && p) progs.push(p);
    if (!progs.length) return setStatus("Select a program first");
    open({ kind: "generate-as", programs: progs });
  });
  registerUiAction("actionRun_Script", runScriptUI);
   
  window.addEventListener("rc-configs", (ev) => {
    const target = (ev as CustomEvent<{ target: string }>).detail?.target;
    if (target) openConfigs(target);
  });
}

 
export async function quiet(name: string, params: Record<string, unknown>) {
  const r = await cmdx(name, params);
  if (!r.ok && r.error) setStatus(r.error);
  return r;
}
