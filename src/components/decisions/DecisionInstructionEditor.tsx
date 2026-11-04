"use client";

import { useState, type KeyboardEvent } from "react";
import { useRC } from "@/client/store";
import { outcomeKeys, type DecisionAction, type DecisionInstruction, type DecisionResult } from "@/engine/decisions";
import { stationParams } from "@/engine/stationParams";
import type { InstructionData, Item } from "@/engine/types";
import { Icon } from "../icons";
import { DecisionResultCard } from "./ProbabilityBars";
import QuestionBuilder from "./QuestionBuilder";
import { openDecisionModels, runDecision, useDecisions } from "./uiStore";

const ACTIONS: { value: DecisionAction["do"]; label: string }[] = [
  { value: "continue", label: "Continue" },
  { value: "stop", label: "Stop the program" },
  { value: "call", label: "Call program" },
  { value: "start", label: "Start program (parallel)" },
  { value: "setIO", label: "Set IO" },
  { value: "setVar", label: "Set station variable" },
  { value: "message", label: "Show message" },
];

function newAction(kind: DecisionAction["do"]): DecisionAction {
  switch (kind) {
    case "call":
    case "start":
      return { do: kind, program: "" };
    case "setIO":
      return { do: "setIO", io: "1", value: "1" };
    case "setVar":
      return { do: "setVar", name: "STATE", value: "" };
    case "message":
      return { do: "message", text: "" };
    default:
      return { do: kind } as DecisionAction;
  }
}

const stop = (e: KeyboardEvent) => e.stopPropagation();

function ActionRow({ a, programs, onChange, onRemove }: { a: DecisionAction; programs: Item[]; onChange: (a: DecisionAction) => void; onRemove: () => void }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <select className="g-input" style={{ width: 150, flexShrink: 0 }} aria-label="Action" value={a.do} onChange={(e) => onChange(newAction(e.target.value as DecisionAction["do"]))}>
        {ACTIONS.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
      {(a.do === "call" || a.do === "start") && (
        <select className="g-input" aria-label="Program" value={a.program} onChange={(e) => onChange({ ...a, program: e.target.value })}>
          <option value="">Pick a program</option>
          {programs.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {a.do === "setIO" && (
        <>
          <input className="g-input mono" style={{ width: 70 }} aria-label="IO" value={a.io} onChange={(e) => onChange({ ...a, io: e.target.value })} onKeyDown={stop} />
          <span style={{ color: "var(--ink-2)" }}>=</span>
          <input className="g-input mono" style={{ width: 60 }} aria-label="Value" value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })} onKeyDown={stop} />
        </>
      )}
      {a.do === "setVar" && (
        <>
          <input className="g-input mono" aria-label="Variable" value={a.name} onChange={(e) => onChange({ ...a, name: e.target.value })} onKeyDown={stop} />
          <span style={{ color: "var(--ink-2)" }}>=</span>
          <input className="g-input mono" aria-label="Value" value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })} onKeyDown={stop} />
        </>
      )}
      {a.do === "message" && <input className="g-input" aria-label="Message" placeholder="Status bar message" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} onKeyDown={stop} />}
      <button className="g-btn icon ghost" style={{ width: 26, height: 26, flexShrink: 0, marginLeft: "auto" }} aria-label="Remove action" title="Remove action" onClick={onRemove}>
        <Icon.Minus size={13} />
      </button>
    </div>
  );
}

 
export default function DecisionInstructionEditor({ it, ins }: { it: Item; ins: InstructionData }) {
   
  return ins.decision ? <Editor key={`${it.id}:${JSON.stringify(ins.decision)}`} it={it} decision={ins.decision} /> : <div style={{ color: "var(--ink-2)" }}>This decision is not defined.</div>;
}

function Editor({ it, decision }: { it: Item; decision: DecisionInstruction }) {
  const ws = useRC((s) => s.ws);
  const profiles = useDecisions((s) => s.profiles);
  const loaded = useDecisions((s) => s.loaded);
  const [d, setD] = useState<DecisionInstruction>(() => structuredClone(decision));
  const [busy, setBusy] = useState<null | "save" | "test">(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ result: DecisionResult; outcome: string | null } | null>(null);

  const programs = Object.values(ws?.items ?? {}).filter((i) => i.type === "program" && i.id !== it.parent);
  const cameras = Object.values(ws?.items ?? {}).filter((i) => (i.type as string) === "camera");
  const profile = profiles.find((p) => p.id === d.profile) ?? profiles.find((p) => p.isDefault);
  const caps = profile?.capabilities;
  const keys = [...outcomeKeys(d.question), ...(d.onError === "branch" ? ["error"] : [])];
  const dirty = JSON.stringify(d) !== JSON.stringify(decision);
  const params = Object.keys(ws ? stationParams(ws) : {}).slice(0, 12);

  const save = async () => {
    setBusy("save");
    setError(null);
     
    const outcomes = Object.fromEntries(keys.map((k) => [k, d.outcomes[k] ?? [{ do: "continue" }]]));
    const r = await runDecision("instruction.editDecision", {
      instruction: it.id,
      question: d.question,
      input: d.input,
      includeState: d.includeState,
      image: d.image,
      camera: d.image === "camera" ? d.camera || null : null,
      profile: d.profile,
      threshold: d.threshold,
      outcomes,
      onError: d.onError,
      timeoutMs: d.timeoutMs,
      storeAs: d.storeAs,
    });
    setBusy(null);
    if (!r.ok) setError(r.error);
  };

  const runTest = async () => {
    if (dirty) await save();
    setBusy("test");
    setError(null);
    setTest(null);
    const r = await runDecision<DecisionResult & { outcome: string | null }>("instruction.testDecision", { instruction: it.id });
    setBusy(null);
    if (r.ok) setTest({ result: r.result, outcome: r.result.outcome });
    else setError(r.error);
  };

  const setOutcome = (k: string, actions: DecisionAction[]) => setD({ ...d, outcomes: { ...d.outcomes, [k]: actions } });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 5 }}>
        <span className="g-label">Decision model</span>
        <div style={{ display: "flex", gap: 6 }}>
          <select className="g-input" value={d.profile ?? ""} onChange={(e) => setD({ ...d, profile: e.target.value || null })}>
            <option value="">Default{profiles.find((p) => p.isDefault) ? ` (${profiles.find((p) => p.isDefault)!.name})` : ""}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.ready ? "" : " (not ready)"}
              </option>
            ))}
          </select>
          <button className="g-btn icon ghost" title="Decision models" onClick={() => openDecisionModels(profile?.id)}>
            <Icon.Settings size={14} />
          </button>
        </div>
        {loaded && !profiles.length && <span style={{ font: "500 11.5px var(--font-ui)", color: "var(--warn)" }}>No decision model is set up yet.</span>}
      </label>

      <div className="glass-inset" style={{ padding: 10, borderRadius: 12 }}>
        <QuestionBuilder value={d.question} allowBox={!!caps?.box} onChange={(q) => setD({ ...d, question: q, storeAs: d.storeAs === d.question.name ? q.name : d.storeAs })} />
      </div>

      <label style={{ display: "grid", gap: 5 }}>
        <span className="g-label">Input</span>
        <textarea className="g-input" rows={3} placeholder="Facts for the model, e.g. Grip force {{GRIP_FORCE}} N, part sensor {{IO_3}}" value={d.input} onChange={(e) => setD({ ...d, input: e.target.value })} onKeyDown={stop} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["robot.tcp", "robot.joints", "program.name", ...params].map((k) => (
            <button key={k} className="g-btn ghost mono" style={{ height: 20, padding: "0 6px", fontSize: 10.5 }} title={`Insert {{${k}}}`} onClick={() => setD({ ...d, input: `${d.input}{{${k}}}` })}>
              {`{{${k}}}`}
            </button>
          ))}
        </div>
      </label>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className={`g-btn ${d.includeState ? "active" : "ghost"}`} onClick={() => setD({ ...d, includeState: !d.includeState })} title="Robots, joints, TCP positions, objects and IO values as JSON">
          Station state
        </button>
        <div role="radiogroup" aria-label="Image" className="glass-inset" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 11 }}>
          {(["none", "view", "camera"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={d.image === v} disabled={v !== "none" && !!caps && !caps.images} className={`g-btn ${d.image === v ? "active" : "ghost"}`} style={{ height: 26, fontSize: 12 }} onClick={() => setD({ ...d, image: v })}>
              {v === "none" ? "No image" : v === "view" ? "3D view" : "Camera"}
            </button>
          ))}
        </div>
        {d.image === "camera" && (
          <select className="g-input" style={{ width: 160 }} value={d.camera ?? ""} onChange={(e) => setD({ ...d, camera: e.target.value || null })} aria-label="Camera">
            <option value="">{cameras.length ? "Pick a camera" : "No camera in the station"}</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {(d.question.type === "yesno" || d.question.type === "box") && (
        <label style={{ display: "grid", gap: 4 }}>
          <span className="g-label">
            {d.question.type === "yesno" ? "Yes when the probability is at least" : "Found when the confidence is at least"} {d.threshold.toFixed(2)}
          </span>
          <input type="range" className="g-range" min={0.05} max={0.95} step={0.05} value={d.threshold} style={{ ["--fill" as string]: `${((d.threshold - 0.05) / 0.9) * 100}%` }} onChange={(e) => setD({ ...d, threshold: Number(e.target.value) })} />
        </label>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <span className="g-label">Then</span>
        {keys.map((k) => {
          const actions = d.outcomes[k] ?? [{ do: "continue" as const }];
          return (
            <div key={k} className="glass-inset" style={{ padding: 10, borderRadius: 12, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ font: "650 12px var(--font-ui)", color: k === "error" ? "var(--bad)" : "var(--accent-ink)" }}>{k === "error" ? "If the model fails" : `If ${k}`}</span>
                <button className="g-btn ghost" style={{ marginLeft: "auto", height: 22, fontSize: 11.5 }} onClick={() => setOutcome(k, [...actions, newAction("message")])}>
                  <Icon.Plus size={12} /> Action
                </button>
              </div>
              {actions.map((a, i) => (
                <ActionRow key={i} a={a} programs={programs} onChange={(na) => setOutcome(k, actions.map((x, j) => (j === i ? na : x)))} onRemove={() => setOutcome(k, actions.filter((_, j) => j !== i))} />
              ))}
              {!actions.length && <span style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)" }}>Continue with the next instruction.</span>}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="g-label">On error</span>
          <select className="g-input" value={d.onError} onChange={(e) => setD({ ...d, onError: e.target.value as DecisionInstruction["onError"] })}>
            <option value="stop">Stop the program</option>
            <option value="branch">Run the error branch</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="g-label">Timeout (s)</span>
          <input className="g-input num" type="number" min={1} max={120} value={Math.round(d.timeoutMs / 1000)} onChange={(e) => setD({ ...d, timeoutMs: Math.min(120, Math.max(1, Number(e.target.value) || 15)) * 1000 })} onKeyDown={stop} />
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="g-label">Store the answer as</span>
        <input className="g-input mono" value={d.storeAs} onChange={(e) => setD({ ...d, storeAs: e.target.value })} onKeyDown={stop} />
        <span style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>
          Station parameters {d.storeAs || d.question.name} and {d.storeAs || d.question.name}_P (probability), readable by later decisions and the API.
        </span>
      </label>

      {error && <div style={{ padding: "8px 12px", borderRadius: 12, background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", font: "500 12px/1.45 var(--font-ui)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="g-btn primary" disabled={!dirty || !!busy} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : "Apply"}
        </button>
        <button className="g-btn" disabled={!dirty || !!busy} onClick={() => setD(structuredClone(decision))}>
          Revert
        </button>
        <button className="g-btn" style={{ marginLeft: "auto" }} disabled={!!busy || !profiles.length} onClick={() => void runTest()} title="Ask now with the current inputs; no actions run">
          {busy === "test" ? "Asking…" : "Test now"}
        </button>
      </div>
      {test && (
        <div className="glass-inset" style={{ padding: 12, borderRadius: 14, display: "grid", gap: 8 }}>
          <DecisionResultCard result={test.result} threshold={d.threshold} compact />
          <div style={{ font: "600 12px var(--font-ui)" }}>Would take: {test.outcome ?? "refused"}</div>
        </div>
      )}
    </div>
  );
}
