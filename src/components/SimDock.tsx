"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cmd } from "@/client/api";
import { jointsAt, planProgram, type Plan } from "@/engine/sim/planner";
import { jointsByItem, syncItemIds } from "@/engine/sync/axes";
import { runProgramUI } from "@/client/interaction";
import { prettyKeys } from "@/client/shortcuts";
import { useRC } from "@/client/store";
import { formatProgramTime } from "@/engine/sim/timefmt";
import { Icon } from "./icons";

 
const SPEED_MAX = 1000;
const ratioOf = (s: number) => s ** 4 * 5e-10;
const sliderOf = (r: number) => Math.round(Math.min(SPEED_MAX, Math.max(0, (r / 5e-10) ** 0.25)));
const SPEED_MAX_RATIO = ratioOf(SPEED_MAX);
const fmtRatio = (r: number) => (r < 10 ? r.toFixed(r < 1 ? 2 : 1) : String(Math.round(r)));



function SpeedField({ ratio, normal }: { ratio: number; normal: number }) {
  const [text, setText] = useState<string | null>(null);
  const apply = () => {
    const v = Number((text ?? "").replace(/[×x\s]/g, ""));
    setText(null);
    if (Number.isFinite(v) && v > 0) void cmd("sim.setSpeed", { factor: Math.min(SPEED_MAX_RATIO, Math.max(0.01, v)) });
  };
  return (
    <span className="rc-tip-host" style={{ display: "inline-flex", alignItems: "center" }}>
      <input
        className="g-input mono"
        aria-label="Simulation speed (times real time)"
        inputMode="decimal"
        value={text ?? fmtRatio(ratio)}
        onFocus={(e) => {
          setText(fmtRatio(ratio));
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onDoubleClick={() => {
          setText(null);
          void cmd("sim.setSpeed", { factor: normal });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{ width: 46, height: 24, padding: "0 4px", fontSize: 11, textAlign: "right" }}
      />
      <span style={{ font: "600 11px var(--font-ui)", color: "var(--ink-2)", marginLeft: 2 }}>×</span>
      <span className="rc-tip" role="tooltip" style={{ top: "auto", bottom: "calc(100% + 8px)" }}>
        <b>Simulation speed</b>
        <span className="rc-tip-help">Type a speed from 0.01× to 500× (1× = real time) and press Enter. Double-click for the default {fmtRatio(normal)}×.</span>
      </span>
    </span>
  );
}






export default function SimDock() {
  const ws = useRC((s) => s.ws);
  const [simTime, setSimTime] = useState(0);
  const [estimate, setEstimate] = useState(0);
  const clock = useRef<{ last: number; t: number; program: string | null }>({ last: 0, t: 0, program: null });
  const running = ws?.running?.program ?? null;
   
   
  const [scrubBase, setScrubBase] = useState<{ prog: string; from: number[] } | null>(null);
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [speedDrag, setSpeedDrag] = useState<number | null>(null);
  const speedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

   
  useEffect(() => {
    if (!running) return;
    clock.current = { last: performance.now(), t: 0, program: running };
    void cmd<number[]>("program.update", { program: running }, { quiet: true }).then((u) => setEstimate(u ? Number(u[1]) : 0));
    let raf = 0;
    const tick = () => {
      const st = useRC.getState().ws;
      const now = performance.now();
      if (st && !st.paused && !useRC.getState().dialogs.length) clock.current.t += ((now - clock.current.last) / 1000) * st.simulationSpeed;
      clock.current.last = now;
      setSimTime(clock.current.t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const sel = ws?.selection.map((id) => ws.items[id]).find(Boolean);
  const prog = ws && sel ? (sel.type === "program" ? sel : sel.type === "instruction" && sel.parent ? ws.items[sel.parent] : undefined) : undefined;
  const scrubbing = !running && !!prog;
  const plan: Plan | null = useMemo(() => {
    if (!ws || !scrubbing || !prog) return null;
    try {
      return planProgram(ws, prog.id, scrubBase?.prog === prog.id ? scrubBase.from : undefined);
    } catch {
      return null;
    }
  }, [ws, scrubbing, prog, scrubBase]);
  if (!ws) return null;
  const busy = (ws.busy?.length ?? 0) > 0;
  const speed = ws.simulationSpeed;
  const shown = running ? ws.items[running]?.name : prog?.name;
  const t = running ? simTime : 0;
  const pct = running && estimate > 0 ? Math.min(100, (simTime / estimate) * 100) : 0;
  const fast = Number(useRC.getState().settings.SimRatioFast ?? 100);
  const normal = Number(useRC.getState().settings.SimRatioNormal ?? 5);

  const duration = plan?.duration ?? 0;
  const scrubTo = (t: number) => {
    if (!prog || !plan?.robot || !ws) return;
    const robot = ws.items[plan.robot]?.robot;
    if (!robot) return;
    if (scrubBase?.prog !== prog.id) setScrubBase({ prog: prog.id, from: robot.joints.slice() });
    setScrubT(t);
    const live = useRC.getState().liveJoints;
     
    useRC.setState({ liveJoints: { ...live, ...Object.fromEntries(jointsByItem(ws, plan.robot, jointsAt(plan, t, robot.joints))) } });
  };
  const commitScrub = () => {
    if (!prog || scrubT === null || !plan?.robot) return;
    const robotId = plan.robot;
    const from = scrubBase?.prog === prog.id ? scrubBase.from : undefined;
    void cmd("program.seek", { program: prog.id, t: scrubT, from }, { quiet: true }).finally(() => {
      const lj = { ...useRC.getState().liveJoints };
      for (const id of ws ? syncItemIds(ws, robotId) : [robotId]) delete lj[id];
      useRC.setState({ liveJoints: lj });
    });
  };
  const ratio = speedDrag !== null ? ratioOf(speedDrag) : speed;
  const setSpeedSlider = (v: number) => {
    setSpeedDrag(v);
    if (speedTimer.current) clearTimeout(speedTimer.current);
    speedTimer.current = setTimeout(() => {
      void cmd("sim.setSpeed", { factor: ratioOf(v) }).finally(() => setSpeedDrag(null));
    }, 120);
  };

  return (
    <div
      className="glass liquid rc-enter"
      style={{ position: "fixed", left: "50%", bottom: 16, translate: "-50% 0", zIndex: 35, display: "flex", alignItems: "center", gap: 10, height: 60, padding: "0 14px", borderRadius: 999, width: "min(760px, calc(100vw - 680px))", minWidth: 480, animationDelay: "180ms" }}
    >
      <button className="g-btn primary icon" style={{ width: 40, height: 40 }} title={`Run Program (${prettyKeys("Ctrl+R")})`} onClick={() => void runProgramUI(prog?.id)}>
        <Icon.Play size={18} />
      </button>
      <button
        className={`g-btn icon ${ws.paused ? "active" : ""}`}
        style={{ width: 34, height: 34 }}
        disabled={!busy && !ws.paused}
        title="Pause Program (Backspace)"
        onClick={() => void cmd("sim.pause")}
      >
        <Icon.Pause size={15} />
      </button>
      <button className="g-btn icon" style={{ width: 34, height: 34 }} disabled={!busy} title="Stop (Esc)" onClick={() => void cmd("sim.stop")}>
        <Icon.Stop size={16} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", font: "600 11px var(--font-ui)", color: "var(--ink-1)", marginBottom: 6, gap: 8 }}>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {shown ? (
              <>
                <strong>{shown}</strong> time: <span className="mono">{formatProgramTime(running ? t : (scrubT ?? 0))}</span>
              </>
            ) : (
              "No program selected"
            )}
          </span>
          <span className="mono" style={{ color: "var(--ink-2)" }}>
            {ws.paused ? "paused" : busy ? `${fmtRatio(speed)}×` : estimate && running ? formatProgramTime(estimate) : duration ? formatProgramTime(duration) : ""}
          </span>
        </div>
        {!running && prog && duration > 0 ? (
          <input
            type="range"
            className="g-range"
            aria-label="Sequence"
            title="Sequence: drag to step through the program's simulation"
            min={0}
            max={duration}
            step={duration / 1000}
            value={scrubT ?? 0}
            style={{ ["--fill" as string]: `${((scrubT ?? 0) / duration) * 100}%`, height: 14 }}
            onChange={(e) => scrubTo(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
          />
        ) : (
        <div className="glass-inset" style={{ height: 8, borderRadius: 8, overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 8,
              background: ws.paused ? "var(--warn)" : "var(--accent)",
              
              transition: running ? "none" : "width .3s",
            }}
          />
        </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: 168 }} title="Simulation speed">
        <input
          type="range"
          className="g-range"
          aria-label="Simulation speed"
          min={0}
          max={SPEED_MAX}
          step={1}
          value={speedDrag ?? sliderOf(speed)}
          style={{ ["--fill" as string]: `${((speedDrag ?? sliderOf(speed)) / SPEED_MAX) * 100}%`, height: 14, flex: 1 }}
          onChange={(e) => setSpeedSlider(Number(e.target.value))}
        />
        <SpeedField ratio={ratio} normal={normal} />
      </div>
      <button
        className={`g-btn icon ${speed === fast ? "active" : "ghost"}`}
        title={speed === fast ? "Set default Normal simulation speed (space key)" : "Set default Fast simulation speed (space key)"}
        onClick={() => void cmd("sim.fastToggle")}
      >
        <Icon.FastForward />
      </button>
      <button className={`g-btn icon ${ws.collisionsActive ? "active" : "ghost"}`} title={`Check Collisions (${prettyKeys("Shift+C")})`} onClick={() => void cmd("collision.setActive")}>
        <Icon.Collision />
      </button>
    </div>
  );
}
