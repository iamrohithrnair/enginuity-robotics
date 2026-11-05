"use client";
// Edits movement, speed, code, I/O, event, and custom instructions.

import { cmd } from "@/client/api";
import { pickItem } from "@/client/interaction";
import { useRC } from "@/client/store";
import type { InstructionData, Item } from "@/engine/types";
import { listItems } from "@/engine/workspace";
import { Check, Combo, Field, NumField, Pill, Radios, Section, TextField } from "./fields";
import { instructionEditor } from "./instructionEditors";

 

 
const SPEED_DEFAULTS = { linear: 500, linearAccel: 3000, joint: 500, jointAccel: 800 } as const;
type SpeedKey = keyof typeof SPEED_DEFAULTS;

function useEdit(it: Item) {
  return (params: Record<string, unknown>) => void cmd("instruction.edit", { instruction: it.id, ...params });
}

function MoveEditor({ it, ins }: { it: Item; ins: InstructionData }) {
  const ws = useRC((s) => s.ws)!;
  const edit = useEdit(it);
  const targets = listItems(ws, { type: "target" });
  const opts = (cur?: string | null) => [
    ...(cur && !ws.items[cur] ? [{ value: cur, label: "(deleted target)" }] : []),
    ...(!cur ? [{ value: "", label: "(no target)" }] : []),
    ...targets.map((t) => ({ value: t.id, label: t.name || "(no name)" })),
  ];
  const deleted = (ins.target && !ws.items[ins.target]) || (ins.target2 && !ws.items[ins.target2]);
  return (
    <>
      {ins.kind === "move" && (
        <Field label="Movement">
          <Radios
            label="Movement type"
            value={ins.moveType === "linear" ? "linear" : ins.moveType === "search" ? "search" : "joint"}
            onChange={(v) => edit({ moveType: v })}
            options={[
              { value: "joint", label: "Joint Move" },
              { value: "linear", label: "Linear Move" },
              { value: "search", label: "Search Linear" },
            ]}
          />
        </Field>
      )}
      {(ins.target || !ins.joints) && (
        <Field label={ins.kind === "movec" ? "Via target:" : "Target:"}>
          <Combo label="Target" value={ins.target ?? ""} onChange={(v) => v && edit({ target: v })} options={opts(ins.target)} />
        </Field>
      )}
      {ins.kind === "movec" && (
        <Field label="End target:">
          <Combo label="End target" value={ins.target2 ?? ""} onChange={(v) => v && edit({ target2: v })} options={opts(ins.target2)} />
        </Field>
      )}
      {!ins.target && ins.joints && (
        <Field label="Robot joints:">
          <div className="glass-inset mono" style={{ padding: "8px 10px", font: "600 11.5px var(--font-mono)" }}>
            {ins.joints.map((v) => v.toFixed(3)).join("  ")}
          </div>
        </Field>
      )}
      {deleted && <Pill tone="bad">Target at instruction {it.name} has been deleted</Pill>}
    </>
  );
}

 
function SpeedEditor({ it, ins }: { it: Item; ins: InstructionData }) {
  const edit = useEdit(it);
  const s = ins.speed ?? { linear: -1, joint: -1, linearAccel: -1, jointAccel: -1 };
  const row = (k: SpeedKey, label: string) => {
    const set = s[k] >= 0;
    return (
      <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 108px", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Check label={label} checked={set} onChange={(v) => edit({ [k]: v ? SPEED_DEFAULTS[k] : -1 })} />
        <NumField label={label} value={set ? s[k] : SPEED_DEFAULTS[k]} decimals={2} disabled={!set} onCommit={(v) => edit({ [k]: v })} />
      </div>
    );
  };
  return (
    <>
      <Section title="Linear speed (mm/s)">
        {row("linear", "Set speed (mm/s)")}
        {row("linearAccel", "Set acceleration (mm/s2 or %)")}
      </Section>
      <Section title="Joint speed (deg/s)">
        {row("joint", "Set speed (deg/s)")}
        {row("jointAccel", "Set acceleration (deg/s2)")}
      </Section>
    </>
  );
}

function CodeEditor({ it, ins }: { it: Item; ins: InstructionData }) {
  const ws = useRC((s) => s.ws)!;
  const edit = useEdit(it);
  const programs = listItems(ws, { type: "program" }).filter((p) => p.id !== it.parent);
  return (
    <Section title="Add Program call or Custom code">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: 8 }}>
        <Combo
          label="Code type"
          value={String(ins.codeType ?? 1)}
          onChange={(v) => edit({ codeType: Number(v) })}
          options={[
            { value: "0", label: "Program Call" },
            { value: "1", label: "Insert Code" },
            { value: "2", label: "Start Thread" },
            { value: "3", label: "Insert Comment" },
          ]}
        />
        <button
          className="g-btn"
          disabled={!programs.length}
          onClick={() => void pickItem("Select program", programs).then((p) => p && edit({ text: p.name }))}
        >
          Select program
        </button>
      </div>
      <TextField label="Code" multiline rows={4} value={ins.text ?? ""} onCommit={(v) => edit({ text: v })} />
    </Section>
  );
}

 
function IOEditor({ it, ins }: { it: Item; ins: InstructionData }) {
  const edit = useEdit(it);
  const io = ins.io ?? { mode: "set" as const, name: "5", value: "1" };
  const mode = io.mode === "wait" ? "wait" : io.analog ? "ao" : "do";
  return (
    <Section title="Manage I/O">
      <div style={{ marginBottom: 8 }}>
        <Radios
          label="IO action"
          value={mode}
          onChange={(v) => edit({ ioMode: v === "wait" ? "wait" : "set", analog: v === "ao" })}
          options={[
            { value: "do", label: "Set Digital Output" },
            { value: "ao", label: "Set Analog Output" },
            { value: "wait", label: "Wait for Digital Input" },
          ]}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Field label="IO Name:">
          <TextField label="IO Name" value={io.name} onCommit={(v) => edit({ ioName: v })} />
        </Field>
        <Field label="IO Value:">
          <TextField label="IO Value" value={io.value} onCommit={(v) => edit({ ioValue: v })} />
        </Field>
      </div>
      <Field label="Timeout (ms)">
        <NumField label="Timeout (ms)" value={io.timeoutMs ?? -1} decimals={0} step={100} disabled={io.mode !== "wait"} onCommit={(v) => edit({ timeoutMs: v })} />
      </Field>
      <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>A timeout of 0 or less waits forever.</div>
    </Section>
  );
}

const EVENT_ACTIONS = [
  { value: "attach", label: "Attach object" },
  { value: "detach", label: "Detach object" },
  { value: "show", label: "Show object/tool" },
  { value: "hide", label: "Hide object/tool" },
  { value: "home", label: "Set joints to home" },
   
  { value: "conveyor", label: "Move conveyor" },
  { value: "create", label: "Create object" },
  { value: "remove", label: "Remove objects" },
  { value: "wait", label: "Wait for object" },
] as const;

 
const EVENT_CAPTIONS: Partial<Record<string, string>> = {
  conveyor: "Select the conveyor to move",
  create: "Select the object to create and where to place it",
  remove: "Select the type of object to delete (all similar objects will be deleted)",
  wait: "Select the sensor",
};

 
const WAIT_MODES = [
  { value: "0", label: "Wait" },
  { value: "1", label: "Delete object" },
  { value: "2", label: "Move object to" },
  { value: "3", label: "Stop robot" },
];

 
function EventEditor({ it, ins }: { it: Item; ins: InstructionData }) {
  const ws = useRC((s) => s.ws)!;
  const ev = ins.event ?? { action: "attach" as const };
  const set = (params: Record<string, unknown>) => void cmd("instruction.setEvent", { instruction: it.id, ...params });
  const action = (EVENT_ACTIONS.find((a) => a.value === ev.action)?.value ?? "attach") as (typeof EVENT_ACTIONS)[number]["value"];
  const tools = listItems(ws, { type: "tool" });
  const frames = listItems(ws, { type: "frame" });
  const robots = listItems(ws, { type: "robot" });
  const pickable = action === "home" || action === "conveyor" ? robots : [...listItems(ws, { type: "object" }), ...tools];
  const chosen = new Set(ev.objects ?? []);
  const waitMode = String(ev.option ?? 0);
  return (
    <Section title="Event Instruction">
      <Field label="Action:">
        <Combo label="Action" value={action} onChange={(v) => set({ action: v })} options={EVENT_ACTIONS.map((a) => ({ value: a.value, label: a.label }))} />
      </Field>
      {(action === "attach" || action === "detach") && (
        <>
          <div className="glass-inset" style={{ padding: "8px 10px", borderRadius: 10, marginBottom: 8, color: "var(--ink-1)" }}>
            {action === "attach" ? "The closest object will be attached" : "All objects will be detached from the tool"}
          </div>
          <Field label="Select Tool (TCP):">
            <Combo
              label="Tool"
              value={ev.tool && ws.items[ev.tool] ? ev.tool : ""}
              onChange={(v) => set({ tool: v || null })}
              options={[{ value: "", label: "(active tool)" }, ...tools.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </Field>
          {action === "attach" ? (
            <>
              <Field label="Measure distance as:">
                <Combo label="Measure distance as" value="any" disabled onChange={() => undefined} options={[{ value: "any", label: "TCP vs. Object Position (any)" }]} />
              </Field>
              <Field label="Maximum distance (mm):">
                <NumField label="Maximum distance (mm)" value={ev.distance ?? 200} decimals={2} disabled onCommit={() => undefined} />
              </Field>
            </>
          ) : (
            <Field label="Place objects in:">
              <Combo
                label="Detach destination"
                value={ev.frame && ws.items[ev.frame] ? ev.frame : ""}
                onChange={(v) => set({ frame: v || null })}
                options={[{ value: "", label: "(station)" }, ...frames.map((f) => ({ value: f.id, label: f.name }))]}
              />
            </Field>
          )}
        </>
      )}
      {EVENT_CAPTIONS[action] && (
        <div className="glass-inset" style={{ padding: "8px 10px", borderRadius: 10, marginBottom: 8, color: "var(--ink-1)" }}>
          {EVENT_CAPTIONS[action]}
        </div>
      )}
      {action === "conveyor" && (
        <Field label="Movement (mm):">
          <NumField label="Movement (mm)" value={ev.distance ?? 200} decimals={2} onCommit={(v) => set({ distance: v })} />
        </Field>
      )}
      {action === "wait" && (
        <Field label="When detected:">
          <Combo label="When detected" value={waitMode} onChange={(v) => set({ option: Number(v) })} options={WAIT_MODES} />
        </Field>
      )}
      {(action === "create" || (action === "wait" && waitMode === "2")) && (
        <Field label="Select parent:">
          <Combo
            label="Parent"
            value={ev.frame && ws.items[ev.frame] ? ev.frame : ""}
            onChange={(v) => set({ frame: v || null })}
            options={[{ value: "", label: "(none)" }, ...frames.map((f) => ({ value: f.id, label: f.name }))]}
          />
        </Field>
      )}
      {action === "wait" && waitMode === "3" && (
        <Field label="Select robot:">
          <Combo
            label="Robot"
            value={ev.frame && ws.items[ev.frame]?.type === "robot" ? ev.frame : ""}
            onChange={(v) => set({ frame: v || null })}
            options={[{ value: "", label: "(none)" }, ...robots.map((r) => ({ value: r.id, label: r.name }))]}
          />
        </Field>
      )}
      {(action === "show" || action === "hide" || action === "home" || action === "conveyor" || action === "create" || action === "remove" || action === "wait") && (
        <Field label={action === "home" || action === "conveyor" ? "Mechanisms:" : "Objects:"}>
          <div className="glass-inset g-scroll" style={{ maxHeight: 160, padding: 4, borderRadius: 10 }}>
            {pickable.length === 0 && <div style={{ padding: 8, color: "var(--ink-2)" }}>Nothing to choose</div>}
            {pickable.map((o) => (
              <div key={o.id}>
                <Check
                  label={o.name || "(no name)"}
                  checked={chosen.has(o.id)}
                  onChange={(v) => {
                    const next = new Set(chosen);
                    if (v) next.add(o.id);
                    else next.delete(o.id);
                    set({ objects: [...next] });
                  }}
                />
              </div>
            ))}
          </div>
        </Field>
      )}
    </Section>
  );
}

 
function CustomEditor({ it }: { it: Item }) {
  const set = (params: Record<string, unknown>) => void cmd("instruction.setCustom", { instruction: it.id, ...params });
  const p = it.params ?? {};
  return (
    <Section title="Custom instruction">
      <Field label="Name">
        <TextField label="Name" value={it.name} onCommit={(v) => set({ name: v })} />
      </Field>
      <Field label="Path (executable or .py run in simulation)">
        <TextField label="Path" value={p.PathRunSim ?? ""} placeholder="relative to the Enginuity Python folder, or absolute" onCommit={(v) => set({ path: v })} />
      </Field>
      <Field label="Icon">
        <TextField label="Icon" value={p.PathIcon ?? ""} onCommit={(v) => set({ icon: v })} />
      </Field>
      <Field label="'Run on Robot' command">
        <TextField label="Run on Robot command" value={p.PathRunRobot ?? ""} onCommit={(v) => set({ robotCommand: v })} />
      </Field>
      <Check label="Blocking (wait until it finishes)" checked={p.Blocking !== "0"} onChange={(v) => set({ blocking: v })} />
    </Section>
  );
}

 
function LinkOptions({ it, ins }: { it: Item; ins: InstructionData }) {
  return (
    <div style={{ marginTop: 8 }}>
      <Check label="Force Original Pose" checked={!!ins.forcePose} onChange={(v) => void cmd("instruction.forceOriginalPose", { instruction: it.id, force: v })} />
    </div>
  );
}

 
function ContributedEditor({ it, ins }: { it: Item; ins: InstructionData }) {
  return instructionEditor(ins.kind)!({ it, ins });
}

 
export default function InstructionPanel({ it }: { it: Item }) {
  const ws = useRC((s) => s.ws)!;
  const ins = it.instruction!;
  const edit = useEdit(it);
  const frames = listItems(ws, { type: "frame" });
  const tools = listItems(ws, { type: "tool" });
   
  if (instructionEditor(ins.kind)) return <ContributedEditor key={`${it.id}:${ins.kind}`} it={it} ins={ins} />;
  switch (ins.kind) {
    case "move":
    case "movec":
      return <MoveEditor it={it} ins={ins} />;
    case "speed":
      return <SpeedEditor it={it} ins={ins} />;
    case "rounding":
      return (
        <Section title="Set Rounding radius">
          <Field label="Enter the Rounding value (radius, in mm or %)">
            <NumField label="Rounding" value={ins.rounding ?? -1} decimals={3} onCommit={(v) => edit({ rounding: v })} />
          </Field>
          <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>Negative values move accurately (Accurate).</div>
        </Section>
      );
    case "pause":
      return (
        <Section title="Instruction Pause">
          <Field label="Enter the delay in miliseconds">
            <NumField label="Pause (ms)" value={ins.pauseMs ?? -1} decimals={0} step={100} suffix="ms" onCommit={(v) => edit({ pauseMs: v })} />
          </Field>
          <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>A negative value stops the program until the user continues (Stop).</div>
        </Section>
      );
    case "print":
      return (
        <Section title="Program message">
          <Field label="Enter the message to display">
            <TextField label="Message" multiline value={ins.text ?? ""} onCommit={(v) => edit({ text: v })} />
          </Field>
        </Section>
      );
    case "code":
      return <CodeEditor it={it} ins={ins} />;
    case "io":
      return <IOEditor it={it} ins={ins} />;
    case "frame":
      return (
        <Section title="Set Reference Frame">
          <Combo
            label="Reference frame"
            value={ins.frame && ws.items[ins.frame] ? ins.frame : ""}
            onChange={(v) => edit({ frame: v || null })}
            options={[{ value: "", label: "(none)" }, ...frames.map((f) => ({ value: f.id, label: f.name }))]}
          />
          <LinkOptions it={it} ins={ins} />
        </Section>
      );
    case "tool":
      return (
        <Section title="Set Tool Frame">
          <Combo
            label="Tool"
            value={ins.tool && ws.items[ins.tool] ? ins.tool : ""}
            onChange={(v) => edit({ tool: v || null })}
            options={[{ value: "", label: "(none)" }, ...tools.map((t) => ({ value: t.id, label: t.name }))]}
          />
          <LinkOptions it={it} ins={ins} />
        </Section>
      );
    case "robot":
      return (
        <Section title="Select Robot">
          <Combo
            label="Robot"
            value={ins.robot && ws.items[ins.robot] ? ins.robot : ""}
            onChange={(v) => v && edit({ robot: v })}
            options={[...(ins.robot && ws.items[ins.robot] ? [] : [{ value: "", label: "(no robot)" }]), ...listItems(ws, { type: "robot" }).map((r) => ({ value: r.id, label: r.name }))]}
          />
          <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)", marginTop: 6 }}>The following instructions of the program use this robot.</div>
        </Section>
      );
    case "custom":
      return <CustomEditor it={it} />;
    case "event":
      return <EventEditor it={it} ins={ins} />;
    default:
      return (
        <Section title="Instruction">
          <div style={{ color: "var(--ink-2)" }}>{it.name}</div>
        </Section>
      );
  }
}
