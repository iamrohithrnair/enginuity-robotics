import { z } from "zod";
import { requireRef, resolveRef } from "../dispatch";
import { eye, inv, mul, transl, xyzrpwToPose, poseToXYZRPW, type Mat } from "../math";
import { autoName } from "../naming";
import { CommandError, defineCommand, ItemRef, Pose, status, XYZRPW, type CmdCtx } from "../registry";
import type { Item, Workspace } from "../types";
import type { Tx } from "../tx";
import { absPose, childFrame, currentRobot, descendants, isAncestor, listItems, makeItem, newFrameOffset } from "../workspace";
import { assertProgramEditable, assertTargetEditable } from "./instructions";





function assertEditable(ws: Workspace, it: Item) {
  if (it.type === "instruction" && it.parent && ws.items[it.parent]?.type === "program") assertProgramEditable(ws, ws.items[it.parent]);
  if (it.type === "program") assertProgramEditable(ws, it);
  if (it.type === "target") assertTargetEditable(ws, it.id);
}

export function activeStationId(ws: Workspace): string {
  if (!ws.activeStation || !ws.items[ws.activeStation]) throw new CommandError("No active station");
  return ws.activeStation;
}

export { ACCEPTS, canParent } from "../treeRules";
import { canParent } from "../treeRules";

 
export function poseKeepingAbsolute(ws: Workspace, id: string, newParent: string): Mat {
  const abs = absPose(ws, id);
  const parentAbs = childFrame(ws, newParent);
  return mul(inv(parentAbs), abs);
}

 
export function apiNoUndo(ctx: CmdCtx) {
  if (ctx.origin === "api") ctx.undoLabel = null;
}





export function adoptAsActiveFrame(ws: Workspace, tx: Tx, frameId: string) {
  const r = currentRobot(ws);
  if (r?.robot && !(r.robot.activeFrame && ws.items[r.robot.activeFrame])) tx.set(r.id, { robot: { ...r.robot, activeFrame: frameId } });
}

 
export function defaultFrameParent(ws: Workspace): string {
  const st = activeStationId(ws);
  if (ws.selection.length === 1) {
    const sel = ws.items[ws.selection[0]];
    if (sel?.type === "frame") return sel.id;
  }
  return st;
}

 
export function createFrame(ctx: Pick<CmdCtx, "ws" | "tx" | "services">, opts: { name?: string; parent?: string; pose?: Mat }): Item {
  const { ws, tx, services } = ctx;
  const st = activeStationId(ws);
  const parent = opts.parent ?? defaultFrameParent(ws);
  const fr = makeItem(ws, "frame", opts.name ?? autoName(ws, st, "frame"));
  const spacing = services.settings.PlaceAtOrigin ? 0 : Number(services.settings.PlaceSpacingMM ?? 1000);
  fr.pose = opts.pose ?? transl(0, newFrameOffset(ws, st, spacing), 0);
  tx.add(fr, parent);
  adoptAsActiveFrame(ws, tx, fr.id);
  return fr;
}

defineCommand({
  name: "item.addFrame",
  title: "Add Reference Frame",
  description:
    "Add a reference frame named 'Frame N'. Parent: explicit, else the single selected frame, else the station root. Placed 1 m apart along Y unless a pose is given.",
  category: "item",
  spec: "R-TREE-3, R-TREE-9, R-TREE-10, R-TREE-11",
  schema: z.object({ name: z.string().optional(), parent: ItemRef.optional(), pose: Pose.optional(), xyzrpw: XYZRPW.optional() }),
  run(ctx, p) {
    const { ws } = ctx;
    const parent = p.parent !== undefined ? requireRef(ws, p.parent, "parent").id : undefined;
    const pose = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : undefined);
    const fr = createFrame(ctx, { name: p.name, parent, pose });
    ctx.undoLabel = `Add: ${fr.name}`;
    return { id: fr.id, name: fr.name, handle: fr.handle };
  },
});

defineCommand({
  name: "item.addFolder",
  title: "Add Folder",
  description: "Add a folder attached to the station root ('Folder N').",
  category: "item",
  spec: "R-TREE-6",
  schema: z.object({ name: z.string().optional(), parent: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const st = activeStationId(ws);
    const parent = p.parent !== undefined ? requireRef(ws, p.parent) : ws.items[st];
    const f = makeItem(ws, "folder", p.name || autoName(ws, st, "folder"));
    tx.add(f, parent.id);
    ctx.undoLabel = `Add: ${f.name}`;
    return { id: f.id, name: f.name };
  },
});

defineCommand({
  name: "item.addNotes",
  title: "Add Notes",
  description: "Add notes to the station root ('Note N').",
  category: "item",
  spec: "R-TREE-6",
  schema: z.object({ name: z.string().optional(), text: z.string().default("") }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const st = activeStationId(ws);
    const n = makeItem(ws, "notes", p.name || autoName(ws, st, "notes"), { notes: { html: p.text } });
    tx.add(n, st);
    ctx.undoLabel = `Add: ${n.name}`;
    return { id: n.id, name: n.name };
  },
});

defineCommand({
  name: "item.setNotes",
  title: "Edit Notes",
  description: "Replace the text of a notes item.",
  category: "item",
  undoable: false,
  schema: z.object({ item: ItemRef, text: z.string() }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.item);
    if (it.type !== "notes") throw new CommandError(`${it.name} is not a notes item`);
    tx.set(it.id, { notes: { html: p.text } });
    return { ok: true };
  },
});

defineCommand({
  name: "item.rename",
  title: "Rename Item",
  description:
    "Rename an item (F2). From the UI an empty name leaves the item unchanged; through the API any text is accepted, including empty names. Duplicates are allowed.",
  category: "item",
  shortcut: "F2",
  spec: "R-TREE-24, R-TREE-7",
  schema: z.object({ item: ItemRef, name: z.string() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const it = requireRef(ws, p.item);
    if (it.type === "instruction") assertEditable(ws, it);
     
    if (p.name === "" && ctx.origin !== "api") {
      ctx.undoLabel = null;
      return { id: it.id, name: it.name, unchanged: true };
    }
    tx.set(it.id, { name: p.name });
    ctx.undoLabel = ctx.origin === "api" ? null : `Set item name to ${p.name}`;
    if (ctx.origin === "ui") status(ctx, `Item name changed to: ${p.name}`);
     
    return { id: it.id, name: p.name };
  },
});

defineCommand({
  name: "item.renameGroup",
  title: "Rename Group",
  description: "Rename several items of one type in selection order to '<text> 1', '<text> 2', … (R-TREE-25).",
  category: "item",
  spec: "R-TREE-25",
  schema: z.object({ items: z.array(ItemRef).min(1), name: z.string() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    if (!p.name) {
      ctx.undoLabel = null;
      return { renamed: 0 };
    }
    const its = p.items.map((r) => requireRef(ws, r));
    its.forEach((it, i) => {
      const n = `${p.name} ${i + 1}`;
      tx.set(it.id, { name: n });
      tx.split(`Set item name to ${n}`);
    });
    return { renamed: its.length };
  },
});

 
function unlinkReferences(ws: Workspace, tx: Tx, gone: Item) {
   
   
  if (gone.type !== "tool" && gone.type !== "frame" && gone.type !== "robot") return;
  for (const other of Object.values(ws.items)) {
    if (other.robot) {
      if (other.robot.activeTool === gone.id) tx.set(other.id, { robot: { ...ws.items[other.id].robot!, activeTool: null } });
      if (other.robot.activeFrame === gone.id) tx.set(other.id, { robot: { ...ws.items[other.id].robot!, activeFrame: null } });
    }
    if (gone.type === "robot") {
      if (other.target?.robot === gone.id) tx.set(other.id, { target: { ...other.target, robot: null } });
      if (other.program?.robot === gone.id) tx.set(other.id, { program: { ...other.program, robot: null } });
    }
  }
}







export function deleteItems(ctx: CmdCtx, refs: (string | number)[]): string[] {
  const { ws, tx } = ctx;
  const removed: string[] = [];
  for (const ref of refs) {
    const it0 = resolveRef(ws, ref);
    if (!it0 || !ws.items[it0.id]) continue;  
    if (it0.type === "station") continue;  
    let it = it0;
    if (it.type === "robot" && it.parent) {
      const par = ws.items[it.parent];
      if (par?.type === "frame" && par.children.length === 1) it = par;
    }
    tx.remove(it.id, (node) => {
      removed.push(node.name);
      unlinkReferences(ws, tx, node);
      tx.split(`Delete: ${node.name}`);
    });
  }
  tx.setMeta("selection", ws.selection.filter((s) => ws.items[s]));
  ctx.undoLabel = null;  
  return removed;
}

defineCommand({
  name: "item.delete",
  title: "Delete",
  description:
    "Delete items and everything below them (no confirmation; undoable step by step). Deleting a robot alone in its base frame deletes the base frame too. Deleting a station closes it.",
  category: "item",
  shortcut: "Delete",
  spec: "R-TREE-26, R-TREE-27, R-IM-35",
  schema: z.object({ items: z.array(ItemRef).min(1) }),
  async run(ctx, p) {
    const { ws } = ctx;
    const its = p.items.map((r) => requireRef(ws, r));
    for (const it of its) {
      assertEditable(ws, it);
      for (const d of it.type === "station" ? [] : descendants(ws, it.id)) assertEditable(ws, d);
    }
    const stations = its.filter((i) => i.type === "station");
    const removed = deleteItems(ctx, its.filter((i) => i.type !== "station").map((i) => i.id));
    const closed: string[] = [];
    if (stations.length) {
      const { closeStation, confirmClose } = await import("./station");
       
      for (const st of stations) {
        if (!(await confirmClose(ctx, st))) continue;
        closeStation(ctx, st.id);
        closed.push(st.name);
      }
    }
    return { removed, closed };
  },
});

defineCommand({
  name: "item.setPose",
  title: "Set Item Pose",
  description:
    "Set an item's position. `pose` (4x4) or `xyzrpw` is interpreted relative to its parent by default, or relative to `relativeTo` ('station' or an item).",
  category: "item",
  spec: "R-TREE-34, R-IM-30",
  schema: z.object({
    item: ItemRef,
    pose: Pose.optional(),
    xyzrpw: XYZRPW.optional(),
    relativeTo: z.union([z.literal("parent"), z.literal("station"), z.string(), z.number()]).optional(),
    keepChildren: z.boolean().default(false).describe("children keep their absolute pose (Move Tools / ALT+Shift drag, R-IM-21)"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const it = requireRef(ws, p.item);
    if (it.type === "station") throw new CommandError("The station has no pose");
     
    if (it.locked && ctx.origin === "ui") {
      status(ctx, it.type === "tool" ? "This tool is locked" : "This object is locked");
      ctx.undoLabel = null;
      return { id: it.id, locked: true };
    }
    if (it.type === "instruction") assertEditable(ws, it);
    const childAbs = p.keepChildren ? it.children.map((c) => [c, absPose(ws, c)] as const) : [];
    let m = p.pose ?? (p.xyzrpw ? xyzrpwToPose(p.xyzrpw) : undefined);
    if (!m) throw new CommandError("Provide pose or xyzrpw");
    if (p.relativeTo && p.relativeTo !== "parent" && it.parent) {
      const refAbs = p.relativeTo === "station" ? eye() : absPose(ws, requireRef(ws, p.relativeTo).id);
      const parentAbs = childFrame(ws, it.parent);
      m = mul(inv(parentAbs), mul(refAbs, m));
    }
    tx.set(it.id, { pose: m });
    for (const [c, abs] of childAbs) tx.set(c, { pose: mul(inv(childFrame(ws, it.id)), abs) });
     
    ctx.undoLabel = it.type === "tool" ? `Move TCP: ${it.name}` : it.type === "target" ? `Move target: ${it.name}` : `Move: ${it.name || "triangles"}`;
    apiNoUndo(ctx);
    return { id: it.id, xyzrpw: poseToXYZRPW(m) };
  },
});






defineCommand({
  name: "item.setParent",
  title: "Move in Tree",
  description:
    "Re-parent an item. keepAbsolute=false (default, plain drop / setParent) keeps the pose relative to the parent; true (Shift+drop / setParentStatic) keeps its place in the world. `index` positions it among the new siblings.",
  category: "item",
  spec: "R-TREE-30, R-TREE-31, R-TREE-32, R-TREE-34",
  schema: z.object({ item: ItemRef, parent: ItemRef, keepAbsolute: z.boolean().default(false), index: z.number().int().optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const it = requireRef(ws, p.item);
    const np = requireRef(ws, p.parent, "parent");
    if (it.type === "instruction") assertEditable(ws, it);
    if (np.type === "program") assertProgramEditable(ws, np);
    if (np.id === it.id) throw new CommandError("Invalid item provided: The item identifier provided is not valid or it does not exist.", "invalid_item");
    if (isAncestor(ws, it.id, np.id)) {
      status(ctx, "The parent can not be a child of the current item");
      throw new CommandError("The parent can not be a child of the current item", "warning");
    }
    if (ctx.origin === "ui" && !canParent(ws, it, np)) throw new CommandError(`${it.name} cannot be placed under ${np.name}`);
    const pose = p.keepAbsolute ? poseKeepingAbsolute(ws, it.id, np.id) : it.pose;
    if (it.parent && ws.items[it.parent]) {
      const old = ws.items[it.parent];
      tx.set(old.id, { children: old.children.filter((c) => c !== it.id) });
    }
    const kids = ws.items[np.id].children.filter((c) => c !== it.id);
    const idx = p.index === undefined ? kids.length : Math.max(0, Math.min(p.index, kids.length));
    kids.splice(idx, 0, it.id);
    tx.set(np.id, { children: kids });
    tx.set(it.id, { parent: np.id, pose });
     
    if (it.type === "object" && np.type === "robot" && np.robot) {
      tx.set(it.id, { type: "tool", tool: { meshes: it.object?.meshes ?? [] }, object: undefined });
      if (!np.robot.activeTool || !ws.items[np.robot.activeTool]) tx.set(np.id, { robot: { ...np.robot, activeTool: it.id } });
      status(ctx, "The object has automatically been transformed into a tool");
    } else if (it.type === "tool" && np.type !== "robot") {
      tx.set(it.id, { type: "object", object: { meshes: it.tool?.meshes ?? [] }, tool: undefined });
      status(ctx, "The tool has automatically been transformed into an object");
    } else if (it.type === "tool" && np.type === "robot" && np.robot && (!np.robot.activeTool || !ws.items[np.robot.activeTool])) {
      tx.set(np.id, { robot: { ...np.robot, activeTool: it.id } });
    }
    ctx.undoLabel = `Attach ${it.name} to ${np.name}`;
    apiNoUndo(ctx);
    return { id: it.id, parent: np.id };
  },
});

 
function reorderable(ws: Workspace, its: Item[]): Item {
  if (!its.length) throw new CommandError("Select an item first");
  if (its.some((i) => i.type === "station" || !i.parent)) throw new CommandError("A station can not be reordered");
  if (its.some((i) => i.parent !== its[0].parent)) throw new CommandError("All items must belong to the same object");
  if (its.some((i) => i.type === "instruction")) throw new CommandError("Instructions can not be reordered");
  return ws.items[its[0].parent!];
}

defineCommand({
  name: "item.reorder",
  title: "Reorder",
  description:
    "Move items among their siblings (Reorder ▸ Move to the Top / Move to the Bottom / Specify...): to 'top', 'bottom' or a 0-based index, or `before` a sibling ('Selected item(s) in the station tree will be placed on top of the selected item'). Several items keep their order. Not recorded in the undo history.",
  category: "item",
  spec: "R-TREE-35, FUN_1003e0978",
  undoable: false,
  schema: z.object({
    item: ItemRef.optional(),
    items: z.array(ItemRef).optional(),
    to: z.union([z.enum(["top", "bottom"]), z.number().int()]).optional(),
    before: ItemRef.optional().describe("sibling the items are placed on top of"),
  }),
  run({ ws, tx }, p) {
    const its = [...(p.items ?? []), ...(p.item !== undefined ? [p.item] : [])].map((r) => requireRef(ws, r));
    const par = reorderable(ws, its);
    const moving = new Set(its.map((i) => i.id));
    const kids = par.children.filter((c) => !moving.has(c));
    let idx: number;
    if (p.before !== undefined) {
      const ref = requireRef(ws, p.before);
      if (ref.parent !== par.id) throw new CommandError("All items must belong to the same object");
       
      idx = kids.indexOf(ref.id);
      if (idx < 0) idx = par.children.filter((c) => !moving.has(c) && par.children.indexOf(c) < par.children.indexOf(ref.id)).length;
    } else {
      const to = p.to ?? "bottom";
      idx = to === "top" ? 0 : to === "bottom" ? kids.length : Math.max(0, Math.min(to, kids.length));
    }
    const ordered = par.children.filter((c) => moving.has(c));
    kids.splice(idx, 0, ...ordered);
    tx.set(par.id, { children: kids });
    return { index: idx };
  },
});








const REORDER_TYPES = [10, 2, 5, 16, 4, 7, 6, 3, 13, 14, 15, 12, 11, 8];
const TYPE_CODE: Record<string, number> = { station: 1, robot: 2, frame: 3, tool: 4, object: 5, target: 6, curve: 7, program: 8, instruction: 9, python: 10, machining: 11, folder: 17, notes: 22, camera: 19 };

function sortName(name: string, apt: boolean): string {
  let n = name.startsWith("Main") ? name.replace("Main", "AAMain") : name.startsWith("Safe") ? name.replace("Safe", "AASafe") : name;
  if (apt && n.startsWith("APT")) {
    if (n.length > 4 && n[4] === "_") n = n.replace("APT", "APT00");
    else if (n.length > 5 && n[5] === "_") n = n.replace("APT", "APT0");
  }
  return n;
}

const qtCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function reorderLessThan(a: Item, b: Item): boolean {
  const ta = TYPE_CODE[a.type] ?? 0, tb = TYPE_CODE[b.type] ?? 0;
  const prog = (t: number) => t === 11 || t === 8;
  if (prog(ta) && prog(tb)) {
    const c = qtCompare(sortName(a.name, true), sortName(b.name, true));
    return c !== 0 ? c < 0 : tb === 8;
  }
  const na = sortName(a.name, false), nb = sortName(b.name, false);
  const ia = REORDER_TYPES.indexOf(ta), ib = REORDER_TYPES.indexOf(tb);
  if (ta === tb || ia < 0 || ib < 0) return qtCompare(na, nb) < 0;
  return ia < ib;
}

defineCommand({
  name: "item.reorderAuto",
  title: "Reorder automatically",
  description:
    "Place items automatically among their siblings (Reorder ▸ Reorder automatically, Tools ▸ Reorder Selected Items Automatically): Python programs, robots, objects, tools, curves, targets, frames, …, machining projects and programs, by name within a type ('Main…' and 'Safe…' programs first). An empty list does nothing (Shift+R with nothing selected). Not recorded in the undo history.",
  category: "item",
  spec: "R-TREE-35, FUN_1003e167c, FUN_1003e10b4",
  undoable: false,
   
  schema: z.object({ items: z.array(ItemRef) }),
  run({ ws, tx }, p) {
    const its = p.items.map((r) => requireRef(ws, r));
    for (const it of its) {
      if (it.type === "station" || !it.parent) throw new CommandError("A station can not be reordered");
      if (it.type === "instruction") throw new CommandError("Instructions can not be reordered");
    }
    for (const it of its) {
      const par = ws.items[it.parent!];
      const kids = par.children.filter((c) => c !== it.id);
      let at = kids.length;
       
      if (kids.length > 1)
        for (let k = 0; k < kids.length - 1; k++) {
          if (reorderLessThan(it, ws.items[kids[k]])) {
            at = k;
            break;
          }
        }
      kids.splice(at, 0, it.id);
      tx.set(par.id, { children: kids });
    }
    return { reordered: its.length };
  },
});






defineCommand({
  name: "item.setVisible",
  title: "Show/Hide",
  description:
    "Show or hide items. With `visible` all items get that state (context menu 'Visible'); without it each item toggles individually (F7). Visibility is per item: children of a hidden frame stay visible.",
  category: "item",
  shortcut: "F7",
  undoable: false,
  spec: "R-TREE-21",
  schema: z.object({ items: z.array(ItemRef).optional(), visible: z.boolean().optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    let its = (p.items ?? ws.selection).map((r) => requireRef(ws, r));
    if (!its.length) {
      status(ctx, "Nothing selected. Swaping visible/invisible space.");
      its = listItems(ws).filter((i) => i.type !== "station" && i.type !== "instruction");
    }
    for (const it of its) tx.set(it.id, { visible: p.visible ?? !it.visible });
    return { items: its.length };
  },
});

defineCommand({
  name: "item.setColor",
  title: "Change Color",
  description: "Set an item's display color [r,g,b,a] with components 0..1 (not undoable).",
  category: "item",
  undoable: false,
  spec: "R-IM-30",
  schema: z.object({ item: ItemRef, color: z.array(z.number().min(0).max(1)).min(3).max(4) }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.item);
    const c = [p.color[0], p.color[1], p.color[2], p.color[3] ?? 1] as [number, number, number, number];
    tx.set(it.id, { color: c });
    return { id: it.id, color: c };
  },
});

defineCommand({
  name: "item.setParam",
  title: "Set Item Parameter",
  description: "Store a named string parameter on an item (Item.setParam).",
  category: "item",
  undoable: false,
  schema: z.object({ item: ItemRef, key: z.string(), value: z.string() }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.item);
    tx.set(it.id, { params: { ...(it.params ?? {}), [p.key]: p.value } });
    return { ok: true };
  },
});

defineCommand({
  name: "edit.select",
  title: "Select Items",
  description: "Replace, extend or toggle the selection (empty array clears it).",
  category: "edit",
  undoable: false,
  schema: z.object({ items: z.array(ItemRef), mode: z.enum(["replace", "add", "toggle"]).default("replace") }),
  run({ ws, tx }, p) {
    const ids = p.items.map((r) => resolveRef(ws, r)?.id).filter(Boolean) as string[];
    let next: string[];
    if (p.mode === "replace") next = ids;
    else if (p.mode === "add") next = [...new Set([...ws.selection, ...ids])];
    else {
      const s = new Set(ws.selection);
      for (const id of ids) {
        if (s.has(id)) s.delete(id);
        else s.add(id);
      }
      next = [...s];
    }
    tx.setMeta("selection", next);
    return { selection: next };
  },
});

export { descendants };
