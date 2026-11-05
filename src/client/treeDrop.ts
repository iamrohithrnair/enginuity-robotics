// Plans station-tree drops around parenting and program-lock rules.
 
 

import { canParent, stationIdOf } from "@/engine/treeRules";
import type { Item, Workspace } from "@/engine/types";

export type DropZone = "before" | "inside" | "after";
export type DropPlan = { parent: string; index?: number };

export const REORDER_RUNNING = "Program %1 is running, reordering is not allowed.";
export const DRAG_INSTRUCTIONS_LOCKED = "Can't drag and drop instruction(s) because program %1 is locked or running.";

 
function programBusy(ws: Workspace, p: Item): boolean {
  return p.type === "program" && (p.program?.locked === true || ws.busy?.includes(p.id) === true);
}

 
export function treeChildren(ws: Workspace, it: Item): string[] {
  if (it.type === "program" && it.program?.showInstructions === false) return it.children.filter((c) => ws.items[c] && ws.items[c].type !== "instruction");
  return it.children.filter((c) => ws.items[c]);
}






export function dropPlan(ws: Workspace, targetId: string, zone: DropZone, ids: string[]): { plan: DropPlan | null; status?: string } {
  const target = ws.items[targetId];
  const items = ids.map((id) => ws.items[id]);
  if (!target || !items.length || items.some((i) => !i)) return { plan: null };
  const st = stationIdOf(ws, targetId);
  if (items.some((i) => stationIdOf(ws, i.id) !== st)) return { plan: null };
   
  if (zone === "inside" && target.type === "instruction" && items.every((i) => i.type === "instruction")) zone = "after";
  const between = zone !== "inside" && !!target.parent;
  const dest = between ? ws.items[target.parent!] : target;
  if (!dest) return { plan: null };
  const position = (): number => {
    const siblings = dest.children.filter((c) => !ids.includes(c));
    const k = siblings.indexOf(target.id);
    return zone === "before" ? k : k + 1;
  };
  if (between && items.every((i) => i.parent === dest.id)) {
     
    if (programBusy(ws, dest)) return { plan: null, status: REORDER_RUNNING.replace("%1", dest.name) };
    if (ids.includes(target.id)) return { plan: null };
    return { plan: { parent: dest.id, index: position() } };
  }
  for (const it of items) {
    if (it.type === "instruction" && (dest.type === "program" || dest.type === "instruction")) {
      const from = it.parent ? ws.items[it.parent] : undefined;
      const to = dest.type === "instruction" && dest.parent ? ws.items[dest.parent] : dest;
      for (const p of [from, to]) if (p && programBusy(ws, p)) return { plan: null, status: DRAG_INSTRUCTIONS_LOCKED.replace("%1", p.name) };
    }
    if (!canParent(ws, it, dest)) return { plan: null };
  }
  if (!between) return { plan: { parent: dest.id } };
  return { plan: { parent: dest.id, index: position() } };
}





export function dropIndices(ws: Workspace, plan: DropPlan, ids: string[]): (number | undefined)[] {
  if (plan.index === undefined) return ids.map(() => undefined);
  const cur = (ws.items[plan.parent]?.children ?? []).slice();
  const final = cur.filter((c) => !ids.includes(c));
  final.splice(plan.index, 0, ...ids);
  return ids.map((id) => {
    const k = cur.indexOf(id);
    if (k >= 0) cur.splice(k, 1);
    const j = final.indexOf(id);
    const idx = j > 0 ? cur.indexOf(final[j - 1]) + 1 : 0;
    cur.splice(idx, 0, id);
    return idx;
  });
}

 
export const shownRows = new Set<string>();
