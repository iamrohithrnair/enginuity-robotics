"use client";

import type { DecisionAnswer, DecisionResult } from "@/engine/decisions";

const pct = (p?: number) => (p === undefined ? "–" : `${Math.round(p * 100)}%`);

function Bar({ label, p, strong, compact }: { label: string; p: number; strong: boolean; compact?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "minmax(56px, 34%) 1fr 38px" : "minmax(70px, 30%) 1fr 42px", alignItems: "center", gap: 8, minHeight: compact ? 18 : 22 }}>
      <span style={{ font: `${strong ? 650 : 500} ${compact ? 11 : 12}px var(--font-ui)`, color: strong ? "var(--ink-0)" : "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label}>
        {label}
      </span>
      <span style={{ position: "relative", height: compact ? 6 : 8, borderRadius: 8, background: "var(--fill-2)", overflow: "hidden" }}>
        <span style={{ position: "absolute", inset: 0, width: `${Math.max(0, Math.min(1, p)) * 100}%`, borderRadius: 8, background: strong ? "var(--accent)" : "var(--fill-3)", transition: "width .5s var(--ease-out)" }} />
      </span>
      <span className="mono" style={{ textAlign: "right", font: `${strong ? 650 : 500} ${compact ? 10.5 : 11.5}px var(--font-mono)`, color: strong ? "var(--ink-0)" : "var(--ink-2)" }}>
        {pct(p)}
      </span>
    </div>
  );
}

 
export function AnswerBars({ answer, threshold = 0.5, compact }: { answer: DecisionAnswer; threshold?: number; compact?: boolean }) {
  if (answer.type === "refusal") return <div style={{ color: "var(--warn)", font: "500 12px var(--font-ui)" }}>The model declined to answer this question.</div>;
  if (answer.type === "yesno") {
    const p = answer.probability ?? 0;
    return (
      <div style={{ display: "grid", gap: 3 }}>
        <Bar label="Yes" p={p} strong={p >= threshold} compact={compact} />
        <Bar label="No" p={1 - p} strong={p < threshold} compact={compact} />
      </div>
    );
  }
  if (answer.type === "box") {
    const b = answer.box;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative", width: 64, height: 44, borderRadius: 6, background: "var(--fill-2)" }}>
          {b && <div style={{ position: "absolute", left: `${b.left * 100}%`, top: `${b.top * 100}%`, width: `${(b.right - b.left) * 100}%`, height: `${(b.bottom - b.top) * 100}%`, border: "1.5px solid var(--accent)", borderRadius: 3 }} />}
        </div>
        <div className="mono" style={{ font: "500 11px var(--font-mono)", color: "var(--ink-1)", lineHeight: 1.5 }}>
          {b ? `x ${b.left.toFixed(2)}–${b.right.toFixed(2)} · y ${b.top.toFixed(2)}–${b.bottom.toFixed(2)}` : "no box"}
          <br />
          confidence {pct(answer.confidence)}
        </div>
      </div>
    );
  }
  const rows = answer.probabilities ?? [];
  const winner = answer.type === "choice" ? answer.choice : answer.level;
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {answer.type === "score" && rows.length > 1 && answer.score !== undefined && (
        <div style={{ position: "relative", height: 14, margin: "0 2px 4px" }} aria-label={`score ${answer.score.toFixed(2)}`}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 2, borderRadius: 2, background: "var(--fill-3)" }} />
          <div style={{ position: "absolute", top: 1, width: 12, height: 12, borderRadius: 12, background: "var(--accent)", left: `calc(${(answer.score / (rows.length - 1)) * 100}% - 6px)`, boxShadow: "0 0 0 3px var(--accent-soft)" }} />
        </div>
      )}
      {rows.map((r) => (
        <Bar key={r.label} label={r.label} p={r.probability} strong={r.label === winner} compact={compact} />
      ))}
    </div>
  );
}

 
export function DecisionResultCard({ result, threshold, compact, title }: { result: DecisionResult; threshold?: number; compact?: boolean; title?: string }) {
  return (
    <div style={{ display: "grid", gap: compact ? 8 : 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>
        {title && <span style={{ color: "var(--ink-1)", fontWeight: 650 }}>{title}</span>}
        <span>{result.profile.name}</span>
        <span>·</span>
        <span className="mono">{result.latencyMs} ms</span>
        {result.usage?.cost !== undefined && (
          <>
            <span>·</span>
            <span className="mono">${result.usage.cost.toFixed(6)}</span>
          </>
        )}
      </div>
      {result.answers.map((a) => (
        <div key={a.name} style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span className="mono" style={{ font: "650 11.5px var(--font-mono)", color: "var(--ink-0)" }}>
              {a.name}
            </span>
            {a.confidence !== undefined && a.type !== "box" && <span style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>confidence {pct(a.confidence)}</span>}
            {a.type === "score" && a.score !== undefined && <span style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>score {a.score.toFixed(2)}</span>}
          </div>
          <AnswerBars answer={a} threshold={threshold} compact={compact} />
        </div>
      ))}
    </div>
  );
}
