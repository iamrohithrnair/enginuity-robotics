"use client";

import { useEffect, useRef, useState } from "react";
import { cmd, selectNow } from "@/client/api";
import { runProgramUI } from "@/client/interaction";
import { openEventInsert } from "@/client/programUi";
import { useRC } from "@/client/store";
import { instructionTreeLabel } from "@/engine/naming";
import { formatProgramTime } from "@/engine/sim/timefmt";
import type { Item } from "@/engine/types";
import { listItems } from "@/engine/workspace";
import { Icon, InstructionIcon } from "../icons";
import { Check, Combo, Field, Pill, Section } from "./fields";
import { NameField } from "./ItemPanels";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ font: "600 9.5px var(--font-ui)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div className="mono" style={{ font: "650 14px var(--font-mono)" }}>
        {value}
      </div>
    </div>
  );
}

const ADD: { label: string; icon: React.ReactNode; run: (p: string) => void }[] = [
  { label: "Move Joint", icon: <Icon.MoveJ size={14} />, run: (p) => void cmd("program.addMoveJ", { program: p }) },
  { label: "Move Linear", icon: <Icon.MoveL size={14} />, run: (p) => void cmd("program.addMoveL", { program: p }) },
  { label: "Move Circular", icon: <Icon.MoveC size={14} />, run: (p) => void cmd("program.addMoveC", { program: p }) },
  { label: "Set Speed", icon: <Icon.Speed size={14} />, run: (p) => void cmd("program.addInstruction", { program: p, kind: "speed" }) },
  { label: "Set Rounding", icon: <Icon.Rounding size={14} />, run: (p) => void cmd("program.addInstruction", { program: p, kind: "rounding" }) },
  { label: "Pause", icon: <Icon.Pause size={14} />, run: (p) => void cmd("program.addInstruction", { program: p, kind: "pause" }) },
  { label: "Show Message", icon: <Icon.Message size={14} />, run: (p) => void cmd("program.addInstruction", { program: p, kind: "print" }) },
  { label: "Program Call", icon: <Icon.Call size={14} />, run: (p) => void cmd("program.addInstruction", { program: p, kind: "call" }) },
  { label: "Set or Wait I/O", icon: <Icon.IO size={14} />, run: (p) => void cmd("program.addInstruction", { program: p, kind: "io" }) },
  { label: "Simulation Event", icon: <Icon.Event size={14} />, run: (p) => openEventInsert(p) },
  { label: "Search Linear", icon: <Icon.MoveL size={14} />, run: (p) => void cmd("program.addSearchL", { program: p }) },
];

 
export default function ProgramPanel({ it }: { it: Item }) {
  const ws = useRC((s) => s.ws)!;
  const current = useRC((s) => s.currentInstruction[it.id] ?? null);
  const [check, setCheck] = useState<unknown[] | null>(null);
  const robots = listItems(ws, { type: "robot" });
  const robot = it.program?.robot ? ws.items[it.program.robot] : undefined;
  const running = ws.busy?.includes(it.id) ?? ws.running?.program === it.id;
  const loop = it.params?.Loop === "1";
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (current) list.current?.querySelector(`[data-ins="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <>
      <NameField it={it} />
      <Section title="Program" right={running ? <Pill tone="good">Running</Pill> : robot ? <Pill tone="accent">{robot.name}</Pill> : <Pill tone="bad">No robot</Pill>}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button className="g-btn primary" onClick={() => void runProgramUI(it.id)} title="Run (Ctrl+R)">
            <Icon.Play size={14} /> {running ? "Restart" : "Run"}
          </button>
          <button
            className="g-btn"
            onClick={() =>
              void cmd<unknown[]>("program.update", { program: it.id }).then(async (u) => {
                const c = await cmd<{ ok: boolean; message: string }>("program.check", { program: it.id });
                setCheck(u && c ? [...u.slice(0, 3), c.ok ? 1 : 0, c.message] : u);
              })
            }
            title="Check Path (F5)"
          >
            <Icon.Check size={14} /> Check
          </button>
          <button className="g-btn" onClick={() => void cmd("program.generate", { program: it.id })} title="Generate Robot Program (F6)">
            <Icon.Code size={14} /> Generate
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: 10 }}>
          <Check label="Loop" checked={loop} onChange={(v) => void cmd("program.setLoop", { program: it.id, loop: v })} />
          <Check label="Show Instructions" checked={it.program?.showInstructions !== false} onChange={(v) => void cmd("program.setFlags", { programs: [it.id], showInstructions: v })} />
          <Check label="Display Path" checked={!!it.program?.displayPath} onChange={(v) => void cmd("program.setFlags", { programs: [it.id], displayPath: v })} />
          <Check label="Locked" checked={!!it.program?.locked} onChange={(v) => void cmd("program.setFlags", { programs: [it.id], locked: v })} />
        </div>
        <Field label="Robot:">
          <Combo
            label="Program robot"
            value={robot ? robot.id : ""}
            onChange={(v) => void cmd("program.setRobot", { program: it.id, robot: v || null })}
            options={[{ value: "", label: "(none)" }, ...robots.map((r) => ({ value: r.id, label: r.name }))]}
          />
        </Field>
        {check && (
          <div className="glass-inset" style={{ marginTop: 4, padding: 10, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            <Stat label="Instructions" value={String(check[0])} />
            <Stat label="Time" value={formatProgramTime(Number(check[1]))} />
            <Stat label="Path" value={`${Number(check[2]).toFixed(1)} mm`} />
            <div style={{ gridColumn: "1 / -1" }}>
              {Number(check[3]) >= 1 ? (
                <Pill tone="good">{it.name} program check success</Pill>
              ) : (
                <Pill tone="bad">{String(check[4] || `${it.name} program check failed`).replace(/<[^>]+>/g, " ")}</Pill>
              )}
            </div>
          </div>
        )}
      </Section>
      <Section title={`Instructions · ${it.children.length}`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {ADD.map((a) => (
            <button key={a.label} className="g-btn ghost icon" style={{ height: 26, width: 30 }} title={a.label} aria-label={`Add ${a.label}`} onClick={() => a.run(it.id)}>
              {a.icon}
            </button>
          ))}
        </div>
        <div ref={list} className="glass-inset g-scroll" style={{ maxHeight: 300, padding: 4 }}>
          {it.children.length === 0 && <div style={{ padding: 14, color: "var(--ink-2)", textAlign: "center" }}>Jog the robot and add Move instructions</div>}
          {it.children.map((c, i) => {
            const ins = ws.items[c];
            if (!ins) return null;
            const sel = ws.selection.includes(c);
            const executing = current === c;
            return (
              <button
                key={c}
                data-ins={c}
                type="button"
                onClick={() => void selectNow([c])}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  height: 28,
                  padding: "0 8px",
                  border: 0,
                  borderRadius: 8,
                  textAlign: "left",
                  cursor: "pointer",
                  font: "500 12px var(--font-ui)",
                  background: sel ? "var(--accent-soft)" : executing ? "color-mix(in srgb, var(--good) 16%, transparent)" : "transparent",
                  boxShadow: executing ? "inset 3px 0 0 var(--good)" : "none",
                  color: sel ? "var(--accent-ink)" : "var(--ink-0)",
                }}
              >
                <span className="mono" style={{ width: 18, color: sel ? "var(--accent-ink)" : "var(--ink-3)", font: "600 10.5px var(--font-mono)" }}>
                  {i + 1}
                </span>
                <InstructionIcon kind={ins.instruction?.kind} moveType={ins.instruction?.moveType} />
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{instructionTreeLabel(ws, ins)}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
