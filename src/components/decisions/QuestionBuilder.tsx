"use client";

import { useState } from "react";
import { questionKey, type DecisionQuestion, type DecisionQuestionType } from "@/engine/decisions";
import { Icon } from "../icons";

 
export const QUESTION_TEMPLATES: { label: string; question: DecisionQuestion }[] = [
  { label: "Grasp check", question: { name: "grasp_ok", type: "yesno", instructions: "Is the part securely grasped and ready to be moved?", yes: "The gripper holds the part firmly and centred", no: "The part is missing, slipping or off-centre" } },
  {
    label: "Part quality",
    question: {
      name: "quality",
      type: "choice",
      instructions: "What is the condition of the inspected part?",
      options: [
        { value: "good", description: "No visible defect" },
        { value: "scratched", description: "Surface scratches only" },
        { value: "dented", description: "Dents or deformation" },
        { value: "wrong_part", description: "Not the expected part" },
      ],
    },
  },
  {
    label: "Bin selection",
    question: {
      name: "bin",
      type: "choice",
      instructions: "Which bin should the robot place the part in?",
      options: [
        { value: "bin_a", description: "Small parts" },
        { value: "bin_b", description: "Large parts" },
        { value: "reject", description: "Damaged or unknown parts" },
      ],
    },
  },
  {
    label: "Collision risk",
    question: {
      name: "risk",
      type: "score",
      instructions: "How likely is the next motion to collide with something?",
      levels: [{ label: "None" }, { label: "Low", description: "Close but clear" }, { label: "High", description: "Very close to an obstacle" }, { label: "Imminent", description: "The path crosses an obstacle" }],
    },
  },
  { label: "Cell clear", question: { name: "cell_clear", type: "yesno", instructions: "Is the robot cell clear of people and loose objects?" } },
  { label: "Locate part (image)", question: { name: "part_box", type: "box", instructions: "the part lying on the conveyor" } },
];

const TYPES: { value: DecisionQuestionType; label: string; hint: string }[] = [
  { value: "yesno", label: "Yes / No", hint: "Probability that the statement is true" },
  { value: "choice", label: "Choice", hint: "One of your options, with a probability each" },
  { value: "score", label: "Score", hint: "A level on an ordered rubric, lowest first" },
  { value: "box", label: "Box", hint: "Where something is in the image (Jev 1.14)" },
];

const row = { display: "grid", gridTemplateColumns: "minmax(80px, 34%) 1fr 26px", gap: 6, alignItems: "center" } as const;

export default function QuestionBuilder({ value, onChange, allowBox = true }: { value: DecisionQuestion; onChange: (q: DecisionQuestion) => void; allowBox?: boolean }) {
   
  const [nameEdited, setNameEdited] = useState(false);
  const set = (patch: Partial<DecisionQuestion>) => onChange({ ...value, ...patch });

  const setType = (type: DecisionQuestionType) => {
    const next: DecisionQuestion = { ...value, type };
    if (type === "choice" && !(value.options ?? []).length) next.options = [{ value: "option_a" }, { value: "option_b" }];
    if (type === "score" && !(value.levels ?? []).length) next.levels = [{ label: "Low" }, { label: "Medium" }, { label: "High" }];
    onChange(next);
  };

  const options = value.options ?? [];
  const levels = value.levels ?? [];
  const types = TYPES.filter((t) => allowBox || t.value !== "box" || value.type === "box");

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <div role="radiogroup" aria-label="Question type" className="glass-inset" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 11 }}>
          {types.map((t) => (
            <button key={t.value} role="radio" aria-checked={value.type === t.value} title={t.hint} className={`g-btn ${value.type === t.value ? "active" : "ghost"}`} style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={() => setType(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <select
          className="g-input"
          aria-label="Question templates"
          value=""
          style={{ width: "auto", marginLeft: "auto", height: 28 }}
          onChange={(e) => {
            const t = QUESTION_TEMPLATES.find((x) => x.label === e.target.value);
            if (t) {
              setNameEdited(false);
              onChange(structuredClone(t.question));
            }
          }}
        >
          <option value="">Templates…</option>
          {QUESTION_TEMPLATES.filter((t) => allowBox || t.question.type !== "box").map((t) => (
            <option key={t.label} value={t.label}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <textarea
        className="g-input"
        rows={2}
        aria-label="Question"
        placeholder={value.type === "box" ? "What to find, e.g. the red part on the conveyor" : value.type === "yesno" ? "A yes/no question, e.g. Is the part seated in the fixture?" : "What should be decided?"}
        value={value.instructions}
        onChange={(e) => {
          const instructions = e.target.value;
          onChange({ ...value, instructions, name: nameEdited ? value.name : questionKey(instructions.split(/\s+/).slice(0, 4).join("_").toLowerCase(), value.name || "q") });
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 8, font: "500 11.5px var(--font-ui)", color: "var(--ink-2)" }}>
        Answer key
        <input
          className="g-input mono"
          style={{ width: 180, height: 24, fontSize: 11.5 }}
          value={value.name}
          onChange={(e) => {
            setNameEdited(true);
            set({ name: e.target.value });
          }}
          onBlur={() => set({ name: questionKey(value.name, "q") })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>

      {value.type === "yesno" && (
        <div style={{ display: "grid", gap: 6 }}>
          <input className="g-input" placeholder="Optional: what a yes means" value={value.yes ?? ""} onChange={(e) => set({ yes: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <input className="g-input" placeholder="Optional: what a no means" value={value.no ?? ""} onChange={(e) => set({ no: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </div>
      )}

      {value.type === "choice" && (
        <div style={{ display: "grid", gap: 5 }}>
          {options.map((o, i) => (
            <div key={i} style={row}>
              <input className="g-input mono" aria-label={`Option ${i + 1} value`} value={o.value} onChange={(e) => set({ options: options.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} />
              <input className="g-input" aria-label={`Option ${i + 1} description`} placeholder="When it applies" value={o.description ?? ""} onChange={(e) => set({ options: options.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} />
              <button className="g-btn icon ghost" style={{ width: 26, height: 26 }} title="Remove option" disabled={options.length <= 2} onClick={() => set({ options: options.filter((_, k) => k !== i) })}>
                <Icon.Minus size={13} />
              </button>
            </div>
          ))}
          <button className="g-btn ghost" style={{ justifySelf: "start", height: 26 }} onClick={() => set({ options: [...options, { value: `option_${String.fromCharCode(97 + (options.length % 26))}` }] })}>
            <Icon.Plus size={13} /> Add option
          </button>
        </div>
      )}

      {value.type === "score" && (
        <div style={{ display: "grid", gap: 5 }}>
          <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>Levels, lowest first — the answer is a position between 0 and {Math.max(1, levels.length - 1)}.</div>
          {levels.map((l, i) => (
            <div key={i} style={row}>
              <input className="g-input" aria-label={`Level ${i} label`} value={l.label} onChange={(e) => set({ levels: levels.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} />
              <input className="g-input" aria-label={`Level ${i} description`} placeholder="Description (optional)" value={l.description ?? ""} onChange={(e) => set({ levels: levels.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} />
              <button className="g-btn icon ghost" style={{ width: 26, height: 26 }} title="Remove level" disabled={levels.length <= 2} onClick={() => set({ levels: levels.filter((_, k) => k !== i) })}>
                <Icon.Minus size={13} />
              </button>
            </div>
          ))}
          <button className="g-btn ghost" style={{ justifySelf: "start", height: 26 }} onClick={() => set({ levels: [...levels, { label: `Level ${levels.length}` }] })}>
            <Icon.Plus size={13} /> Add level
          </button>
        </div>
      )}

      {value.type === "box" && <div style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)" }}>Box questions need an image (3D view or camera) and Jev 1.14 (TypeSafe or OpenRouter).</div>}
    </div>
  );
}
