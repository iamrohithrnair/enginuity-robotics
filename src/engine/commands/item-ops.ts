 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { exportFileName, ITEM_EXPORT_FORMATS, writeItemExport } from "../itemExport";
import { eye, inv, mul, type Mat } from "../math";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";
import type { Item, MeshRef } from "../types";
import { absPose, currentRobot, makeItem } from "../workspace";
import { displayFlag as flag, displayTarget } from "../display";
import { transformTriangles } from "../exporters";
import { alignedOrientation } from "../align";
import { newStation } from "./station";

function setFlag(ctx: CmdCtx, it: Item, key: string, on: boolean) {
  ctx.tx.set(it.id, { params: { ...(ctx.ws.items[it.id].params ?? {}), [key]: on ? "1" : "0" } });
}

defineCommand({
  name: "item.setDisplay",
  title: "Visible Frames",
  description:
    "Show or hide the reference frames drawn for items (context menus 'Visible Station Reference', 'Visible Grid', 'Visible Reference Frame', 'Visible Robot Flange', 'Visible Tool Frame', 'Visible TCP', 'Visible Object Reference'). what: reference | flange | tool | tcp | grid. Without `visible` each entry toggles. Not recorded in the undo history.",
  category: "item",
  undoable: false,
  spec: "R-TREE-38, R-TREE-40, R-TREE-42",
  schema: z.object({
    items: z.array(ItemRef).min(1),
    what: z.enum(["reference", "flange", "tool", "tcp", "grid"]),
    visible: z.boolean().optional(),
  }),
  run(ctx, p) {
    const out: { item: string; key: string; visible: boolean }[] = [];
    for (const ref of p.items) {
      const t = displayTarget(ctx.ws, requireRef(ctx.ws, ref), p.what);
      const on = p.visible ?? !flag(ctx.ws.items[t.item.id], t.key, ctx.services.settings);
      setFlag(ctx, t.item, t.key, on);
      out.push({ item: t.item.name, key: t.key, visible: on });
    }
    return { changed: out };
  },
});

defineCommand({
  name: "item.lock",
  title: "Lock",
  description:
    "Lock or unlock tools and objects (context menu 'Lock'; toggles without `locked`). A locked item can't be moved from the 3D view or the panels: Enginuity says 'This object is locked' / 'This tool is locked'.",
  category: "item",
  undoable: false,
  spec: "R-TREE-42, FUN_100056eb8",
  schema: z.object({ items: z.array(ItemRef).min(1), locked: z.boolean().optional() }),
  run(ctx, p) {
    const its = p.items.map((r) => requireRef(ctx.ws, r));
    for (const it of its) ctx.tx.set(it.id, { locked: p.locked ?? !it.locked });
    return { items: its.map((i) => ({ name: i.name, locked: !!ctx.ws.items[i.id].locked })) };
  },
});

 
export function lockedMessage(it: Item): string | null {
  if (!it.locked) return null;
  return it.type === "tool" ? "This tool is locked" : "This object is locked";
}







defineCommand({
  name: "object.split",
  title: "Split Object",
  description:
    "Split an object (context menu 'Split Object'): each shape (one per colour/body), each curve and the point list become separate objects named '<name>-0', '<name>-1'…, '<name>-Curve 0', '<name>-Point 0', placed under the original object, which keeps no geometry.",
  category: "item",
  spec: "R-TREE-42, FUN_1004b4500",
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const { ws, tx, services } = ctx;
    const it = requireRef(ws, p.item);
    const data = it.object ?? it.tool;
    if (!data || (it.type !== "object" && it.type !== "tool")) throw new CommandError(`${it.name} is not an object`);
    const g = data.geometryPose;
    const meshes: MeshRef[] = g && !isEye(g)
      ? data.meshes.map((m) => {
          const t = services.geometry.get(m.geometry);
          return t ? { ...m, geometry: services.geometry.put(transformTriangles(t, g)), normals: undefined } : m;
        })
      : data.meshes;
    const curves = it.object?.curves ?? [];
    const points = it.object?.points ?? [];
    const created: string[] = [];
     
    if (it.type === "object") tx.set(it.id, { object: { ...it.object!, meshes: [], geometryPose: undefined, curves: [], points: [], pointNames: undefined } });
    else tx.set(it.id, { tool: { ...it.tool!, meshes: [], geometryPose: undefined } });
    const add = (name: string, object: Item["object"]) => {
      const o = makeItem(ws, "object", name, { object, pose: eye(), visible: it.visible });
      tx.add(o, it.id);
      tx.split(`Add: ${name}`);
      created.push(o.id);
    };
    if (points.length) add(`${it.name}-Point 0`, { meshes: [], points });
    curves.forEach((c, i) => add(c.name || `${it.name}-Curve ${i}`, { meshes: [], curves: [c] }));
    meshes.forEach((m, i) => add(`${it.name}-${i}`, { meshes: [m], source: it.object?.source }));
    if (!created.length) {
      ctx.undoLabel = null;
      status(ctx, `${it.name} has no geometry to split`);
    }
    return { created: created.map((id) => ws.items[id].name), ids: created };
  },
});

const isEye = (m: Mat) => m.every((v, i) => Math.abs(v - eye()[i]) < 1e-9);

defineCommand({
  name: "item.saveAs",
  title: "Save As",
  description:
    "Export tools and objects to a file (context menus 'Save As...', 'Save as *.ply / *.wrl / *.stl', 'Save Selected as ...'): stl (binary STL), ply (binary PLY with colours), wrl (VRML 2.0), sld (object file) or tool (.tool file with its TCP). One item exports in its own frame; several items export together in station coordinates. Returns the saved file path and its base64 content.",
  category: "item",
  readonly: true,
  undoable: false,
  spec: "R-SLF-36",
  schema: z.object({
    items: z.array(ItemRef).min(1),
    format: z.enum(ITEM_EXPORT_FORMATS),
    fileName: z.string().optional().describe("file name without folder; defaults to the item name"),
  }),
  run(ctx, p) {
    const its = p.items.map((r) => requireRef(ctx.ws, r));
    const { bytes, fileName } = writeItemExport(ctx.ws, ctx.services.geometry, its, p.format, p.fileName ?? exportFileName(its[0].name, p.format));
    const path = ctx.services.files?.writeExport?.(fileName, bytes) ?? null;
    if (path) status(ctx, `Saved ${path}`);
    return { path, fileName, bytes: bytes.length, base64: toBase64(bytes) };
  },
});

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

 

export { AXIS_ROTATIONS, alignedOrientation } from "../align";

defineCommand({
  name: "frame.alignOrientation",
  title: "Align Frame Orientation",
  description:
    "Snap a reference frame's orientation to the closest of the 24 orientations aligned with its parent's axes, keeping its position (context menu 'Align Frame Orientation'). Does nothing when it is already aligned.",
  category: "item",
  spec: "R-TREE-39, FUN_1004be260",
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const it = requireRef(ctx.ws, p.item);
    if (it.type === "station") throw new CommandError("The station has no pose");
    const a = alignedOrientation(it.pose);
    if (!a.changed) {
      ctx.undoLabel = null;
      return { aligned: false };
    }
    ctx.tx.set(it.id, { pose: a.pose });
    ctx.undoLabel = `Move: ${it.name}`;
    return { aligned: true };
  },
});

 

defineCommand({
  name: "object.getWithRobot",
  title: "Get with Robot",
  description:
    "Attach an object to the robot's active tool keeping its place in the world, as if the robot picked it (context menu 'Get with Robot (ALT+double click)'). Default robot: the current one.",
  category: "item",
  spec: "R-TREE-42",
  schema: z.object({ item: ItemRef, robot: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const it = requireRef(ws, p.item);
    const robot = p.robot !== undefined ? requireRef(ws, p.robot, "robot") : currentRobot(ws);
    if (!robot?.robot) throw new CommandError("Select robot first");
    const toolId = robot.robot.activeTool && ws.items[robot.robot.activeTool] ? robot.robot.activeTool : null;
    if (!toolId) throw new CommandError(`${robot.name} has no tool`);
    if (it.parent === toolId) return { attached: false };
    const abs = absPose(ws, it.id);
    const old = it.parent ? ws.items[it.parent] : undefined;
    if (old) tx.set(old.id, { children: old.children.filter((c) => c !== it.id) });
    tx.set(toolId, { children: [...ws.items[toolId].children, it.id] });
    tx.set(it.id, { parent: toolId, pose: mul(inv(absPose(ws, toolId)), abs) });
    ctx.undoLabel = `Attach ${it.name} to ${ws.items[toolId].name}`;
    return { attached: true, tool: ws.items[toolId].name };
  },
});





defineCommand({
  name: "folder.moveToNewStation",
  title: "Move to a New Project",
  description: "Move a folder and its contents into a new station (folder context menu 'Move to a New Project'). The new station becomes active.",
  category: "station",
  undoable: false,
  spec: "R-TREE-43, FUN_1003d8f0c",
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const it = requireRef(ws, p.item);
    if (it.type !== "folder") throw new CommandError(`${it.name} is not a folder`);
    const old = it.parent ? ws.items[it.parent] : undefined;
    const st = newStation(ctx);
    if (old) tx.set(old.id, { children: old.children.filter((c) => c !== it.id) });
    tx.set(st.id, { children: [...ws.items[st.id].children, it.id] });
    tx.set(it.id, { parent: st.id });
    ctx.undoLabel = null;
    return { station: ws.items[st.id].name, id: st.id };
  },
});
