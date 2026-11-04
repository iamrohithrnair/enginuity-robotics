"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { prettyKeys } from "@/client/shortcuts";
import { useRC, useViewState } from "@/client/store";
import { runAction } from "@/client/uiActions";
import { findAction } from "@/engine/actions";
import { DropMenu } from "./glass/Menu";
import { Icon } from "./icons";
import "./contrib";
import { actionEntry, menuBar, TOOLBARS, toolbarsFor, type MenuState } from "./menuBar";
import { mainMenuEntries, withContributions } from "./menuContrib";
import PhysicsToggle from "./physics/PhysicsToggle";
import { TOOLBAR_HELP } from "./toolbarHelp";

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 4px" }}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="rc-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4f8cff" />
            <stop offset="0.55" stopColor="#2563eb" />
            <stop offset="1" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#rc-logo)" />
        <path d="M9 23h9M12.5 23v-3.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12.5" cy="18" r="2.2" fill="#fff" />
        <path d="m14 16.3 5-5.3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="20.3" cy="9.8" r="2.2" fill="#fff" />
        <path d="m22.3 10.6 2.7 1.8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span style={{ font: "700 14px var(--font-ui)", letterSpacing: "-0.02em" }}>
        Engin<span style={{ color: "var(--accent)" }}>uity</span>
      </span>
    </div>
  );
}

function menuBtn(label: string) {
  return function MenuTrigger(open: boolean) {
    return (
      <button className={`g-btn ghost ${open ? "active" : ""}`} style={{ height: 28, padding: "0 9px" }}>
        {label}
      </button>
    );
  };
}

const subscribeFullscreen = (cb: () => void) => {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
};

 
function useMenuState(): MenuState {
  const ws = useRC((s) => s.ws);
  const settings = useRC((s) => s.settings);
  const undo = useRC((s) => s.undo);
  const hold = useRC((s) => s.moveMode);
  const view = useViewState();
  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => !!document.fullscreenElement, () => false);
  return { ws, settings, undo, hold, view, fullscreen };
}

 
function ToolButton({ name, state }: { name: string; state: MenuState }) {
  const a = findAction(name);
  const e = actionEntry(name, state);
  if (!a) return null;
  const help = TOOLBAR_HELP[name];
  return (
    <span className="rc-tip-host">
      <button className={`g-btn icon ghost ${e.checked ? "active" : ""}`} aria-label={a.text} aria-description={help} aria-pressed={e.checked} disabled={e.disabled} onClick={() => void runAction(name)}>
        {e.icon ?? <span style={{ font: "600 10px var(--font-ui)" }}>{a.text.slice(0, 3)}</span>}
      </button>
      <span className="rc-tip" role="tooltip">
        <b>{e.label ?? a.text}</b>
        {e.shortcut && <span className="rc-tip-key">{prettyKeys(e.shortcut)}</span>}
        {help && <span className="rc-tip-help">{help}</span>}
      </span>
    </span>
  );
}

 
function ToolbarStrip({ state }: { state: MenuState }) {
  const groups = toolbarsFor(state.view.toolbar)
    .map((t) => ({ t, names: TOOLBARS[t] ?? [] }))
    .filter((g) => g.names.length);
  if (!groups.length) return null;
  return (
    <div role="toolbar" aria-label="Toolbars" style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", justifyContent: "center", padding: "2px 8px 6px" }}>
      {groups.map((g, i) => (
        <div key={g.t} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {i > 0 && <div style={{ width: 1, height: 20, background: "var(--hair)", margin: "0 5px" }} />}
          {g.names.map((n) => (
            <ToolButton key={n} name={n} state={state} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function TopBar() {
  const state = useMenuState();
  const connected = useRC((s) => s.connected);
  const rightPanel = useRC((s) => s.rightPanel);
  const set = useRC((s) => s.set);
  const closeUp = state.settings.RC_EE_VIEW === true;
   
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--topbar-bottom", `${Math.ceil(el.getBoundingClientRect().bottom)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, []);

  return (
    <header
      ref={bar}
      className="glass liquid rc-enter"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        translate: "-50% 0",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        borderRadius: 24,
        maxWidth: "calc(100vw - 24px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: 46, padding: "0 8px" }}>
        <Logo />
        <div style={{ width: 1, height: 22, background: "var(--hair)", margin: "0 4px" }} />
        { }
        {menuBar(state).map((m) => (
          <DropMenu key={m.name} trigger={menuBtn(m.name)} entries={withContributions(m.entries, mainMenuEntries(m.name))} />
        ))}
        <div style={{ width: 1, height: 22, background: "var(--hair)", margin: "0 4px" }} />
        <button className="g-btn primary" onClick={() => void runAction("actionOpen_weblib")} title={`Open Robot Library (${prettyKeys("Ctrl+Shift+O")})`}>
          <Icon.Library /> Library
        </button>
        <button className="g-btn ghost" onClick={() => set({ paletteOpen: true })} style={{ justifyContent: "flex-start", color: "var(--ink-2)" }} title="Command palette">
          <Icon.Search /> <span className="g-kbd">{prettyKeys("Ctrl+K")}</span>
        </button>
        <button
          className={`g-btn icon ghost ${closeUp ? "active" : ""}`}
          aria-pressed={closeUp}
          aria-label="End effector close-up"
          title={closeUp ? "Hide the end-effector close-up" : "Show the end-effector close-up (follows the robot's tool)"}
          onClick={() => void runAction("rc.endEffectorView")}
        >
          <Icon.CloseUp />
        </button>
        <PhysicsToggle />
        <button className={`g-btn ${rightPanel === "chat" ? "active" : ""}`} onClick={() => set({ rightPanel: rightPanel === "chat" ? "inspector" : "chat" })} title="Enginuity Copilot">
          <Icon.Sparkle /> Copilot
        </button>
        <button className="g-btn icon ghost" onClick={() => void runAction("action-Options")} title={`Options (${prettyKeys("Shift+O")})`} aria-label="Options">
          <Icon.Settings />
        </button>
        <span title={connected ? "Connected" : "Reconnecting…"} style={{ width: 8, height: 8, borderRadius: 8, margin: "0 8px 0 4px", background: connected ? "var(--good)" : "var(--warn)" }} />
      </div>
      <ToolbarStrip state={state} />
    </header>
  );
}
