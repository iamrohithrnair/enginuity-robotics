"use client";

import { useState } from "react";
import { useRC } from "@/client/store";
import { Icon } from "./icons";

export default function CodeViewer() {
  const view = useRC((s) => s.codeView);
  const [tab, setTab] = useState(0);
  if (!view) return null;
  const file = view.files[Math.min(tab, view.files.length - 1)];
  const close = () => useRC.setState({ codeView: null });
  const lines = file?.content.split("\n") ?? [];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 74, display: "grid", placeItems: "center", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass glass-strong liquid rc-pop" style={{ width: "min(900px, calc(100vw - 60px))", height: "min(720px, calc(100vh - 60px))", borderRadius: 26, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--hair)" }}>
          <Icon.Code size={18} />
          <div>
            <div style={{ font: "700 15px var(--font-ui)" }}>{view.program}</div>
            <div style={{ color: "var(--ink-2)", font: "500 11.5px var(--font-ui)" }}>Generated with post processor {view.post}</div>
          </div>
          <div style={{ display: "flex", gap: 4, marginLeft: 20 }}>
            {view.files.map((f, i) => (
              <button key={f.name} className={`g-btn ${i === tab ? "active" : "ghost"}`} style={{ height: 26 }} onClick={() => setTab(i)}>
                {f.name}
              </button>
            ))}
          </div>
          <button className="g-btn" style={{ marginLeft: "auto" }} onClick={() => file && void navigator.clipboard.writeText(file.content).then(() => useRC.getState().toast({ kind: "success", title: "Copied to clipboard" }))}>
            <Icon.Copy size={14} /> Copy
          </button>
          <button
            className="g-btn"
            onClick={() => {
              if (!file) return;
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([file.content], { type: "text/plain" }));
              a.download = file.name;
              a.click();
            }}
          >
            <Icon.Download size={14} /> Save
          </button>
          <button className="g-btn icon ghost" onClick={close} aria-label="Close" title="Close">
            <Icon.Close />
          </button>
        </div>
        <div className="g-scroll mono" style={{ flex: 1, padding: "12px 0", font: "500 12px/1.6 var(--font-mono)", userSelect: "text", background: "var(--well)" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "flex", whiteSpace: "pre" }}>
              <span style={{ width: 52, textAlign: "right", paddingRight: 14, color: "var(--ink-3)", userSelect: "none", flexShrink: 0 }}>{i + 1}</span>
              <span style={{ color: highlight(l) }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function highlight(line: string): string {
  const t = line.trim();
  if (t.startsWith("!") || t.startsWith(";") || t.startsWith("#") || t.startsWith("//") || t.startsWith("%")) return "var(--ink-3)";
  if (/^(MoveL|MoveJ|MoveAbsJ|MoveC|movel|movej|PTP|LIN|CIRC|J |L )/i.test(t)) return "var(--info)";
  if (/^(PROC|ENDPROC|MODULE|ENDMODULE|DEF|END|def|end)/.test(t)) return "var(--orange)";
  return "var(--ink-0)";
}
