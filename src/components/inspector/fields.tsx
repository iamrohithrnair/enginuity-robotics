"use client";
// Provides reusable inspector fields, pose inputs, and section layouts.

import { useId, useState, type ReactNode } from "react";

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <span className="g-label">{title}</span>
        <span style={{ marginLeft: "auto" }}>{right}</span>
      </div>
      {children}
    </section>
  );
}

 
export function NumField({
  value,
  onCommit,
  step = 1,
  decimals = 3,
  width,
  suffix,
  disabled,
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  decimals?: number;
  width?: number;
  suffix?: string;
  disabled?: boolean;
  label?: string;
}) {
   
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value.toFixed(decimals);
  const commit = () => {
    const v = Number(text);
    setDraft(null);
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-9) onCommit(v);
  };
  return (
    <div style={{ position: "relative", width, minWidth: 0 }}>
      <input
        className="g-input num"
        aria-label={label}
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={() => setDraft(value.toFixed(decimals))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value.toFixed(decimals));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = Number(text) + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1);
            setDraft(v.toFixed(decimals));
            onCommit(v);
          }
          e.stopPropagation();
        }}
        style={{ paddingRight: suffix ? 26 : 9, opacity: disabled ? 0.45 : 1 }}
      />
      {suffix && <span style={{ position: "absolute", right: 8, top: 7, font: "500 10.5px var(--font-ui)", color: "var(--ink-3)", pointerEvents: "none" }}>{suffix}</span>}
    </div>
  );
}

 
export function TextField({ value, onCommit, label, multiline, rows = 3, placeholder }: { value: string; onCommit: (v: string) => void; label: string; multiline?: boolean; rows?: number; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const commit = () => {
    setDraft(null);
    if (text !== value) onCommit(text);
  };
  const common = {
    className: "g-input",
    "aria-label": label,
    value: text,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) (e.target as HTMLElement).blur();
      if (e.key === "Escape") {
        setDraft(value);
        (e.target as HTMLElement).blur();
      }
      e.stopPropagation();
    },
  };
  return multiline ? <textarea {...common} rows={rows} /> : <input {...common} />;
}

 
export function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <div style={{ display: inline ? "grid" : "block", gridTemplateColumns: inline ? "auto 1fr" : undefined, alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ font: "550 11.5px var(--font-ui)", color: "var(--ink-1)", marginBottom: inline ? 0 : 5 }}>{label}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

 
export function Check({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 26,
        padding: "2px 6px 2px 2px",
        textAlign: "left",
        border: 0,
        borderRadius: 8,
        background: "transparent",
        color: "var(--ink-0)",
        font: "500 12.5px var(--font-ui)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: 5,
          display: "grid",
          placeItems: "center",
          color: "#fff",
          font: "700 11px var(--font-ui)",
          background: checked ? "var(--accent)" : "var(--well)",
          boxShadow: checked ? "none" : "inset 0 0 0 1.5px var(--fill-3)",
          transition: "background .15s",
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

 
export function Combo<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
  compact,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  disabled?: boolean;
   
  compact?: boolean;
}) {
  return (
    <select
      className="g-input"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ opacity: disabled ? 0.45 : 1, fontSize: compact ? 11 : undefined, letterSpacing: compact ? "-0.01em" : undefined }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

 
export function Radios<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="glass-inset" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 3, borderRadius: 12 }}>
      {options.map((o) => (
        <label
          key={o.value}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 26,
            padding: "0 8px",
            borderRadius: 9,
            cursor: "pointer",
            background: value === o.value ? "var(--accent-soft)" : "transparent",
            color: value === o.value ? "var(--accent-ink)" : "var(--ink-0)",
            font: "500 12px var(--font-ui)",
          }}
        >
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} style={{ accentColor: "var(--accent)" }} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

const AXIS = ["var(--axis-x)", "var(--axis-y)", "var(--axis-z)"];

 
export function PoseFields({ values, rot, unit, onCommit, disabled }: { values: number[]; rot: string[]; unit: string; onCommit: (v: number[]) => void; disabled?: boolean }) {
  const labels = ["X", "Y", "Z", ...rot];
  const quat = rot.length === 4;
  return (
    <div style={{ display: "grid", gridTemplateColumns: quat ? "repeat(12, 1fr)" : "repeat(3, 1fr)", gap: 6 }}>
      {labels.map((l, i) => (
        <label key={l + i} style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: quat ? (i < 3 ? "span 4" : "span 3") : undefined, minWidth: 0 }}>
          <span style={{ font: "600 10px var(--font-ui)", color: i < 3 ? AXIS[i] : AXIS[(i - 3) % 3], letterSpacing: ".04em" }}>{l}</span>
          <NumField
            label={`${l}${i < 3 ? " (mm)" : unit ? ` (${unit})` : ""}`}
            value={values[i] ?? 0}
            decimals={i < 3 ? 3 : unit === "" || unit === "rad" ? 6 : 3}
            step={i < 3 ? 1 : unit === "deg" ? 1 : 0.01}
            disabled={disabled}
            onCommit={(v) => {
              const n = values.slice();
              n[i] = v;
              onCommit(n);
            }}
          />
        </label>
      ))}
    </div>
  );
}

 
export function PoseGrid({ xyzrpw, onCommit }: { xyzrpw: number[]; onCommit: (v: number[]) => void }) {
  return <PoseFields values={xyzrpw} rot={["Rx", "Ry", "Rz"]} unit="deg" onCommit={onCommit} />;
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "accent" }) {
  const bg = { neutral: "var(--fill-2)", good: "color-mix(in srgb, var(--good) 15%, transparent)", bad: "color-mix(in srgb, var(--bad) 14%, transparent)", accent: "var(--accent-soft)" }[tone];
  const fg = { neutral: "var(--ink-1)", good: "var(--good)", bad: "var(--bad)", accent: "var(--accent-ink)" }[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, background: bg, color: fg, font: "600 10.5px var(--font-ui)" }}>{children}</span>;
}
