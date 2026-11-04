import { z } from "zod";
import { requireRef, resolveRef } from "../dispatch";
import { clampJoints } from "../kinematics";
import { defineCommand, CommandError, ItemRef, status, type CmdCtx } from "../registry";
import type { Item, Workspace } from "../types";
import type { Tx } from "../tx";
import { allocHandle, currentRobot, descendants, listItems, makeItem, newId } from "../workspace";
import { activeStationId, deleteItems } from "./items";

 
export const CLIPBOARD_MARKER = "%Enginuity items%";

 
 
let clipboard: { items: Item[]; roots: string[]; station: string | null } | null = null;

export function clipboardContents() {
  return clipboard;
}

 
export function relevantRobot(ws: Workspace): Item | undefined {
  const sel = ws.selection.map((s) => ws.items[s]).filter(Boolean);
  const direct = sel.find((i) => i.type === "robot");
  if (direct) return direct;
  for (const it of sel) {
    const linked = it.target?.robot ?? it.program?.robot;
    if (linked && ws.items[linked]?.robot) return ws.items[linked];
    let cur: Item | undefined = it;
    while (cur?.parent) {
      cur = ws.items[cur.parent];
      if (cur?.type === "robot") return cur;
    }
  }
  return currentRobot(ws);
}

function snapshot(ws: Workspace, ids: string[]) {
  const items: Item[] = [];
  const roots = ids.filter((id) => !ids.some((o) => o !== id && descendants(ws, o).some((d) => d.id === id)));
  for (const id of roots) items.push(structuredClone(ws.items[id]), ...descendants(ws, id).map((d) => structuredClone(d)));
  return { items, roots, station: ws.activeStation };
}

 
export function jointsClipboardText(joints: number[]): string {
  return joints.map((v) => v.toFixed(6)).join("\t");
}

function copyJoints(ctx: CmdCtx) {
  const r = relevantRobot(ctx.ws);
  if (!r?.robot) return { copied: [], clipboardText: null };
  status(ctx, `${r.name} joints copied to clipboard`);
  return { copied: [], clipboardText: jointsClipboardText(r.robot.joints) };
}

defineCommand({
  name: "edit.copy",
  title: "Copy",
  description:
    "Copy the selected items with their children (Ctrl+C). The OS clipboard receives the text '%Enginuity items%'. With nothing selected, copies the robot joints as tab-separated text.",
  category: "edit",
  shortcut: "Ctrl+C",
  undoable: false,
  readonly: true,
  spec: "R-IM-36, R-IM-39, R-TREE-28",
  schema: z.object({ items: z.array(ItemRef).optional() }),
  run(ctx, p) {
    const { ws } = ctx;
    const ids = (p.items ?? ws.selection).map((r) => resolveRef(ws, r)?.id).filter(Boolean) as string[];
    if (!ids.length) return copyJoints(ctx);
    clipboard = snapshot(ws, ids);
    return { copied: clipboard.roots.map((i) => ws.items[i].name), clipboardText: CLIPBOARD_MARKER };
  },
});

defineCommand({
  name: "edit.cut",
  title: "Cut",
  description: "Cut = copy, then delete the items (undoable 'Delete:' steps). With nothing selected it copies the robot joints (Ctrl+X).",
  category: "edit",
  shortcut: "Ctrl+X",
  spec: "R-IM-36",
  schema: z.object({ items: z.array(ItemRef).optional() }),
  run(ctx, p) {
    const { ws } = ctx;
    const ids = (p.items ?? ws.selection).map((r) => resolveRef(ws, r)?.id).filter(Boolean) as string[];
    if (!ids.length) {
      ctx.undoLabel = null;
      return copyJoints(ctx);
    }
    clipboard = snapshot(ws, ids);
    const names = clipboard.roots.map((i) => ws.items[i].name);
    deleteItems(ctx, clipboard.roots);
    return { cut: names, clipboardText: CLIPBOARD_MARKER };
  },
});

 
function cloneSubtree(ws: Workspace, tx: Tx, src: Item[], rootId: string, parent: string, map: Map<string, string>): Item {
  const root = src.find((i) => i.id === rootId)!;
  const copy: Item = structuredClone(root);
  copy.id = newId(root.type.slice(0, 3));
  copy.handle = allocHandle(ws);
  map.set(root.id, copy.id);
  copy.children = [];
  tx.add(copy, parent);
  tx.split(`Add: ${copy.name}`);
  for (const c of root.children) {
    if (src.find((i) => i.id === c)) cloneSubtree(ws, tx, src, c, copy.id, map);
  }
  return copy;
}







function pasteItems(ctx: CmdCtx, parentRef: string | number | undefined, copies: number): string[] {
  const { ws, tx, services } = ctx;
  if (!clipboard) throw new CommandError("Cannot paste data.");
  const st = activeStationId(ws);
  const keepLinks = ctx.origin === "api" || (!!services.settings.CopyPasteKeepLinks && clipboard.station === ws.activeStation);
  let parent: Item = parentRef !== undefined ? requireRef(ws, parentRef, "parent") : ws.items[ws.selection.find((s) => ws.items[s]) ?? st];
  const created: string[] = [];
  for (let n = 0; n < copies; n++) {
    for (const rootId of clipboard.roots) {
      const root = clipboard.items.find((i) => i.id === rootId)!;
      let target = parent;
      if (root.type === "station") {
        if (target.type !== "station") throw new CommandError("A station can only be pasted to another station");
      } else if (root.type === "instruction") {
        if (target.type === "instruction" && target.parent) target = ws.items[target.parent];
        if (target.type !== "program") throw new CommandError("Cannot paste data.");
      } else if (target.type === "program" || target.type === "instruction") {
        status(ctx, "Cannot paste to a program or instruction. Using the station root");
        target = ws.items[st];
      }
      const map = new Map<string, string>();
      const copy = cloneSubtree(ws, tx, clipboard.items, rootId, target.id, map);
      const remap = (id: string | null | undefined) => (id && map.has(id) ? map.get(id)! : keepLinks && id && ws.items[id] ? id : null);
      for (const id of map.values()) {
        const it = ws.items[id];
        if (it.robot) tx.set(id, { robot: { ...it.robot, activeTool: remap(it.robot.activeTool), activeFrame: remap(it.robot.activeFrame) } });
        if (it.target) tx.set(id, { target: { ...it.target, robot: remap(it.target.robot) } });
        if (it.program) tx.set(id, { program: { ...it.program, robot: remap(it.program.robot) } });
        if (it.instruction) {
          const ins = it.instruction;
           
          const keep = (r: string | null | undefined) => (r && map.has(r) ? map.get(r)! : r ?? null);
          tx.set(id, { instruction: { ...ins, target: keep(ins.target), target2: keep(ins.target2), frame: keep(ins.frame), tool: keep(ins.tool) } });
        }
      }
      created.push(copy.id);
    }
    parent = ws.items[parent.id];
  }
  return created;
}

 
export function parseClipboardMatrix(text: string): number[][] {
  const cols: number[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const vals = line
      .trim()
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (!vals.length || vals.some((v) => !Number.isFinite(v))) continue;
    cols.push(vals);
  }
  return cols;
}





async function pasteText(ctx: CmdCtx, text: string) {
  const { ws, tx } = ctx;
  const cols = parseClipboardMatrix(text);
  const R = cols.length ? cols[0].length : 0;
  const C = cols.length;
  const robot = relevantRobot(ws);
  const dof = robot?.robot?.model.nq ?? 0;
  const firstIsUnitNormal = R >= 6 && Math.abs(cols[0][3] ** 2 + cols[0][4] ** 2 + cols[0][5] ** 2 - 1) < 1e-4;
  const pointsOrCurve = !robot || (R === 6 && C > 1 && firstIsUnitNormal) || R < dof;
  if (pointsOrCurve) {
    const st = activeStationId(ws);
    const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "frame");
    const parent = sel?.id ?? st;
    if (R === 3) {
      const obj = makeItem(ws, "object", "Pasted Points", { object: { meshes: [], points: cols.map((c) => [c[0], c[1], c[2]]) } });
      tx.add(obj, parent);
      ctx.undoLabel = `Add: ${obj.name}`;
      return { pasted: [obj.id], kind: "points" };
    }
    if (R < 6) {
      status(ctx, "Cannot paste data.");
      ctx.undoLabel = null;
      return { pasted: [], kind: "none" };
    }
    const obj = makeItem(ws, "object", "Pasted Curve", { object: { meshes: [], curves: [{ points: cols.map((c) => c.slice(0, 6)) }] } });
    tx.add(obj, parent);
    ctx.undoLabel = `Add: ${obj.name}`;
    return { pasted: [obj.id], kind: "curve" };
  }
  const rd = robot!.robot!;
  if (R === dof) {
    if (C === 1) {
      tx.set(robot!.id, { robot: { ...rd, joints: clampJoints(rd.model, cols[0]) } });
      ctx.undoLabel = `Move robot: ${robot!.name}`;
      status(ctx, `Pasted joints from clipboard to ${robot!.name}`);
      return { pasted: [], kind: "joints" };
    }
    ctx.services.emit?.({ type: "joint-list", robot: robot!.id, rows: cols });
    ctx.undoLabel = null;
    status(ctx, `Pasted joint sequence from clipboard to ${robot!.name}`);
    return { pasted: [], kind: "joint-list", rows: C };
  }
   
  const { addInstruction } = await import("./programs");
  let prog = listItems(ws, { type: "program" }).find((p) => p.name === "Sequence" && p.params?.pastedSequence === "1");
  if (!prog) {
    prog = makeItem(ws, "program", "Sequence", { program: { robot: robot!.id }, params: { pastedSequence: "1" } });
    tx.add(prog, activeStationId(ws));
  }
  cols.forEach((c, i) => addInstruction(ws, tx, prog!, { kind: "move", moveType: "joint", joints: c.slice(0, dof), index: i + 1 }, null, true));
  ctx.undoLabel = `Add: ${prog.name}`;
  status(ctx, `Pasted program from clipboard to ${robot!.name}`);
  return { pasted: [prog.id], kind: "program" };
}

defineCommand({
  name: "edit.paste",
  title: "Paste",
  description:
    "Paste (Ctrl+V). With `text` from the OS clipboard other than '%Enginuity items%' the text is parsed as numbers: joints for the robot, a program 'Sequence', 'Pasted Points' or 'Pasted Curve'. Otherwise copied items are pasted under the first selected item (or `parent`), keeping names and relative poses.",
  category: "edit",
  shortcut: "Ctrl+V",
  spec: "R-IM-37, R-IM-38, R-TREE-28, R-TREE-29",
  schema: z.object({ parent: ItemRef.optional(), text: z.string().optional(), copies: z.number().int().min(1).max(100).default(1) }),
  async run(ctx, p) {
    const { ws, tx } = ctx;
    if (p.text !== undefined && p.text !== CLIPBOARD_MARKER) return pasteText(ctx, p.text);
    if (!clipboard) {
      status(ctx, "Cannot paste data.");
      ctx.undoLabel = null;
      return { pasted: [] };
    }
    const created = pasteItems(ctx, p.parent, p.copies);
    tx.setMeta("selection", created);
    ctx.undoLabel = null;
    return { pasted: created.map((c) => ws.items[c].name), ids: created };
  },
});

defineCommand({
  name: "edit.undo",
  title: "Undo",
  description: "Undo the last action of the active station (Ctrl+Z).",
  category: "edit",
  shortcut: "Ctrl+Z",
  undoable: false,
  spec: "R-IM-28, R-IM-29",
  schema: z.object({}),
  run({ services }) {
    if (!services.undo) throw new CommandError("Undo is not available");
    return services.undo.undo();
  },
});

defineCommand({
  name: "edit.redo",
  title: "Redo",
  description: "Redo the last undone action of the active station (Ctrl+Y).",
  category: "edit",
  shortcut: "Ctrl+Y",
  undoable: false,
  spec: "R-IM-28, R-IM-29",
  schema: z.object({}),
  run({ services }) {
    if (!services.undo) throw new CommandError("Redo is not available");
    return services.undo.redo();
  },
});

defineCommand({
  name: "edit.undoStack",
  title: "View Undo Stack",
  description:
    "The undo history of the active station: `undo` steps (oldest first), `redo` steps (next first), the current position `index` (= number of undoable steps), and `cleanIndex`, the position of the last save or open (`clean` = no unsaved changes).",
  category: "edit",
  readonly: true,
  undoable: false,
  spec: "R-IM-29, D-24",
  schema: z.object({}),
  run({ services }) {
    return services.undo?.list() ?? { undo: [], redo: [] };
  },
});

defineCommand({
  name: "edit.undoTo",
  title: "Go to Undo Step",
  description:
    "Jump the active station's history to a position, like clicking an entry of the undo stack window: 0 = before the first step ('<empty>'), N = after the N-th step; steps are undone or redone one by one.",
  category: "edit",
  undoable: false,
  spec: "R-IM-29, D-24",
  schema: z.object({ index: z.number().int().min(0) }),
  run({ services }, p) {
    if (!services.undo?.undoTo) throw new CommandError("Undo is not available");
    return services.undo.undoTo(p.index);
  },
});

defineCommand({
  name: "edit.clearUndo",
  title: "Clear Undo Stack",
  description: "Clear the undo history of the active station (Options: Clear Undo Stack).",
  category: "edit",
  undoable: false,
  spec: "R-IM-33, R-IM-34",
  schema: z.object({}),
  run({ services }) {
    services.undo?.clear();
    return { ok: true };
  },
});
