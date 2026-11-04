"use client";

import { useEffect, useState } from "react";
import { useRC, useViewState } from "@/client/store";





export default function StatusBar() {
  const status = useRC((s) => s.status);
  const hold = useRC((s) => s.moveMode);
  const chosen = useViewState().moveMode;
  const moveMode = hold !== "default" ? hold : chosen;
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setExpired(status.at), Math.max(0, status.at + status.ms - Date.now()));
    return () => clearTimeout(t);
  }, [status]);
  const live = !!status && expired !== status.at;
  const text = live ? status!.text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "") : "";
  const mode = moveMode === "references" ? "Move References (hold ALT)" : moveMode === "tools" ? "Move Tools (hold ALT+Shift)" : "";
  if (!text && !mode) return null;
  return (
    <div
      className="glass rc-enter"
      role="status"
      aria-live="polite"
      style={{ position: "fixed", left: 16, bottom: 16, zIndex: 34, maxWidth: "min(420px, calc(50vw - 260px))", minHeight: 34, display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderRadius: 14, font: "550 12px var(--font-ui)", color: "var(--ink-1)" }}
    >
      {text && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={text}>{text}</span>}
      {mode && <span className="g-kbd" style={{ whiteSpace: "nowrap" }}>{mode}</span>}
    </div>
  );
}
