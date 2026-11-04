"use client";

 
 
 
 

import { useEffect, useState } from "react";
import { create } from "zustand";
import { cmd, cmdx } from "@/client/api";
import { downloadBase64 } from "@/client/fileActions";
import { useRC, useViewState } from "@/client/store";
import { registerUiAction, runAction } from "@/client/uiActions";
import { robotShowFrames, SHOW_FRAME_LABELS } from "@/engine/commands/robot-display";
import { layoutText, parseLayout } from "@/engine/layout";
import type { Item } from "@/engine/types";
import { WORKSPACE_MODE_LABELS } from "@/engine/workspaceEnvelope";
import { ContextMenu } from "../glass/Menu";
import { Check, Combo, Field, Radios, Section } from "../inspector/fields";
import { menuBar, type MenuState } from "../menuBar";
import { mainMenuEntries, withContributions } from "../menuContrib";
import { Message, Window } from "./utilities";

type Panel = { kind: "export" } | { kind: "demo" };
const usePanel = create<{ panel: Panel | null }>(() => ({ panel: null }));
const close = () => usePanel.setState({ panel: null });

 

interface RecState {
  recording: boolean;
  seconds: number;
  samples: number;
  text: string;
  programs: { id: string; name: string; type: string }[];
}






function ExportSimulation() {
  const [st, setSt] = useState<RecState | null>(null);
  const [mode, setMode] = useState<"custom" | "program">("custom");
  const [program, setProgram] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const refresh = async () => {
    const r = await cmd<RecState>("sim.exportState", {}, { quiet: true });
    if (r) {
      setSt(r);
      if (r.programs.length) setProgram((p) => p || r.programs[0].id);
    }
    return r;
  };
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!st) return null;
  const startStop = async () => {
    setMsg({ text: "" });
    const r = st.recording ? await cmdx<RecState>("sim.exportStop", {}) : await cmdx<RecState>("sim.exportStart", mode === "program" ? { mode, program: program || undefined } : { mode });
    if (!r.ok) setMsg({ text: r.error ?? "", bad: true });
    await refresh();
  };
  const save = async () => {
    setMsg({ text: "" });
    const r = await cmdx<{ path: string; fileName: string; base64: string }>("sim.exportSave", {});
    if (!r.ok || !r.result) return setMsg({ text: r.error ?? "", bad: true });
    downloadBase64(r.result.fileName, r.result.base64);
    setMsg({ text: `Simulation saved successfully: ${r.result.path}` });
    await refresh();
  };
  return (
    <Window title="Export simulation" onClose={close} width={380}>
      <Field label="Export format:" inline>
        <Combo label="Export format" value="html" onChange={() => undefined} options={[{ value: "html", label: "html" }]} />
      </Field>
      <Section title="Export type">
        <Radios
          label="Export type"
          value={mode}
          onChange={setMode}
          options={[
            { value: "custom", label: "Custom simulation" },
            { value: "program", label: "Existing program" },
          ]}
        />
        {mode === "program" && (
          <div style={{ marginTop: 6 }}>
            <Combo label="Program" value={program} onChange={setProgram} disabled={!st.programs.length} options={st.programs.length ? st.programs.map((p) => ({ value: p.id, label: p.name })) : [{ value: "", label: "No programs" }]} />
          </div>
        )}
      </Section>
      <div role="status" aria-label="Recording state" style={{ font: "550 12.5px var(--font-ui)", color: st.recording ? "var(--bad)" : "var(--ink-1)", margin: "6px 2px 10px" }}>
        {st.text}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="g-btn primary" onClick={() => void save()} disabled={!st.samples && !st.recording}>
          Save
        </button>
        <button className={`g-btn ${st.recording ? "" : "primary"}`} onClick={() => void startStop()} aria-label={st.recording ? "Stop" : "Start"}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: st.recording ? 2 : 9, background: "var(--bad)", display: "inline-block" }} />
          {st.recording ? "Stop" : "Start"}
        </button>
      </div>
      <Message text={msg.text} tone={msg.bad ? "bad" : "neutral"} />
    </Window>
  );
}

 

 
function MakeDemo() {
  const [name, setName] = useState("Enginuity demo.zip");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    setMsg({ text: "Making demo package, please wait..." });
    const r = await cmdx<{ path: string; fileName: string; base64: string; html: string }>("station.makeDemo", { fileName: name });
    setBusy(false);
    if (!r.ok || !r.result) return setMsg({ text: r.error ?? "Cannot make a demo package", bad: true });
    downloadBase64(r.result.fileName, r.result.base64);
    setMsg({ text: r.result.html });
  };
  return (
    <Window title="Make a demo package..." onClose={close} width={400}>
      <Field label="Output file:">
        <input className="g-input" aria-label="Output file" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Section title="Output type">
        <Radios label="Output type" value="zip" onChange={() => undefined} options={[{ value: "zip", label: "Make a zip file (*.zip)" }]} />
      </Section>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button className="g-btn primary" disabled={busy} onClick={() => void generate()}>
          Generate file
        </button>
      </div>
      <Message text={msg.text} tone={msg.bad ? "bad" : "neutral"} />
    </Window>
  );
}

 

 
export function RobotDisplayOptions({ robot }: { robot: Item }) {
  const view = useViewState();
  const mode = robot.params?.ShowWorkspace !== undefined ? Number(robot.params.ShowWorkspace) : view.workspace ? 2 : 0;
  const f = robotShowFrames(robot);
  const n = robot.robot?.model.nq ?? 0;
  const links = Array.from({ length: n + 1 }, (_, i) => i);
  const all = f.tool && f.ref && f.flange && links.every((i) => f.links.includes(i));
  const set = (p: Record<string, unknown>) => void cmd("robot.showFrames", { robot: robot.id, ...p });
  return (
    <>
      <Section title="WorkSpace">
        <Combo label="WorkSpace" value={String(mode)} onChange={(v) => void cmd("robot.showWorkspace", { robot: robot.id, mode: Number(v) })} options={WORKSPACE_MODE_LABELS.map((label, i) => ({ value: String(i), label }))} />
      </Section>
      <Section title="Show Frames" right={<Check label={SHOW_FRAME_LABELS.all} checked={all} onChange={(v) => set({ all: v })} />}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Check label={SHOW_FRAME_LABELS.tool} checked={f.tool} onChange={(v) => set({ tool: v })} />
          <Check label={SHOW_FRAME_LABELS.ref} checked={f.ref} onChange={(v) => set({ ref: v })} />
          <Check label={SHOW_FRAME_LABELS.flange} checked={f.flange} onChange={(v) => set({ flange: v })} />
          {links.map((i) => (
            <Check key={i} label={i === 0 ? SHOW_FRAME_LABELS.base : `Joint ${i}`} checked={f.links.includes(i)} onChange={(v) => set({ links: v ? [...f.links, i] : f.links.filter((x) => x !== i) })} />
          ))}
        </div>
      </Section>
    </>
  );
}

 

let lastPointer = { x: 120, y: 120 };

 
function CinemaMenus() {
  const view = useViewState();
  const ws = useRC((s) => s.ws);
  const settings = useRC((s) => s.settings);
  const undo = useRC((s) => s.undo);
  const hold = useRC((s) => s.moveMode);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => (lastPointer = { x: e.clientX, y: e.clientY });
    const key = (e: KeyboardEvent) => {
      if (e.key !== "F10" || !view.cinema) return;
      e.preventDefault();
      setAt({ ...lastPointer });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key);
    };
  }, [view.cinema]);
  if (!at || !view.cinema) return null;
  const state: MenuState = { ws, settings, undo, hold, view, fullscreen: typeof document !== "undefined" && !!document.fullscreenElement };
  const entries = menuBar(state).map((m) => ({ label: m.name, submenu: withContributions(m.entries, mainMenuEntries(m.name)) }));
  return <ContextMenu x={at.x} y={at.y} entries={entries} onClose={() => setAt(null)} />;
}

 





function LayoutPersistence() {
  const view = useViewState();
  const rightPanel = useRC((s) => s.rightPanel);
  const ready = useRC((s) => !!s.ws && Object.keys(s.settings).length > 0);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    const saved = parseLayout(useRC.getState().settings.RC_LAYOUT);
    const t = setTimeout(() => {
      if (saved) {
        useRC.setState({ rightPanel: saved.rightPanel });
        void cmd("view.toolbar", { layout: saved.toolbar === "No Toolbar" ? "None" : saved.toolbar }, { quiet: true });
        void cmd("view.setDisplay", { treeInside: saved.treeInside, treeVisible: saved.treeVisible }, { quiet: true });
      }
      setRestored(true);
    }, 0);
    return () => clearTimeout(t);
  }, [ready, restored]);
  const text = layoutText({ toolbar: view.toolbar, treeInside: view.treeInside, treeVisible: view.treeVisible, rightPanel });
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      if (useRC.getState().settings.RC_LAYOUT !== text) void cmd("settings.set", { key: "RC_LAYOUT", value: text }, { quiet: true });
    }, 800);
    return () => clearTimeout(t);
  }, [restored, text]);
  return null;
}

 

registerUiAction("actionExport_3D_Simulation", () => usePanel.setState({ panel: { kind: "export" } }));
registerUiAction("actionMake_demo_station", () => usePanel.setState({ panel: { kind: "demo" } }));
 
registerUiAction("actionDraw_curve_on_part", () => runAction("actionCurveCreate"));

 
export default function A3Host() {
  const panel = usePanel((s) => s.panel);
  return (
    <>
      <CinemaMenus />
      <LayoutPersistence />
      {panel?.kind === "export" && <ExportSimulation />}
      {panel?.kind === "demo" && <MakeDemo />}
    </>
  );
}
