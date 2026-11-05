"use client";
// Hosts program instruction, configuration, generation, and Python prompt dialogs.

import { useEffect, useMemo, useState } from "react";
import { cmd, cmdx, setStatus } from "@/client/api";
import { installProgramUi, savePythonAs, useProgramUi, type ProgramDialog } from "@/client/programUi";
import { useRC } from "@/client/store";
import type { Item } from "@/engine/types";
import { listItems } from "@/engine/workspace";
import { Icon } from "../icons";
import InstructionPanel from "../inspector/InstructionPanel";
import { Check, Combo, Field } from "../inspector/fields";
import { Modal } from "../Modal";

 
export default function ProgramDialogs() {
  const dialogs = useProgramUi((s) => s.dialogs);
  useEffect(() => installProgramUi(), []);
  return (
    <>
      {dialogs.map((d) => (
        <DialogFor key={d.id} d={d} close={() => useProgramUi.getState().close(d.id)} />
      ))}
    </>
  );
}

function DialogFor({ d, close }: { d: ProgramDialog & { id: number }; close: () => void }) {
  switch (d.kind) {
    case "edit-instruction":
      return <InstructionWindow id={d.instruction} close={close} />;
    case "event-insert":
      return <EventInsertDialog program={d.program} close={close} />;
    case "configs":
      return <ConfigsDialog target={d.target} robot={d.robot} original={d.original} close={close} />;
    case "generate-as":
      return <GenerateAsDialog programs={d.programs} close={close} />;
    case "python-confirm":
      return <PythonConfirmDialog d={d} close={close} />;
    case "python-edit":
      return <PythonEditor item={d.item} close={close} />;
    case "number":
      return <NumberPrompt d={d} close={close} />;
    case "text":
      return <TextPrompt d={d} close={close} />;
    case "vector":
      return <VectorPrompt d={d} close={close} />;
  }
}

const EDITOR_TITLES: Record<string, string> = {
  speed: "Set values",
  rounding: "Set Rounding radius",
  print: "Program message",
  code: "Program Call",
  pause: "Instruction Pause",
  io: "Set or Wait I/O",
  event: "Event Instruction",
};

 
function InstructionWindow({ id, close }: { id: string; close: () => void }) {
  const it = useRC((s) => s.ws?.items[id]);
  useEffect(() => {
    if (!it?.instruction) close();
  }, [it, close]);
  if (!it?.instruction) return null;
  const title = EDITOR_TITLES[it.instruction.kind] ?? it.name;
  return (
    <div
      className="glass-strong liquid rc-pop"
      role="dialog"
      aria-label={title}
      style={{ position: "fixed", left: "50%", top: 96, translate: "-50% 0", zIndex: 70, width: 380, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 140px)", overflow: "auto", borderRadius: 20, padding: "14px 16px 10px" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ font: "650 14px var(--font-ui)" }}>{title}</span>
        <span style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
        <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} aria-label="Close editor" title="Close editor" onClick={close}>
          <Icon.Close />
        </button>
      </div>
      <InstructionPanel it={it} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button className="g-btn primary" onClick={close}>
          OK
        </button>
      </div>
    </div>
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
type EventAction = (typeof EVENT_ACTIONS)[number]["value"];

 
const NEW_EVENT_CAPTIONS: Partial<Record<EventAction, string>> = {
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

 
function EventInsertDialog({ program, close }: { program: string | null; close: () => void }) {
  const ws = useRC((s) => s.ws)!;
  const prog = program ? ws.items[program] : undefined;
  const robot = prog?.program?.robot ? ws.items[prog.program.robot] : undefined;
  const tools = listItems(ws, { type: "tool" });
  const [action, setAction] = useState<EventAction>("attach");
  const [tool, setTool] = useState(robot?.robot?.activeTool && ws.items[robot.robot.activeTool] ? robot.robot.activeTool : (tools[0]?.id ?? ""));
  const [objects, setObjects] = useState<string[]>([]);
  const [frame, setFrame] = useState("");
  const [movement, setMovement] = useState("200");
  const [mode, setMode] = useState("0");
  const lists = action === "show" || action === "hide" || action === "home" || action === "conveyor" || action === "create" || action === "remove" || action === "wait";
  const pickable = action === "home" || action === "conveyor" ? listItems(ws, { type: "robot" }) : [...listItems(ws, { type: "object" }), ...tools];
  const caption = action === "attach" ? "The closest object will be attached" : action === "detach" ? "All objects will be detached from the tool" : action === "home" ? "Mechanisms" : (NEW_EVENT_CAPTIONS[action] ?? "Objects");
   
  const frameChoices = action === "wait" && mode === "3" ? listItems(ws, { type: "robot" }) : listItems(ws, { type: "frame" });
  const usesFrame = action === "create" || (action === "wait" && (mode === "2" || mode === "3"));
  const ok = async () => {
    const r = (await cmd("program.addInstruction", {
      kind: "event",
      eventAction: action,
      ...(program ? { program } : {}),
      ...(tool && (action === "attach" || action === "detach") ? { tool } : {}),
      ...(lists ? { objects } : {}),
      ...(usesFrame && frame ? { frame } : {}),
    })) as { id?: string } | null;
     
    if (r?.id && (action === "conveyor" || action === "wait")) {
      await cmd("instruction.setEvent", { instruction: r.id, ...(action === "conveyor" ? { distance: Number(movement) || 0 } : { option: Number(mode) }) });
    }
    if (r) close();
  };
  return (
    <Modal title="Event Instruction" width={560} onClose={close}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <Field label="Action:">
            <Combo label="Action" value={action} onChange={(v) => setAction(v)} options={EVENT_ACTIONS.map((a) => ({ value: a.value, label: a.label }))} />
          </Field>
          {(action === "attach" || action === "detach") && (
            <>
              <Field label="Select Tool (TCP):">
                <Combo label="Tool" value={tool} onChange={setTool} options={tools.length ? tools.map((t) => ({ value: t.id, label: t.name })) : [{ value: "", label: "(no tool)" }]} />
              </Field>
              {action === "attach" && (
                <>
                  <Field label="Measure distance as:">
                    <Combo label="Measure distance as" value="any" disabled onChange={() => undefined} options={[{ value: "any", label: "TCP vs. Object Position (any)" }]} />
                  </Field>
                  <Field label="Maximum distance (mm):">
                    <input className="g-input num" value="200.00" disabled aria-label="Maximum distance (mm)" />
                  </Field>
                </>
              )}
            </>
          )}
          {action === "conveyor" && (
            <Field label="Movement (mm):">
              <input className="g-input num" value={movement} aria-label="Movement (mm)" onChange={(e) => setMovement(e.target.value)} />
            </Field>
          )}
          {action === "wait" && (
            <Field label="When detected:">
              <Combo label="When detected" value={mode} onChange={setMode} options={WAIT_MODES} />
            </Field>
          )}
          {usesFrame && (
            <Field label={action === "wait" && mode === "3" ? "Select robot:" : "Select parent:"}>
              <Combo label="Parent" value={frame} onChange={setFrame} options={[{ value: "", label: "(none)" }, ...frameChoices.map((f) => ({ value: f.id, label: f.name }))]} />
            </Field>
          )}
        </div>
        <div>
          <div style={{ font: "550 11.5px var(--font-ui)", color: "var(--ink-1)", marginBottom: 5 }}>{caption}</div>
          <div className="glass-inset g-scroll" style={{ height: 180, padding: 4, borderRadius: 10 }}>
            {lists &&
              pickable.map((o) => (
                <div key={o.id}>
                  <Check
                    label={o.name || "(no name)"}
                    checked={objects.includes(o.id)}
                    onChange={(v) => setObjects(v ? [...objects, o.id] : objects.filter((x) => x !== o.id))}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={close}>
          Cancel
        </button>
        <button className="g-btn primary" autoFocus onClick={() => void ok()}>
          OK
        </button>
      </div>
    </Modal>
  );
}

interface ConfigRow {
  id: number;
  frontRear: string;
  elbow: string;
  wrist: string;
  joints: number[];
  recommended: boolean;
  current: boolean;
}







function ConfigsDialog({ target, robot, original, close }: { target: string; robot: string; original: number[]; close: () => void }) {
  const t = useRC((s) => s.ws?.items[target]);
  const [showAll, setShowAll] = useState(false);
  const [recommended, setRecommended] = useState(true);
  const [rows, setRows] = useState<ConfigRow[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void cmd<{ configurations: ConfigRow[] }>("target.configurations", { target, robot, showAll, recommended }).then((r) => live && setRows(r?.configurations ?? []));
    return () => {
      live = false;
    };
  }, [target, robot, showAll, recommended]);
  const pick = (r: ConfigRow) => {
    setPicked(r.id);
    void cmd("robot.setJoints", { robot, joints: r.joints });
  };
  const ok = async () => {
    const row = rows?.find((r) => r.id === picked);
    if (row) await cmd("target.setConfiguration", { target, robot, joints: row.joints });
    close();
  };
  const cancel = async () => {
    await cmd("robot.setJoints", { robot, joints: original });
    close();
  };
  return (
    <Modal title={`Robot Configurations${t ? ` · ${t.name}` : ""}`} width={560} onClose={() => void cancel()}>
      <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
        <Check label="Show all" checked={showAll} onChange={(v) => setShowAll(v)} />
        <Check label="Recommended" checked={recommended} onChange={(v) => setRecommended(v)} />
      </div>
      <div className="glass-inset g-scroll" style={{ maxHeight: 260, borderRadius: 12, padding: 4 }}>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: "64px 1fr 1fr 1fr", gap: 6, padding: "4px 8px", font: "650 11px var(--font-ui)", color: "var(--ink-2)" }}>
          <span>Config. id</span>
          <span>Front/Rear</span>
          <span>Elbow up/down</span>
          <span>Flip/non-Flip</span>
        </div>
        {rows === null && <div style={{ padding: 8, color: "var(--ink-2)" }}>Solving…</div>}
        {rows?.length === 0 && <div style={{ padding: 8, color: "var(--ink-2)" }}>Target is not reachable</div>}
        {rows?.map((r) => (
          <button
            key={r.id}
            className={`g-btn ${picked === r.id ? "active" : r.current && picked === null ? "active" : "ghost"}`}
            title={r.joints.map((v) => v.toFixed(2)).join("  ")}
            style={{ width: "100%", height: "auto", minHeight: 28, padding: "4px 8px", display: "grid", gridTemplateColumns: "64px 1fr 1fr 1fr", gap: 6, textAlign: "left" }}
            onClick={() => pick(r)}
          >
            <span className="mono">{r.id}</span>
            <span>{r.frontRear}</span>
            <span>{r.elbow}</span>
            <span>{r.wrist}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" title="Do not change the original robot configuration" onClick={() => void cancel()}>
          Cancel
        </button>
        <button className="g-btn primary" title="Keeps the selected configuration (current robot position)" onClick={() => void ok()}>
          Ok
        </button>
      </div>
    </Modal>
  );
}

 
function GenerateAsDialog({ programs, close }: { programs: string[]; close: () => void }) {
  const ws = useRC((s) => s.ws);
  const [folder, setFolder] = useState("");
  const go = async () => {
    close();
    if (programs.length === 1) await cmd("program.generate", { program: programs[0], ...(folder.trim() ? { folder: folder.trim() } : {}) });
    else await cmd("program.generateMany", { programs, ...(folder.trim() ? { folder: folder.trim() } : {}) });
  };
  return (
    <Modal title="Select local folder to store programs..." onClose={close}>
      <div style={{ font: "500 12px/1.45 var(--font-ui)", color: "var(--ink-1)", marginBottom: 8 }}>
        {programs.map((id) => ws?.items[id]?.name).filter(Boolean).join(", ")} → Enginuity programs folder
      </div>
      <Field label="Folder (inside the programs folder; empty = the programs folder itself)">
        <input className="g-input" autoFocus value={folder} placeholder="e.g. cell1/ABB" aria-label="Folder" onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button className="g-btn" onClick={close}>
          Cancel
        </button>
        <button className="g-btn primary" onClick={() => void go()}>
          Generate
        </button>
      </div>
    </Modal>
  );
}

 
function PythonConfirmDialog({ d, close }: { d: Extract<ProgramDialog, { kind: "python-confirm" }>; close: () => void }) {
  const run = async () => {
    close();
    if (d.instruction) await cmd("instruction.approveCustom", { instruction: d.instruction, hash: d.hash });
    else if (d.item) await cmd("python.approve", { item: d.item, hash: d.hash });
    else await cmd("python.approveScript", { hash: d.hash });
  };
  return (
    <Modal title={`Run ${d.name}?`} width={620} onClose={close}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <span style={{ color: "var(--warn)", marginTop: 2 }}>
          <Icon.Warning size={18} />
        </span>
        <div style={{ font: "500 12.5px/1.5 var(--font-ui)", color: "var(--ink-1)" }}>
          The Copilot wrote this code. It runs on this computer with your permissions and can control the station through the Python API. Review it before running it.
        </div>
      </div>
      <pre className="glass-inset g-scroll mono" style={{ maxHeight: 320, margin: 0, padding: 10, borderRadius: 12, font: "500 11.5px/1.5 var(--font-mono)", whiteSpace: "pre-wrap", userSelect: "text" }}>
        {d.code}
      </pre>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" autoFocus onClick={close}>
          Don&apos;t run
        </button>
        <button className="g-btn primary" onClick={() => void run()}>
          Run
        </button>
      </div>
    </Modal>
  );
}

 
function PythonEditor({ item, close }: { item: string; close: () => void }) {
  const it = useRC((s) => s.ws?.items[item]) as Item | undefined;
  const busy = useRC((s) => !!s.ws?.busy?.includes(item));
  const [code, setCode] = useState(it?.python?.code ?? "");
  const dirty = code !== (it?.python?.code ?? "");
  const lines = useMemo(() => code.split("\n").length, [code]);
  if (!it?.python) return null;
  const save = async () => {
    if (dirty) await cmd("python.setCode", { item, code });
  };
  return (
    <div
      className="glass-strong liquid rc-pop"
      role="dialog"
      aria-label={`Edit Python Script ${it.name}`}
      style={{ position: "fixed", left: "50%", top: "calc(var(--topbar-bottom, 58px) + 14px)", translate: "-50% 0", zIndex: 70, width: 760, maxWidth: "calc(100vw - 32px)", height: "min(640px, calc(100vh - 120px))", display: "flex", flexDirection: "column", borderRadius: 20, padding: "12px 14px" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ font: "650 14px var(--font-ui)" }}>{it.name}.py</span>
        {dirty && <span style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>edited</span>}
        <span style={{ flex: 1 }} />
        <button className="g-btn" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
        <button
          className="g-btn"
          onClick={() =>
            void (async () => {
              await save();
              await cmd(busy ? "python.stop" : "python.run", { item });
            })()
          }
        >
          {busy ? <Icon.Stop size={14} /> : <Icon.Play size={14} />} {busy ? "Stop" : "Run"}
        </button>
        <button className="g-btn ghost" onClick={() => void save().then(() => savePythonAs(item))}>
          Save as *.py…
        </button>
        <button className="g-btn icon ghost" aria-label="Close editor" title="Close editor" onClick={() => void save().then(close)}>
          <Icon.Close />
        </button>
      </div>
      <textarea
        className="g-input mono"
        aria-label="Python code"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const s = el.selectionStart;
            setCode(code.slice(0, s) + "    " + code.slice(el.selectionEnd));
            requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
          }
        }}
        style={{ flex: 1, height: "auto", resize: "none", font: "500 12.5px/1.55 var(--font-mono)", padding: "10px 12px", whiteSpace: "pre", overflow: "auto" }}
      />
      <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)", marginTop: 6 }}>
        {lines} lines · runs against the Enginuity Python API (enginuity package; robolink-style imports work unchanged)
      </div>
    </div>
  );
}

function NumberPrompt({ d, close }: { d: Extract<ProgramDialog, { kind: "number" }>; close: () => void }) {
  const [text, setText] = useState(d.value.toFixed(d.decimals));
  const ok = () => {
    const v = Number(text);
    if (!Number.isFinite(v) || v < d.min || v > d.max) return setStatus(`Enter a value between ${d.min} and ${d.max}`);
    d.onOk(v);
    close();
  };
  return (
    <Modal title={d.title} onClose={close}>
      <Field label={d.label}>
        <input className="g-input num" autoFocus value={text} inputMode="decimal" aria-label={d.label} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} />
      </Field>
      <PromptButtons ok={ok} close={close} />
    </Modal>
  );
}

function TextPrompt({ d, close }: { d: Extract<ProgramDialog, { kind: "text" }>; close: () => void }) {
  const [text, setText] = useState(d.value);
  const ok = () => {
    d.onOk(text);
    close();
  };
  return (
    <Modal title={d.title} onClose={close}>
      <Field label={d.label}>
        <input className="g-input" autoFocus value={text} aria-label={d.label} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} />
      </Field>
      <PromptButtons ok={ok} close={close} />
    </Modal>
  );
}

function VectorPrompt({ d, close }: { d: Extract<ProgramDialog, { kind: "vector" }>; close: () => void }) {
  const [v, setV] = useState(["0.000", "0.000", "0.000"]);
  const ok = () => {
    const n = v.map(Number);
    if (n.some((x) => !Number.isFinite(x))) return setStatus("Enter numeric values");
    d.onOk([n[0], n[1], n[2]]);
    close();
  };
  return (
    <Modal title={d.title} onClose={close}>
      <div style={{ font: "500 12.5px var(--font-ui)", color: "var(--ink-1)", marginBottom: 8 }}>{d.label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {["X", "Y", "Z"].map((axis, i) => (
          <Field key={axis} label={axis}>
            <input
              className="g-input num"
              autoFocus={i === 0}
              value={v[i]}
              inputMode="decimal"
              aria-label={`${axis} (mm)`}
              onChange={(e) => setV(v.map((x, k) => (k === i ? e.target.value : x)))}
              onKeyDown={(e) => e.key === "Enter" && ok()}
            />
          </Field>
        ))}
      </div>
      <PromptButtons ok={ok} close={close} />
    </Modal>
  );
}

function PromptButtons({ ok, close }: { ok: () => void; close: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
      <button className="g-btn" onClick={close}>
        Cancel
      </button>
      <button className="g-btn primary" onClick={ok}>
        OK
      </button>
    </div>
  );
}

 
export async function runQuiet(name: string, params: Record<string, unknown>) {
  const r = await cmdx(name, params);
  if (!r.ok && r.error) setStatus(r.error);
  return r;
}
