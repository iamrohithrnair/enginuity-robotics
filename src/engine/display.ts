 
 
 

import type { Item, Workspace } from "./types";

export type DisplayWhat = "reference" | "flange" | "tool" | "tcp" | "grid";

 
export function displayFlag(it: Item, key: string, settings?: Record<string, unknown>): boolean {
  const v = it.params?.[key];
  if (v !== undefined) return v !== "0";
  return it.type === "object" && key === "ShowFrame" ? settings?.ShowRef_NewObjects === true : true;
}








export function displayTarget(ws: Workspace, it: Item, what: DisplayWhat): { item: Item; key: string } {
  if (it.type === "station") return { item: it, key: what === "grid" ? "ShowGrid" : "ShowFrame" };
  if (it.type === "robot") {
    if (what === "flange") return { item: it, key: "ShowFlange" };
    if (what === "tool" || what === "tcp") {
      const tool = it.robot?.activeTool ? ws.items[it.robot.activeTool] : undefined;
      return tool ? { item: tool, key: "ShowTCP" } : { item: it, key: "ShowToolFrame" };
    }
    const base = it.parent ? ws.items[it.parent] : undefined;
    return base?.type === "frame" ? { item: base, key: "ShowFrame" } : { item: it, key: "ShowFrame" };
  }
  if (it.type === "tool" && (what === "tcp" || what === "tool")) return { item: it, key: "ShowTCP" };
  return { item: it, key: "ShowFrame" };
}

 
export function isDisplayed(ws: Workspace, it: Item, what: DisplayWhat, settings?: Record<string, unknown>): boolean {
  const t = displayTarget(ws, it, what);
  return displayFlag(t.item, t.key, settings);
}
