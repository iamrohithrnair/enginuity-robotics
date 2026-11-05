"use client";
// Edits item names, frames, targets, object appearance, and notes.

import { useEffect, useState } from "react";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import { displayFlag } from "@/engine/display";
import { jointsConfig, kinematicsReady } from "@/engine/kinematics";
import { inv, mul } from "@/engine/math";
import type { Item } from "@/engine/types";
import { absPose, currentRobot, listItems, toolPose } from "@/engine/workspace";
import { Icon } from "../icons";
import { Check, Combo, Field, NumField, Radios, Section, TextField } from "./fields";
import PoseEditor from "./PoseEditor";
import PhysicsSection from "../physics/PhysicsSection";

 
export function NameField({ it, label = "Name:" }: { it: Item; label?: string }) {
  return (
    <Field label={label}>
      <TextField label={label} value={it.name} onCommit={(v) => void cmd("item.rename", { item: it.id, name: v })} />
    </Field>
  );
}

export function VisibleCheck({ it }: { it: Item }) {
  return <Check label="Visible" checked={it.visible} onChange={(v) => void cmd("item.setVisible", { items: [it.id], visible: v })} />;
}

 
export function FramePanel({ it }: { it: Item }) {
  const ws = useRC((s) => s.ws)!;
  const robots = listItems(ws, { type: "robot" });
  const owner = robots.find((r) => r.robot?.activeFrame === it.id);
  const cur = currentRobot(ws) ?? robots[0];
  return (
    <>
      <NameField it={it} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        <VisibleCheck it={it} />
        {robots.length > 0 && (
          <Check
            label={owner ? `Active Reference Frame (${owner.name})` : "Active Reference Frame"}
            checked={!!owner}
            onChange={(v) => void (v ? cmd("robot.setActiveFrame", { robot: cur!.id, frame: it.id }) : cmd("robot.clearActiveFrame", { robot: owner!.id }))}
          />
        )}
      </div>
      <PoseEditor item={it} refLabel="Reference position with respect to:" />
    </>
  );
}

 
const isTurnOf = (a: number[], b: number[]) =>
  a.length === b.length &&
  a.every((v, k) => {
    const d = Math.abs(v - b[k]) % 360;
    return d < 1e-3 || 360 - d < 1e-3;
  });

const CONFIG_TEXT = (c: number[]) => `${c[0] ? "Rear" : "Front"} · ${c[1] ? "Elbow Down" : "Elbow Up"} · ${c[2] ? "Flip" : "Non-Flip"}`;

 
function ConfigChooser({ target, robot, onClose }: { target: Item; robot: Item; onClose: () => void }) {
  const ws = useRC((s) => s.ws)!;
  const [sols, setSols] = useState<number[][] | null>(null);
  useEffect(() => {
    const flange = mul(mul(inv(absPose(ws, robot.id)), absPose(ws, target.id)), inv(toolPose(ws, robot.id)));
    void cmd<{ solutions: number[][] }>("robot.solveIK", { robot: robot.id, pose: flange, all: true }).then((r) => setSols(r?.solutions ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, robot.id]);
  const current = target.target?.joints ?? [];
  return (
    <div className="glass-inset" style={{ padding: 6, borderRadius: 12, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4, padding: "2px 4px" }}>
        <span style={{ font: "650 11.5px var(--font-ui)" }}>Robot Configurations</span>
        <button className="g-btn icon ghost" style={{ marginLeft: "auto", height: 22 }} aria-label="Close configurations" title="Close configurations" onClick={onClose}>
          <Icon.Close size={12} />
        </button>
      </div>
      {sols === null && <div style={{ padding: 8, color: "var(--ink-2)" }}>Solving…</div>}
      {sols?.length === 0 && <div style={{ padding: 8, color: "var(--ink-2)" }}>Target is not reachable</div>}
      <div className="g-scroll" style={{ maxHeight: 220 }}>
        {sols?.map((q, i) => {
          const same = q.length === current.length && q.every((v, k) => Math.abs(v - current[k]) < 1e-3);
          const conf = kinematicsReady() && robot.robot ? jointsConfig(robot.robot.model, q) : null;
           
          const turn = sols.slice(0, i).some((p) => isTurnOf(q, p));
          return (
            <button
              key={i}
              className={`g-btn ${same ? "active" : "ghost"}`}
              style={{ width: "100%", height: "auto", minHeight: 30, padding: "4px 8px", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
              onClick={() => void cmd("target.setJoints", { target: target.id, joints: q })}
            >
              <span style={{ font: "600 11px var(--font-ui)" }}>
                {conf ? CONFIG_TEXT(conf) : `Solution ${i + 1}`}
                {turn ? " · ±360° turn" : ""}
              </span>
              <span className="mono" style={{ font: "500 10.5px var(--font-mono)", color: "var(--ink-2)" }}>
                {q.map((v) => v.toFixed(2)).join("  ")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

 
export function TargetPanel({ it }: { it: Item }) {
  const ws = useRC((s) => s.ws)!;
  const t = it.target!;
  const robots = listItems(ws, { type: "robot" });
  const robot = t.robot ? ws.items[t.robot] : undefined;
  const [configs, setConfigs] = useState(false);
  return (
    <>
      <NameField it={it} />
      <div style={{ marginBottom: 10 }}>
        <VisibleCheck it={it} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
        <button className="g-btn" style={{ whiteSpace: "nowrap", fontSize: 12 }} disabled={!robot} onClick={() => void cmd("target.update", { target: it.id })}>
          Teach current position
        </button>
        <button className="g-btn primary" style={{ whiteSpace: "nowrap", fontSize: 12 }} disabled={!robot} onClick={() => void cmd("target.moveTo", { target: it.id })}>
          <Icon.MoveJ size={14} /> Move to target
        </button>
      </div>
      <Field label="Robot:">
        <Combo
          label="Robot"
          value={t.robot && ws.items[t.robot] ? t.robot : ""}
          onChange={(v) => void cmd("target.setRobot", { target: it.id, robot: v || null })}
          options={[{ value: "", label: "(none)" }, ...robots.map((r) => ({ value: r.id, label: r.name }))]}
        />
      </Field>
      <Field label="Target type">
        <Radios
          label="Target type"
          value={t.isJoint ? "joint" : "cartesian"}
          onChange={(v) => void cmd("target.setJoint", { target: it.id, isJoint: v === "joint" })}
          options={[
            { value: "cartesian", label: "Keep cartesian position" },
            { value: "joint", label: "Keep joint values" },
          ]}
        />
      </Field>
      <PoseEditor item={it} title="Cartesian position:" refLabel="Target position with respect to:" disabled={t.isJoint} />
      <Section
        title="Robot joints:"
        right={
          <button className="g-btn ghost" style={{ height: 24 }} disabled={!robot} onClick={() => setConfigs((v) => !v)}>
            Change config.
          </button>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {t.joints.map((q, i) => (
            <label key={i} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ font: "600 10px var(--font-ui)", color: "var(--ink-2)" }}>J{i + 1}</span>
              <NumField
                label={`J${i + 1}`}
                value={q}
                decimals={4}
                onCommit={(v) => {
                  const next = t.joints.slice();
                  next[i] = v;
                  void cmd("target.setJoints", { target: it.id, joints: next });
                }}
              />
            </label>
          ))}
          {t.joints.length === 0 && <div style={{ gridColumn: "1 / -1", color: "var(--ink-2)" }}>No joints stored</div>}
        </div>
        {configs && robot && <ConfigChooser target={it} robot={robot} onClose={() => setConfigs(false)} />}
      </Section>
    </>
  );
}

const toHex = (c: number[]) => `#${c
  .slice(0, 3)
  .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0"))
  .join("")}`;

 
function ScaleRow({ it }: { it: Item }) {
  const [ratio, setRatio] = useState(1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginBottom: 12 }}>
      <div style={{ flex: 1 }}>
        <NumField label="Scale ratio" value={ratio} decimals={4} onCommit={setRatio} />
      </div>
      <button className="g-btn" style={{ height: 30 }} disabled={!(Math.abs(ratio) > 1e-12) || ratio === 1} onClick={() => void cmd("object.scale", { item: it.id, scale: ratio })}>
        Apply Scale
      </button>
    </div>
  );
}

 
export function ObjectPanel({ it }: { it: Item }) {
  const ws = useRC((s) => s.ws)!;
  const isTool = it.type === "tool";
  const holder = it.parent ? ws.items[it.parent] : undefined;
  const color = it.color ?? (isTool ? it.tool?.meshes[0]?.color : it.object?.meshes[0]?.color) ?? [0.8, 0.8, 0.85, 1];
  const settings = useRC((s) => s.settings);
  const shown = displayFlag(it, isTool ? "ShowTCP" : "ShowFrame", settings);
  const locked = it.locked === true || it.params?.Locked === "1";
  return (
    <>
      <NameField it={it} label={isTool ? "Tool Name:" : "Object Name:"} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        <VisibleCheck it={it} />
        <Check
          label={isTool ? "Show TCP" : "Show object frame"}
          checked={shown}
          onChange={(v) => void cmd("item.setParam", { item: it.id, key: isTool ? "ShowTCP" : "ShowFrame", value: v ? "1" : "0" })}
        />
        {isTool && holder?.robot && (
          <Check label="Active Tool" checked={holder.robot.activeTool === it.id} onChange={(v) => v && void cmd("robot.setActiveTool", { robot: holder.id, tool: it.id })} />
        )}
        <Check label="Lock" checked={locked} onChange={(v) => void cmd("item.lock", { items: [it.id], locked: v })} />
      </div>
      <PoseEditor item={it} title={isTool ? "Tool Center Point" : "Object position"} refLabel={isTool ? "Tool Center Point with respect to" : "Object Position with respect to"} />
      <ScaleRow it={it} />
      <PhysicsSection it={it} />
      <Section title="Change colors">
        <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="color"
            aria-label="Item color"
            value={toHex(color)}
            onChange={(e) => {
              const h = e.target.value;
              const rgb = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
              void cmd("item.setColor", { item: it.id, color: [...rgb, color[3] ?? 1] });
            }}
            style={{ width: 40, height: 28, border: 0, borderRadius: 8, background: "transparent", padding: 0 }}
          />
          <span className="mono" style={{ color: "var(--ink-2)" }}>
            {toHex(color).toUpperCase()}
          </span>
        </label>
      </Section>
    </>
  );
}

export function NotesPanel({ it }: { it: Item }) {
  return (
    <>
      <NameField it={it} />
      <Field label="Notes">
        <TextField label="Notes" multiline rows={10} value={it.notes?.html ?? ""} onCommit={(v) => void cmd("item.setNotes", { item: it.id, text: v })} />
      </Field>
    </>
  );
}
