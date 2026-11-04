"use client";

 
 

import { useState } from "react";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import type { ScriptGenerated, ScriptRunView } from "@/engine/scripts";
import { Icon } from "../icons";
import { openScriptEditor } from "./uiStore";

export function openGenerated(g: ScriptGenerated) {
  useRC.setState({
    codeView: {
      program: g.program,
      post: g.post,
      files: g.files.map((f) => ({ name: f.name, content: f.content ?? `(${f.bytes.toLocaleString()} characters — open ${f.path ?? f.name})` })),
    },
  });
}

const mono = { font: "500 11px/1.5 var(--font-mono)" } as const;

export function ScriptRunCard({ run, showCode = false, onLine }: { run: ScriptRunView; showCode?: boolean; onLine?: (line: number) => void }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const lines = run.code?.split("\n") ?? [];
  const errLine = run.error?.line ?? null;
  const changes = [
    [run.counts.created, "created", run.created],
    [run.counts.changed, "changed", run.changed],
    [run.counts.deleted, "deleted", run.deleted],
  ] as const;

  const save = async () => {
    if (!run.code) return;
    const r = await cmd<{ id: string; name: string }>("script.save", { code: run.code, name: run.name });
    if (r) {
      setSaved(r.name);
      useRC.getState().toast({ kind: "success", title: "Script saved", body: `${r.name} is in the station tree. Double-click it to run it again.` });
    }
  };

  return (
    <div style={{ display: "grid", gap: 8, padding: "8px 10px", borderRadius: 12, background: "var(--fill-1)", border: "1px solid var(--hair)", font: "500 11.5px var(--font-ui)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", color: run.ok ? "var(--good)" : "var(--bad)" }}>{run.ok ? <Icon.Script size={15} /> : <Icon.Warning size={14} />}</span>
        <span style={{ font: "650 12px var(--font-ui)", color: "var(--ink-0)" }}>{run.name}</span>
        <span style={{ color: "var(--ink-3)", marginLeft: "auto" }}>
          {run.ok ? "done" : "failed"} · {run.calls} calls · {(run.ms / 1000).toFixed(1)} s
        </span>
      </div>
      {run.error && (
        <button
          className="g-btn ghost"
          style={{ height: "auto", padding: "6px 8px", justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", borderRadius: 8, color: "var(--bad)", background: "color-mix(in srgb, var(--bad) 10%, transparent)" }}
          onClick={() => errLine && (onLine ? onLine(errLine) : setCodeOpen(true))}
          title={errLine ? "Show the line" : undefined}
        >
          {errLine ? `Line ${errLine}: ` : ""}
          {run.error.message}
        </button>
      )}
      {showCode && run.code && (
        <div>
          <button className="g-btn ghost" style={{ height: 22, padding: "0 6px", marginLeft: -4, font: "550 11px var(--font-ui)" }} onClick={() => setCodeOpen(!codeOpen)}>
            {codeOpen ? <Icon.ChevronDown size={12} /> : <Icon.ChevronRight size={12} />} Script · {lines.length} lines
          </button>
          {codeOpen && (
            <div className="g-scroll" style={{ ...mono, maxHeight: 240, marginTop: 4, padding: "6px 0", borderRadius: 8, background: "var(--well)", userSelect: "text" }}>
              {lines.map((l, i) => (
                <div key={i} style={{ display: "flex", whiteSpace: "pre", background: errLine === i + 1 ? "color-mix(in srgb, var(--bad) 16%, transparent)" : undefined }}>
                  <span style={{ width: 34, textAlign: "right", paddingRight: 10, color: "var(--ink-3)", userSelect: "none", flexShrink: 0 }}>{i + 1}</span>
                  <span>{l}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {run.logs.length > 0 && (
        <div className="g-scroll" style={{ ...mono, maxHeight: 150, padding: "6px 8px", borderRadius: 8, background: "var(--well)", color: "var(--ink-1)", whiteSpace: "pre-wrap", userSelect: "text" }}>
          {run.truncated && <div style={{ color: "var(--ink-3)" }}>… earlier output not shown</div>}
          {run.logs.join("\n")}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, color: "var(--ink-2)" }}>
        {changes.map(([n, label, list]) => (
          <span key={label} title={list.join("\n") || undefined} style={{ textDecoration: run.reverted ? "line-through" : undefined }}>
            <strong style={{ color: "var(--ink-0)" }}>{n}</strong> {label}
          </span>
        ))}
        {run.undo && <span style={{ color: "var(--ink-3)" }}>· one undo step</span>}
        {run.reverted && <span style={{ color: "var(--ink-3)" }}>· undone because the run failed</span>}
      </div>
      {run.generated.map((g, i) => (
        <div key={`${g.program}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--fill-2)" }}>
          <Icon.Code size={14} />
          <div style={{ minWidth: 0 }}>
            <div style={{ font: "600 11.5px var(--font-ui)", color: "var(--ink-0)" }}>{g.program}</div>
            <div style={{ color: "var(--ink-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {g.post} · {g.files.map((f) => f.name).join(", ")}
            </div>
          </div>
          <button className="g-btn" style={{ height: 24, marginLeft: "auto" }} onClick={() => openGenerated(g)}>
            Open
          </button>
        </div>
      ))}
      {showCode && run.code && (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="g-btn" style={{ height: 26 }} disabled={Boolean(saved)} onClick={() => void save()} title="Keep this script in the station to run it again">
            <Icon.Save size={13} /> {saved ? `Saved as ${saved}` : "Save as script"}
          </button>
          <button className="g-btn ghost" style={{ height: 26 }} onClick={() => openScriptEditor(null, { draft: { name: run.name, code: run.code ?? "" } })}>
            <Icon.Code size={13} /> Open in editor
          </button>
        </div>
      )}
    </div>
  );
}
