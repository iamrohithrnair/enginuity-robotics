"use client";
// Displays default decision-model settings and profile management controls.

import { decisionProvider } from "@/engine/decisions";
import { Icon } from "../icons";
import { openDecidePlayground, openDecisionModels, useDecisions } from "./uiStore";

 
export default function DecisionModelsSection() {
  const profiles = useDecisions((s) => s.profiles);
  const def = profiles.find((p) => p.isDefault);
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div className="g-label">Decision models</div>
      <div className="glass-inset" style={{ padding: 12, borderRadius: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)", flexShrink: 0 }}>
          <Icon.Decision size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "600 12.5px var(--font-ui)" }}>{def ? def.name : "None set up"}</div>
          <div style={{ font: "500 11px var(--font-ui)", color: def && !def.ready ? "var(--warn)" : "var(--ink-2)" }}>
            {def ? (def.ready ? `${decisionProvider(def.provider).label} · ${def.model} · default for the Copilot and Decision instructions` : `Missing: ${def.missing.join(", ")}`) : "OpenAI Decisions, Jev, Microsoft-Decision-1, Clef, Decider"}
            {profiles.length > 1 ? ` · ${profiles.length} models` : ""}
          </div>
        </div>
        <button className="g-btn" style={{ marginLeft: "auto", flexShrink: 0 }} onClick={() => openDecisionModels(profiles.length ? def?.id : "new")}>
          Manage…
        </button>
        <button className="g-btn ghost" style={{ flexShrink: 0 }} onClick={openDecidePlayground} disabled={!profiles.length}>
          Try
        </button>
      </div>
    </section>
  );
}
