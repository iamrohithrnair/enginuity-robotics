"use client";
// Selects inspector panels for station items and quick-add actions.

import { useMemo } from "react";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import { instructionTreeLabel } from "@/engine/naming";
import type { Item, Workspace } from "@/engine/types";
import { Icon, InstructionIcon, ItemIcon } from "../icons";
import { Section } from "./fields";
import InstructionPanel from "./InstructionPanel";
import { FramePanel, NameField, NotesPanel, ObjectPanel, TargetPanel } from "./ItemPanels";
import MachiningPanel from "./MachiningPanel";
import ProgramPanel from "./ProgramPanel";
import RobotPanel from "./RobotPanel";

 
function panelTitle(ws: Workspace, it: Item): string {
  switch (it.type) {
    case "frame":
      return `Frame Details: ${it.name}`;
    case "robot":
      return `${it.name} panel`;
    case "instruction":
      return instructionTreeLabel(ws, it);
    case "notes":
      return `Notes: ${it.name}`;
    default:
      return it.name || "(no name)";
  }
}

function StationPanel({ ws }: { ws: Workspace }) {
  const st = ws.activeStation ? ws.items[ws.activeStation] : undefined;
  const robots = useMemo(() => Object.values(ws.items).filter((i) => i.type === "robot"), [ws]);
  return (
    <div>
      <div style={{ font: "650 15px var(--font-ui)", marginBottom: 4 }}>{st?.name}</div>
      <div style={{ color: "var(--ink-2)", marginBottom: 16, lineHeight: 1.5 }}>Select an item in the tree or the 3D view to edit it.</div>
      {robots.length === 0 && (
        <div className="glass-inset" style={{ padding: 16, textAlign: "center", marginBottom: 14 }}>
          <div style={{ display: "grid", placeItems: "center", marginBottom: 8, color: "var(--accent)" }}>
            <Icon.Library size={28} />
          </div>
          <div style={{ font: "650 13px var(--font-ui)", marginBottom: 4 }}>Start with a robot</div>
          <div style={{ color: "var(--ink-2)", marginBottom: 12 }}>Browse 1,500+ robots from the online library.</div>
          <button className="g-btn primary" onClick={() => useRC.setState({ libraryOpen: true })}>
            Open Robot Library
          </button>
        </div>
      )}
      <Section title="Quick add">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button className="g-btn" onClick={() => void cmd("item.addFrame")}>
            <Icon.Frame size={14} /> Frame
          </button>
          <button className="g-btn" onClick={() => void cmd("program.add")}>
            <Icon.Program size={14} /> Program
          </button>
          <button className="g-btn" onClick={() => void cmd("object.addShape", { shape: "box", sizeX: 300, sizeY: 300, sizeZ: 200, xyzrpw: [500, 0, 0, 0, 0, 0] })}>
            <Icon.Object size={14} /> Box
          </button>
          <button className="g-btn" onClick={() => void cmd("object.addShape", { shape: "cylinder", radius: 120, height: 250, xyzrpw: [450, 300, 0, 0, 0, 0] })}>
            <Icon.Object size={14} /> Cylinder
          </button>
        </div>
      </Section>
    </div>
  );
}

function Body({ it }: { it: Item }) {
  switch (it.type) {
    case "robot":
      return <RobotPanel robot={it} />;
    case "frame":
      return <FramePanel it={it} />;
    case "target":
      return <TargetPanel it={it} />;
    case "tool":
    case "object":
      return <ObjectPanel it={it} />;
    case "program":
      return <ProgramPanel it={it} />;
    case "instruction":
      return <InstructionPanel it={it} />;
    case "notes":
      return <NotesPanel it={it} />;
    case "machining":
      return <MachiningPanel it={it} />;
    default:
      return <NameField it={it} />;
  }
}

 
export default function Inspector() {
  const ws = useRC((s) => s.ws);
  if (!ws) return null;
  const it = ws.selection.length === 1 ? ws.items[ws.selection[0]] : undefined;
  return (
    <aside
      className="glass liquid rc-enter"
      aria-label={it ? panelTitle(ws, it) : "Station"}
      style={{ position: "fixed", top: "calc(var(--topbar-bottom, 58px) + 12px)", right: 12, bottom: 96, width: 336, zIndex: 30, display: "flex", flexDirection: "column", animationDelay: "120ms" }}
    >
      {it && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 14px 0", minWidth: 0 }}>
          <span style={{ color: "var(--ink-1)", display: "inline-flex", flex: "none" }}>
            {it.type === "instruction" ? <InstructionIcon kind={it.instruction?.kind} moveType={it.instruction?.moveType} /> : <ItemIcon type={it.type} isJoint={it.target?.isJoint} />}
          </span>
          <span style={{ flex: 1, minWidth: 0, font: "650 12.5px var(--font-ui)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={panelTitle(ws, it)}>
            {panelTitle(ws, it)}
          </span>
          <span style={{ display: "flex", gap: 2, flex: "none" }}>
            {it.type !== "instruction" && (
              <button className="g-btn icon ghost" aria-label={it.visible ? "Hide (F7)" : "Show (F7)"} title={it.visible ? "Hide (F7)" : "Show (F7)"} onClick={() => void cmd("item.setVisible", { items: [it.id], visible: !it.visible })}>
                {it.visible ? <Icon.Eye size={14} /> : <Icon.EyeOff size={14} />}
              </button>
            )}
            <button className="g-btn icon ghost" aria-label="Delete" title="Delete" onClick={() => void cmd("item.delete", { items: [it.id] })}>
              <Icon.Trash size={14} />
            </button>
            <button className="g-btn icon ghost" aria-label="Close panel" title="Close (Alt+C)" onClick={() => useRC.setState({ rightPanel: "none" })}>
              <Icon.Close size={14} />
            </button>
          </span>
        </div>
      )}
      <div className="g-scroll" style={{ flex: 1, padding: 14 }}>
        {it ? <Body key={it.id} it={it} /> : <StationPanel ws={ws} />}
      </div>
    </aside>
  );
}
