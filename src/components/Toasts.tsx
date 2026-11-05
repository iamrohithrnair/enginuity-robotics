"use client";
// Displays dismissible notifications with severity-specific styling.

import { useRC } from "@/client/store";
import { Icon } from "./icons";

export default function Toasts() {
  const toasts = useRC((s) => s.toasts);
  const dismiss = useRC((s) => s.dismiss);
  return (
    <div style={{ position: "fixed", right: 360, bottom: 92, zIndex: 90, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass glass-strong rc-pop"
          onClick={() => dismiss(t.id)}
          style={{ pointerEvents: "auto", display: "flex", gap: 10, padding: "11px 14px", maxWidth: 380, borderRadius: 16, cursor: "pointer" }}
        >
          <span style={{ color: t.kind === "error" ? "var(--bad)" : t.kind === "success" ? "var(--good)" : "var(--info)", marginTop: 1 }}>
            {t.kind === "error" ? <Icon.Warning /> : t.kind === "success" ? <Icon.Check /> : <Icon.Info />}
          </span>
          <div>
            <div style={{ font: "650 12.5px var(--font-ui)" }}>{t.title}</div>
            {t.body && <div style={{ color: "var(--ink-1)", marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
