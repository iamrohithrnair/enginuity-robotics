"use client";
// Hosts color, measurement, help, and auxiliary view panels.

 
 

import { useEffect, useMemo, useState } from "react";
import { cmd } from "@/client/api";
import { SHORTCUTS, prettyKeys } from "@/client/shortcuts";
import { useRC, useViewState } from "@/client/store";
import { ABOUT } from "@/engine/about";
import { navStyle } from "@/engine/view";
import { Icon } from "./icons";
import Notepad from "./Notepad";

function Panel({ title, icon, onClose, children, style }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="glass glass-strong rc-pop" role="dialog" aria-label={title} style={{ position: "fixed", zIndex: 70, borderRadius: 18, padding: 14, display: "flex", flexDirection: "column", gap: 10, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <div style={{ font: "700 14px var(--font-ui)" }}>{title}</div>
        <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} aria-label="Close" title="Close" onClick={onClose}>
          <Icon.Close size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}

const toHex = (c: number[]) => `#${c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

const SWATCHES = ["#e8e8e5", "#9ca3af", "#3f3f46", "#2563eb", "#16a34a", "#eab308", "#ea580c", "#dc2626", "#9333ea", "#0e7490"];

 
function ColorPanel({ ids }: { ids: string[] }) {
  const ws = useRC((s) => s.ws);
  const first = ws?.items[ids[0]];
  const base = first?.color ?? first?.object?.meshes[0]?.color ?? first?.tool?.meshes[0]?.color ?? [0.8, 0.8, 0.82, 1];
  const [hex, setHex] = useState(toHex(base));
  const [alpha, setAlpha] = useState(base[3] ?? 1);
  const close = () => useRC.setState({ colorFor: null });
  const apply = (h: string, a: number) => {
    setHex(h);
    setAlpha(a);
    for (const id of ids) void cmd("item.setColor", { item: id, color: [...fromHex(h), a] }, { quiet: true });
  };
  const names = ids.map((id) => ws?.items[id]?.name).filter(Boolean);
  return (
    <Panel title="Change Color" icon={<Icon.Palette size={16} />} onClose={close} style={{ left: "50%", top: 120, translate: "-50% 0", width: 300 }}>
      <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{names.join(", ")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SWATCHES.map((s) => (
          <button key={s} aria-label={`Color ${s}`} onClick={() => apply(s, alpha)} style={{ width: 22, height: 22, borderRadius: 6, border: 0, cursor: "pointer", background: s, boxShadow: hex === s ? "0 0 0 2px var(--accent)" : "inset 0 0 0 1px var(--hair)" }} />
        ))}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, font: "500 12px var(--font-ui)" }}>
        Color
        <input type="color" value={hex} onChange={(e) => apply(e.target.value, alpha)} style={{ width: 44, height: 26, border: 0, background: "transparent" }} />
        <span className="mono" style={{ color: "var(--ink-2)" }}>{hex.toUpperCase()}</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, font: "500 12px var(--font-ui)" }}>
        Opacity
        <input className="g-range" type="range" min={0.05} max={1} step={0.05} value={alpha} style={{ ["--fill" as string]: `${alpha * 100}%` }} onChange={(e) => apply(hex, Number(e.target.value))} />
      </label>
    </Panel>
  );
}

interface MeasureResult {
  distance: number;
  delta: number[];
  angle?: number;
}

 
function MeasurePanel() {
  const m = useRC((s) => s.measure);
  const [res, setRes] = useState<MeasureResult | null>(null);
  const close = () => useRC.setState({ measureOpen: false, measure: { a: null, b: null } });
  useEffect(() => {
    if (!m.a || !m.b) return;
    let alive = true;
    void cmd<MeasureResult>("view.measure", { from: { point: m.a.point, ...(m.a.normal ? { normal: m.a.normal } : {}) }, to: { point: m.b.point, ...(m.b.normal ? { normal: m.b.normal } : {}) } }, { quiet: true }).then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, [m.a, m.b]);
  const f = (v: number) => v.toFixed(3);
  const row = (label: string, value: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, font: "500 12px var(--font-ui)" }}>
      <span style={{ color: "var(--ink-2)" }}>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
  const shown = m.a && m.b ? res : null;
  return (
    <Panel title="Measure" icon={<Icon.Measure size={16} />} onClose={close} style={{ left: "50%", bottom: 108, translate: "-50% 0", width: 320 }}>
      <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-2)" }}>{!m.a ? "Click the first point on the station." : !m.b ? "Click the second point." : "Click again to start a new measurement."}</div>
      {m.a && row("Point 1 (mm)", m.a.point.map(f).join(", "))}
      {m.b && row("Point 2 (mm)", m.b.point.map(f).join(", "))}
      {shown && (
        <>
          {row("Distance (mm)", f(shown.distance))}
          {row("Delta XYZ (mm)", shown.delta.map(f).join(", "))}
          {shown.angle !== undefined && row("Angle (deg)", f(shown.angle))}
        </>
      )}
    </Panel>
  );
}

function AboutDialog() {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void cmd<Record<string, unknown>>("help.about", {}, { quiet: true }).then(setInfo);
  }, []);
  return (
    <Panel title={`About ${ABOUT.product}`} icon={<Icon.Info size={16} />} onClose={() => useRC.setState({ aboutOpen: false })} style={{ left: "50%", top: "28%", translate: "-50% 0", width: 380 }}>
      {info && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, font: "500 12.5px/1.5 var(--font-ui)" }}>
          <div style={{ font: "700 18px var(--font-ui)" }}>
            {String(info.product)} <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>{String(info.version)}</span>
          </div>
          <div>
            Build: <span className="mono">{String(info.build)}</span>
          </div>
          <div>Version release date: {String(info.releaseDate)}</div>
          <div style={{ color: "var(--ink-1)" }}>{String(info.description)}</div>
        </div>
      )}
    </Panel>
  );
}

 
function HelpPanel() {
  const style = useRC((s) => navStyle(s.settings));
  const [q, setQ] = useState("");
  const keys = useMemo(() => SHORTCUTS.filter((s) => `${s.label} ${s.keys}`.toLowerCase().includes(q.toLowerCase())), [q]);
  const nav =
    style === "classic"
      ? [
          ["Left drag", "Select items (rubber band); Rotate / Pan / Zoom from View"],
          ["Right drag", "Rotate around the picked point"],
          ["Middle drag", "Pan (with left/right also held: rotate)"],
          ["Wheel", "Zoom toward the point under the cursor"],
          ["⇧ + left drag", "Zoom"],
          ["⌘⇧ + left drag", "Rotate"],
          ["Hold ⌥ / ⌥⇧", "Move References / Move Tools"],
        ]
      : [
          ["Left drag on an item", "Move it (the selection moves together); ⇧ vertical, ⌥ rotate"],
          ["Left drag on empty space", "Pan"],
          ["Right drag / two-finger click drag / ⌃ drag", "Orbit around the picked point"],
          ["Wheel / pinch", "Zoom toward the cursor"],
          ["⇧ + left drag on empty space", "Rectangle selection (⌘ adds)"],
          ["Click / double-click", "Select / activate"],
        ];
  return (
    <Panel title="Help" icon={<Icon.Help size={16} />} onClose={() => useRC.setState({ helpOpen: false })} style={{ right: 24, top: 120, width: 420, maxHeight: "72vh" }}>
      <div className="g-label">Mouse ({style === "classic" ? "Classic" : "Enginuity"} navigation — Options ▸ Mouse)</div>
      {nav.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 12, font: "500 12px var(--font-ui)" }}>
          <span style={{ width: 170, flexShrink: 0, color: "var(--ink-2)" }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <div className="g-label" style={{ marginTop: 6 }}>
        Keyboard shortcuts
      </div>
      <input className="g-input" placeholder="Filter shortcuts" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="g-scroll" style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
        {keys.map((s) => (
          <div key={`${s.keys}-${s.label}`} style={{ display: "flex", justifyContent: "space-between", font: "500 12px var(--font-ui)" }}>
            <span>{s.label}</span>
            <span className="g-kbd">{prettyKeys(s.keys)}</span>
          </div>
        ))}
      </div>
      <div style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)" }}>Every menu action is also in the command palette ({prettyKeys("Ctrl+K")}) and available to the Copilot.</div>
    </Panel>
  );
}

 
function DockedTreeClose() {
  return (
    <button
      className="g-btn icon ghost"
      title="Close the tree (View ▸ Show Tree reopens it)"
      aria-label="Close the tree"
      onClick={() => void cmd("view.setDisplay", { treeVisible: false })}
      style={{ position: "fixed", top: 74, left: "calc(clamp(250px, 17vw, 340px) - 36px)", zIndex: 31, width: 26, height: 26 }}
    >
      <Icon.Close size={13} />
    </button>
  );
}

export default function ViewTools() {
  const colorFor = useRC((s) => s.colorFor);
  const measureOpen = useRC((s) => s.measureOpen);
  const aboutOpen = useRC((s) => s.aboutOpen);
  const helpOpen = useRC((s) => s.helpOpen);
  const view = useViewState();
  return (
    <>
      {colorFor && <ColorPanel key={colorFor.join(",")} ids={colorFor} />}
      {measureOpen && <MeasurePanel />}
      {aboutOpen && <AboutDialog />}
      {helpOpen && <HelpPanel />}
      {view.treeVisible && !view.treeInside && <DockedTreeClose />}
      <Notepad />
    </>
  );
}
