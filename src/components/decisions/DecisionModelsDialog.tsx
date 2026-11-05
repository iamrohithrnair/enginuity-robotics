"use client";
// Manages decision-model profiles, credentials, and test requests.

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useRC } from "@/client/store";
import { DECISION_PRESETS, decisionProvider, type DecisionProfilePublic, type DecisionProviderId, type DecisionResult, type DecisionWire } from "@/engine/decisions";
import { Icon } from "../icons";
import { DecisionResultCard } from "./ProbabilityBars";
import { closeDecisionDialogs, openDecidePlayground, refreshProfiles, runDecision, saveProfileKey, useDecisions } from "./uiStore";

const chip = { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, background: "var(--fill-1)", font: "550 10.5px var(--font-ui)", color: "var(--ink-1)" } as const;

function StatusDot({ p }: { p: DecisionProfilePublic }) {
  return <span title={p.ready ? "Ready" : `Missing: ${p.missing.join(", ")}`} style={{ width: 8, height: 8, borderRadius: 8, flexShrink: 0, background: p.ready ? "var(--good)" : "var(--warn)" }} />;
}

 
export default function DecisionModelsDialog() {
  const open = useDecisions((s) => s.dialog === "models");
  return open ? <Body /> : null;
}

function Body() {
  const profiles = useDecisions((s) => s.profiles);
  const loaded = useDecisions((s) => s.loaded);
  const selected = useDecisions((s) => s.selected);
  const current = profiles.find((p) => p.id === selected);
  const showGallery = selected === "new" || (loaded && !profiles.length && !selected?.startsWith("draft:"));
  const draftPreset = selected?.startsWith("draft:") ? DECISION_PRESETS.find((x) => x.id === selected.slice(6)) : undefined;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 76, display: "grid", placeItems: "center", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && closeDecisionDialogs()}>
      <div className="glass glass-strong liquid rc-pop" role="dialog" aria-label="Decision models" style={{ width: 880, maxWidth: "calc(100vw - 32px)", height: 600, maxHeight: "86vh", borderRadius: 24, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid var(--hair)" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Icon.Decision size={18} />
          </div>
          <div>
            <div style={{ font: "700 15px var(--font-ui)" }}>Decision models</div>
            <div style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)" }}>Typed yes/no, choice and score answers in milliseconds, for the Copilot and for Decision instructions in programs.</div>
          </div>
          <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} aria-label="Close" title="Close" onClick={closeDecisionDialogs}>
            <Icon.Close size={15} />
          </button>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "250px 1fr", minHeight: 0 }}>
          <aside style={{ borderRight: "1px solid var(--hair)", padding: 10, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
            <div className="g-scroll" style={{ flex: 1, display: "grid", alignContent: "start", gap: 4 }}>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  className={`g-btn ${p.id === selected ? "active" : "ghost"}`}
                  style={{ height: "auto", padding: "8px 10px", justifyContent: "flex-start", textAlign: "left", borderRadius: 12, display: "flex", gap: 8 }}
                  onClick={() => useDecisions.setState({ selected: p.id })}
                >
                  <StatusDot p={p} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", font: "600 12.5px var(--font-ui)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ display: "block", font: "500 11px var(--font-ui)", color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{decisionProvider(p.provider).label} · {p.model || "no model"}</span>
                  </span>
                  {p.isDefault && (
                    <span title="Default model" aria-label="Default" style={{ color: "var(--accent)", font: "700 13px var(--font-ui)", flexShrink: 0 }}>
                      ★
                    </span>
                  )}
                </button>
              ))}
              {loaded && !profiles.length && <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-2)", padding: "6px 4px" }}>No decision model yet. Pick one on the right.</div>}
            </div>
            <button className={`g-btn ${showGallery || draftPreset ? "active" : ""}`} onClick={() => useDecisions.setState({ selected: "new" })}>
              <Icon.Plus size={14} /> Add model
            </button>
            <button className="g-btn ghost" onClick={openDecidePlayground}>
              <Icon.Sparkle size={14} /> Decide playground
            </button>
          </aside>
          <section className="g-scroll" style={{ padding: 18, minHeight: 0 }}>
            {draftPreset ? (
              <ProfileEditor key={selected} preset={draftPreset} />
            ) : showGallery ? (
              <Gallery />
            ) : current ? (
              <ProfileEditor key={current.id} profile={current} />
            ) : (
              <div style={{ color: "var(--ink-2)" }}>Loading…</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Gallery() {
  return (
    <div>
      <div style={{ font: "650 14px var(--font-ui)", marginBottom: 4 }}>Add a decision model</div>
      <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-2)", marginBottom: 14 }}>Pick a model; you will paste its key next. OpenRouter gives one key for Jev, Microsoft-Decision-1, Decider and Clef.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
        {DECISION_PRESETS.map((x) => {
          const info = decisionProvider(x.provider);
          const model = info.models.find((m) => m.id === x.model);
          return (
            <button
              key={x.id}
              className="g-btn ghost"
              style={{ height: "auto", minHeight: 96, padding: 12, display: "grid", alignContent: "start", justifyItems: "start", gap: 4, textAlign: "left", borderRadius: 14, background: "var(--fill-1)", whiteSpace: "normal" }}
              onClick={() => useDecisions.setState({ selected: `draft:${x.id}` })}
            >
              <span style={{ font: "650 13.5px var(--font-ui)" }}>{x.title}</span>
              <span style={{ font: "550 11.5px var(--font-ui)", color: "var(--accent-ink)" }}>{x.subtitle}</span>
              <span style={{ font: "500 11px/1.4 var(--font-ui)", color: "var(--ink-2)" }}>{x.provider === "custom" ? info.blurb : model?.images ? "Text, JSON and images" : model?.note ?? "Text and JSON"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Draft {
  name: string;
  provider: DecisionProviderId;
  model: string;
  baseUrl: string;
  accountId: string;
  wire: DecisionWire;
  makeDefault: boolean;
}

function ProfileEditor({ profile, preset }: { profile?: DecisionProfilePublic; preset?: (typeof DECISION_PRESETS)[number] }) {
  const isNew = !profile;
  const provider = (profile?.provider ?? preset?.provider ?? "openrouter") as DecisionProviderId;
  const info = decisionProvider(provider);
  const [d, setD] = useState<Draft>(() => ({
    name: profile?.name ?? (preset ? `${preset.title} · ${preset.subtitle.replace(/^via /, "")}` : ""),
    provider,
    model: profile?.model ?? preset?.model ?? info.defaultModel,
    baseUrl: profile?.baseUrl ?? "",
    accountId: profile?.accountId ?? "",
    wire: profile?.wire ?? "systemone",
    makeDefault: profile?.isDefault ?? false,
  }));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<DecisionResult | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const knownModel = info.models.some((m) => m.id === d.model);
  const [customModel, setCustomModel] = useState(!knownModel && !!d.model);
  const needsEndpoint = info.needs.includes("endpoint");
  const keyStatus = profile ? (profile.keySource === "profile" ? "Saved on the Enginuity server" : profile.keySource === "env" ? `From the server environment ($${profile.keyEnv})` : "Not set") : "Not set";

  const save = async (): Promise<string | null> => {
    setBusy("save");
    setError(null);
    const r = await runDecision<DecisionProfilePublic>("decision.saveProfile", {
      ...(profile ? { id: profile.id } : {}),
      name: d.name.trim() || undefined,
      provider: d.provider,
      model: d.model.trim(),
      baseUrl: d.baseUrl.trim(),
      accountId: d.accountId.trim(),
      ...(d.provider === "custom" ? { wire: d.wire } : {}),
      makeDefault: d.makeDefault,
    });
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return null;
    }
    try {
      if (key.trim()) await saveProfileKey(r.result.id, key.trim());
      setKey("");
    } catch (err) {
      setError(`Saved, but the key was not stored: ${err instanceof Error ? err.message : String(err)}`);
    }
    await refreshProfiles();
    useDecisions.setState({ selected: r.result.id });
    setBusy(null);
    if (isNew) useRC.getState().toast({ kind: "success", title: "Decision model added", body: r.result.name });
    return r.result.id;
  };

  const runTest = async () => {
    const id = profile?.id ?? (await save());
    if (!id) return;
    setBusy("test");
    setError(null);
    setTest(null);
    const r = await runDecision<DecisionResult>("decision.test", { profile: id });
    setBusy(null);
    if (r.ok) setTest(r.result);
    else setError(r.error);
  };

  const remove = async () => {
    if (!profile) {
      useDecisions.setState({ selected: "new" });
      return;
    }
    setBusy("delete");
    const r = await runDecision("decision.deleteProfile", { profile: profile.id });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const ps = await refreshProfiles();
    useDecisions.setState({ selected: ps.find((p) => p.isDefault)?.id ?? ps[0]?.id ?? "new" });
  };

  const clearKey = async () => {
    if (!profile) return;
    try {
      await saveProfileKey(profile.id, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const field = (label: string, el: ReactNode, hint?: string) => (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ font: "600 11.5px var(--font-ui)", color: "var(--ink-1)" }}>{label}</span>
      {el}
      {hint && <span style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>{hint}</span>}
    </label>
  );
  const stop = (e: KeyboardEvent) => e.stopPropagation();
  const caps = profile?.capabilities;

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input className="g-input" aria-label="Name" style={{ font: "650 15px var(--font-ui)", height: 34 }} value={d.name} placeholder="Name" onChange={(e) => setD({ ...d, name: e.target.value })} onKeyDown={stop} />
        <button className={`g-btn ${d.makeDefault ? "active" : ""}`} style={{ whiteSpace: "nowrap", flexShrink: 0 }} title="The Copilot and new Decision instructions use the default model" onClick={() => setD({ ...d, makeDefault: !d.makeDefault })}>
          {d.makeDefault ? "★ Default" : "☆ Make default"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...chip, background: "var(--accent-soft)", color: "var(--accent-ink)" }}>{info.label}</span>
        {caps && <span style={chip}>{caps.images ? "Text, JSON, images" : "Text and JSON"}</span>}
        {caps?.box && <span style={chip}>Box questions</span>}
        {caps && <span style={chip}>≤ {caps.maxQuestions} questions</span>}
        <a href={info.docs} target="_blank" rel="noopener noreferrer" style={{ ...chip, textDecoration: "none" }}>
          Docs ↗
        </a>
      </div>

      {field(
        "Model",
        customModel || provider === "custom" ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input className="g-input mono" value={d.model} placeholder={provider === "azure" ? "Your deployment name" : "Model id"} onChange={(e) => setD({ ...d, model: e.target.value })} onKeyDown={stop} />
            {info.models.length > 0 && (
              <button
                className="g-btn ghost"
                onClick={() => {
                  setCustomModel(false);
                  setD({ ...d, model: info.defaultModel });
                }}
              >
                List
              </button>
            )}
          </div>
        ) : (
          <select
            className="g-input"
            value={d.model}
            onChange={(e) => {
              if (e.target.value === "__custom") setCustomModel(true);
              else setD({ ...d, model: e.target.value });
            }}
          >
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.id}
              </option>
            ))}
            <option value="__custom">Other model id…</option>
          </select>
        ),
        provider === "azure" ? "Microsoft Foundry: the request's model is your deployment name." : undefined,
      )}

      {info.needs.includes("accountId") && field("Account ID", <input className="g-input mono" value={d.accountId} placeholder="Cloudflare account id" onChange={(e) => setD({ ...d, accountId: e.target.value })} onKeyDown={stop} />, "Find it in the Cloudflare dashboard, Workers AI section.")}

      {(needsEndpoint || advanced) &&
        field(
          provider === "azure" ? "Foundry resource endpoint" : provider === "custom" ? "Endpoint" : info.wire === "openai" ? "Base URL" : "Endpoint",
          <input className="g-input mono" value={d.baseUrl} placeholder={provider === "azure" ? "https://<resource>.services.ai.azure.com" : info.endpoint} onChange={(e) => setD({ ...d, baseUrl: e.target.value })} onKeyDown={stop} />,
          provider === "custom" ? "Any server that speaks one of the two schemas, e.g. self-hosted Clef or Decider weights." : !needsEndpoint ? `Default: ${info.endpoint}` : undefined,
        )}

      {provider === "custom" &&
        field(
          "Schema",
          <div role="radiogroup" className="glass-inset" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 11, width: "fit-content" }}>
            {(["systemone", "openai"] as const).map((w) => (
              <button key={w} role="radio" aria-checked={d.wire === w} className={`g-btn ${d.wire === w ? "active" : "ghost"}`} style={{ height: 26 }} onClick={() => setD({ ...d, wire: w })}>
                {w === "systemone" ? "System One (Jev, Clef, Decider)" : "OpenAI Decisions"}
              </button>
            ))}
          </div>,
        )}

      {field(
        info.keyLabel,
        <div style={{ display: "flex", gap: 6 }}>
          <input className="g-input mono" type="password" autoComplete="off" value={key} placeholder={profile?.keySource === "profile" ? "•••••••• (saved — type to replace)" : "Paste the key"} onChange={(e) => setKey(e.target.value)} onKeyDown={stop} />
          {profile?.keySource === "profile" && (
            <button className="g-btn ghost" onClick={() => void clearKey()}>
              Remove
            </button>
          )}
        </div>,
        `${keyStatus}. Keys stay on the Enginuity server; the browser and the Copilot never see them.`,
      )}

      {!needsEndpoint && provider !== "custom" && (
        <button className="g-btn ghost" style={{ justifySelf: "start", height: 24, fontSize: 11.5 }} onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Hide advanced" : "Advanced: endpoint override"}
        </button>
      )}

      {profile && !profile.ready && <div style={{ font: "500 12px var(--font-ui)", color: "var(--warn)" }}>Missing: {profile.missing.join(", ")}</div>}
      {error && <div style={{ padding: "8px 12px", borderRadius: 12, background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", font: "500 12px/1.45 var(--font-ui)" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="g-btn primary" disabled={!!busy || !d.model.trim()} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : isNew ? "Add model" : "Save"}
        </button>
        <button className="g-btn" disabled={!!busy || !d.model.trim()} onClick={() => void runTest()} title="Asks a sample grasp-check question and shows the answer">
          {busy === "test" ? "Testing…" : "Test"}
        </button>
        <button className="g-btn danger" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={() => void remove()}>
          {isNew ? "Cancel" : "Delete"}
        </button>
      </div>

      {test && (
        <div className="glass-inset" style={{ padding: 12, borderRadius: 14 }}>
          <DecisionResultCard result={test} title="Test: grasp check" />
        </div>
      )}
    </div>
  );
}
