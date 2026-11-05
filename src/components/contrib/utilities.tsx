"use client";
// Hosts robot calibration, mechanism building, and utility dialogs.

 
 
 
 
 

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { create } from "zustand";
import { cmd, cmdx, setStatus } from "@/client/api";
import { useRC } from "@/client/store";
import { registerUiAction } from "@/client/uiActions";
import { fk } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { cameraSettings } from "@/engine/commands/camera";
import { CAMERA_MSG, formatColor, parseColor } from "@/engine/utilities/camera";
import { EULER_FORMATS, poseToEuler } from "@/engine/utilities/euler";
import { MECHANISM_PARAMS, MECHANISM_TYPES, mechanismKinematics } from "@/engine/utilities/mechanism";
import { activeToolOf, descendants, robotOfTool, toolPose } from "@/engine/workspace";
import { richText } from "../Modal";
import { Icon } from "../icons";
import { Check, Combo, Field, NumField, Radios, Section } from "../inspector/fields";
import { contributeItemMenu } from "../menuContrib";
import { RobotParametersMore } from "./a3-params";
import { downloadCameraSnapshot } from "../viewport/CameraView";

type Panel =
  | { kind: "tcp"; tool?: string }
  | { kind: "frame"; frame?: string }
  | { kind: "mechanism" }
  | { kind: "iso" }
  | { kind: "connect"; robot: string }
  | { kind: "camera"; camera: string }
  | { kind: "params"; robot: string };

export const useUtilities = create<{ panel: Panel | null }>(() => ({ panel: null }));
const open = (panel: Panel) => useUtilities.setState({ panel });
const close = () => useUtilities.setState({ panel: null });

const ws = () => useRC.getState().ws;
const selected = (): Item[] => {
  const w = ws();
  return w ? w.selection.map((id) => w.items[id]).filter((i): i is Item => !!i) : [];
};
 
const itemsOf = (w: Workspace | null, type: Item["type"]) => (w?.activeStation ? descendants(w, w.activeStation).filter((i) => i.type === type) : []);

 
function selectedRobot(): Item | undefined {
  const w = ws();
  if (!w) return undefined;
  for (const it of selected()) {
    if (it.type === "robot") return it;
    if (it.type === "tool") {
      const r = robotOfTool(w, it.id);
      if (r) return r;
    }
  }
  return itemsOf(w, "robot")[0];
}

 

export function Window({ title, children, onClose, width = 400 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  return (
    <div
      className="glass-strong liquid rc-pop"
      role="dialog"
      aria-label={title}
      style={{ position: "fixed", left: `calc(clamp(260px, 18vw, 350px) + ${pos.x}px)`, top: 76 + pos.y, width, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 120px)", overflow: "auto", zIndex: 60, borderRadius: 18, padding: "12px 14px 14px" }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "grab", userSelect: "none" }}
        onPointerDown={(e) => {
          const s = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          const mv = (ev: PointerEvent) => setPos({ x: s.px + ev.clientX - s.x, y: Math.max(-60, s.py + ev.clientY - s.y) });
          const up = () => {
            window.removeEventListener("pointermove", mv);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", mv);
          window.addEventListener("pointerup", up);
        }}
      >
        <span style={{ font: "650 14px var(--font-ui)" }}>{title}</span>
        <span style={{ flex: 1 }} />
        <button className="g-btn icon ghost" style={{ width: 24, height: 24 }} aria-label="Close" title="Close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          <Icon.Close size={12} />
        </button>
      </div>
      {children}
    </div>
  );
}

 
function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="glass-inset" style={{ borderRadius: 12, padding: 10, marginTop: 8 }}>
      <div style={{ font: "500 12.5px var(--font-ui)", marginBottom: 8 }}>{text}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="g-btn ghost" onClick={onNo}>
          No
        </button>
        <button className="g-btn primary" onClick={onYes}>
          Yes
        </button>
      </div>
    </div>
  );
}

export function Message({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "bad" }) {
  if (!text) return null;
  return (
    <div
      className="glass-inset"
      style={{ borderRadius: 12, padding: "8px 10px", marginTop: 8, font: "500 12px var(--font-ui)", color: tone === "bad" ? "var(--bad)" : "var(--ink-0)", whiteSpace: "pre-wrap" }}
      dangerouslySetInnerHTML={{ __html: richText(text.replace(/\n/g, "<br>")) }}
    />
  );
}

 
function RowsEditor({ rows, onChange, columns, label }: { rows: number[][]; onChange: (r: number[][]) => void; columns: string[]; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? rows.map((r) => r.map((v) => +v.toFixed(4)).join("  ")).join("\n");
  return (
    <div>
      <div style={{ font: "600 10.5px var(--font-ui)", color: "var(--ink-3)", marginBottom: 4 }}>{columns.join("  ·  ")}</div>
      <textarea
        className="g-input"
        aria-label={label}
        rows={Math.min(10, Math.max(4, rows.length + 1))}
        value={text}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const parsed = draft
            .split(/\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => l.split(/[\s,;]+/).map(Number))
            .filter((r) => r.length && r.every(Number.isFinite));
          setDraft(null);
          onChange(parsed);
        }}
        style={{ width: "100%", font: "500 11.5px var(--font-mono, ui-monospace)", resize: "vertical" }}
      />
    </div>
  );
}

const robotOptions = (w: Workspace | null) => itemsOf(w, "robot").map((r) => ({ value: r.id, label: r.name }));

 

function ToolDefinition({ toolId }: { toolId?: string }) {
  const w = useRC((s) => s.ws);
  const tools = itemsOf(w, "tool");
  const [tool, setTool] = useState(toolId ?? tools[0]?.id ?? "");
  const toolRobot = w && tool ? robotOfTool(w, tool) : undefined;
  const [robot, setRobot] = useState(toolRobot?.id ?? selectedRobot()?.id ?? "");
  const [method, setMethod] = useState<"point" | "plane">("point");
  const [input, setInput] = useState<"poses" | "joints">("joints");
  const [euler, setEuler] = useState("0");
  const [rows, setRows] = useState<number[][]>([]);
  const [result, setResult] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const [confirm, setConfirm] = useState(false);
  const params = { rows, input, euler: Number(euler), method, robot: robot || undefined, tool: tool || undefined };
  useEffect(() => {
    if (rows.length < 3) return;
    let live = true;
    void cmdx<{ message: string; errorsText: string; difference?: number }>("calib.tool", params).then((r) => {
      if (!live) return;
      setResult(r.ok && r.result ? { text: `${r.result.message}\n${r.result.errorsText}` } : { text: r.error ?? "", bad: true });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);
  const r = w && robot ? w.items[robot] : undefined;
  const getPoint = () => {
    if (!r?.robot) return setStatus("Select robot first");
    if (input === "joints") setRows([...rows, r.robot.joints.slice()]);
    else setRows([...rows, poseToEuler(fk(r.robot.model, r.robot.joints), Number(euler))]);
  };
  const cols = input === "joints" ? Array.from({ length: r?.robot?.model.nq ?? 6 }, (_, i) => `J${i + 1}`) : Number(euler) === 6 ? ["X", "Y", "Z", "qw", "qx", "qy", "qz"] : ["X", "Y", "Z", "A", "B", "C"];
  return (
    <Window title="Tool Definition" onClose={close}>
      <Field label="Robot:" inline>
        <Combo label="Robot" value={robot} onChange={setRobot} options={[{ value: "", label: "(none)" }, ...robotOptions(w)]} />
      </Field>
      <Field label="Select tool:" inline>
        <Combo label="Tool" value={tool} onChange={setTool} options={[{ value: "", label: "(none)" }, ...tools.map((t) => ({ value: t.id, label: t.name }))]} />
      </Field>
      <Section title="Calibrate using">
        <Radios label="Calibrate using" value={method} onChange={setMethod} options={[{ value: "point", label: "Calib XYZ by point" }, { value: "plane", label: "Calib XYZ by plane" }]} />
      </Section>
      <Section title="Select method">
        <Radios label="Select method" value={input} onChange={setInput} options={[{ value: "joints", label: "joints" }, { value: "poses", label: "poses" }]} />
        {input === "poses" && (
          <div style={{ marginTop: 6 }}>
            <Combo label="Pose format" value={euler} onChange={setEuler} options={EULER_FORMATS.map((f, i) => ({ value: String(i), label: f }))} compact />
          </div>
        )}
      </Section>
      <Section title={`Number of positions: ${rows.length}`} right={<button className="g-btn ghost" onClick={getPoint}>{`Get p${rows.length + 1}`}</button>}>
        <RowsEditor rows={rows} onChange={setRows} columns={cols} label="Measurements" />
      </Section>
      <Message text={rows.length < 3 ? (rows.length ? "Not enough data. Add measurements to have an error estimate." : "") : result.text} tone={result.bad && rows.length >= 3 ? "bad" : "neutral"} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button className="g-btn ghost" onClick={() => setRows([])}>
          Reset calibration
        </button>
        <button className="g-btn primary" disabled={!tool || rows.length < 3 || !!result.bad} onClick={() => setConfirm(true)}>
          Update
        </button>
      </div>
      {confirm && (
        <Confirm
          text="This will replace the current TCP values. Continue?"
          onNo={() => setConfirm(false)}
          onYes={() => {
            setConfirm(false);
            void cmd("calib.tool", { ...params, apply: true });
          }}
        />
      )}
    </Window>
  );
}

 

const FRAME_METHODS = [
  { value: "p1-on-x", label: "3 point (p3 crosses Y+)" },
  { value: "p1-origin", label: "3 point (p1 = origin)" },
  { value: "6-points", label: "6 point" },
  { value: "turntable", label: "Turntable Calibration (1 Axis)" },
  { value: "turntable-2-axes", label: "Turntable Calibration (2 Axes)" },
] as const;

function FrameDefinition({ frameId }: { frameId?: string }) {
  const w = useRC((s) => s.ws);
  const frames = itemsOf(w, "frame");
  const [frame, setFrame] = useState(frameId ?? "");
  const [robot, setRobot] = useState(selectedRobot()?.id ?? "");
  const [method, setMethod] = useState<(typeof FRAME_METHODS)[number]["value"]>("p1-origin");
  const [input, setInput] = useState<"points" | "joints">("joints");
  const [rows, setRows] = useState<number[][]>([]);
  const [result, setResult] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const [confirm, setConfirm] = useState(false);
  const params = { rows, input, method, robot: robot || undefined, frame: frame || undefined };
  useEffect(() => {
    if (rows.length < 3) return;
    let live = true;
    void cmdx<{ message: string }>("calib.frame", params).then((r) => {
      if (live) setResult(r.ok && r.result ? { text: r.result.message } : { text: r.error ?? "", bad: true });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);
  const r = w && robot ? w.items[robot] : undefined;
  const getPoint = () => {
    if (!r?.robot || !w) return setStatus("Select robot first");
    if (input === "joints") setRows([...rows, r.robot.joints.slice()]);
    else {
      const m = mul(fk(r.robot.model, r.robot.joints), toolPose(w, r.id));
      setRows([...rows, [m[3], m[7], m[11]]]);
    }
  };
  return (
    <Window title="Reference Frame Definition" onClose={close}>
      <Field label="Robot:" inline>
        <Combo label="Robot" value={robot} onChange={setRobot} options={[{ value: "", label: "(none)" }, ...robotOptions(w)]} />
      </Field>
      <Field label="Select frame:" inline>
        <Combo label="Frame" value={frame} onChange={setFrame} options={[{ value: "", label: "(none)" }, ...frames.map((f) => ({ value: f.id, label: f.name }))]} />
      </Field>
      <Field label="Calibration method:">
        <Combo label="Calibration method" value={method} onChange={setMethod} options={[...FRAME_METHODS]} />
      </Field>
      <Section title="Calibrate using">
        <Radios label="Calibrate using" value={input} onChange={setInput} options={[{ value: "joints", label: "joints" }, { value: "points", label: "points" }]} />
      </Section>
      <Section title={`Number of points: ${rows.length}`} right={<button className="g-btn ghost" onClick={getPoint}>{`Get p${rows.length + 1}`}</button>}>
        <RowsEditor rows={rows} onChange={setRows} columns={input === "joints" ? Array.from({ length: r?.robot?.model.nq ?? 6 }, (_, i) => `J${i + 1}`) : ["X", "Y", "Z"]} label="Points" />
      </Section>
      <Message text={rows.length < 3 ? "" : result.text} tone={result.bad ? "bad" : "neutral"} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button className="g-btn ghost" onClick={() => setRows([])}>
          Reset
        </button>
        <button className="g-btn primary" disabled={!frame || rows.length < 3 || !!result.bad} onClick={() => setConfirm(true)}>
          Update
        </button>
      </div>
      {confirm && (
        <Confirm
          text="This will replace the current frame position. Continue?"
          onNo={() => setConfirm(false)}
          onYes={() => {
            setConfirm(false);
            void cmd("calib.frame", { ...params, apply: true });
          }}
        />
      )}
    </Window>
  );
}

 

function MechanismBuilder() {
  const w = useRC((s) => s.ws);
  const objects = [...itemsOf(w, "object"), ...itemsOf(w, "tool")];
  const [type, setType] = useState(1);
  const [name, setName] = useState("My Mechanism");
  const [params, setParams] = useState<number[]>([]);
  const kin = useMemo(() => mechanismKinematics(type, params), [type, params]);
  const n = kin.nq;
  const [objs, setObjs] = useState<string[]>([]);
  const [axes, setAxes] = useState<{ build: number; home: number; invert: boolean; lower: number; upper: number }[]>([]);
  const ax = Array.from({ length: n }, (_, i) => axes[i] ?? { build: 0, home: 0, invert: false, lower: -200, upper: 200 });
  const setAx = (i: number, patch: Partial<(typeof ax)[number]>) => setAxes(ax.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const names = MECHANISM_PARAMS[type] ?? [];
  const isLinear = (i: number) => !!kin.rows[i]?.[4];
  const build = async () => {
    const r = await cmdx<{ robot: string }>("mechanism.build", {
      type,
      name,
      params,
      objects: Array.from({ length: kin.nlinks }, (_, i) => objs[i] || null),
      build: ax.map((a) => a.build),
      home: ax.map((a) => a.home),
      senses: ax.map((a) => (a.invert ? -1 : 1)),
      lower: ax.map((a) => a.lower),
      upper: ax.map((a) => a.upper),
    });
    setMsg(r.ok ? { text: `Robot/mechanism created: ${r.result?.robot}` } : { text: r.error ?? "", bad: true });
  };
  return (
    <Window title="Model Mechanism or Robot" onClose={close} width={460}>
      <Field label="Type:" inline>
        <Combo
          label="Mechanism type"
          value={String(type)}
          onChange={(v) => {
            setType(Number(v));
            setParams([]);
            setAxes([]);
          }}
          options={MECHANISM_TYPES.map((t) => ({ value: String(t.code), label: t.label }))}
        />
      </Field>
      <Field label="Name:" inline>
        <input className="g-input" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {names.length > 0 && (
        <Section title={n >= 5 ? "Set the robot dimensions" : "Parameters"}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {names.map((label, i) => (
              <label key={label + i} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ font: "600 10px var(--font-ui)", color: "var(--ink-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                <NumField label={label} value={params[i] ?? 0} decimals={2} onCommit={(v) => setParams(Array.from({ length: Math.max(params.length, i + 1) }, (_, k) => (k === i ? v : (params[k] ?? 0))))} />
              </label>
            ))}
          </div>
        </Section>
      )}
      <Section title="Objects">
        {Array.from({ length: kin.nlinks }, (_, i) => (
          <Field key={i} label={i === 0 ? "Base" : `Axis ${i}`} inline>
            <Combo
              label={i === 0 ? "Base object" : `Object of axis ${i}`}
              value={objs[i] ?? ""}
              onChange={(v) => setObjs(Array.from({ length: Math.max(objs.length, i + 1) }, (_, k) => (k === i ? v : (objs[k] ?? ""))))}
              options={[{ value: "", label: "(none)" }, ...objects.map((o) => ({ value: o.id, label: o.name }))]}
            />
          </Field>
        ))}
      </Section>
      <Section title="Joints">
        <div style={{ display: "grid", gridTemplateColumns: "34px repeat(4, 1fr) auto", gap: 5, alignItems: "center", font: "600 10px var(--font-ui)", color: "var(--ink-3)" }}>
          <span />
          <span>Build</span>
          <span>Home</span>
          <span>Min</span>
          <span>Max</span>
          <span>Invert</span>
          {ax.map((a, i) => [
            <span key={`l${i}`} style={{ color: "var(--ink-1)" }}>
              J{i + 1}
              {isLinear(i) ? " mm" : "°"}
            </span>,
            <NumField key={`b${i}`} label={`Build joint ${i + 1}`} value={a.build} decimals={1} onCommit={(v) => setAx(i, { build: v })} />,
            <NumField key={`h${i}`} label={`Home joint ${i + 1}`} value={a.home} decimals={1} onCommit={(v) => setAx(i, { home: v })} />,
            <NumField key={`n${i}`} label={`Minimum limit ${i + 1}`} value={a.lower} decimals={1} onCommit={(v) => setAx(i, { lower: v })} />,
            <NumField key={`x${i}`} label={`Maximum limit ${i + 1}`} value={a.upper} decimals={1} onCommit={(v) => setAx(i, { upper: v })} />,
            <Check key={`s${i}`} label="" checked={a.invert} onChange={(v) => setAx(i, { invert: v })} />,
          ])}
        </div>
      </Section>
      <Message text={msg.text} tone={msg.bad ? "bad" : "neutral"} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button className="g-btn primary" onClick={() => void build()}>
          Update
        </button>
      </div>
    </Window>
  );
}

 

function RobotParameters({ robotId }: { robotId: string }) {
  const r = useRC((s) => s.ws?.items[robotId]);
  const [dh, setDh] = useState<{ alpha: number; a: number; theta: number; d: number; type: string }[] | null>(null);
  useEffect(() => {
    void cmd<{ dh: { alpha: number; a: number; theta: number; d: number; type: string }[] }>("robot.parameters", { robot: robotId }, { quiet: true }).then((x) => x && setDh(x.dh));
  }, [robotId, r?.robot?.model]);
  if (!r?.robot || !dh) return null;
  const m = r.robot.model;
  const setRow = (i: number, k: "alpha" | "a" | "theta" | "d", v: number) => {
    const next = dh.map((row, j) => (j === i ? { ...row, [k]: v } : row));
    setDh(next);
    void cmd("robot.setParameters", { robot: robotId, dh: next.map(({ alpha, a, theta, d }) => ({ alpha, a, theta, d })) });
  };
  return (
    <Window title="Robot Parameters" onClose={close} width={470}>
      <div style={{ font: "600 12.5px var(--font-ui)", color: "var(--ink-1)", margin: "-4px 2px 8px" }}>Robot: {r.name}</div>
      <Section title="Kinematic parameters: Denavit-Hartenberg Modified (DHM)">
        <div style={{ display: "grid", gridTemplateColumns: "34px repeat(4, 1fr)", gap: 5, alignItems: "center", font: "600 10px var(--font-ui)", color: "var(--ink-3)" }}>
          <span />
          <span>α (deg)</span>
          <span>a (mm)</span>
          <span>θ (deg)</span>
          <span>d (mm)</span>
          {dh.map((row, i) => [
            <span key={`j${i}`} style={{ color: "var(--ink-1)" }}>
              J{i + 1}
              {row.type === "linear" ? "*" : ""}
            </span>,
            ...(["alpha", "a", "theta", "d"] as const).map((k) => <NumField key={`${k}${i}`} label={`${k} of joint ${i + 1}`} value={row[k]} decimals={3} onCommit={(v) => setRow(i, k, v)} />),
          ])}
        </div>
      </Section>
      <Section title="Joint limits">
        <div style={{ display: "grid", gridTemplateColumns: "34px 1fr 1fr", gap: 5, alignItems: "center", font: "600 10px var(--font-ui)", color: "var(--ink-3)" }}>
          {m.userLower.map((lo, i) => [
            <span key={`k${i}`} style={{ color: "var(--ink-1)" }}>
              J{i + 1}
            </span>,
            <NumField key={`lo${i}`} label={`Minimum limit ${i + 1}`} value={lo} decimals={2} onCommit={(v) => void cmd("robot.setParameters", { robot: robotId, lower: m.userLower.map((x, j) => (j === i ? v : x)) })} />,
            <NumField key={`hi${i}`} label={`Maximum limit ${i + 1}`} value={m.userUpper[i]} decimals={2} onCommit={(v) => void cmd("robot.setParameters", { robot: robotId, upper: m.userUpper.map((x, j) => (j === i ? v : x)) })} />,
          ])}
        </div>
      </Section>
      <RobotParametersMore robot={r} />
    </Window>
  );
}

 

function ConnectRobot({ robotId }: { robotId: string }) {
  const r = useRC((s) => s.ws?.items[robotId]);
  const c = r?.robot?.connection;
  const [ip, setIp] = useState(c?.ip ?? "");
  const [port, setPort] = useState(c?.port ?? 2000);
  const [remotePath, setRemotePath] = useState(c?.remotePath ?? "/");
  const [ftpUser, setFtpUser] = useState(c?.ftpUser ?? "anonymous");
  const [ftpPass, setFtpPass] = useState(c?.ftpPass ?? "");
  useEffect(() => {
    if (!c) void cmd<{ ip: string; port: number; remotePath: string; ftpUser: string }>("robot.connectionState", { robot: robotId }, { quiet: true }).then((x) => {
      if (!x) return;
      setIp(x.ip);
      setPort(x.port);
      setRemotePath(x.remotePath);
      setFtpUser(x.ftpUser);
    });
  }, [robotId, c]);
  if (!r?.robot) return null;
  const save = () => cmd("robot.setConnection", { robot: robotId, ip, port, remotePath, ftpUser, ftpPass }, { quiet: true });
  return (
    <Window title={`Connect: ${r.name}`} onClose={close}>
      <Field label="Robot IP/COM:" inline>
        <input className="g-input" aria-label="Robot IP/COM" value={ip} onChange={(e) => setIp(e.target.value)} onBlur={() => void save()} />
      </Field>
      <Field label="Robot port:" inline>
        <NumField label="Robot port" value={port} decimals={0} onCommit={(v) => setPort(Math.round(v))} />
      </Field>
      <Field label="Remote FTP path:" inline>
        <input className="g-input" aria-label="Remote FTP path" value={remotePath} onChange={(e) => setRemotePath(e.target.value)} onBlur={() => void save()} />
      </Field>
      <Field label="Remote FTP user name:" inline>
        <input className="g-input" aria-label="Remote FTP user name" value={ftpUser} onChange={(e) => setFtpUser(e.target.value)} onBlur={() => void save()} />
      </Field>
      <Field label="Remote FTP password:" inline>
        <input className="g-input" type="password" aria-label="Remote FTP password" value={ftpPass} onChange={(e) => setFtpPass(e.target.value)} onBlur={() => void save()} />
      </Field>
      <Field label="Connection status:" inline>
        <span style={{ font: "600 12px var(--font-ui)", color: c && c.state === -3 ? "var(--bad)" : "var(--ink-1)" }}>{c?.message ?? "disconnected"}</span>
      </Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="g-btn ghost" title="Disconnect from robot. Double click to force stop." onClick={() => void cmd("robot.disconnect", { robot: robotId })}>
          Disconnect
        </button>
        <button
          className="g-btn primary"
          title="Connect using the robot driver"
          onClick={async () => {
            await save();
            await cmd("robot.connect", { robot: robotId });
          }}
        >
          Connect
        </button>
      </div>
    </Window>
  );
}

 

function CameraSettingsPanel({ cameraId }: { cameraId: string }) {
  const cam = useRC((s) => s.ws?.items[cameraId]);
  const settings = useRC((s) => s.settings as Record<string, number | string | boolean>);
  if (!cam?.camera) return null;
  const s = cameraSettings({ settings }, cam);
  const set = (params: string) => void cmd("camera.setParams", { camera: cameraId, params });
  return (
    <Window title={`Camera Settings: ${cam.name}`} onClose={close} width={380}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Field label="Field of view (deg)">
          <NumField label="Field of view" value={s.fov} decimals={2} onCommit={(v) => set(`FOV=${v}`)} />
        </Field>
        <Field label="Focal length (mm)">
          <NumField label="Focal length" value={s.focal} decimals={2} onCommit={(v) => set(`FOCAL_LENGTH=${v} FAR_LENGTH=${v + (s.far - s.focal)}`)} />
        </Field>
        <Field label="Working distance (mm)">
          <NumField label="Working distance" value={s.far - s.focal} decimals={1} onCommit={(v) => set(`FAR_LENGTH=${s.focal + v}`)} />
        </Field>
        <Field label="Pixel size (µm)">
          <NumField label="Pixel size" value={s.pixelSize} decimals={3} onCommit={(v) => set(`PIXELSIZE=${v}`)} />
        </Field>
        <Field label="Width (px)">
          <NumField label="Width" value={s.width} decimals={0} onCommit={(v) => set(`SIZE=${Math.round(v)}x${s.height}`)} />
        </Field>
        <Field label="Height (px)">
          <NumField label="Height" value={s.height} decimals={0} onCommit={(v) => set(`SIZE=${s.width}x${Math.round(v)}`)} />
        </Field>
      </div>
      <Field label="View type" inline>
        <Combo label="View type" value={s.ortho ? "ORTHO" : "PERSP"} onChange={(v) => set(v)} options={[{ value: "PERSP", label: "Perspective" }, { value: "ORTHO", label: "Orthographic" }]} />
      </Field>
      <Field label="Image" inline>
        <Combo label="Image type" value={s.depth ? "DEPTH" : s.gray ? "GRAYSCALE" : "COLOR"} onChange={(v) => set(v === "COLOR" ? "COLOR" : `COLOR ${v}`)} options={[{ value: "COLOR", label: "Color" }, { value: "GRAYSCALE", label: "Grayscale" }, { value: "DEPTH", label: "Depth" }]} />
      </Field>
      <Field label="Background Color" inline>
        <input type="color" aria-label="Background Color" value={formatColor(s.bg).replace(/^#../, "#")} onChange={(e) => set(`BG_COLOR=${e.target.value}`)} />
      </Field>
      <Check label="Show Camera Workspace" checked={s.showLimits} onChange={(v) => set(`SHOW_LIMITS=${v ? 1 : 0}`)} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="g-btn ghost" onClick={() => void downloadCameraSnapshot(cam)}>
          Take snapshot
        </button>
        <button className="g-btn primary" onClick={() => void cmd("camera.window", { camera: cameraId, open: !cam.camera!.open })}>
          {cam.camera.open ? "Close view" : "Show Camera"}
        </button>
      </div>
    </Window>
  );
}

 

function IsoCubeDialog() {
  const w = useRC((s) => s.ws);
  const [robot, setRobot] = useState(selectedRobot()?.id ?? "");
  const r = w && robot ? w.items[robot] : undefined;
  const tools = r ? itemsOf(w, "tool").filter((t) => w && robotOfTool(w, t.id)?.id === r.id) : [];
  const [tool, setTool] = useState(r && w ? (activeToolOf(w, r.id)?.id ?? "") : "");
  const tcpPos = () => {
    if (!r?.robot || !w) return [0, 0, 0];
    const m = mul(fk(r.robot.model, r.robot.joints), tool ? w.items[tool].pose : toolPose(w, r.id));
    return [m[3], m[7], m[11]];
  };
  const [center, setCenter] = useState<number[]>(tcpPos);
  const [side, setSide] = useState(200);
  const [plane, setPlane] = useState<"A" | "B" | "C" | "D">("C");
  const [maximize, setMaximize] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>({ text: "" });
  if (!r?.robot)
    return (
      <Window title="ISO 9283 cube" onClose={close}>
        <Message text="Add a robot first." tone="bad" />
      </Window>
    );
  const generate = async () => {
    const res = await cmdx<{ program: string; side: number }>("iso.cube", { robot, center, side, plane, tool: tool || undefined, refJoints: r.robot!.joints, maximize });
    if (res.ok) {
      if (maximize && res.result) setSide(res.result.side);
      close();
    } else setMsg({ text: res.error ?? "", bad: true });
  };
  return (
    <Window title="ISO 9283 cube" onClose={close} width={380}>
      <Field label="Robot" inline>
        <Combo label="Robot" value={robot} onChange={setRobot} options={robotOptions(w)} />
      </Field>
      <Field label="TCP" inline>
        <Combo label="TCP" value={tool} onChange={setTool} options={[{ value: "", label: "(current TCP)" }, ...tools.map((t) => ({ value: t.id, label: t.name }))]} />
      </Field>
      <Field label="Reference joints">
        <span style={{ font: "500 11.5px var(--font-mono, ui-monospace)" }}>{r.robot.joints.map((v) => v.toFixed(2)).join(", ")}</span>
      </Field>
      <Field label="Cube center">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {["X", "Y", "Z"].map((l, i) => (
            <NumField key={l} label={`Cube center ${l}`} value={center[i]} decimals={1} onCommit={(v) => setCenter(center.map((c, k) => (k === i ? v : c)))} />
          ))}
        </div>
      </Field>
      <Field label="Cube side (mm)" inline>
        <NumField label="Cube side" value={side} decimals={1} onCommit={(v) => setSide(Math.abs(v))} />
      </Field>
      <Field label="Test plane" inline>
        <Combo label="Test plane" value={plane} onChange={setPlane} options={(["A", "B", "C", "D"] as const).map((p) => ({ value: p, label: p }))} />
      </Field>
      <Check label="Maximize" checked={maximize} onChange={setMaximize} />
      <Message text={msg.text} tone={msg.bad ? "bad" : "neutral"} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button
          className="g-btn ghost"
          onClick={() => {
            setCenter(tcpPos());
            setSide(200);
          }}
        >
          default
        </button>
        <button className="g-btn primary" onClick={() => void generate()}>
          Generate ISO 9283 cube
        </button>
      </div>
    </Window>
  );
}

 
export default function UtilitiesHost() {
  const panel = useUtilities((s) => s.panel);
  if (!panel) return null;
  switch (panel.kind) {
    case "tcp":
      return <ToolDefinition key={panel.tool ?? "tcp"} toolId={panel.tool} />;
    case "frame":
      return <FrameDefinition key={panel.frame ?? "frame"} frameId={panel.frame} />;
    case "mechanism":
      return <MechanismBuilder />;
    case "iso":
      return <IsoCubeDialog />;
    case "connect":
      return <ConnectRobot key={panel.robot} robotId={panel.robot} />;
    case "camera":
      return <CameraSettingsPanel key={panel.camera} cameraId={panel.camera} />;
    case "params":
      return <RobotParameters key={panel.robot} robotId={panel.robot} />;
  }
}

 

 
async function addCameraUI(anchor?: Item) {
  const it = anchor ?? selected().find((i) => i.type === "frame" || i.type === "object" || i.type === "tool");
  if (!it) return setStatus(CAMERA_MSG.needLocation);
  await cmd("camera.add", { attachTo: it.id });
}

async function vrViewUI() {
  const r = await cmd<{ vr: boolean }>("view.vrView", {});
  if (!r) return;
  try {
    if (r.vr) {
      useRC.setState({ rightPanel: "none", jointList: null });
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    setStatus("Full screen needs a click or a key press in the Enginuity window");
  }
}

registerUiAction("actionCalibrate_tool", () => open({ kind: "tcp", tool: selected().find((i) => i.type === "tool")?.id }));
registerUiAction("actionCalibrate_frame", () => open({ kind: "frame", frame: selected().find((i) => i.type === "frame")?.id }));
registerUiAction("actionAdd_Mechanism_or_Robot", () => open({ kind: "mechanism" }));
registerUiAction("actionISO_9283_targets_and_path", () => {
  if (!itemsOf(ws(), "robot").length) return setStatus("Add a robot first.");
  open({ kind: "iso" });
});
registerUiAction("action-ConnectRobot", () => {
  const robots = itemsOf(ws(), "robot");
  if (!robots.length) return setStatus("No robot to connect");
  const r = selected().find((i) => i.type === "robot") ?? (robots.length === 1 ? robots[0] : undefined);
  if (!r) return setStatus("Select a robot to connect");
  open({ kind: "connect", robot: r.id });
});
registerUiAction("actionSimulate_2D_Camera", () => addCameraUI());
registerUiAction("actionVR_View", () => vrViewUI());

 

contributeItemMenu((w, item) => {
  switch (item.type) {
    case "tool":
      return [
        { label: "Define TCP…", icon: <Icon.Tool />, onSelect: () => open({ kind: "tcp", tool: item.id }) },
        { label: "Simulate 2D Camera", icon: <Icon.Camera />, onSelect: () => void addCameraUI(item) },
      ];
    case "frame":
      return [
        { label: "Define Reference Frame…", icon: <Icon.Frame />, onSelect: () => open({ kind: "frame", frame: item.id }) },
        { label: "Simulate 2D Camera", icon: <Icon.Camera />, onSelect: () => void addCameraUI(item) },
      ];
    case "object":
      return [{ label: "Simulate 2D Camera", icon: <Icon.Camera />, onSelect: () => void addCameraUI(item) }];
    case "robot":
      return [
        { label: "Connect to robot…", onSelect: () => open({ kind: "connect", robot: item.id }) },
        { label: "Robot parameters…", onSelect: () => open({ kind: "params", robot: item.id }) },
      ];
    case "camera": {
      const s = cameraSettings({ settings: useRC.getState().settings as Record<string, number | string | boolean> }, item);
      const anchors = [...itemsOf(w, "frame"), ...itemsOf(w, "object"), ...itemsOf(w, "tool")];
      const colors = ["white", "black", "gray", "lightgray", "blue", "green"];
      return [
        { label: "Camera Settings", icon: <Icon.Settings />, onSelect: () => open({ kind: "camera", camera: item.id }) },
        { label: "Camera Location", submenu: anchors.map((a) => ({ label: a.name, checked: item.camera?.link === a.id, onSelect: () => void cmd("camera.setLocation", { camera: item.id, attachTo: a.id }) })) },
        { label: "Show Camera", checked: !!item.camera?.open, onSelect: () => void cmd("camera.window", { camera: item.id, open: !item.camera?.open }) },
        { label: "Show Camera Workspace", checked: s.showLimits, onSelect: () => void cmd("camera.setParams", { camera: item.id, params: `SHOW_LIMITS=${s.showLimits ? 0 : 1}` }) },
        { label: "Take snapshot", icon: <Icon.Camera />, onSelect: () => void downloadCameraSnapshot(item) },
        {
          label: "Background Color",
          submenu: colors.map((c) => ({ label: c, checked: formatColor(s.bg) === formatColor(parseColor(c)!), onSelect: () => void cmd("camera.setParams", { camera: item.id, params: `BG_COLOR=${c}` }) })),
        },
      ];
    }
    default:
      return [];
  }
}, 70);
