"use client";
// Edits per-item physics body mode, mass, friction, and restitution.

 
 

import { useState } from "react";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import { PHYSICS_DEFAULTS, type BodyMode } from "@/engine/physics/types";
import type { Item } from "@/engine/types";
import { Combo, Field, Section } from "../inspector/fields";
import { RoleChip } from "./PhysicsPanel";
import { openPhysicsPanel, usePhysicsReport } from "./store";

 
function OptNum({ label, value, placeholder, onCommit, suffix }: { label: string; value: number | null | undefined; placeholder: string; onCommit: (v: number | null) => void; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === null || value === undefined ? "" : String(value));
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    setDraft(null);
    if (t === "") return value === null || value === undefined ? undefined : onCommit(null);
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
  };
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        className="g-input num"
        aria-label={label}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        style={{ paddingRight: suffix ? 30 : 9 }}
      />
      {suffix && <span style={{ position: "absolute", right: 8, top: 7, font: "500 10.5px var(--font-ui)", color: "var(--ink-3)", pointerEvents: "none" }}>{suffix}</span>}
    </div>
  );
}

const MODES: { value: BodyMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "dynamic", label: "Dynamic" },
  { value: "static", label: "Static" },
];

export default function PhysicsSection({ it }: { it: Item }) {
  const on = useRC((s) => s.settings.RC_PHYSICS === true);
  const report = usePhysicsReport(it.id);
  if (it.type !== "object") return null;
  const p = it.physics ?? {};
  const set = (patch: Record<string, unknown>) => void cmd("object.setPhysics", { items: [it.id], ...patch });
  const resolved = !on ? "Physics is off: the object stays where it is placed." : !it.visible ? "Hidden: takes no part in physics." : report ? report.text : "Not part of physics (no geometry).";
  return (
    <Section
      title="Physics"
      right={
        on && report ? (
          <RoleChip role={report.role} />
        ) : (
          <button className="g-btn ghost" style={{ height: 22, fontSize: 11 }} onClick={() => openPhysicsPanel()}>
            Settings…
          </button>
        )
      }
    >
      <Field label="Body">
        <Combo label="Body" value={p.body ?? "auto"} options={MODES} onChange={(v) => set({ body: v })} />
      </Field>
      <div style={{ font: "500 11.5px/1.4 var(--font-ui)", color: report?.role === "dynamic" ? "var(--accent-ink)" : "var(--ink-2)", margin: "-2px 0 10px" }}>{resolved}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={{ font: "600 10px var(--font-ui)", color: "var(--ink-2)" }}>Mass</span>
          <OptNum label="Mass" value={p.mass} placeholder={report?.mass !== undefined ? String(Math.round(report.mass * 100) / 100) : "auto"} suffix="kg" onCommit={(v) => set({ mass: v })} />
        </label>
        <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={{ font: "600 10px var(--font-ui)", color: "var(--ink-2)" }}>Friction</span>
          <OptNum label="Friction" value={p.friction} placeholder={String(PHYSICS_DEFAULTS.friction)} onCommit={(v) => set({ friction: v })} />
        </label>
        <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={{ font: "600 10px var(--font-ui)", color: "var(--ink-2)" }}>Bounciness</span>
          <OptNum label="Bounciness" value={p.restitution} placeholder={String(PHYSICS_DEFAULTS.restitution)} onCommit={(v) => set({ restitution: v === null ? null : Math.min(1, v) })} />
        </label>
      </div>
      <div style={{ font: "500 10.5px var(--font-ui)", color: "var(--ink-3)", marginTop: 6 }}>
        Empty fields use the defaults: mass from {p.density ?? PHYSICS_DEFAULTS.density} kg/m³, friction {PHYSICS_DEFAULTS.friction}, bounciness {PHYSICS_DEFAULTS.restitution}.
      </div>
    </Section>
  );
}
