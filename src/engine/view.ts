 
 
 
 
 
 

import type { ItemType, ViewState, Workspace } from "./types";

export const DEFAULT_VIEW: ViewState = {
  frames: true,
  text: true,
  workspace: false,
  trace: false,
  traceReset: 0,
  perspective: true,
  leftAction: "select",
  moveMode: "default",
  cinema: false,
  toolbar: "Default",
  treeInside: true,
  treeVisible: true,
  blockKeys: false,
};

export function viewOf(ws: Workspace | null | undefined): ViewState {
  return { ...DEFAULT_VIEW, ...(ws?.view ?? {}) };
}






export const FRAME_SIZE_KEYS = { ref: "FrameSizesRef", target: "FrameSizesTarget", path: "FrameSizesPath", other: "FrameSizesOther" } as const;
export const FRAME_SIZE_DEFAULTS = { ref: 350, target: 250, path: 150, other: 100 } as const;
export type FrameSizeKind = keyof typeof FRAME_SIZE_KEYS;

export function frameSize(settings: Record<string, unknown>, kind: FrameSizeKind): number {
  const v = Number(settings[FRAME_SIZE_KEYS[kind]]);
  return Number.isFinite(v) && v > 0 ? v : FRAME_SIZE_DEFAULTS[kind];
}

 
export function frameKindOf(type: ItemType): FrameSizeKind {
  if (type === "frame" || type === "object" || type === "tool" || type === "station") return "ref";
  if (type === "target") return "target";
  return "other";
}





export function scaledFrameSizes(settings: Record<string, unknown>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const kind of Object.keys(FRAME_SIZE_KEYS) as FrameSizeKind[]) {
    const next = frameSize(settings, kind) * factor;
    if (next >= 0) out[FRAME_SIZE_KEYS[kind]] = Math.round(next * 1e6) / 1e6;
  }
  return out;
}






export const TEXT_FOR_KEYS: Partial<Record<ItemType, string>> = {
  frame: "TextFor_Frames",
  robot: "TextFor_Robots",
  object: "TextFor_Objects",
  tool: "TextFor_Tools",
  target: "TextFor_Targets",
  program: "TextFor_Programs",
};

export function showsText(settings: Record<string, unknown>, view: ViewState, type: ItemType): boolean {
  if (!view.text) return false;
  const key = TEXT_FOR_KEYS[type];
  if (!key) return false;
   
  if (settings.ShowTextObjectOnly === true) return type === "object";
  return settings[key] === true;
}

 
export const TRACE_STYLES = ["References", "Line", "Dots", "Points", "Spheres"] as const;

 
export const TOOLBAR_LAYOUTS = ["Default", "Viewer", "Basic", "Palletizing", "Simple", "Complete", "No Toolbar"] as const;







const TOOLBAR_SETS: [string, (typeof TOOLBAR_LAYOUTS)[number]][] = [
  ["none", "No Toolbar"],
  ["viewer", "Viewer"],
  ["basic", "Basic"],
  ["simple", "Simple"],
  ["complete", "Complete"],
  ["palletizing", "Palletizing"],
];

export function toolbarLayoutByName(name: string): (typeof TOOLBAR_LAYOUTS)[number] | null {
  const n = name.toLowerCase();
  return TOOLBAR_SETS.find(([set]) => n.startsWith(set))?.[1] ?? null;
}

 
export const NAV_STYLES = ["robocraft", "classic"] as const;
export type NavStyle = (typeof NAV_STYLES)[number];

 
const LEGACY_CLASSIC_NAV = "robodk";

export function navStyle(settings: Record<string, unknown>): NavStyle {
  return settings.RC_NAV_STYLE === "classic" || settings.RC_NAV_STYLE === LEGACY_CLASSIC_NAV ? "classic" : "robocraft";
}
