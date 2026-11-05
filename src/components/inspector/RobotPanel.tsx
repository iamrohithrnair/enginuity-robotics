"use client";
// Presents robot joints, Cartesian jogging, tools, and reference controls.

import { useEffect, useMemo, useRef, useState } from "react";
import { cmd, cmdx } from "@/client/api";
import { useRC } from "@/client/store";
import { fk, kinematicsReady } from "@/engine/kinematics";
import { inv, mul, poseToXYZRPW, round } from "@/engine/math";
import type { Item, RobotModel, Workspace } from "@/engine/types";
import { absPose, childFrame, listItems, toolPose } from "@/engine/workspace";
import { Icon } from "../icons";
import { Combo, Field, NumField, Pill, Section, TextField } from "./fields";
import { RobotDisplayOptions } from "../contrib/a3";

 
function usePostNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void cmd<{ posts: { name: string }[] }>("post.list", {}, { quiet: true }).then((r) => {
      if (live && r) setNames(r.posts.map((p) => p.name));
    });
    return () => {
      live = false;
    };
  }, []);
  return names;
}





function JointSlider(props: { index: number; value: number; lower: number; upper: number; unit: string; inc: number; onChange: (v: number) => void; onCommit: (v: number) => void; onStep: (sign: number) => void }) {
  const { index, value, lower, upper, unit, inc, onChange, onCommit, onStep } = props;
  const fill = ((value - lower) / Math.max(1e-9, upper - lower)) * 100;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 78px 46px", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <span style={{ font: "650 11px var(--font-mono)", color: "var(--ink-2)" }}>J{index + 1}</span>
      <div style={{ position: "relative" }}>
        <input
          type="range"
          className="g-range"
          min={lower}
          max={upper}
          step={0.1}
          value={value}
          aria-label={`Joint ${index + 1}`}
          style={{ ["--fill" as string]: `${fill}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        />
        <div style={{ display: "flex", justifyContent: "space-between", font: "500 9.5px var(--font-mono)", color: "var(--ink-3)", marginTop: -3 }}>
          <span>{lower.toFixed(1)}</span>
          <span>{upper.toFixed(1)}</span>
        </div>
      </div>
      <NumField value={value} decimals={2} suffix={unit} onCommit={onCommit} />
      <div style={{ display: "flex", gap: 2 }}>
        <button className="g-btn ghost" style={{ height: 22, width: 22, padding: 0 }} aria-label={`J${index + 1} -${inc}`} title={`-${inc} ${unit}`} onClick={() => onStep(-1)}>
          <Icon.Minus size={11} />
        </button>
        <button className="g-btn ghost" style={{ height: 22, width: 22, padding: 0 }} aria-label={`J${index + 1} +${inc}`} title={`+${inc} ${unit}`} onClick={() => onStep(1)}>
          <Icon.Plus size={11} />
        </button>
      </div>
    </div>
  );
}

 
function userJointKind(model: RobotModel, i: number): "rotary" | "linear" {
  for (let r = 0; r < model.joints.length; r++) if (model.map[r * model.nq + i]) return model.joints[r].kind;
  return "rotary";
}

type Config = { joints: number[]; current: boolean };





function ConfigsRow({ robot, joints }: { robot: Item; joints: number[] }) {
  const key = joints.map((v) => v.toFixed(4)).join(",");
  const [configs, setConfigs] = useState<{ key: string; list: Config[] } | null>(null);
  const list = configs?.key === key ? configs.list : null;
  const load = () => {
    if (list) return;
    void cmdx<{ configurations: Config[] }>("robot.configurations", { robot: robot.id }).then((r) => {
      if (r.ok && r.result) setConfigs({ key, list: r.result.configurations.filter((c) => !c.current) });
    });
  };
  const fmt = (q: number[]) => q.map((v) => v.toFixed(1)).join(", ");
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <select
        className="g-input"
        aria-label="Other configurations"
        value=""
        onFocus={load}
        onPointerDown={load}
        onChange={(e) => {
          const c = list?.[Number(e.target.value)];
          if (c) void cmd("robot.setJoints", { robot: robot.id, joints: c.joints });
        }}
        style={{ flex: 1, minWidth: 0 }}
      >
        <option value="">{fmt(joints)}</option>
        {list?.map((c, k) => (
          <option key={k} value={k}>
            {fmt(c.joints)}
          </option>
        ))}
      </select>
      <button className="g-btn" style={{ height: 30 }} title="Align the tool with the axes of the reference frame" onClick={() => void cmd("robot.alignToolOrientation", { robot: robot.id })}>
        Align
      </button>
    </div>
  );
}

function tcpInRef(ws: Workspace, robot: Item, joints: number[]) {
  const rd = robot.robot!;
  const refId = rd.activeFrame && ws.items[rd.activeFrame] ? rd.activeFrame : robot.parent;
  const tcpAbs = mul(mul(absPose(ws, robot.id), fk(rd.model, joints)), toolPose(ws, robot.id));
  return { refId, xyzrpw: poseToXYZRPW(mul(inv(childFrame(ws, refId ?? null)), tcpAbs)) };
}

export default function RobotPanel({ robot }: { robot: Item }) {
  const ws = useRC((s) => s.ws)!;
  const live = useRC((s) => s.liveJoints[robot.id]);
  const rd = robot.robot!;
  const joints = live ?? rd.joints;
  const settings = useRC((s) => s.settings);
  const postNames = usePostNames();
  const [step, setStep] = useState(Number(useRC.getState().settings.SliderIncrMM ?? 10));
  const [frameMode, setFrameMode] = useState<"reference" | "tool">("reference");
  const pending = useRef<number[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = (q: number[]) => {
    pending.current = q;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const p = pending.current;
      if (p) void cmd("robot.setJoints", { robot: robot.id, joints: p }, { quiet: true });
    }, 33);
  };

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const kinReady = useRC((s) => s.kinReady);
  const tcp = useMemo(() => (kinReady && kinematicsReady() ? tcpInRef(ws, robot, joints) : null), [ws, robot, joints, kinReady]);
  const tools = robot.children.map((c) => ws.items[c]).filter((i) => i?.type === "tool");
  const frames = listItems(ws, { type: "frame" });

  const jog = (axis: string, sign: number) => {
    const isRot = axis.startsWith("r");
    void cmd("robot.jogCartesian", { robot: robot.id, axis, delta: sign * (isRot ? Math.min(step, 15) : step), frame: frameMode });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--orange) 14%, transparent)", color: "var(--orange)" }}>
          <Icon.Robot size={22} color="currentColor" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "650 14px var(--font-ui)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{robot.name} panel</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <Pill>{rd.model.nq} axes</Pill>
            <Pill tone="accent">{rd.postProcessor}</Pill>
          </div>
        </div>
      </div>

      <Field label="Name:">
        <TextField label="Robot name" value={robot.name} onCommit={(v) => void cmd("item.rename", { item: robot.id, name: v })} />
      </Field>

      <Section
        title="Joints"
        right={
          <div style={{ display: "flex", gap: 4 }}>
            <button className="g-btn ghost" style={{ height: 24 }} onClick={() => void cmd("robot.home", { robot: robot.id })} title="Move Home">
              <Icon.Home size={14} /> Move Home
            </button>
            <button className="g-btn ghost" style={{ height: 24 }} onClick={() => void cmd("robot.setHome", { robot: robot.id, joints: joints.slice() })} title="Use the current joints as home">
              Set Home
            </button>
          </div>
        }
      >
        {Array.from({ length: rd.model.nq }, (_, i) => {
          const linear = userJointKind(rd.model, i) === "linear";
          const inc = Number((linear ? settings.SliderIncrMM : settings.SliderIncrDeg) ?? 10);
          return (
            <JointSlider
              key={i}
              index={i}
              value={round(joints[i] ?? 0, 2)}
              lower={rd.model.userLower[i] ?? rd.model.joints[i]?.lower ?? -180}
              upper={rd.model.userUpper[i] ?? rd.model.joints[i]?.upper ?? 180}
              unit={linear ? "mm" : "°"}
              inc={inc}
              onStep={(sign) => void cmd("robot.jogJoint", { robot: robot.id, joint: i + 1, delta: sign * inc })}
              onChange={(v) => {
                const q = joints.slice();
                q[i] = v;
                useRC.setState({ liveJoints: { ...useRC.getState().liveJoints, [robot.id]: q } });
                send(q);
              }}
              onCommit={(v) => {
                const q = joints.slice();
                q[i] = v;
                void cmd("robot.setJoints", { robot: robot.id, joints: q }).then(() => {
                  const lj = { ...useRC.getState().liveJoints };
                  delete lj[robot.id];
                  useRC.setState({ liveJoints: lj });
                });
              }}
            />
          );
        })}
        <ConfigsRow robot={robot} joints={joints} />
      </Section>

      <Section title="Tool position" right={<span style={{ font: "500 10.5px var(--font-ui)", color: "var(--ink-2)" }}>w.r.t. {tcp?.refId ? ws.items[tcp.refId]?.name : "station"}</span>}>
        <div className="glass-inset" style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {["X", "Y", "Z", "Rx", "Ry", "Rz"].map((l, i) => (
            <div key={l}>
              <div style={{ font: "600 9.5px var(--font-ui)", color: ["var(--axis-x)", "var(--axis-y)", "var(--axis-z)"][i % 3] }}>{l}</div>
              { }
              <NumField
                label={`Tool ${l}`}
                value={tcp ? tcp.xyzrpw[i] : 0}
                decimals={3}
                disabled={!tcp}
                onCommit={(v) => {
                  if (!tcp) return;
                  const x = tcp.xyzrpw.slice();
                  x[i] = v;
                  void cmd("robot.moveTo", { robot: robot.id, xyzrpw: x, relativeTo: "reference" });
                }}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Cartesian jog"
        right={
          <div className="glass-inset" style={{ display: "flex", padding: 2, borderRadius: 999 }}>
            {(["reference", "tool"] as const).map((m) => (
              <button key={m} className={`g-btn ${frameMode === m ? "active" : "ghost"}`} style={{ height: 22, fontSize: 11 }} onClick={() => setFrameMode(m)}>
                {m === "reference" ? "Reference" : "Tool"}
              </button>
            ))}
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
          {["x", "y", "z", "rx", "ry", "rz"].map((a, i) => (
            <div key={a} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
              <button className="g-btn" style={{ height: 26, padding: 0 }} onClick={() => jog(a, +1)} title={`+${a.toUpperCase()}`}>
                <Icon.Plus size={13} />
              </button>
              <div style={{ textAlign: "center", font: "650 10.5px var(--font-ui)", color: ["var(--axis-x)", "var(--axis-y)", "var(--axis-z)"][i % 3] }}>{a.toUpperCase()}</div>
              <button className="g-btn" style={{ height: 26, padding: 0 }} onClick={() => jog(a, -1)} title={`-${a.toUpperCase()}`}>
                <Icon.Minus size={13} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)" }}>Step</span>
          {[1, 5, 10, 50].map((s) => (
            <button key={s} className={`g-btn ${step === s ? "active" : "ghost"}`} style={{ height: 22, padding: "0 8px", fontSize: 11 }} onClick={() => setStep(s)}>
              {s} mm
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tool & reference">
        <div style={{ display: "grid", gap: 8 }}>
          <select
            className="g-input"
            aria-label="Active tool"
            value={rd.activeTool ?? ""}
            onChange={(e) => e.target.value && void cmd("robot.setActiveTool", { robot: robot.id, tool: e.target.value })}
          >
            <option value="">{tools.length ? "Select tool" : "No tools — flange"}</option>
            {tools.map((t) => (
              <option key={t!.id} value={t!.id}>
                {t!.name}
              </option>
            ))}
          </select>
          <select
            className="g-input"
            aria-label="Reference frame"
            value={rd.activeFrame && ws.items[rd.activeFrame] ? rd.activeFrame : ""}
            onChange={(e) => void (e.target.value ? cmd("robot.setActiveFrame", { robot: robot.id, frame: e.target.value }) : cmd("robot.clearActiveFrame", { robot: robot.id }))}
          >
            <option value="">Robot base frame</option>
            {frames.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="g-btn" style={{ flex: 1 }} onClick={() => void cmd("target.teach", { robot: robot.id })}>
              <Icon.Teach size={14} /> Teach target
            </button>
            <button className="g-btn" style={{ flex: 1 }} onClick={() => void cmd("robot.addTool", { robot: robot.id, xyzrpw: [0, 0, 100, 0, 0, 0] })}>
              <Icon.Tool size={14} /> Add TCP
            </button>
          </div>
        </div>
      </Section>

      { }
      <RobotDisplayOptions robot={robot} />
      <Section title="Speeds">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <NumField label="Linear speed" value={rd.speeds.linear} suffix="mm/s" decimals={0} onCommit={(v) => void cmd("robot.setSpeed", { robot: robot.id, linear: v })} />
          <NumField label="Joint speed" value={rd.speeds.joint} suffix="°/s" decimals={0} onCommit={(v) => void cmd("robot.setSpeed", { robot: robot.id, joint: v })} />
          <NumField label="Linear acceleration" value={rd.speeds.linearAccel} suffix="mm/s²" decimals={0} onCommit={(v) => void cmd("robot.setSpeed", { robot: robot.id, linearAccel: v })} />
          <NumField label="Joint acceleration" value={rd.speeds.jointAccel} suffix="°/s²" decimals={0} onCommit={(v) => void cmd("robot.setSpeed", { robot: robot.id, jointAccel: v })} />
        </div>
      </Section>

      <Section title="Post processor">
        <Combo
          label="Select Post Processor"
          value={rd.postProcessor}
          onChange={(v) => void cmd("robot.setPostProcessor", { robot: robot.id, post: v })}
          options={[...new Set([rd.postProcessor, ...postNames])].map((p) => ({ value: p, label: p.replace(/_/g, " ") }))}
        />
      </Section>
    </div>
  );
}
