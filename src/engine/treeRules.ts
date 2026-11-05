// Enforces station-tree parenting rules and absolute-pose retention policies.
 

import type { Item, ItemType, Workspace } from "./types";






export const ACCEPTS: Partial<Record<ItemType, ItemType[]>> = {
  station: ["robot", "tool", "object", "frame", "curve", "program", "python", "machining", "folder", "notes", "script"],
  folder: ["robot", "tool", "object", "frame", "curve", "program", "python", "machining", "folder", "notes", "script"],
  frame: ["robot", "tool", "object", "curve", "frame", "folder", "notes", "target"],
  robot: ["tool", "object", "frame", "robot"],
  tool: ["object"],
  object: ["curve", "object"],
  curve: ["curve"],
  program: ["instruction"],
  instruction: ["instruction"],
};

const isAncestorOf = (ws: Workspace, maybeAncestor: string, id: string) => {
  let cur = ws.items[id];
  while (cur?.parent) {
    if (cur.parent === maybeAncestor) return true;
    cur = ws.items[cur.parent];
  }
  return false;
};

 
export function canParent(ws: Workspace, child: Item, parent: Item): boolean {
  if (child.id === parent.id || isAncestorOf(ws, child.id, parent.id)) return false;
  return (ACCEPTS[parent.type] ?? []).includes(child.type);
}

 
export function stationIdOf(ws: Workspace, id: string): string | undefined {
  let cur = ws.items[id];
  while (cur?.parent) cur = ws.items[cur.parent];
  return cur?.type === "station" ? cur.id : undefined;
}

 
export const KEEPS_ABSOLUTE_ON_SHIFT: ItemType[] = ["frame", "object", "target"];
