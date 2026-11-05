 
 
 

// Registers and merges ordered main-menu and item-menu contributions.
import type { Item, Workspace } from "@/engine/types";
import type { MenuEntry } from "./glass/Menu";

 
export type MainMenu = "File" | "Edit" | "Program" | "View" | "Tools" | "Utilities" | "Connect" | "Help";

type MainContribution = { order: number; key: string; entries: () => MenuEntry[] };
type ItemContribution = {
  order: number;
  key: string;
  entries: (ws: Workspace, item: Item, selection: string[], opts: { from3D: boolean }) => MenuEntry[];
};

const mainMenus = new Map<MainMenu, MainContribution[]>();
const itemMenus: ItemContribution[] = [];

 
export function contributeMainMenu(menu: MainMenu, entries: () => MenuEntry[], order = 100, key = entries.toString()) {
   
  const list = (mainMenus.get(menu) ?? []).filter((c) => c.key !== key);
  list.push({ order, key, entries });
  list.sort((a, b) => a.order - b.order);
  mainMenus.set(menu, list);
}

 
export function contributeItemMenu(entries: ItemContribution["entries"], order = 100, key = entries.toString()) {
  const same = itemMenus.findIndex((c) => c.key === key);
  if (same >= 0) itemMenus.splice(same, 1);
  itemMenus.push({ order, key, entries });
  itemMenus.sort((a, b) => a.order - b.order);
}

function joinGroups(groups: MenuEntry[][]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    if (out.length) out.push({ separator: true });
    out.push(...g);
  }
  return out;
}

export function mainMenuEntries(menu: MainMenu): MenuEntry[] {
  return joinGroups((mainMenus.get(menu) ?? []).map((c) => c.entries()));
}

export function itemMenuEntries(ws: Workspace, item: Item, selection: string[], opts: { from3D: boolean }): MenuEntry[] {
  return joinGroups(itemMenus.map((c) => c.entries(ws, item, selection, opts)));
}

 
export function withContributions(base: MenuEntry[], extra: MenuEntry[]): MenuEntry[] {
  if (!extra.length) return base;
  return base.length ? [...base, { separator: true }, ...extra] : extra;
}
