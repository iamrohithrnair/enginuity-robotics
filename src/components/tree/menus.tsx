"use client";
// Builds station-item context menus for editing, display, and hierarchy actions.

 
 
 
 

import { cmd, cmdx, selectNow } from "@/client/api";
import { activateItem, renameUI, revealInTree } from "@/client/interaction";
import { pushView, useRC } from "@/client/store";
import type { Item, Workspace } from "@/engine/types";
import { stationIdOf } from "@/engine/treeRules";
import type { MenuEntry } from "../glass/Menu";
import { Icon } from "../icons";
import "../contrib";
import { itemMenuEntries, withContributions } from "../menuContrib";
import { instructionMenu, instructionsMenu, programMenu, programsMenu, pythonMenu, pythonsMenu, targetMenu, targetsMenu, type MenuKit } from "./menus-program";
import {
  addToolFromFileUI,
  closeStationUI,
  openFilesUI,
  reorderUI,
  replaceRobotUI,
  robotConfigurationsUI,
  saveItemsAsUI,
  saveStationAsUI,
  saveStationUI,
  stationParamsUI,
} from "@/client/fileActions";
import { currentRobot } from "@/engine/workspace";
import { isDisplayed, type DisplayWhat } from "@/engine/display";

const SEP: MenuEntry = { separator: true };

function itemsOfType(ws: Workspace, type: Item["type"]) {
  const st = ws.activeStation;
  return Object.values(ws.items).filter((i) => i.type === type && stationIdOf(ws, i.id) === st);
}

async function copyToClipboard(ids: string[], cut: boolean) {
  const r = await cmd<{ clipboardText: string | null }>(cut ? "edit.cut" : "edit.copy", { items: ids });
  if (r?.clipboardText) await navigator.clipboard?.writeText(r.clipboardText).catch(() => undefined);
}

async function pasteInto(parent: string) {
  let text: string | undefined;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = undefined;
  }
  const r = await cmdx("edit.paste", text ? { parent, text } : { parent });
  if (!r.ok) useRC.getState().toast({ kind: "error", title: "Paste", body: r.error ?? "" });
}

 
function tail(it: Item, sel: string[], from3D: boolean): MenuEntry[] {
  const noRename = it.type === "robot";
  const noReorder = it.type === "robot" || it.type === "instruction";
  const noClipboard = it.type === "program";
  const out: MenuEntry[] = [SEP];
  if (!noRename) out.push({ label: "Rename", shortcut: "F2", onSelect: () => useRC.setState({ renameFor: it.id }) });
  if (!noReorder)
    out.push({
      label: "Reorder",
      submenu: [
        { label: "Move to the Top", onSelect: () => void cmd("item.reorder", { items: sel, to: "top" }) },
        { label: "Move to the Bottom", onSelect: () => void cmd("item.reorder", { items: sel, to: "bottom" }) },
        { label: "Specify...", onSelect: () => reorderUI(sel) },
        { label: "Reorder automatically", onSelect: () => void cmd("item.reorderAuto", { items: sel }) },
      ],
    });
  if (from3D) out.push({ label: "Reveal in the tree", shortcut: "F8", onSelect: () => revealInTree() });
  if (!noClipboard) {
    out.push(SEP);
    out.push({ label: "Cut", shortcut: "Ctrl+X", onSelect: () => void copyToClipboard(sel, true) });
    out.push({ label: "Copy", icon: <Icon.Copy />, shortcut: "Ctrl+C", onSelect: () => void copyToClipboard(sel, false) });
    out.push({ label: "Paste", shortcut: "Ctrl+V", onSelect: () => void pasteInto(it.id) });
  }
  out.push(SEP, { label: "Delete", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) });
  return out;
}

 
function changeSupport(ws: Workspace, ids: string[]): MenuEntry {
  const frames = itemsOfType(ws, "frame").filter((f) => !ids.includes(f.id));
  return {
    label: "Change Support (Shift+drag)",
    submenu: frames.map((f) => ({
      label: f.name || "(no name)",
      icon: <Icon.Frame />,
      checked: ids.length === 1 && ws.items[ids[0]]?.parent === f.id,
      onSelect: () => void Promise.all(ids.map((id) => cmd("item.setParent", { item: id, parent: f.id, keepAbsolute: true }))),
    })),
  };
}

function visibleEntry(ws: Workspace, sel: string[]): MenuEntry {
  const all = sel.every((id) => ws.items[id]?.visible);
  return { label: "Visible", shortcut: "F7", checked: all, onSelect: () => void cmd("item.setVisible", { items: sel, visible: !all }) };
}

 
function displayEntry(ws: Workspace, it: Item, what: DisplayWhat, label: string): MenuEntry {
  const on = isDisplayed(ws, it, what, useRC.getState().settings);
  return { label, checked: on, onSelect: () => void cmd("item.setDisplay", { items: [it.id], what, visible: !on }) };
}

function multiDisplayEntry(ws: Workspace, items: Item[], what: DisplayWhat, label: string): MenuEntry {
  const on = items.every((i) => isDisplayed(ws, i, what, useRC.getState().settings));
  return { label, checked: on, onSelect: () => void cmd("item.setDisplay", { items: items.map((i) => i.id), what, visible: !on }) };
}

 
function robotTail(sel: string[], from3D: boolean): MenuEntry[] {
  const out: MenuEntry[] = [SEP];
  if (from3D) out.push({ label: "Reveal in the tree", shortcut: "F8", onSelect: () => revealInTree() });
  out.push(
    { label: "Cut", shortcut: "Ctrl+X", onSelect: () => void copyToClipboard(sel, true) },
    { label: "Copy", icon: <Icon.Copy />, shortcut: "Ctrl+C", onSelect: () => void copyToClipboard(sel, false) },
  );
  return out;
}

const reframe = (ids: string[]): MenuEntry => ({ label: "Reframe On", icon: <Icon.Fit />, shortcut: "Alt+0", onSelect: () => pushView({ action: "fit", items: ids }) });

function robotsSubmenu(ws: Workspace, current: string | null | undefined, onPick: (id: string | null) => void): MenuEntry[] {
  return [
    ...itemsOfType(ws, "robot").map((r) => ({ label: r.name, icon: <Icon.Robot />, checked: current === r.id, onSelect: () => onPick(r.id) })),
    SEP,
    { label: "None", icon: <Icon.Close />, checked: !current, onSelect: () => onPick(null) },
  ];
}

 
function menuKit(): MenuKit {
  return {
    tail,
    visibleEntry,
    reframe,
    robotsSubmenu,
    changeSupport,
    itemsOfType,
    renameGroup: (sel, type) => ({
      label: "Rename Group",
      onSelect: () => {
        const ws = useRC.getState().ws;
        const base = { frame: "Frame", target: "Target", program: "Prog", object: "Object", tool: "Tool" }[type as string] ?? (ws?.items[sel[0]]?.name ?? "");
        const what = { frame: "references", target: "targets", program: "programs" }[type as string] ?? "objects";
        useRC.setState({ groupRename: { ids: sel, label: `Rename group of ${what}`, base } });
      },
    }),
  };
}

 
export function itemMenu(ws: Workspace, clicked: string, opts: { from3D?: boolean } = {}): MenuEntry[] {
  const it = ws.items[clicked];
  if (!it) return [];
  const sel = ws.selection.includes(clicked) ? ws.selection.filter((s) => ws.items[s]) : [clicked];
  return withContributions(baseItemMenu(ws, clicked, opts), itemMenuEntries(ws, it, sel, { from3D: !!opts.from3D }));
}

function baseItemMenu(ws: Workspace, clicked: string, opts: { from3D?: boolean } = {}): MenuEntry[] {
  const it = ws.items[clicked];
  if (!it) return [];
  const sel = ws.selection.includes(clicked) ? ws.selection.filter((s) => ws.items[s]) : [clicked];
  const from3D = !!opts.from3D;

   
  const st = stationIdOf(ws, clicked);
  if (st && st !== ws.activeStation) {
    return [
      { label: "Activate station", icon: <Icon.Station />, onSelect: () => void cmd("station.setActive", { station: st }) },
      { label: "Close station", icon: <Icon.Close />, onSelect: () => void cmd("station.close", { station: st }) },
    ];
  }

  if (sel.length > 1) {
    const types = new Set(sel.map((id) => ws.items[id].type));
    if (types.size > 1) return [visibleEntry(ws, sel), SEP, { label: "Delete Selection", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) }];
    const type = [...types][0];
    const renameGroup: MenuEntry = {
      label: "Rename Group",
      onSelect: () => {
        const base = { frame: "Frame", target: "Target", program: "Prog", object: "Object", tool: "Tool" }[type as string] ?? ws.items[sel[0]].name;
        const what = { frame: "references", target: "targets", program: "programs" }[type as string] ?? "objects";
        useRC.setState({ groupRename: { ids: sel, label: `Rename group of ${what}`, base } });
      },
    };
    const del: MenuEntry = { label: type === "program" ? "Delete Programs" : "Delete Selection", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) };
    const kit = menuKit();
    if (type === "target") return targetsMenu(ws, sel, kit);
    if (type === "program") return programsMenu(ws, sel, kit);
    if (type === "instruction") return instructionsMenu(ws, sel);
    if (type === "python") return pythonsMenu(ws, sel);
    if (type === "frame") return [visibleEntry(ws, sel), SEP, changeSupport(ws, sel), SEP, renameGroup, del];
    if (type === "tool" || type === "object") {
      const items = sel.map((id) => ws.items[id]);
      const allLocked = items.every((i) => i.locked);
      return [
        visibleEntry(ws, sel),
        multiDisplayEntry(ws, items, "tcp", "Visible TCP"),
        multiDisplayEntry(ws, items, "reference", "Visible Object Reference"),
        { label: "Lock", checked: allLocked, onSelect: () => void cmd("item.lock", { items: sel, locked: !allLocked }) },
        renameGroup,
        { label: "Merge", onSelect: () => void cmd("object.merge", { items: sel }) },
        changeSupport(ws, sel),
        { label: "Save Selected as ...", icon: <Icon.Save />, submenu: (["ply", "wrl", "stl"] as const).map((f) => ({ label: `Save as *.${f}`, onSelect: () => void saveItemsAsUI(sel, f) })) },
        SEP,
        { label: "Delete all", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) },
      ];
    }
    return [visibleEntry(ws, sel), SEP, renameGroup, del];
  }

  switch (it.type) {
    case "station": {
      const active = ws.activeStation === it.id;
      return [
        ...(active ? [] : [{ label: "Set Active Station", icon: <Icon.Station />, onSelect: () => void cmd("station.setActive", { station: it.id }) }]),
        displayEntry(ws, it, "reference", "Visible Station Reference"),
        displayEntry(ws, it, "grid", "Visible Grid"),
        reframe(Object.keys(ws.items).filter((id) => stationIdOf(ws, id) === it.id)),
        SEP,
        { label: "Station Parameters", icon: <Icon.Settings />, onSelect: () => stationParamsUI(it.id) },
        SEP,
        { label: "Add Reference Frame...", icon: <Icon.Frame />, onSelect: () => void cmd("item.addFrame", { parent: it.id }) },
        { label: "Add Folder", icon: <Icon.Folder />, onSelect: () => void cmd("item.addFolder", {}) },
        { label: "Add Notes", icon: <Icon.Notes />, onSelect: () => void cmd("item.addNotes", {}) },
        SEP,
        { label: "Add Item...", icon: <Icon.Library />, onSelect: () => openFilesUI({ parent: it.id }) },
        { label: "Save", icon: <Icon.Save />, shortcut: "Ctrl+S", onSelect: () => void saveStationUI(it.id) },
        { label: "Save As...", onSelect: () => void saveStationAsUI(it.id) },
        { label: "Show in Explorer", onSelect: () => void cmd("station.showInFolder", { station: it.id }) },
        SEP,
        { label: "Rename", shortcut: "F2", onSelect: () => useRC.setState({ renameFor: it.id }) },
        { label: "Close", icon: <Icon.Close />, onSelect: () => void closeStationUI(it.id) },
      ];
    }
    case "frame": {
       
      const robot = currentRobot(ws);
      const activeFor = robot?.robot?.activeFrame === it.id;
      return [
        visibleEntry(ws, sel),
        reframe(sel),
        ...(robot
          ? [
              SEP,
              {
                label: "Active Reference Frame",
                checked: activeFor,
                onSelect: () => void (activeFor ? cmd("robot.clearActiveFrame", { robot: robot.id }) : cmd("robot.setActiveFrame", { robot: robot.id, frame: it.id })),
              },
            ]
          : []),
        { label: "Align Frame Orientation", onSelect: () => void cmd("frame.alignOrientation", { item: it.id }) },
        SEP,
        { label: "Add Reference Frame...", icon: <Icon.Frame />, onSelect: () => void cmd("item.addFrame", { parent: it.id }) },
        { label: "Add Item...", icon: <Icon.Library />, onSelect: () => openFilesUI({ parent: it.id }) },
        changeSupport(ws, [it.id]),
        SEP,
        { label: "Options...", onSelect: () => void activateItem(it.id) },
        { label: "Reset", onSelect: () => void cmd("item.setPose", { item: it.id, xyzrpw: [0, 0, 0, 0, 0, 0] }) },
        ...tail(it, sel, from3D),
      ];
    }
    case "robot":
      return [
        visibleEntry(ws, sel),
        displayEntry(ws, it, "reference", "Visible Reference Frame"),
        displayEntry(ws, it, "flange", "Visible Robot Flange"),
        displayEntry(ws, it, "tool", "Visible Tool Frame"),
        reframe(sel),
        SEP,
        { label: "Add Tool (TCP)", icon: <Icon.Tool />, onSelect: () => void cmd("robot.addTool", { robot: it.id }) },
        {
          label: "Attach Tool",
          submenu: itemsOfType(ws, "tool").map((t) => ({ label: t.name, icon: <Icon.Tool />, checked: it.robot?.activeTool === t.id, onSelect: () => void cmd("item.setParent", { item: t.id, parent: it.id }) })),
        },
        { label: "Add Reference Frame", icon: <Icon.Frame />, onSelect: () => void cmd("item.addFrame", {}) },
        { label: "Teach Current Position", icon: <Icon.Teach />, shortcut: "Ctrl+T", onSelect: () => void cmd("target.teach", { robot: it.id }) },
        { label: "Add Tool (TCP) From File...", onSelect: () => addToolFromFileUI(it.id) },
        { label: "Save As...", icon: <Icon.Save />, onSelect: () => void saveItemsAsUI([it.id], "robot") },
        { label: "Delete", icon: <Icon.Trash />, shortcut: "Delete", danger: true, onSelect: () => void cmd("item.delete", { items: sel }) },
        SEP,
        { label: "Select Post Processor", icon: <Icon.Code />, onSelect: () => void selectNow([it.id]).then(() => useRC.setState({ rightPanel: "inspector" })) },
        { label: "Align Tool Orientation", onSelect: () => void cmd("robot.alignToolOrientation", { robot: it.id }) },
        { label: "Move Home", icon: <Icon.Home />, onSelect: () => void cmd("robot.home", { robot: it.id }) },
        { label: "Change Configuration", onSelect: () => robotConfigurationsUI(it.id) },
        { label: "Options...", onSelect: () => void activateItem(it.id) },
        { label: "Replace Robot", onSelect: () => replaceRobotUI(it.id) },
        ...robotTail(sel, from3D),
      ];
    case "target":
      return targetMenu(ws, it, sel, from3D, menuKit());
    case "tool":
    case "object": {
      const holder = it.parent ? ws.items[it.parent] : undefined;
      const isTool = it.type === "tool";
      return [
        visibleEntry(ws, sel),
        displayEntry(ws, it, isTool ? "tcp" : "reference", isTool ? "Visible TCP" : "Visible Object Reference"),
        reframe(sel),
        SEP,
        { label: "Split Object", onSelect: () => void cmd("object.split", { item: it.id }) },
        ...(isTool && holder?.robot
          ? [{ label: "Active Tool", checked: holder.robot.activeTool === it.id, onSelect: () => void cmd("robot.setActiveTool", { robot: holder.id, tool: it.id }) }]
          : []),
        { label: "Lock", checked: !!it.locked, onSelect: () => void cmd("item.lock", { items: [it.id], locked: !it.locked }) },
        changeSupport(ws, [it.id]),
        ...(isTool ? [] : [{ label: "Get with Robot (ALT+double click)", onSelect: () => void cmd("object.getWithRobot", { item: it.id }) }]),
        SEP,
        { label: "Options...", shortcut: "F3", onSelect: () => void activateItem(it.id) },
        isTool
          ? { label: "Save As...", icon: <Icon.Save />, onSelect: () => void saveItemsAsUI([it.id], "tool") }
          : {
              label: "Save As...",
              icon: <Icon.Save />,
              submenu: (["ply", "wrl", "sld", "stl"] as const).map((f) => ({ label: `Save as *.${f}`, onSelect: () => void saveItemsAsUI([it.id], f) })),
            },
        ...tail(it, sel, from3D),
      ];
    }
    case "program":
      return programMenu(ws, it, sel, from3D, menuKit());
    case "python":
      return pythonMenu(ws, it, sel, from3D, menuKit());
    case "instruction":
      return instructionMenu(ws, it, sel);
    case "folder":
      return [
        { label: "Add Folder", icon: <Icon.Folder />, onSelect: () => void cmd("item.addFolder", { parent: it.id }) },
        { label: "Move to a New Project", onSelect: () => void cmd("folder.moveToNewStation", { item: it.id }) },
        ...tail(it, sel, from3D),
      ];
    case "notes":
      return [{ label: "Open Notes", icon: <Icon.Notes />, onSelect: () => void activateItem(it.id) }, ...tail(it, sel, from3D)];
    default:
      return tail(it, sel, from3D);
  }
}

export { renameUI };
