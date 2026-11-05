// Builds display labels and unique names for station items and instructions.
 
 
 

import type { InstructionData, Item, ItemType, Workspace } from "./types";
import { decisionInstructionName } from "./decisions";
import { descendants } from "./workspace";






export const fixed1 = (v: number) => v.toFixed(1);

 
export const roundHalfAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

 
function g(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

 
export function ioDisplayName(name: string, analog = false): string {
  return /^\d+$/.test(name) ? `${analog ? "AO_" : "IO_"}${name}` : name;
}

 
export function pauseName(ms: number): string {
  if (ms < 0) return "Stop";
  if (ms < 1000) return `Pause ${roundHalfAway(ms)} ms`;
  return `Pause ${fixed1(ms / 1000)} s`;
}

 
export function speedName(s: InstructionData["speed"]): string {
  if (!s) return "Change speed (unset)";
  if (s.linear >= 0) return `Set speed (${fixed1(s.linear)} mm/s)`;
  if (s.linearAccel >= 0) return `Set accel. (${fixed1(s.linearAccel)} mm/s2)`;
  if (s.joint >= 0) return `Set speed (${fixed1(s.joint)} deg/s)`;
  if (s.jointAccel >= 0) return `Set accel. (${fixed1(s.jointAccel)} deg/s2)`;
  return "Change speed (unset)";
}

 
export function roundingName(r: number | undefined): string {
  const v = r ?? -1;
  return v < 0 ? "Accurate" : `Smooth(${roundHalfAway(v)})`;
}

export function ioName(io: InstructionData["io"]): string {
  if (!io) return "Set IO";
  const n = ioDisplayName(io.name, io.analog);
  if (io.mode === "set") return `Set ${n}=${io.value}`;
  const t = io.timeoutMs ?? -1;
  const suffix = t <= 0 ? "" : t < 1000 ? ` T${g(Math.trunc(t))}ms` : ` T${fixed1(t / 1000)}s`;
  return `Wait ${n}=${io.value}${suffix}`;
}






export function instructionName(ws: Workspace, ins: InstructionData): string {
  const nameOf = (id?: string | null) => (id && ws.items[id] ? ws.items[id].name : "");
  switch (ins.kind) {
    case "move": {
      const verb = ins.moveType === "linear" ? "MoveL" : ins.moveType === "search" ? "SearchL" : "MoveJ";
      if (!ins.target && ins.index !== undefined) return `${verb} ${ins.index}`;
      return `${verb} (${nameOf(ins.target)})`;
    }
    case "movec":
      return `MoveC (${nameOf(ins.target)}, ${nameOf(ins.target2)})`;
    case "speed":
      return speedName(ins.speed);
    case "rounding":
      return roundingName(ins.rounding);
    case "frame":
      return ins.frame && ws.items[ins.frame] ? `Set Ref.: ${nameOf(ins.frame)}` : "Change Frame";
    case "tool":
      return ins.tool && ws.items[ins.tool] ? `Set Tool: ${nameOf(ins.tool)}` : "Set Tool";
    case "robot":
      return `Select Robot: ${nameOf(ins.robot)}`;
    case "pause":
      return pauseName(ins.pauseMs ?? -1);
    case "print":
    case "code":
      return ins.text ?? "";
    case "io":
      return ioName(ins.io);
    case "event":
      return eventName(ws, ins.event);
    case "custom":
      return ins.text ?? "";
    case "decision":
      return decisionInstructionName(ins.decision);
  }
}

 
export function eventName(ws: Workspace, e: InstructionData["event"]): string {
  if (!e) return "Not defined";
  const nameOf = (id?: string | null) => (id && ws.items[id] ? ws.items[id].name : "");
  const objs = e.objects ?? (e.object ? [e.object] : []);
   
  if (objs.length === 1 && !ws.items[objs[0]] && e.action !== "attach" && e.action !== "detach" && e.action !== "detach-all") return "Not defined";
  const one = objs.length === 1 ? nameOf(objs[0]) : null;
  switch (e.action) {
    case "attach":
      return e.tool && ws.items[e.tool] ? `Attach to ${nameOf(e.tool)}` : "Not defined";
    case "detach":
    case "detach-all":
      return e.tool && ws.items[e.tool] ? `Detach from ${nameOf(e.tool)}` : "Not defined";
    case "show":
      return one !== null ? `Show ${one}` : "Show objects";
    case "hide":
      return one !== null ? `Hide ${one}` : "Hide objects";
    case "move":
      return one !== null ? `Move ${one}` : "Move objects";
    case "home":
      return one !== null ? `Home ${one}` : "Home mechanisms";
     
    case "conveyor":
      return one !== null ? `Move ${one}` : objs.length ? "Move conveyors" : "Not defined";
    case "create":
      return one !== null ? `Create ${one}` : objs.length ? "Create objects" : "Not defined";
    case "remove":
      return one !== null ? `Remove all ${one}` : objs.length ? "Remove objects" : "Not defined";
    case "wait": {
       
      const prefix = ["Wait", "Wait & Remove", "Wait & Move", "Wait & Stop"][e.option ?? 0] ?? "";
      return one !== null ? `${prefix}-${one}` : objs.length ? prefix : "Not defined";
    }
    default:
      return "Unknown/future action";
  }
}

 
export function instructionTreeLabel(ws: Workspace, item: Item): string {
  const ins = item.instruction;
  if (!ins) return item.name;
  if (ins.kind === "print") return `Print: ${item.name}`;
  if (ins.kind === "code" && ins.codeType === 0) return `Call ${item.name}`;
  if (ins.kind === "code" && ins.codeType === 2) return `Run ${item.name}`;
  return item.name;
}

 
export function countIn(ws: Workspace, rootId: string, types: ItemType[]): number {
  let n = 0;
  for (const it of descendants(ws, rootId)) if (types.includes(it.type)) n += 1;
  return n;
}








export function autoName(ws: Workspace, stationId: string, type: ItemType): string {
  switch (type) {
    case "frame":
      return `Frame ${countIn(ws, stationId, ["frame"]) + 1}`;
    case "program":
    case "python":
      return `Prog${countIn(ws, stationId, ["program", "python"]) + 1}`;
    case "folder":
      return `Folder ${countIn(ws, stationId, ["folder"]) + 1}`;
    case "notes":
      return `Note ${countIn(ws, stationId, ["notes"]) + 1}`;
    case "tool":
      return `Tool ${countIn(ws, stationId, ["tool"]) + 1}`;
    case "target":
      return `Target ${countIn(ws, stationId, ["target"]) + 1}`;
    case "curve":
      return `Curve ${countIn(ws, stationId, ["curve"]) + 1}`;
    case "object":
      return `Object ${countIn(ws, stationId, ["object"]) + 1}`;
    default:
      return type;
  }
}

 
export function autoTargetName(ws: Workspace, parentId: string): string {
  return `Target ${countIn(ws, parentId, ["target"]) + 1}`;
}

 
export function newStationName(ws: Workspace): string {
  return `New Station (${ws.stations.length + 1})`;
}
