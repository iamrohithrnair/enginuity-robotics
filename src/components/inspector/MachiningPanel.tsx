"use client";

 
 
 
 
 

import { cmd } from "@/client/api";
import { useMachiningUi } from "@/client/machiningUi";
import { useRC } from "@/client/store";
import { objectCurves, objectPoints } from "@/engine/curves";
import { projectLinks } from "@/engine/machining/project";
import type { Item } from "@/engine/types";
import { listItems } from "@/engine/workspace";
import { Check, Combo, Field, NumField, Section, TextField } from "./fields";
import { NameField } from "./ItemPanels";

const KIND_TITLE: Record<string, string> = {
  machining: "Robot Machining Project",
  curve: "Curve Follow Project",
  point: "Point Follow Project",
  print3d: "3D Printing Project",
  weld: "Robot Welding project",
};

 
const NC_EVENTS: [string, string, string][] = [
  ["ToolChange", "Change tool ID", "%1: tool ID"],
  ["Mcode", "Call M code", "%1: M code, %2: code and parameters, %P, %S…: parameter values"],
  ["SpindleRPM", "Spindle speed (RPM)", "%1: spindle speed"],
  ["SpindleCW", "Spindle set clockwise", ""],
  ["SpindleCCW", "Spindle set counterclockwise", ""],
  ["Extruder", "Set extruder feed", "%1: extruded material (E value)"],
  ["IO_OnMotion", "Set Digital Output On (sync)", "Used by M62 P<id>; %1: output"],
  ["IO_OffMotion", "Set Digital Output Off (sync)", "Used by M63 P<id>; %1: output"],
  ["IO_On", "Set Digital Output On", "Used by M64 P<id>; 'default' sets the output"],
  ["IO_Off", "Set Digital Output Off", "Used by M65 P<id>; 'default' clears the output"],
];

const EVENTS: [string, string][] = [
  ["CallProgStart", "Program start"],
  ["CallApproach", "Path approach"],
  ["CallPathStart", "Path start"],
  ["CallAction", "Point action"],
  ["CallPathFinish", "Path finish"],
  ["CallRetract", "Path retract"],
  ["CallProgFinish", "Program finish"],
];

export default function MachiningPanel({ it }: { it: Item }) {
  const ws = useRC((s) => s.ws)!;
  const m = it.machining;
  if (!m) return <NameField it={it} />;
  const { robot, frame, tool } = projectLinks(ws, m);
  const set = (machining: Record<string, number | string | boolean>) => void cmd("machining.setParams", { project: it.id, machining });
  const setEv = (progEvents: Record<string, number | string | boolean>) => void cmd("machining.setParams", { project: it.id, progEvents });
  const s = m.settings;
  const n = (k: string, d = 0) => Number(s[k] ?? d);
  const input = m.input?.object ? ws.items[m.input.object] : undefined;
  const robots = listItems(ws, { type: "robot" });
  const frames = listItems(ws, { type: "frame" });
  const tools = robot ? listItems(ws, { type: "tool" }).filter((t) => t.parent === robot.id) : [];
  const objects = listItems(ws, { type: "object" }).filter((o) => (m.kind === "point" ? objectPoints(o).length : objectCurves(o).length));
  const followsPoints = m.kind === "point";
  const followsCurves = m.kind === "curve" || m.kind === "weld";
  const prog = m.program ? ws.items[m.program] : undefined;
  const ev = m.events;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <NameField it={it} />
      <div style={{ font: "600 12px var(--font-ui)", color: "var(--ink-2)" }}>{KIND_TITLE[m.kind]}</div>

      <Section title="Robot and references">
        <Field label="Robot">
          <Combo label="Robot" value={robot?.id ?? ""} options={[{ value: "", label: "—" }, ...robots.map((r) => ({ value: r.id, label: r.name }))]} onChange={(v) => void cmd("machining.setParams", { project: it.id, robot: v || null })} />
        </Field>
        <Field label="Reference">
          <Combo label="Reference" value={frame?.id ?? ""} options={[{ value: "", label: "Robot base" }, ...frames.map((f) => ({ value: f.id, label: f.name }))]} onChange={(v) => void cmd("machining.setParams", { project: it.id, frame: v || null })} />
        </Field>
        <Field label="Tool">
          <Combo label="Tool" value={tool?.id ?? ""} options={[{ value: "", label: "Active tool" }, ...tools.map((t) => ({ value: t.id, label: t.name }))]} onChange={(v) => void cmd("machining.setParams", { project: it.id, tool: v || null })} />
        </Field>
      </Section>

      <Section title={followsPoints ? "Point selection" : followsCurves ? "Curve selection" : "NC program"}>
        {followsCurves || followsPoints ? (
          <>
            <Field label="Object">
              <Combo
                label="Object"
                value={input?.id ?? ""}
                options={[{ value: "", label: followsPoints ? "Select an object with points" : "Select an object with curves" }, ...objects.map((o) => ({ value: o.id, label: o.name }))]}
                onChange={(v) => v && void cmd("machining.setInput", { project: it.id, object: v })}
              />
            </Field>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                className="g-btn"
                onClick={() =>
                  useMachiningUi.setState({ tool: { mode: "select", project: it.id, kind: followsPoints ? "point" : "curve", object: input?.id ?? null, curves: m.input?.curves ?? [] } })
                }
              >
                {followsPoints ? "Select points" : "Select curves"}
              </button>
              {input && followsCurves && (
                <span style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)", alignSelf: "center" }}>
                  {m.input?.curves?.length ? `${m.input.curves.length} of ${objectCurves(input).length} curves` : `All ${objectCurves(input).length} curves`}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-1)" }}>{m.input?.nc ? m.input.nc.file.replace(/^.*[\\/]/, "") : "No NC file loaded"}</div>
            <button className="g-btn" onClick={() => useMachiningUi.setState({ picker: { kind: m.kind === "print3d" ? "print3d" : "nc", project: it.id } })}>
              Select NC file
            </button>
          </>
        )}
      </Section>

      <Section title="Path settings">
        <Field label="Operation speed (mm/s)">
          <NumField label="Operation speed" value={n("SpeedOperation", 50)} decimals={1} onCommit={(v) => set({ SpeedOperation: v })} />
        </Field>
        <Field label="Rapid speed (mm/s)">
          <NumField label="Rapid speed" value={n("SpeedRapid", 1000)} decimals={1} onCommit={(v) => set({ SpeedRapid: v })} />
        </Field>
        <Field label="Approach">
          <TextField label="Approach" value={m.approach} onCommit={(v) => void cmd("machining.setParams", { project: it.id, approach: v })} />
        </Field>
        <Field label="Retract">
          <TextField label="Retract" value={m.retract} onCommit={(v) => void cmd("machining.setParams", { project: it.id, retract: v })} />
        </Field>
        {followsPoints && (
          <Field label="Point approach (mm)">
            <NumField label="Point approach" value={n("PointApproach", 20)} decimals={1} onCommit={(v) => set({ PointApproach: v })} />
          </Field>
        )}
        <Field label="Select algorithm:">
          <Combo
            label="Algorithm"
            value={String(n("Algorithm"))}
            options={[
              { value: "0", label: "Minimum tool orientation change" },
              { value: "1", label: "Tool orientation follows path" },
            ]}
            onChange={(v) => set({ Algorithm: Number(v) })}
          />
        </Field>
        <Field label="Tool Z rotation ± (deg) / step">
          <div style={{ display: "flex", gap: 6 }}>
            <NumField label="Rotation range" value={n("RotZ_Range", 180)} decimals={1} onCommit={(v) => set({ RotZ_Range: v })} />
            <NumField label="Rotation step" value={n("RotZ_Step", 20)} decimals={1} onCommit={(v) => set({ RotZ_Step: v })} />
          </div>
        </Field>
        {followsCurves && (
          <>
            <Check label="Approach/Retract each curve" checked={!!n("ApproachRetractAll")} onChange={(v) => set({ ApproachRetractAll: v ? 1 : 0 })} />
            <Field label="Join Curve Tolerance (mm)">
              <NumField label="Join tolerance" value={n("JoinCurvesTol", 0.5)} decimals={2} onCommit={(v) => set({ JoinCurvesTol: v })} />
            </Field>
          </>
        )}
        <Check label="Rapid approach/retract" checked={!!n("RapidApproachRetract", 1)} onChange={(v) => set({ RapidApproachRetract: v ? 1 : 0 })} />
        <Check label="Avoid Collisions" checked={!!n("AvoidCollisions")} onChange={(v) => set({ AvoidCollisions: v ? 1 : 0 })} />
        <Check label="Auto update" checked={!!n("AutoUpdate", 1)} onChange={(v) => set({ AutoUpdate: v ? 1 : 0 })} />
        <Check label="Visible toolpath" checked={String(s.PathDisplay ?? "Estimated") !== "None"} onChange={(v) => set({ PathDisplay: v ? "Estimated" : "None" })} />
        <Check label="Visible normals" checked={!!n("VisibleNormals")} onChange={(v) => set({ VisibleNormals: v ? 1 : 0 })} />
      </Section>

      {m.kind === "weld" && (
        <Section title="Weld settings">
          {(
            [
              ["OffsetNormalMM", "Normal (mm)"],
              ["OffsetSideMM", "Side (mm)"],
              ["CutStartMM", "Start cut (mm)"],
              ["CutEndMM", "End cut (mm)"],
              ["FlareStartMM", "Start distance (mm)"],
              ["FlareStartDeg", "Start angle (deg)"],
              ["FlareEndMM", "End distance (mm)"],
              ["FlareEndDeg", "End angle (deg)"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <NumField label={label} value={n(k)} decimals={2} onCommit={(v) => set({ [k]: v })} />
            </Field>
          ))}
        </Section>
      )}

      <Section title="Program events">
        <Check label="Set rounding" checked={!!Number(ev.RoundingOn)} onChange={(v) => setEv({ RoundingOn: v ? 1 : 0 })} />
        {Number(ev.RoundingOn) ? (
          <Field label="Rounding (mm)">
            <NumField label="Rounding" value={Number(ev.Rounding ?? 1)} decimals={1} onCommit={(v) => setEv({ Rounding: v })} />
          </Field>
        ) : null}
        {EVENTS.filter(([k]) => k !== "CallAction" || followsPoints).map(([k, label]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "center" }}>
            <Check label={label} checked={!!Number(ev[`${k}On`])} onChange={(v) => setEv({ [`${k}On`]: v ? 1 : 0 })} />
            <TextField label={label} value={String(ev[k] ?? "")} onCommit={(v) => setEv({ [k]: v })} />
          </div>
        ))}
        {!followsCurves && !followsPoints &&
          NC_EVENTS.map(([k, label, hint]) => (
            <Field key={k} label={label}>
              <span title={hint ? `${hint}; %TOOL%, %REF%, %ROBOT%: tool, reference and robot names` : undefined} style={{ display: "block" }}>
                <TextField label={label} value={String(ev[k] ?? "")} onCommit={(v) => setEv({ [k]: v })} />
              </span>
            </Field>
          ))}
        <button className="g-btn ghost" onClick={() => void cmd("machining.setDefaults", { project: it.id, what: "events" })}>
          Set Default
        </button>
      </Section>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="g-btn primary" onClick={() => void cmd("machining.update", { project: it.id })}>
          Update
        </button>
        <button className="g-btn" disabled={!prog} onClick={() => prog && void cmd("program.run", { program: prog.id })}>
          Simulate
        </button>
      </div>
      {m.result && (
        <div className="glass-inset" style={{ padding: "8px 10px", font: "500 12px/1.45 var(--font-ui)", color: m.result.ok ? "var(--good)" : "var(--warn)" }}>
          <span dangerouslySetInnerHTML={{ __html: m.result.message }} />
          <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
            Path points: {m.result.points} · reachable {Math.round(m.result.ratio * 100)}%{prog ? ` · program ${prog.name}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
