"use client";

import { useState, type KeyboardEvent } from "react";
import { selectNow } from "@/client/api";
import { useRC } from "@/client/store";
import { answerSummary, questionKey, type DecisionQuestion, type DecisionResult } from "@/engine/decisions";
import { Icon } from "../icons";
import { DecisionResultCard } from "./ProbabilityBars";
import QuestionBuilder, { QUESTION_TEMPLATES } from "./QuestionBuilder";
import { closeDecisionDialogs, openDecisionModels, runDecision, useDecisions } from "./uiStore";



export default function DecidePlayground() {
  const open = useDecisions((s) => s.dialog === "playground");
  return open ? <Body /> : null;
}

function Body() {
  const profiles = useDecisions((s) => s.profiles);
  const loaded = useDecisions((s) => s.loaded);
  const log = useDecisions((s) => s.log);
  const ws = useRC((s) => s.ws);
  const [profile, setProfile] = useState<string>("");
  const [text, setText] = useState("");
  const [includeStation, setIncludeStation] = useState(true);
  const [image, setImage] = useState<"none" | "view" | "camera">("none");
  const [camera, setCamera] = useState("");
  const [questions, setQuestions] = useState<DecisionQuestion[]>(() => [structuredClone(QUESTION_TEMPLATES[0].question)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [target, setTarget] = useState<string>("");

  const active = profiles.find((p) => p.id === profile) ?? profiles.find((p) => p.isDefault) ?? profiles[0];
  const caps = active?.capabilities;
  const cameras = Object.values(ws?.items ?? {}).filter((i) => (i.type as string) === "camera");
  const programs = Object.values(ws?.items ?? {}).filter((i) => i.type === "program");
  const programId = target || programs[0]?.id || "";
  const stop = (e: KeyboardEvent) => e.stopPropagation();

  const decide = async () => {
    setBusy(true);
    setError(null);
    const r = await runDecision<DecisionResult>("decision.ask", {
      ...(active ? { profile: active.id } : {}),
      questions,
      text: text.trim() || undefined,
      includeStation,
      image,
      ...(image === "camera" && camera ? { camera } : {}),
    });
    setBusy(false);
    if (r.ok) setResult(r.result);
    else setError(r.error);
  };

  const addToProgram = async () => {
    const q = questions[0];
    if (!programId || !q) return;
    const r = await runDecision<{ id: string; name: string; program: string }>("program.addDecision", {
      program: programId,
      question: q,
      input: text,
      includeState: includeStation,
      image,
      ...(image === "camera" && camera ? { camera } : {}),
      profile: active?.id ?? null,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    useRC.getState().toast({ kind: "success", title: "Decision instruction added", body: `${r.result.name} in ${r.result.program}` });
    closeDecisionDialogs();
    void selectNow([r.result.id]);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 76, display: "grid", placeItems: "center", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && closeDecisionDialogs()}>
      <div className="glass glass-strong liquid rc-pop" role="dialog" aria-label="Decide playground" style={{ width: 980, maxWidth: "calc(100vw - 32px)", height: 640, maxHeight: "88vh", borderRadius: 24, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--hair)" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Icon.Decision size={18} />
          </div>
          <div style={{ font: "700 15px var(--font-ui)" }}>Decide</div>
          <select className="g-input" aria-label="Decision model" style={{ width: 280, marginLeft: 12 }} value={active?.id ?? ""} onChange={(e) => setProfile(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.ready ? "" : " (not ready)"}
              </option>
            ))}
            {!profiles.length && <option value="">No decision model</option>}
          </select>
          <button className="g-btn ghost" onClick={() => openDecisionModels(active?.id)}>
            <Icon.Settings size={14} /> Models
          </button>
          <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} aria-label="Close" title="Close" onClick={closeDecisionDialogs}>
            <Icon.Close size={15} />
          </button>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.15fr 1fr", minHeight: 0 }}>
          <section className="g-scroll" style={{ padding: 16, borderRight: "1px solid var(--hair)", display: "grid", alignContent: "start", gap: 12 }}>
            <div className="g-label">Situation</div>
            <textarea className="g-input" rows={3} placeholder="Describe what to judge, e.g. sensor readings, the operator's request, a candidate plan…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={stop} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className={`g-btn ${includeStation ? "active" : "ghost"}`} onClick={() => setIncludeStation(!includeStation)} title="Robots, joints, TCP positions, objects and IO values as JSON">
                Station state
              </button>
              <div role="radiogroup" aria-label="Image" className="glass-inset" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 11 }}>
                {(["none", "view", "camera"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={image === v}
                    disabled={v !== "none" && !caps?.images}
                    title={v !== "none" && !caps?.images ? "This model reads text and JSON only" : undefined}
                    className={`g-btn ${image === v ? "active" : "ghost"}`}
                    style={{ height: 26, fontSize: 12 }}
                    onClick={() => setImage(v)}
                  >
                    {v === "none" ? "No image" : v === "view" ? "3D view" : "Camera"}
                  </button>
                ))}
              </div>
              {image === "camera" && (
                <select className="g-input" style={{ width: 180 }} value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="Camera">
                  <option value="">{cameras.length ? "Pick a camera" : "No camera in the station"}</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div className="g-label">Questions</div>
              <button
                className="g-btn ghost"
                style={{ marginLeft: "auto", height: 24, fontSize: 12 }}
                disabled={!!caps && questions.length >= caps.maxQuestions}
                onClick={() => setQuestions([...questions, { name: questionKey(`q${questions.length + 1}`), type: "yesno", instructions: "" }])}
              >
                <Icon.Plus size={13} /> Question
              </button>
            </div>
            {questions.map((q, i) => (
              <div key={i} className="glass-inset" style={{ padding: 12, borderRadius: 14, position: "relative" }}>
                {questions.length > 1 && (
                  <button className="g-btn icon ghost" style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24 }} aria-label="Remove question" title="Remove question" onClick={() => setQuestions(questions.filter((_, k) => k !== i))}>
                    <Icon.Close size={12} />
                  </button>
                )}
                <QuestionBuilder value={q} allowBox={!!caps?.box} onChange={(nq) => setQuestions(questions.map((x, k) => (k === i ? nq : x)))} />
              </div>
            ))}
          </section>
          <section className="g-scroll" style={{ padding: 16, display: "grid", alignContent: "start", gap: 12 }}>
            <button className="g-btn primary" style={{ height: 36, fontSize: 13.5 }} disabled={busy || !active || !questions.length} onClick={() => void decide()}>
              {busy ? "Deciding…" : "Decide"}
            </button>
            {loaded && !profiles.length && (
              <button className="g-btn" onClick={() => openDecisionModels("new")}>
                Add a decision model first
              </button>
            )}
            {active && !active.ready && <div style={{ font: "500 12px var(--font-ui)", color: "var(--warn)" }}>{active.name}: missing {active.missing.join(", ")}</div>}
            {error && <div style={{ padding: "8px 12px", borderRadius: 12, background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", font: "500 12px/1.45 var(--font-ui)" }}>{error}</div>}
            {result && (
              <div className="glass-inset" style={{ padding: 14, borderRadius: 16 }}>
                <DecisionResultCard result={result} />
              </div>
            )}
            {result && programs.length > 0 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select className="g-input" aria-label="Program" value={programId} onChange={(e) => setTarget(e.target.value)}>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button className="g-btn" style={{ flexShrink: 0 }} onClick={() => void addToProgram()} title="Insert the first question as a Decision instruction (edit its outcomes in the instruction panel)">
                  Add to program
                </button>
              </div>
            )}
            {log.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="g-label">Recent decisions</div>
                {log.slice(0, 12).map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", font: "500 11.5px var(--font-ui)", color: "var(--ink-1)" }}>
                    <span className="mono" style={{ color: "var(--ink-3)", fontSize: 10.5 }}>
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                    <span style={{ color: "var(--ink-2)" }}>{e.program ? `${e.program} · ${e.instruction}` : e.source === "agent" ? "Copilot" : e.source}</span>
                    <span style={{ marginLeft: "auto", textAlign: "right", color: e.error ? "var(--bad)" : "var(--ink-0)" }}>{e.error ?? e.result?.answers.map((a) => `${a.name}: ${answerSummary(a)}`).join(" · ")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
