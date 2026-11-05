// Serializes and validates saved toolbar and panel layouts.
 
 
 
 
 

import { TOOLBAR_LAYOUTS } from "./view";

export interface SavedLayout {
  toolbar: string;
  treeInside: boolean;
  treeVisible: boolean;
  rightPanel: "inspector" | "chat" | "none";
}

export function layoutText(l: SavedLayout): string {
  return JSON.stringify({ toolbar: l.toolbar, treeInside: l.treeInside, treeVisible: l.treeVisible, rightPanel: l.rightPanel });
}

 
export function parseLayout(text: unknown): SavedLayout | null {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const o = JSON.parse(text) as Partial<SavedLayout>;
    const toolbars: readonly string[] = TOOLBAR_LAYOUTS;
    if (typeof o.toolbar !== "string" || !toolbars.includes(o.toolbar)) return null;
    if (typeof o.treeInside !== "boolean" || typeof o.treeVisible !== "boolean") return null;
    if (!["inspector", "chat", "none"].includes(String(o.rightPanel))) return null;
    return { toolbar: o.toolbar, treeInside: o.treeInside, treeVisible: o.treeVisible, rightPanel: o.rightPanel as SavedLayout["rightPanel"] };
  } catch {
    return null;
  }
}
