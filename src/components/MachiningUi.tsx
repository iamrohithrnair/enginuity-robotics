"use client";

 
 
 
 

import { useEffect, useRef } from "react";
import { cmd } from "@/client/api";
import { useMachiningUi } from "@/client/machiningUi";
import { useRC } from "@/client/store";
import { NC_EXTENSIONS } from "@/engine/machining/nc";
import { finishCurveTool } from "./viewport/Curves";

const TEXT_ACCEPT = ".csv,.txt";
const NC_ACCEPT = NC_EXTENSIONS.map((e) => `.${e}`).join(",");

function FilePicker() {
  const picker = useMachiningUi((s) => s.picker);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!picker || !input.current) return;
    input.current.value = "";
    input.current.accept = picker.kind === "points" || picker.kind === "curve" ? TEXT_ACCEPT : NC_ACCEPT;
    input.current.click();
  }, [picker]);
  return (
    <input
      ref={input}
      type="file"
      hidden
      onChange={async (e) => {
        const req = useMachiningUi.getState().picker;
        useMachiningUi.setState({ picker: null });
        const f = e.target.files?.[0];
        if (!f || !req) return;
        const text = await f.text();
        if (req.kind === "points") await cmd("object.importPoints", { text, fileName: f.name, ...(req.object ? { object: req.object } : {}) });
        else if (req.kind === "curve") await cmd("object.importCurve", { text, fileName: f.name, ...(req.object ? { object: req.object } : {}) });
        else if (req.project) await cmd("machining.setInput", { project: req.project, ncText: text, fileName: f.name });
        else await cmd("machining.openNc", { fileName: f.name, text, kind: req.kind === "print3d" ? "print3d" : "machining" });
      }}
    />
  );
}

function ToolBar() {
  const tool = useMachiningUi((s) => s.tool);
  const ws = useRC((s) => s.ws);
  if (!tool) return null;
  const set = (patch: Partial<NonNullable<typeof tool>>) => useMachiningUi.setState({ tool: { ...tool, ...patch } as typeof tool });
  let title = "";
  let detail = "";
  if (tool.mode === "create") {
    title = "Add/Modify Curves/Points";
    detail = tool.object && ws?.items[tool.object] ? `${ws.items[tool.object].name}: ${tool.points.length} points` : "Click on an object surface to add curve points";
  } else if (tool.mode === "select") {
    title = tool.kind === "point" ? "Point selection" : "Curve selection";
    detail = tool.kind === "point" ? "Select one or more points, then select ESC when done" : `Select one or more curves, then select ESC when done (${tool.curves.length} selected)`;
  } else {
    title = "Targets on surface";
    detail = "Click on a surface to add a target";
  }
  return (
    <div
      className="glass rc-enter"
      role="toolbar"
      aria-label={title}
      style={{ position: "fixed", top: "calc(var(--topbar-bottom, 58px) + 12px)", left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 14, maxWidth: "calc(100vw - 32px)", flexWrap: "wrap" }}
    >
      <strong style={{ font: "650 12.5px var(--font-ui)" }}>{title}</strong>
      <span style={{ font: "500 12px var(--font-ui)", color: "var(--ink-2)" }}>{detail}</span>
      {tool.mode === "surface" && (
        <>
          <button className={`g-btn ${tool.orient === "normal" ? "active" : ""}`} title="Maintain the TCP normal to the surface" onClick={() => set({ orient: "normal" })}>
            Normal
          </button>
          <button className={`g-btn ${tool.orient === "constant" ? "active" : ""}`} onClick={() => set({ orient: "constant" })}>
            Constant
          </button>
          {(["X", "Y", "Z"] as const).map((ax, i) => (
            <button
              key={ax}
              className="g-btn"
              title={`Rotate around Tool ${ax} axis`}
              onClick={() => {
                const rot = [...tool.rot] as [number, number, number];
                rot[i] = (rot[i] + 15) % 360;
                set({ rot });
              }}
            >
              R{ax} {tool.rot[i]}°
            </button>
          ))}
          <button className="g-btn ghost" onClick={() => set({ rot: [0, 0, 0] })}>
            Reset Orientation
          </button>
          <button className={`g-btn ${tool.preview ? "active" : ""}`} title="Show the robot at the target under the cursor" onClick={() => set({ preview: !tool.preview })}>
            Show preview
          </button>
        </>
      )}
      {tool.mode === "create" && tool.points.length > 0 && (
        <button className="g-btn ghost" onClick={() => set({ points: tool.points.slice(0, -1) })}>
          Undo point
        </button>
      )}
      <button className="g-btn primary" onClick={() => void finishCurveTool()}>
        Done
      </button>
      <button className="g-btn ghost" onClick={() => useMachiningUi.setState({ tool: null })}>
        Cancel
      </button>
    </div>
  );
}

function Report() {
  const report = useMachiningUi((s) => s.report);
  if (!report) return null;
  const close = () => useMachiningUi.setState({ report: null });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass glass-strong rc-pop" role="dialog" aria-label={report.title} style={{ minWidth: 320, maxWidth: 520, padding: 18, borderRadius: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ font: "700 15px var(--font-ui)" }}>{report.title}</div>
        <div style={{ font: "500 13px/1.5 var(--font-ui)", color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: report.html }} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="g-btn primary" autoFocus onClick={close}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MachiningUi() {
  return (
    <>
      <FilePicker />
      <ToolBar />
      <Report />
    </>
  );
}
