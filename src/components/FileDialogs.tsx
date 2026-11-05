"use client";
// Hosts file prompts, undo history, backups, and station parameter dialogs.

 
 

import { useEffect, useMemo, useRef, useState } from "react";
import { cmd } from "@/client/api";
import { refreshRecent, useFileDialogs } from "@/client/fileActions";
import { useRC } from "@/client/store";
import { paramsView } from "@/engine/stationParams";
import { stationFileBase } from "@/engine/stationFile";
import { Icon } from "./icons";
import { Modal, richText } from "./Modal";

export default function FileDialogs() {
  const prompt = useFileDialogs((s) => s.prompt);
  const question = useFileDialogs((s) => s.question);
  const undoOpen = useFileDialogs((s) => s.undoStackOpen);
  const stationParams = useFileDialogs((s) => s.stationParams);
  const backups = useFileDialogs((s) => s.backups);
  const robotConfigs = useFileDialogs((s) => s.robotConfigs);
  const reorder = useFileDialogs((s) => s.reorder);
  useEffect(() => {
    void refreshRecent();
  }, []);
  return (
    <>
      {prompt && <PromptDialog key={prompt.title + prompt.value} />}
      {question && <QuestionDialog />}
      {undoOpen && <UndoStackWindow />}
      {stationParams && <StationParamsDialog id={stationParams} />}
      {backups && <BackupsDialog />}
      {robotConfigs && <RobotConfigsWindow key={robotConfigs} robot={robotConfigs} />}
      {reorder && <ReorderDialog key={reorder.join()} items={reorder} />}
    </>
  );
}

function PromptDialog() {
  const p = useFileDialogs((s) => s.prompt)!;
  const [text, setText] = useState(p.value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <Modal title={p.title} onClose={() => p.resolve(null)}>
      <div style={{ font: "500 12.5px var(--font-ui)", color: "var(--ink-1)", marginBottom: 8 }}>{p.label}</div>
      <input
        ref={input}
        className="g-input"
        aria-label={p.label}
        style={{ width: "100%" }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") p.resolve(text);
          if (e.key === "Escape") {
            e.stopPropagation();
            p.resolve(null);
          }
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={() => p.resolve(null)}>
          Cancel
        </button>
        <button className="g-btn primary" onClick={() => p.resolve(text)}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function QuestionDialog() {
  const q = useFileDialogs((s) => s.question)!;
  return (
    <Modal title={q.title} onClose={() => q.resolve(q.buttons.at(-1) ?? "")}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ color: "var(--accent)", marginTop: 2 }}>
          <Icon.Info size={20} />
        </div>
        <div style={{ font: "500 13px/1.5 var(--font-ui)", color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: richText(q.html) }} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        {q.buttons.map((b, i) => (
          <button key={b} autoFocus={i === q.buttons.length - 1} className={`g-btn ${i === q.buttons.length - 1 ? "primary" : ""}`} onClick={() => q.resolve(b)}>
            {b}
          </button>
        ))}
      </div>
    </Modal>
  );
}

type UndoList = { undo: string[]; redo: string[]; index?: number; cleanIndex?: number };





function UndoStackWindow() {
  const list = useRC((s) => s.undo) as UndoList;
  const rows = ["<empty>", ...list.undo, ...list.redo];
  const index = list.index ?? list.undo.length;
  return (
    <div
      className="glass liquid rc-enter"
      role="dialog"
      aria-label="Undo stack"
      style={{ position: "fixed", right: 360, top: "calc(var(--topbar-bottom, 58px) + 12px)", zIndex: 60, width: 300, maxHeight: "60vh", display: "flex", flexDirection: "column", borderRadius: 16, padding: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, font: "650 12.5px var(--font-ui)" }}>
        <span>Undo stack</span>
        <button className="g-btn icon ghost" aria-label="Close undo stack" title="Close undo stack" onClick={() => useFileDialogs.setState({ undoStackOpen: false })}>
          <Icon.Close />
        </button>
      </div>
      <div className="g-scroll" style={{ overflow: "auto" }}>
        {rows.map((label, k) => (
          <button
            key={k}
            className={`g-btn ${k === index ? "active" : "ghost"}`}
            style={{ width: "100%", justifyContent: "flex-start", gap: 6, opacity: k > index ? 0.55 : 1 }}
            onClick={() => void cmd("edit.undoTo", { index: k })}
          >
            <span style={{ width: 14, display: "inline-flex" }}>{list.cleanIndex === k ? <Icon.Save size={12} /> : null}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

 
function StationParamsDialog({ id }: { id: string }) {
  const station = useRC((s) => s.ws?.items[id]);
   
  const stored = useRC((s) => s.ws?.items[id]?.stationParams);
  const params = useMemo(() => paramsView(stored ?? []), [stored]);
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(params));
  const close = () => useFileDialogs.setState({ stationParams: null });
  const save = async () => {
    const before = new Set(Object.keys(params));
    for (const [k, v] of rows) if (k.trim() && params[k.trim()] !== v) await cmd("station.setParam", { key: k.trim(), value: v, station: id });
    for (const k of before) if (!rows.some(([r]) => r.trim() === k)) await cmd("station.deleteParam", { key: k, station: id });
    close();
  };
  return (
    <Modal title={`Station Parameters${station ? `: ${station.name}` : ""}`} onClose={close} width={520}>
      <div className="glass-inset g-scroll" style={{ maxHeight: 300, overflow: "auto", padding: 6, display: "grid", gap: 4 }}>
        {rows.length === 0 && <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-3)", padding: 6 }}>No station parameters</div>}
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 6 }}>
            <input className="g-input" aria-label="Parameter" value={k} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
            <input className="g-input" aria-label="Value" value={v} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
            <button className="g-btn icon ghost" aria-label="Remove parameter" title="Remove parameter" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Icon.Close />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={() => setRows([...rows, ["", ""]])}>
          Add
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="g-btn" onClick={close}>
            Cancel
          </button>
          <button className="g-btn primary" onClick={() => void save()}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}

 
function BackupsDialog() {
  const backups = useFileDialogs((s) => s.backups)!;
  const [sel, setSel] = useState(backups[0]?.file ?? "");
  const close = () => useFileDialogs.setState({ backups: null });
  return (
    <Modal title="Recover Auto Backup" onClose={close} width={520}>
      <div style={{ font: "500 12.5px/1.45 var(--font-ui)", color: "var(--ink-1)", marginBottom: 10 }}>
        Select a backup to recover.
        <br />
        Auto saved backup files are saved automatically in: data/backups
      </div>
      <div className="glass-inset" style={{ borderRadius: 12, maxHeight: 240, overflow: "auto", padding: 4 }}>
        {backups.map((b) => (
          <button key={b.file} className={`g-btn ${sel === b.file ? "active" : "ghost"}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => setSel(b.file)}>
            {stationFileBase(b.file)}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={close}>
          Cancel
        </button>
        <button
          className="g-btn primary"
          disabled={!sel}
          onClick={() => {
            close();
            void cmd("station.recoverBackup", { file: sel });
          }}
        >
          Recover
        </button>
      </div>
    </Modal>
  );
}

type Config = { joints: number[]; config: number[]; current: boolean };





function RobotConfigsWindow({ robot }: { robot: string }) {
  const ws = useRC((s) => s.ws);
  const joints = useRC((s) => s.ws?.items[robot]?.robot?.joints);
  const [data, setData] = useState<{ title: string; configurations: Config[] } | null>(null);
  useEffect(() => {
    let live = true;
    void cmd<{ title: string; configurations: Config[] }>("robot.configurations", { robot }).then((r) => live && setData(r));
    return () => {
      live = false;
    };
  }, [robot, joints]);
  const close = () => useFileDialogs.setState({ robotConfigs: null });
  if (!ws?.items[robot]) return null;
  return (
    <div className="glass liquid rc-enter" role="dialog" aria-label="Robot Configurations" style={{ position: "fixed", right: 360, top: "calc(var(--topbar-bottom, 58px) + 12px)", zIndex: 60, width: 420, maxHeight: "60vh", display: "flex", flexDirection: "column", borderRadius: 16, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, font: "650 12.5px var(--font-ui)" }}>
        <span>{data?.title ?? `${ws.items[robot].name}: Robot Configurations`}</span>
        <button className="g-btn icon ghost" aria-label="Close robot configurations" title="Close robot configurations" onClick={close}>
          <Icon.Close />
        </button>
      </div>
      <div className="g-scroll" style={{ overflow: "auto" }}>
        {data?.configurations.length === 0 && <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-3)", padding: 6 }}>No other configurations</div>}
        {data?.configurations.map((c, k) => (
          <button key={k} className={`g-btn ${c.current ? "active" : "ghost"}`} style={{ width: "100%", justifyContent: "flex-start", gap: 8, fontSize: 11.5 }} onClick={() => void cmd("robot.setJoints", { robot, joints: c.joints })}>
            <span className="mono" style={{ width: 52, color: "var(--ink-2)" }}>[{c.config.slice(0, 3).join(",")}]</span>
            <span className="mono">{c.joints.map((v) => v.toFixed(2)).join("  ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

 
function ReorderDialog({ items }: { items: string[] }) {
  const ws = useRC((s) => s.ws);
  const first = ws?.items[items[0]];
  const parent = first?.parent ? ws?.items[first.parent] : undefined;
  const siblings = (parent?.children ?? []).filter((c) => !items.includes(c));
  const [sel, setSel] = useState(siblings[0] ?? "");
  const close = () => useFileDialogs.setState({ reorder: null });
  const ok = async () => {
    if (sel) await cmd("item.reorder", { items, before: sel });
    close();
  };
  return (
    <Modal title="Enginuity" onClose={close}>
      <div style={{ font: "500 12.5px/1.45 var(--font-ui)", color: "var(--ink-1)", marginBottom: 10 }}>Selected item(s) in the station tree will be placed on top of the selected item in this list</div>
      <div className="glass-inset" style={{ borderRadius: 12, maxHeight: 240, overflow: "auto", padding: 4 }}>
        {siblings.map((id) => (
          <button key={id} className={`g-btn ${sel === id ? "active" : "ghost"}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => setSel(id)} onDoubleClick={() => void ok()}>
            {ws?.items[id]?.name || "(no name)"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={close}>
          Cancel
        </button>
        <button className="g-btn primary" disabled={!sel} onClick={() => void ok()}>
          OK
        </button>
      </div>
    </Modal>
  );
}
