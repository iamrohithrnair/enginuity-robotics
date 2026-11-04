"use client";

 
 
 
 
 
 
 

import { cmd, cmdx, selectNow, setStatus } from "@/client/api";
import { pickItem, revealInTree, runProgramUI } from "@/client/interaction";
import {
  askText,
  copyText,
  displayPythonPaths,
  offsetTargetsUI,
  openConfigs,
  openEventInsert,
  openInstructionEditor,
  openPythonEditor,
  savePythonAll,
  savePythonAs,
  toolShiftUI,
  useProgramUi,
} from "@/client/programUi";
import { runAction } from "@/client/uiActions";
import { useRC } from "@/client/store";
import type { InstructionData, Item, Workspace } from "@/engine/types";
import type { MenuEntry } from "../glass/Menu";
import { Icon } from "../icons";

const SEP: MenuEntry = { separator: true };

 
export interface MenuKit {
  tail(it: Item, sel: string[], from3D: boolean): MenuEntry[];
  visibleEntry(ws: Workspace, sel: string[]): MenuEntry;
  reframe(ids: string[]): MenuEntry;
  robotsSubmenu(ws: Workspace, current: string | null | undefined, onPick: (id: string | null) => void): MenuEntry[];
  changeSupport(ws: Workspace, ids: string[]): MenuEntry;
  itemsOfType(ws: Workspace, type: Item["type"]): Item[];
  renameGroup(sel: string[], type: Item["type"]): MenuEntry;
}

 
async function run(name: string, params: Record<string, unknown>) {
  const r = await cmdx(name, params);
  if (!r.ok && r.error) setStatus(r.error.replace(/<[^>]+>/g, " "));
  return r;
}

const busy = (ws: Workspace, id: string) => !!ws.busy?.includes(id);

 

export function targetMenu(ws: Workspace, it: Item, sel: string[], from3D: boolean, k: MenuKit): MenuEntry[] {
  const t = it.target!;
  return [
    { label: "Move to Target", icon: <Icon.MoveJ />, onSelect: () => void run("robot.moveJ", { target: it.id, robot: t.robot ?? undefined }) },
    { label: "Go to Target", onSelect: () => void run("target.moveTo", { target: it.id }) },
    { label: "Teach Current Position", icon: <Icon.Teach />, onSelect: () => void run("target.update", { target: it.id }) },
    SEP,
    k.visibleEntry(ws, sel),
    { label: "Select", checked: ws.selection.includes(it.id), onSelect: () => void cmd("target.toggleSelect", { target: it.id }) },
    k.reframe(sel),
    SEP,
    { label: "Cartesian Target", checked: !t.isJoint, onSelect: () => void cmd("target.setJoint", { target: it.id, isJoint: false }) },
    { label: "Joint Target", checked: t.isJoint, onSelect: () => void cmd("target.setJoint", { target: it.id, isJoint: true }) },
    { label: "Robot Linked", submenu: k.robotsSubmenu(ws, t.robot, (r) => void cmd("target.setRobot", { target: it.id, robot: r })) },
    k.changeSupport(ws, [it.id]),
    { label: "Align Target Orientation", onSelect: () => void run("target.alignOrientation", { target: it.id }) },
    SEP,
    { label: "Options...", shortcut: "F3", onSelect: () => void selectNow([it.id]).then(() => useRC.setState({ rightPanel: "inspector" })) },
    { label: "Change Configuration", shortcut: "F4", onSelect: () => openConfigs(it.id) },
    ...k.tail(it, sel, from3D),
  ];
}

export function targetsMenu(ws: Workspace, sel: string[], k: MenuKit): MenuEntry[] {
  const progs = k.itemsOfType(ws, "program");
  return [
    k.visibleEntry(ws, sel),
    k.reframe(sel),
    SEP,
    { label: "Cartesian Target", onSelect: () => void Promise.all(sel.map((id) => cmd("target.setJoint", { target: id, isJoint: false }))) },
    { label: "Joint Target", onSelect: () => void Promise.all(sel.map((id) => cmd("target.setJoint", { target: id, isJoint: true }))) },
    { label: "Robot Linked", submenu: k.robotsSubmenu(ws, undefined, (r) => void Promise.all(sel.map((id) => cmd("target.setRobot", { target: id, robot: r })))) },
    k.changeSupport(ws, sel),
    SEP,
    { label: "Preview Targets", shortcut: "F5", onSelect: () => void run("target.preview", { targets: sel }) },
    { label: "Create Program", icon: <Icon.Program />, onSelect: () => void cmd("program.add", { targets: sel }) },
    ...(progs.length
      ? [
          {
            label: "Add to Program...",
            onSelect: () =>
              void pickItem("Select a program to add movement instructions...", progs).then((p) => p && Promise.all(sel.map((t) => cmd("program.addMoveJ", { program: p.id, target: t })))),
          },
        ]
      : []),
    SEP,
    k.renameGroup(sel, "target"),
    { label: "Delete Selection", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) },
  ];
}

 

 
const noDriver = (label: string, shortcut?: string): MenuEntry => ({ label, shortcut, disabled: true });

async function checkPath(id: string, collisions: boolean) {
  await run("program.check", { program: id, collisions });
}

export function programMenu(ws: Workspace, it: Item, sel: string[], from3D: boolean, k: MenuKit): MenuEntry[] {
  const p = it.program ?? {};
  const loop = it.params?.Loop === "1";
  return [
    { label: "Run", icon: <Icon.Play />, shortcut: "Ctrl+R", checked: busy(ws, it.id), onSelect: () => void runProgramUI(it.id) },
    noDriver("Run on Robot"),
    { label: "Loop", icon: <Icon.Loop />, checked: loop, onSelect: () => void cmd("program.setLoop", { program: it.id, loop: !loop }) },
    { label: "Show Instructions", checked: p.showInstructions !== false, onSelect: () => void cmd("program.setFlags", { programs: [it.id], showInstructions: p.showInstructions === false }) },
    { label: "Display Path", shortcut: "F7", checked: !!p.displayPath, onSelect: () => void cmd("program.setFlags", { programs: [it.id], displayPath: !p.displayPath }) },
    { label: "Locked", checked: !!p.locked, onSelect: () => void cmd("program.setFlags", { programs: [it.id], locked: !p.locked }) },
    SEP,
    { label: "Check Path", icon: <Icon.Check />, shortcut: "F5", onSelect: () => void checkPath(it.id, false) },
    { label: "Check Path and Collisions", shortcut: "Shift+F5", onSelect: () => void checkPath(it.id, true) },
    SEP,
    { label: "Recalculate Targets", disabled: !!p.locked || busy(ws, it.id), onSelect: () => void run("program.recalculateTargets", { program: it.id }) },
    SEP,
    {
      label: "Generate Robot Program as...",
      shortcut: "Shift+F6",
      onSelect: () => useProgramUi.getState().open({ kind: "generate-as", programs: [it.id] }),
    },
    { label: "Generate Robot Program", icon: <Icon.Code />, shortcut: "F6", onSelect: () => void run("program.generateMany", { programs: [it.id] }) },
    noDriver("Send Program to Robot", "Ctrl+F6"),
    noDriver("Start on Robot", "F8"),
    { label: "Select Post Processor", onSelect: () => it.program?.robot && void selectNow([it.program.robot]).then(() => useRC.setState({ rightPanel: "inspector" })) },
    SEP,
    { label: "Export Simulation...", onSelect: () => void selectNow([it.id]).then(() => runAction("actionExport_3D_Simulation")) },
    SEP,
    { label: "Robot", submenu: k.robotsSubmenu(ws, it.program?.robot, (r) => void run("program.setRobot", { program: it.id, robot: r })) },
    ...k.tail(it, sel, from3D),
  ];
}

export function programsMenu(ws: Workspace, sel: string[], k: MenuKit): MenuEntry[] {
  const first = ws.items[sel[0]]?.program ?? {};
  return [
    { label: "Make Main Program", icon: <Icon.Program />, onSelect: () => void run("program.makeMain", { programs: sel }) },
    noDriver("Run on Robot"),
    { label: "Show Instructions", checked: first.showInstructions !== false, onSelect: () => void cmd("program.setFlags", { programs: sel, showInstructions: first.showInstructions === false }) },
    { label: "Display path", checked: !!first.displayPath, onSelect: () => void cmd("program.setFlags", { programs: sel, displayPath: !first.displayPath }) },
    SEP,
    { label: "Generate Robot Programs", icon: <Icon.Code />, shortcut: "F6", onSelect: () => void run("program.generateMany", { programs: sel }) },
    noDriver("Send Programs to Robot", "Ctrl+F6"),
    SEP,
    { label: "Robot", submenu: k.robotsSubmenu(ws, undefined, (r) => void Promise.all(sel.map((id) => run("program.setRobot", { program: id, robot: r })))) },
    SEP,
    k.renameGroup(sel, "program"),
    { label: "Delete Programs", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) },
  ];
}

 

export function pythonMenu(ws: Workspace, it: Item, sel: string[], from3D: boolean, k: MenuKit): MenuEntry[] {
  const running = busy(ws, it.id);
   
   
  const runMode = (mode: string) => () => void run("python.runMode", { item: it.id, mode });
  const pathShown = !!useRC.getState().trace[`python:${it.id}`];
  return [
     
    running
      ? { label: "Stop Python Script", icon: <Icon.Stop />, onSelect: () => void run("python.stop", { item: it.id }) }
      : { label: "Run Python Script", icon: <Icon.Play />, onSelect: () => void run("python.run", { item: it.id }) },
    { label: "Edit Python Script", shortcut: "F3", onSelect: () => openPythonEditor(it.id) },
    SEP,
    { label: "Display Path", shortcut: "F7", checked: pathShown, onSelect: () => void run("python.runMode", { item: it.id, mode: "path", show: !pathShown }) },
    SEP,
    { label: "Quick Program Check", icon: <Icon.Check />, onSelect: runMode("check") },
    { label: "Generate Robot Program", icon: <Icon.Code />, shortcut: "F6", onSelect: runMode("generate") },
    SEP,
    noDriver("Run on Robot"),
    { label: "Upload to Robot", icon: <Icon.Code />, onSelect: runMode("upload") },
    SEP,
    { label: "Save as *.py file...", onSelect: () => void savePythonAs(it.id) },
    ...k.tail(it, sel, from3D),
  ];
}

export function pythonsMenu(ws: Workspace, sel: string[]): MenuEntry[] {
  const trace = useRC.getState().trace;
  const shown = sel.some((id) => !!trace[`python:${id}`]);
  return [
    { label: "Save All as *.py", icon: <Icon.Save />, onSelect: () => void savePythonAll(sel) },
    { label: "Display Path", shortcut: "F7", checked: shown, onSelect: () => void displayPythonPaths(sel, !shown) },
    SEP,
    { label: "Delete", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) },
  ];
}

 

function robotAt(ws: Workspace, prog: Item, index: number): Item | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const ins = ws.items[prog.children[i]]?.instruction;
    if (ins?.kind === "robot" && ins.robot && ws.items[ins.robot]?.robot) return ws.items[ins.robot];
  }
  const r = prog.program?.robot ? ws.items[prog.program.robot] : undefined;
  return r?.robot ? r : undefined;
}

 
const TARGET_SUBMENU_MAX = 25;

function targetLinked(ws: Workspace, it: Item, label: string, key: "target" | "target2", prompt: string): MenuEntry {
  const targets = Object.values(ws.items).filter((i) => i.type === "target");
  const current = it.instruction?.[key];
  const relink = (id: string) => void run("instruction.edit", { instruction: it.id, [key]: id });
  if (targets.length > TARGET_SUBMENU_MAX)
    return { label: `${label}...`, icon: <Icon.Target />, onSelect: () => void pickItem(prompt.replace("%1", it.name), targets).then((t) => t && relink(t.id)) };
  return { label, icon: <Icon.Target />, submenu: targets.map((t) => ({ label: t.name || "(no name)", checked: current === t.id, onSelect: () => relink(t.id) })) };
}

const execute = (it: Item, disabled = false): MenuEntry => ({ label: "Execute Instruction", icon: <Icon.Play />, disabled, onSelect: () => void run("program.executeInstruction", { instruction: it.id }) });

function startFromHere(ws: Workspace, it: Item, prog: Item): MenuEntry {
  return {
    label: "Start from Here",
    disabled: busy(ws, prog.id),
    onSelect: () => void run("program.run", { program: prog.id, startAt: prog.children.indexOf(it.id) }),
  };
}

const del = (sel: string[]): MenuEntry => ({ label: "Delete", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) });
const modify = (it: Item, label = "Modify"): MenuEntry => ({ label, onSelect: () => openInstructionEditor(it.id) });

function linkMenu(ws: Workspace, it: Item, ins: InstructionData, what: "frame" | "tool"): MenuEntry[] {
  const word = what === "frame" ? "Reference" : "Tool";
  const linked = ins[what] && ws.items[ins[what]!] ? ws.items[ins[what]!] : undefined;
  const candidates = Object.values(ws.items).filter((i) => i.type === what);
  return [
    { label: `Select ${word}`, disabled: !linked, onSelect: () => void cmd("instruction.selectLinked", { instructions: [it.id] }) },
    { label: `Remove ${word} Link`, disabled: !linked, onSelect: () => void run("instruction.setLink", { instruction: it.id, item: null }) },
    {
      label: `Set ${word} Link`,
      onSelect: () =>
        void pickItem(what === "frame" ? `Select a reference frame for ${it.name}` : `Select a tool for ${it.name}`, candidates).then((x) => x && run("instruction.setLink", { instruction: it.id, item: x.id })),
    },
    { label: "Force Original Pose", checked: !!ins.forcePose, onSelect: () => void run("instruction.forceOriginalPose", { instruction: it.id, force: !ins.forcePose }) },
    {
      label: `Copy ${word} Pose`,
      icon: <Icon.Copy />,
      onSelect: () => void cmd<{ clipboardText: string }>("instruction.copyPose", { instruction: it.id }).then((r) => r && copyText(r.clipboardText)),
    },
  ];
}

export function instructionMenu(ws: Workspace, it: Item, sel: string[]): MenuEntry[] {
  const ins = it.instruction!;
  const prog = it.parent ? ws.items[it.parent] : undefined;
  if (!prog) return [del(sel)];
  const index = prog.children.indexOf(it.id);
  switch (ins.kind) {
    case "move": {
      const target = ins.target ? ws.items[ins.target] : undefined;
      const robot = robotAt(ws, prog, index);
      const canRun = !!robot && !!(ins.target ? target : ins.joints?.length || ins.pose);
      return [
        execute(it, !canRun),
        startFromHere(ws, it, prog),
        { label: "Select Target", icon: <Icon.Target />, disabled: !target, onSelect: () => void cmd("instruction.selectLinked", { instructions: [it.id] }) },
        ...(target?.visible ? [{ label: "Hide Target Object", onSelect: () => void cmd("instruction.hideTargets", { instructions: [it.id] }) }] : []),
        { label: "Teach Current Position", onSelect: () => void run("instruction.teachCurrentPosition", { instruction: it.id }) },
        SEP,
        { label: "Target Options...", disabled: !target, onSelect: () => target && void selectNow([target.id]).then(() => useRC.setState({ rightPanel: "inspector" })) },
        SEP,
        { label: "Joint Move", icon: <Icon.MoveJ />, checked: ins.moveType !== "linear" && ins.moveType !== "search", onSelect: () => void run("instruction.setMoveType", { instructions: [it.id], moveType: "joint" }) },
        { label: "Linear Move", icon: <Icon.MoveL />, checked: ins.moveType === "linear", onSelect: () => void run("instruction.setMoveType", { instructions: [it.id], moveType: "linear" }) },
        { label: "Search Linear", icon: <Icon.MoveL />, checked: ins.moveType === "search", onSelect: () => void run("instruction.setMoveType", { instructions: [it.id], moveType: "search" }) },
        ...(ins.moveType === "search" ? [{ label: "Show Contact Point", onSelect: () => void run("instruction.showContactPoint", { instruction: it.id }) }] : []),
        SEP,
        targetLinked(ws, it, "Target Linked", "target", "Select a target for %1"),
        SEP,
        del(sel),
      ];
    }
    case "movec":
      return [
        execute(it, !robotAt(ws, prog, index) || !ins.target || !ins.target2 || !ws.items[ins.target] || !ws.items[ins.target2]),
        startFromHere(ws, it, prog),
        { label: "Select Targets", icon: <Icon.Target />, onSelect: () => void cmd("instruction.selectLinked", { instructions: [it.id] }) },
        { label: "Hide Target Objects", onSelect: () => void cmd("instruction.hideTargets", { instructions: [it.id] }) },
        { label: "Options...", onSelect: () => ins.target && void selectNow([ins.target]).then(() => useRC.setState({ rightPanel: "inspector" })) },
        SEP,
        targetLinked(ws, it, "Target Linked 1", "target", "Select the first target for %1"),
        targetLinked(ws, it, "Target Linked 2", "target2", "Select the second target for %1"),
        SEP,
        del(sel),
      ];
    case "frame":
    case "tool":
      return [execute(it), startFromHere(ws, it, prog), SEP, ...linkMenu(ws, it, ins, ins.kind), SEP, del(sel)];
    case "speed":
    case "rounding":
      return [modify(it, "Edit"), execute(it), startFromHere(ws, it, prog), SEP, del(sel)];
    case "pause":
      return [execute(it), { label: "Skip Wait", onSelect: () => void cmd("program.skipWait", { instruction: it.id }) }, modify(it), SEP, del(sel)];
    case "event":
      return [
        execute(it),
        { label: "Skip Wait", onSelect: () => void cmd("program.skipWait", { instruction: it.id }) },
        modify(it),
        SEP,
        del(sel),
        SEP,
        { label: "Record all Objects", icon: <Icon.Save />, onSelect: () => void run("event.recordAllObjects", { instruction: it.id }) },
      ];
    case "code": {
      const callee = (ins.codeType === 0 || ins.codeType === 2) && Object.values(ws.items).find((i) => (i.type === "program" || i.type === "python") && i.name === ins.text);
      return [
        execute(it),
        startFromHere(ws, it, prog),
        modify(it),
        { label: "Reveal in the tree", disabled: !callee, onSelect: () => callee && void selectNow([callee.id]).then(() => revealInTree()) },
        SEP,
        del(sel),
      ];
    }
    case "print":
      return [execute(it), modify(it), SEP, del(sel)];
    case "io":
      return [
        execute(it),
        ...(ins.io?.mode === "wait" ? [{ label: "Skip DI Wait", onSelect: () => void cmd("program.skipWait", { instruction: it.id }) }] : []),
        modify(it),
        SEP,
        del(sel),
      ];
    case "custom": {
      const blocking = it.params?.Blocking !== "0";
      const edit = (key: "name" | "path" | "icon" | "robotCommand", title: string, value: string) =>
        void askText(title, title, value).then((v) => {
          if (v !== null) void run("instruction.setCustom", { instruction: it.id, [key]: v });
        });
      return [
        { label: "Execute Instruction", icon: <Icon.Play />, onSelect: () => void run("instruction.runCustom", { instruction: it.id }) },
        { label: "Stop Instruction", icon: <Icon.Stop />, onSelect: () => void run("instruction.runCustom", { instruction: it.id, stop: true }) },
        startFromHere(ws, it, prog),
        SEP,
        { label: "Set Name", onSelect: () => edit("name", "Enter instruction name", it.name) },
        { label: "Modify Path", onSelect: () => edit("path", "Enter executable file (relative or absolute)", it.params?.PathRunSim ?? "") },
        { label: "Modify Icon", onSelect: () => edit("icon", "Enter icon path (relative or absolute)", it.params?.PathIcon ?? "") },
        { label: "Blocking", checked: blocking, onSelect: () => void run("instruction.setCustom", { instruction: it.id, blocking: !blocking }) },
        { label: "Modify 'Run on Robot' Command", onSelect: () => edit("robotCommand", "Enter the 'Run on Robot' command", it.params?.PathRunRobot ?? "") },
        { label: "Edit instruction", onSelect: () => openInstructionEditor(it.id) },
        SEP,
        del(sel),
      ];
    }
    case "robot":
      return [
        execute(it),
        startFromHere(ws, it, prog),
        { label: "Select Robot", submenu: Object.values(ws.items).filter((i) => i.type === "robot").map((r) => ({ label: r.name, checked: ins.robot === r.id, onSelect: () => void run("instruction.edit", { instruction: it.id, robot: r.id }) })) },
        SEP,
        del(sel),
      ];
    default:
      return [execute(it), startFromHere(ws, it, prog), modify(it), SEP, del(sel)];
  }
}

const SHIFTS = ["Tx", "Ty", "Tz", "Rx", "Ry", "Rz"] as const;

 
export function instructionsMenu(ws: Workspace, sel: string[]): MenuEntry[] {
  const first = ws.items[sel[0]]?.instruction;
  if (first?.kind === "code") {
    return [
      {
        label: "Modify",
        onSelect: () => {
          const codes = sel.filter((id) => ws.items[id]?.instruction?.kind === "code");
          const text = codes.map((id) => ws.items[id].instruction!.text ?? "").join("\n");
          void askText("Modify", "One line per selected instruction", text).then((v) => {
            if (v === null) return;
            const lines = v.split(/\n|\s*\|\s*/);
            void Promise.all(codes.map((id, i) => (lines[i] !== undefined ? run("instruction.edit", { instruction: id, text: lines[i] }) : null)));
          });
        },
      },
    ];
  }
  return [
    { label: "Offset Targets", icon: <Icon.Frame />, onSelect: () => void offsetTargetsUI(sel) },
    { label: "Relative Tool Shift", icon: <Icon.Tool />, submenu: SHIFTS.map((a) => ({ label: a, onSelect: () => void toolShiftUI(sel, a) })) },
    SEP,
    { label: "Select Targets", icon: <Icon.Target />, onSelect: () => void cmd("instruction.selectLinked", { instructions: sel }) },
    { label: "Hide Target Objects", onSelect: () => void cmd("instruction.hideTargets", { instructions: sel }) },
    SEP,
    { label: "Set Move Joint", icon: <Icon.MoveJ />, onSelect: () => void run("instruction.setMoveType", { instructions: sel, moveType: "joint" }) },
    { label: "Set Move Linear", icon: <Icon.MoveL />, onSelect: () => void run("instruction.setMoveType", { instructions: sel, moveType: "linear" }) },
    SEP,
    { label: "Set as Joint Targets", icon: <Icon.JointTarget />, onSelect: () => void run("instruction.setTargetType", { instructions: sel, joint: true }) },
    { label: "Set as Cartesian Targets", icon: <Icon.Target />, onSelect: () => void run("instruction.setTargetType", { instructions: sel, joint: false }) },
  ];
}

 
export const insertEventEntry = (program: string): MenuEntry => ({ label: "Simulation Event Instruction", icon: <Icon.Event />, onSelect: () => openEventInsert(program) });
