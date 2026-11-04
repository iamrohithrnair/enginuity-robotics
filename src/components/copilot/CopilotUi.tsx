"use client";

 
 

import { useState, type CSSProperties, type ReactNode } from "react";
import { type AgentInfo, type Guardrail, type WebInfo, hostOf, META_BLUE, notReadyReason } from "./agentInfo";

type SvgProps = { size?: number; color?: string };
const Svg = ({ size = 14, color, children }: SvgProps & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);
export const GlobeIcon = (p: SvgProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.5 3.5 5.3 3.5 8.5s-1.2 6-3.5 8.5c-2.3-2.5-3.5-5.3-3.5-8.5s1.2-6 3.5-8.5z" />
  </Svg>
);
export const ShieldIcon = ({ check, ...p }: SvgProps & { check?: boolean }) => (
  <Svg {...p}>
    <path d="M12 3.2l7 2.8v5.3c0 4.4-2.9 8.1-7 9.4-4.1-1.3-7-5-7-9.4V6l7-2.8z" />
    {check && <path d="M8.9 12.1l2.2 2.2 4.2-4.4" />}
  </Svg>
);
const ChipIcon = (p: SvgProps) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" />
    <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.8" />
    <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
  </Svg>
);
const ArrowIcon = (p: SvgProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const PhotoIcon = (p: SvgProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <circle cx="9" cy="10.5" r="1.6" />
    <path d="M20.5 15.5l-4.6-4.6-7.4 7.6" />
  </Svg>
);

 
const brandInk = `color-mix(in srgb, ${META_BLUE} 78%, var(--ink-0))`;
const tintOf = (info: AgentInfo | null) => (info?.model.vendor === "Meta" ? META_BLUE : "var(--accent)");
const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

 
export function ModelBadge({ info, busy, onOpen }: { info: AgentInfo | null; busy?: boolean; onOpen?: () => void }) {
  if (!info) return <div className="rc-shimmer" aria-label="Loading the Copilot model" style={{ height: 54, borderRadius: 14 }} />;
  const tint = tintOf(info);
  const reason = notReadyReason(info);
  const body = (
    <>
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: info.model.vendor === "Meta" ? `linear-gradient(145deg, #4fa3ff, ${META_BLUE} 55%, #0047c2)` : "linear-gradient(145deg, #60a5fa, var(--accent))",
          boxShadow: "0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35)",
        }}
      >
        <ChipIcon size={19} color="#fff" />
      </span>
      <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
        <span style={{ font: "700 14.5px/1.15 var(--font-ui)", letterSpacing: "-0.015em", color: "var(--ink-0)", ...ellipsis }}>{info.model.label}</span>
        <span style={{ font: "500 11px/1.25 var(--font-ui)", color: "var(--ink-2)", ...ellipsis }}>
          {info.model.vendor && (
            <>
              <span style={{ color: info.model.vendor === "Meta" ? brandInk : "var(--ink-1)", fontWeight: 700, letterSpacing: "0.02em" }}>{info.model.vendor}</span>
              {" · "}
            </>
          )}
          via <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>{info.provider.label}</span>
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {!info.derived && <StatePill tone={reason ? "warn" : busy ? "busy" : "good"}>{reason ? "Setup" : busy ? "Working" : "Ready"}</StatePill>}
        {onOpen && <ArrowIcon size={14} color="var(--ink-3)" />}
      </span>
      {reason && (
        <span style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 9, background: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--warn)", font: "600 11px/1.35 var(--font-ui)" }}>
          <ShieldIcon size={12} /> {reason}
        </span>
      )}
    </>
  );
  const style: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "34px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 10,
    rowGap: 8,
    width: "100%",
    minHeight: 54,
    height: "auto",
    padding: "9px 10px",
    borderRadius: 14,
    textAlign: "left",
    justifyContent: "stretch",
    background: `linear-gradient(100deg, color-mix(in srgb, ${tint} 16%, transparent), color-mix(in srgb, ${tint} 5%, transparent) 70%)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 34%, transparent)`,
  };
  const title = `${info.model.id} via ${info.provider.label}${info.provider.baseURL ? ` (${info.provider.baseURL})` : ""}`;
  return onOpen ? (
    <button type="button" className="g-btn" style={style} title={`${title} — change in Options ▸ Copilot`} aria-label={`Model: ${info.model.label} via ${info.provider.label}. Open Copilot options`} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div style={style} title={title}>
      {body}
    </div>
  );
}

function StatePill({ tone, children }: { tone: "good" | "warn" | "busy"; children: ReactNode }) {
  const c = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 8px", borderRadius: 999, background: `color-mix(in srgb, ${c} 13%, transparent)`, color: c, font: "650 10.5px var(--font-ui)", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: c, animation: tone === "busy" ? "rc-pulse 1s infinite" : undefined }} />
      {children}
    </span>
  );
}

type ChipState = "on" | "off" | "warn";
export function Chip({ icon, label, state, note, title, onClick }: { icon: ReactNode; label: ReactNode; state: ChipState; note?: string; title?: string; onClick?: () => void }) {
  const c = state === "on" ? "var(--good)" : state === "warn" ? "var(--warn)" : "var(--ink-3)";
  return (
    <button
      type="button"
      className="g-btn ghost"
      title={title}
      onClick={onClick}
      style={{ height: 24, padding: "0 9px 0 7px", gap: 5, borderRadius: 999, font: "550 11px var(--font-ui)", color: state === "off" ? "var(--ink-2)" : "var(--ink-1)", background: "var(--fill-1)", boxShadow: "inset 0 0 0 1px var(--hair)", whiteSpace: "nowrap", maxWidth: "100%" }}
    >
      <span style={{ display: "inline-flex", color: c }}>{icon}</span>
      <span style={ellipsis}>{label}</span>
      {note && <span style={{ color: c, fontWeight: 650 }}>{note}</span>}
    </button>
  );
}

 
export function CapabilityChips({ info, onOpen, children }: { info: AgentInfo | null; onOpen?: () => void; children?: ReactNode }) {
  const web = info?.webSearch;
  const guard = info?.guard;
  const sam = info?.sam;
  const webState: ChipState = !web?.enabled ? "off" : web.ready ? "on" : "warn";
  const guardState: ChipState = !guard?.enabled ? "off" : guard.ready ? "on" : "warn";
  const samState: ChipState = !sam?.enabled ? "off" : sam.ready ? "on" : "warn";
  const needsKey = `Add ${info?.keyEnv || "MODEL_API_KEY"} to .env.local or a Meta Model API key in Options ▸ Copilot`;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 24 }}>
      {info ? (
        <>
          <Chip
            icon={<GlobeIcon size={13} />}
            label="Web search · Meta"
            state={webState}
            note={webState === "off" ? "off" : webState === "warn" ? "not configured" : undefined}
            title={webState === "on" ? "The Copilot searches the web with Meta search grounding and cites its sources" : webState === "warn" ? needsKey : "Web search is off (Options ▸ Copilot)"}
            onClick={onOpen}
          />
          <Chip
            icon={<ShieldIcon size={13} check={guardState === "on"} />}
            label={guardState === "off" ? "Guardrails" : `Guardrails · ${guard?.model?.label ?? "Muse Spark"}`}
            state={guardState}
            note={guardState === "off" ? "off" : guardState === "warn" ? "not configured" : undefined}
            title={guardState === "off" ? "Guardrails are off (Options ▸ Copilot)" : guardState === "warn" ? needsKey : `${guard?.model?.label ?? "Muse Spark"} via ${guard?.provider ?? "Meta Model API"} checks every request for scope and every web result for prompt injection`}
            onClick={onOpen}
          />
          <Chip
            icon={<PhotoIcon size={13} />}
            label={`Photos · ${sam?.model.label ?? "SAM 3.1"}`}
            state={samState}
            note={samState === "off" ? "off" : samState === "warn" ? "not configured" : undefined}
            title={samState === "on" ? "Attach photos or sketches of a work area: the model reads them and SAM 3.1 finds the objects in them" : samState === "warn" ? needsKey : "SAM 3.1 is off (Options ▸ Copilot); the model still reads attached photos"}
            onClick={onOpen}
          />
        </>
      ) : (
        <>
          <span className="rc-shimmer" style={{ width: 132, height: 24, borderRadius: 999 }} />
          <span className="rc-shimmer" style={{ width: 176, height: 24, borderRadius: 999 }} />
          <span className="rc-shimmer" style={{ width: 118, height: 24, borderRadius: 999 }} />
        </>
      )}
      {children}
    </div>
  );
}

 
export function TurnFooter({ info, web }: { info: AgentInfo; web: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px", font: "500 10.5px var(--font-ui)", color: "var(--ink-3)", minWidth: 0 }} title={`${info.model.id} via ${info.provider.label}`}>
      <span style={{ width: 6, height: 6, borderRadius: 2, flexShrink: 0, background: tintOf(info) }} />
      <span style={ellipsis}>
        {info.model.label} · {info.provider.label}
      </span>
      {web && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          · <GlobeIcon size={11} /> web: Meta search
        </span>
      )}
    </div>
  );
}

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

 
export function WebStepCard({ tool, args, ok, error, web }: { tool: string; args?: unknown; ok?: boolean; error?: string | null; web?: WebInfo }) {
  const [all, setAll] = useState(false);
  const extract = tool !== "web.search";
  const pending = ok === undefined;
  const a = (args && typeof args === "object" ? args : {}) as { query?: string; url?: string };
  const query = web?.query ?? a.query;
  const host = hostOf(web?.url ?? a.url) || "the page";
  const title = extract ? `${pending ? "Reading" : ok ? "Read" : "Could not read"} ${host}${pending ? "…" : ""}` : pending ? "Searching the web with Meta search…" : ok ? "Searched the web with Meta search" : "Web search with Meta search failed";
  const results = web?.results ?? [];
  const shown = all ? results : results.slice(0, 5);
  const blocked = web?.blocked ?? 0;
  const c = ok === false ? "var(--bad)" : "var(--info)";
  return (
    <div className="rc-enter" style={{ display: "grid", gap: 8, padding: "10px 11px", borderRadius: 13, background: "var(--fill-1)", boxShadow: "inset 0 0 0 1px var(--hair)" }}>
      { }
      <style href="rc-web-source" precedence="default">{`.rc-web-source:hover{background:var(--fill-2)}.rc-web-source:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, animation: pending ? "rc-pulse 1s infinite" : undefined }}>
          <GlobeIcon size={13} />
        </span>
        <span style={{ font: "650 12px var(--font-ui)", color: "var(--ink-0)", ...ellipsis }}>{title}</span>
        {!pending && web?.ms !== undefined && <span style={{ marginLeft: "auto", flexShrink: 0, color: "var(--ink-3)", font: "500 10.5px var(--font-ui)" }}>{(web.ms / 1000).toFixed(1)} s</span>}
      </div>
      {query && !extract && (
        <div style={{ font: "500 12px/1.4 var(--font-ui)", color: "var(--ink-1)", paddingLeft: 30, userSelect: "text" }}>
          “{query}”
        </div>
      )}
      {pending && (
        <div style={{ display: "grid", gap: 6, paddingLeft: 30 }}>
          <span className="rc-shimmer" style={{ height: 9, borderRadius: 5, width: "92%" }} />
          <span className="rc-shimmer" style={{ height: 9, borderRadius: 5, width: "70%" }} />
        </div>
      )}
      {web?.answer && (
        <div style={{ marginLeft: 30, padding: "7px 9px", borderRadius: 9, background: "var(--fill-1)" }} title={web.answer}>
          { }
          <div style={{ font: "500 11.5px/1.45 var(--font-ui)", color: "var(--ink-1)", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", userSelect: "text" }}>{web.answer}</div>
        </div>
      )}
      {shown.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: "0 0 0 24px", display: "grid", gap: 1 }}>
          {shown.map((r, i) => {
            const href = safeHref(r.url);
            const row = (
              <>
                <span className="mono" style={{ color: "var(--ink-3)", font: "500 10px var(--font-mono)", textAlign: "right" }}>
                  {i + 1}
                </span>
                <span style={{ font: "550 11.5px var(--font-ui)", color: "var(--ink-0)", ...ellipsis }}>{r.title || hostOf(r.url)}</span>
                <span style={{ font: `${r.cited ? 650 : 500} 10.5px var(--font-ui)`, color: r.flagged ? "var(--warn)" : r.cited ? "var(--accent-ink)" : "var(--ink-3)", maxWidth: 120, ...ellipsis }}>{r.flagged ? "text redacted" : hostOf(r.url)}</span>
              </>
            );
            const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "14px minmax(0, 1fr) auto", alignItems: "baseline", gap: 7, padding: "4px 6px", borderRadius: 7, textDecoration: "none" };
            return (
              <li key={`${i}-${r.url}`}>
                {href ? (
                  <a className="rc-web-source" href={href} target="_blank" rel="noopener noreferrer" style={rowStyle} title={r.flagged ? `${r.url}\nThe prompt-injection filter redacted suspicious text in this result` : r.cited ? `${r.url}\nCited in the answer` : r.url}>
                    {row}
                  </a>
                ) : (
                  <div style={rowStyle}>{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {results.length > 5 && (
        <button type="button" className="g-btn ghost" style={{ justifySelf: "start", height: 22, marginLeft: 26, padding: "0 6px", font: "550 11px var(--font-ui)", color: "var(--ink-2)" }} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${results.length} sources`}
        </button>
      )}
      {blocked > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 30, color: "var(--good)", font: "600 11px var(--font-ui)" }}>
          <ShieldIcon size={13} check /> {blocked} result{blocked === 1 ? "" : "s"} removed by the prompt-injection filter
        </div>
      )}
      {error && <div style={{ marginLeft: 30, color: "var(--bad)", font: "500 11.5px/1.4 var(--font-ui)" }}>{error}</div>}
    </div>
  );
}

function describeGuard(g: Guardrail, removed: number): { title: string; detail?: string; tone: string } {
  const detail = g.message?.trim() || undefined;
  switch (g.kind) {
    case "scope":
      return { title: "Out of scope — the Copilot helps with robot cells, programming and simulation", detail, tone: "var(--warn)" };
    case "web": {
       
      const reason = detail?.replace(/^web search blocked:\s*/i, "");
      return { title: g.action === "redacted" ? "Web search query redacted" : g.action === "warned" ? "Web search flagged" : "Web search blocked", detail: reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : undefined, tone: "var(--warn)" };
    }
    case "injection": {
       
      if (g.action === "blocked" && !g.tool) return { title: "Message blocked by the prompt-injection guard", detail: detail?.replace(/^message blocked:\s*/i, ""), tone: "var(--warn)" };
      const n = removed || Number(detail?.match(/removed (\d+)/i)?.[1] ?? 0);
      if (n > 0) return { title: `Removed ${n} web result${n === 1 ? "" : "s"} that contained instructions`, tone: "var(--good)" };
      return { title: "Redacted text in web results that looked like instructions", detail, tone: "var(--good)" };
    }
    case "gate":
      return { title: `Needs your confirmation: this turn used web content, so ${g.tool ?? "the command"} was not run`, detail: detail ?? "Reply to confirm and the Copilot will run it.", tone: "var(--accent)" };
    default:
      return { title: detail ?? "Guardrail", tone: "var(--warn)" };
  }
}

 
export function GuardNotice({ g, removed = 0 }: { g: Guardrail; removed?: number }) {
  const { title, detail, tone } = describeGuard(g, removed);
  return (
    <div className="rc-enter" role="note" style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr) auto", alignItems: "start", gap: 8, padding: "8px 10px", borderRadius: 11, background: `color-mix(in srgb, ${tone} 10%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 26%, transparent)` }}>
      <span style={{ color: tone, display: "inline-flex", marginTop: 1 }}>
        <ShieldIcon size={15} check={g.kind === "injection"} />
      </span>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ font: "600 11.5px/1.4 var(--font-ui)", color: "var(--ink-0)" }}>{title}</span>
        {detail && <span style={{ font: "500 11px/1.4 var(--font-ui)", color: "var(--ink-2)", userSelect: "text" }}>{detail}</span>}
      </span>
      <span style={{ font: "600 9.5px/1.6 var(--font-ui)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", whiteSpace: "nowrap" }} title={`Copilot guardrail${g.probability !== undefined ? ` (probability ${g.probability.toFixed(2)})` : ""}`}>
        Guard
      </span>
    </div>
  );
}
