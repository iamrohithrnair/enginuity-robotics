"use client";
// Edits robot joint senses, home position, and kinematics tables.

 
 
 

import { useEffect, useState } from "react";
import { cmd, cmdx } from "@/client/api";
import { robotSenses, SENSES_TEXT } from "@/engine/commands/robot-display";
import { poseToXYZRPW, xyzrpwToPose } from "@/engine/math";
import type { Item } from "@/engine/types";
import { Combo, Field, PoseFields, Section } from "../inspector/fields";

export function RobotParametersMore({ robot }: { robot: Item }) {
  const m = robot.robot!.model;
  const sensesKey = robotSenses(m).join(", ");
  const [draft, setDraft] = useState<string | null>(null);
  const senses = draft ?? sensesKey;
  const [model, setModel] = useState<"DHM" | "DH">("DHM");
  const [table, setTable] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const dhKey = JSON.stringify(m.joints);
  useEffect(() => {
    void cmd<{ text: string }>("robot.exportKinematics", { robot: robot.id, model }, { quiet: true }).then((r) => r && setTable(r.text));
  }, [robot.id, model, dhKey]);
  const frame = (key: "base" | "tool", v: number[]) => void cmd("robot.setParameters", { robot: robot.id, [key]: xyzrpwToPose(v) });
  const run = async (name: string, params: Record<string, unknown>, ok: string) => {
    const r = await cmdx(name, params);
    setMsg(r.ok ? { text: ok } : { text: r.error ?? "", bad: true });
  };
  return (
    <>
      <Section title="Base frame:">
        <PoseFields values={poseToXYZRPW(m.base)} rot={["Rx", "Ry", "Rz"]} unit="deg" onCommit={(v) => frame("base", v)} />
      </Section>
      <Section title="Tool frame:">
        <PoseFields values={poseToXYZRPW(m.flange)} rot={["Rx", "Ry", "Rz"]} unit="deg" onCommit={(v) => frame("tool", v)} />
      </Section>
      <Section title="Joint Senses">
        <div style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)", marginBottom: 6 }}>
          Set the robot axis senses, in order: +1 (default) or -1 (inverted).
          {m.nq === 6 ? ` ${SENSES_TEXT.coupling}` : ""}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="g-input" aria-label={SENSES_TEXT.title} value={senses} onChange={(e) => setDraft(e.target.value)} />
          <button className="g-btn" onClick={() => void run("robot.setSenses", { robot: robot.id, senses }, "Joint senses updated").then(() => setDraft(null))}>
            Apply
          </button>
        </div>
      </Section>
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "4px 0 8px" }}>
        <button className="g-btn" title="Use the current joints as the home position" onClick={() => void run("robot.setHome", { robot: robot.id }, "Home position set to the current joints")}>
          Set home position
        </button>
      </div>
      <Section title="Export Table">
        <Field label="Model" inline>
          <Combo
            label="Kinematics model"
            value={model}
            onChange={setModel}
            options={[
              { value: "DH", label: "Denavit Hartenberg (DH)" },
              { value: "DHM", label: "Denavit Hartenberg Modified (DHM)" },
            ]}
          />
        </Field>
        <div style={{ font: "600 10px var(--font-ui)", color: "var(--ink-3)", margin: "2px 0 4px" }}>{model === "DHM" ? "alpha (deg) · a (mm) · theta (deg) · d (mm) — Nominal" : "d (mm) · theta (deg) · a (mm) · alpha (deg) — Nominal"}</div>
        <textarea className="g-input" aria-label="Kinematics table" rows={Math.min(9, m.joints.length + 1)} spellCheck={false} value={table} onChange={(e) => setTable(e.target.value)} style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11.5 }} />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
          <button className="g-btn ghost" onClick={() => void navigator.clipboard?.writeText(table).then(() => setMsg({ text: "Table copied" }))}>
            copy data
          </button>
          <button className="g-btn" disabled={model !== "DHM"} title={model === "DHM" ? "Use this table as the robot's DHM parameters" : "Paste works on the DHM table"} onClick={() => void run("robot.pasteKinematics", { robot: robot.id, text: table }, "Kinematic parameters updated")}>
            paste data
          </button>
        </div>
      </Section>
      {msg.text && <div style={{ font: "500 12px var(--font-ui)", color: msg.bad ? "var(--bad)" : "var(--ink-1)", marginTop: 6 }}>{msg.text}</div>}
    </>
  );
}
