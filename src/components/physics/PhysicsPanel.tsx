"use client";

 
 
 

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cmd, selectNow } from "@/client/api";
import { useRC } from "@/client/store";
import { PHYSICS_DEFAULTS, type BodyReport } from "@/engine/physics/types";
import { Icon } from "../icons";
import { NumField } from "../inspector/fields";
import { PhysicsGlyph } from "./PhysicsGlyph";
import { openPhysicsPanel, usePhysics } from "./store";

const ROLE_STYLE: Record<BodyReport["role"], { background: string; color: string }> = {
  dynamic: { background: "var(--accent-soft)", color: "var(--accent-ink)" },
  static: { background: "var(--fill-2)", color: "var(--ink-1)" },
  kinematic: { background: "var(--fill-1)", color: "var(--info)" },
};

export function RoleChip({ role }: { role: BodyReport["role"] }) {
  return (
    <span style={{ ...ROLE_STYLE[role], borderRadius: 999, padding: "1px 7px", font: "650 10px var(--font-ui)", letterSpacing: "0.02em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {role}
    </span>
  );
}

export function PhysicsPanel() {
  const open = usePhysics((s) => s.panel);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<PanelBody />, document.body);
}

function PanelBody() {
  const st = usePhysics((s) => s.state);
  const settings = useRC((s) => s.settings);
  const on = settings.RC_PHYSICS === true;
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => openPhysicsPanel(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const act = async (label: string, name: string, params: Record<string, unknown> = {}) => {
    setBusy(label);
    const r = await cmd<Record<string, unknown>>(name, params);
    setBusy(null);
    return r;
  };
  const objects = Object.values(st?.report ?? {})
    .filter((r) => r.kind === "object")
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role.localeCompare(b.role)));
  const counts = st?.counts;
  const gravity = Number(settings.RC_PHYSICS_GRAVITY ?? PHYSICS_DEFAULTS.gravity);
  const substeps = Number(settings.RC_PHYSICS_SUBSTEPS ?? PHYSICS_DEFAULTS.substeps);
  return (
    <div
      className="glass glass-strong liquid rc-pop"
      role="dialog"
      aria-label="Physics"
      style={{ position: "fixed", top: "calc(var(--topbar-bottom, 58px) + 10px)", left: "50%", translate: "-50% 0", zIndex: 62, width: 372, maxWidth: "calc(100vw - 24px)", maxHeight: "72vh", borderRadius: 20, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 14px 8px" }}>
        <PhysicsGlyph size={17} />
        <div style={{ font: "700 14px var(--font-ui)" }}>Physics</div>
        <button
          type="button"
          className="g-switch"
          role="switch"
          aria-checked={on}
          aria-label="Physics"
          data-on={String(on)}
          disabled={busy !== null}
          onClick={() => void act("toggle", "physics.enable", { on: !on })}
          style={{ marginLeft: "auto" }}
        />
        <button className="g-btn icon ghost" onClick={close} aria-label="Close physics panel" title="Close physics panel">
          <Icon.Close size={14} />
        </button>
      </div>
      <div className="g-scroll" style={{ padding: "0 14px 14px", display: "grid", gap: 12, overflow: "auto", minHeight: 0 }}>
        <p style={{ margin: 0, font: "500 11.5px/1.45 var(--font-ui)", color: "var(--ink-2)" }}>
          {on
            ? "Released parts fall, settle, stack and are pushed by robots and tools. Fixtures stay put; parts already resting stay asleep. Physics moves are not undo steps."
            : "Off: objects stay where they are placed and only move when carried or set. Switch on to let parts fall, settle, stack and be pushed by robots and tools."}
        </p>
        {on && counts && (
          <div className="glass-inset" style={{ padding: "8px 10px", display: "grid", gap: 4, font: "500 11.5px var(--font-ui)" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>
                <b>{counts.dynamic}</b> dynamic
              </span>
              <span>
                <b>{counts.static}</b> static
              </span>
              <span>
                <b>{counts.kinematic}</b> kinematic
              </span>
              <span style={{ color: counts.awake ? "var(--accent-ink)" : "var(--ink-2)" }}>{counts.awake ? `${counts.awake} moving` : "all at rest"}</span>
            </div>
            <div style={{ color: "var(--ink-2)" }}>
              Floor at {Math.round(st?.floorZ ?? 0)} mm · built in {st?.buildMs ?? 0} ms{st?.stepMs ? ` · ${st.stepMs.toFixed(2)} ms per step` : ""}
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="g-label">Gravity (m/s²)</span>
            <NumField label="Gravity" value={gravity} decimals={2} step={0.1} onCommit={(v) => void cmd("physics.configure", { gravity: Math.max(0, v) })} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="g-label">Substeps per frame</span>
            <NumField label="Substeps" value={substeps} decimals={0} step={1} onCommit={(v) => void cmd("physics.configure", { substeps: Math.max(1, Math.min(16, Math.round(v))) })} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="g-btn" disabled={!on || busy !== null} onClick={() => void act("settle", "physics.settle", { maxSeconds: 5 })} title="Run physics until everything is at rest (at most 5 s of simulated time)">
            {busy === "settle" ? "Settling…" : "Settle"}
          </button>
          <button className="g-btn" disabled={!on || busy !== null} onClick={() => void act("reset", "physics.reset")} title="Put back every object physics moved since it was switched on">
            Reset poses
          </button>
        </div>
        {on && objects.length > 0 && (
          <section style={{ display: "grid", gap: 6 }}>
            <span className="g-label">Objects</span>
            <div className="glass-inset" style={{ padding: 4, display: "grid", gap: 1 }}>
              {objects.map((r) => (
                <button
                  key={r.item}
                  className="g-btn ghost"
                  onClick={() => void selectNow([r.item])}
                  style={{ height: "auto", minHeight: 28, padding: "4px 8px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8, textAlign: "left" }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", font: "600 12px var(--font-ui)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                    <span style={{ display: "block", font: "500 10.5px var(--font-ui)", color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.text}</span>
                  </span>
                  <RoleChip role={r.role} />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
