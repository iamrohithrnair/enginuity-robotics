"use client";

import { create } from "zustand";
import { useMemo } from "react";
import type { Mat } from "@/engine/math";
import type { Item, ViewState, Workspace, WorkspacePatch } from "@/engine/types";
import { DEFAULT_VIEW } from "@/engine/view";

export type Panel = "inspector" | "chat" | "none";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  title: string;
  body?: string;
}

export interface ViewEvent {
  seq: number;
  action: "preset" | "fit" | "toggle" | "pose";
   
  pose?: number[];
  view?: string;
  items?: string[] | null;
  what?: string;
}

 
export interface ServerDialog {
  id: string;
  title: string;
  html: string;
  buttons: string[];
   
  input?: string;
}

 
export interface Picker {
  title: string;
  label: string;
  items: string[];
  onPick(id: string): void;
}

 
export type MoveMode = "default" | "references" | "tools";

 
export interface MeasurePick {
  point: [number, number, number];
  normal?: [number, number, number];
  item?: string;
}

 
export interface DragPreview {
  ids: string[];
  motion: Mat;
}

interface State {
  ws: Workspace | null;
  connected: boolean;
  settings: Record<string, unknown>;
  undo: { undo: string[]; redo: string[] };
  rightPanel: Panel;
  libraryOpen: boolean;
   
  libraryKind: "robot" | "tool" | "axis" | "station" | "simready";
  paletteOpen: boolean;
  settingsOpen: boolean;
  codeView: { program: string; post: string; files: { name: string; content: string }[] } | null;
  toasts: Toast[];
  view: ViewEvent | null;
   
  liveJoints: Record<string, number[]>;
   
  status: { text: string; at: number; ms: number } | null;
  dialogs: ServerDialog[];
  picker: Picker | null;
   
  currentInstruction: Record<string, string | null>;
   
  jointList: { robot: string; rows: number[][] } | null;
   
  renameFor: string | null;
   
  groupRename: { ids: string[]; label: string; base: string } | null;
   
  rubber: { x0: number; y0: number; x1: number; y1: number } | null;
   
  viewMenu: { x: number; y: number; item: string | null } | null;
   
  suppressClick: number;
   
  preview: { robot: string; joints: number[][] } | null;
   
  moveMode: MoveMode;
   
  holdPan: boolean;
   
  apiEvents: boolean;
   
  trace: Record<string, number[][]>;
  collisions: string[];
  hover: string | null;
   
  kinReady: boolean;
   
  moveTool: boolean;
   
  drag: DragPreview | null;
   
  colorFor: string[] | null;
   
  measureOpen: boolean;
   
  measure: { a: MeasurePick | null; b: MeasurePick | null };
   
  aboutOpen: boolean;
  helpOpen: boolean;
  apply(patch: WorkspacePatch): void;
   
  applyMany(patches: WorkspacePatch[]): void;
  setSnapshot(ws: Workspace): void;
  toast(t: Omit<Toast, "id">): void;
  dismiss(id: number): void;
  set(p: Partial<State>): void;
}

let toastSeq = 0;
let viewSeq = 0;

export const useRC = create<State>((set, get) => ({
  ws: null,
  connected: false,
  settings: {},
  undo: { undo: [], redo: [] },
  rightPanel: "inspector",
  libraryOpen: false,
  libraryKind: "robot",
  paletteOpen: false,
  settingsOpen: false,
  codeView: null,
  toasts: [],
  view: null,
  liveJoints: {},
  status: null,
  dialogs: [],
  picker: null,
  currentInstruction: {},
  jointList: null,
  renameFor: null,
  groupRename: null,
  rubber: null,
  viewMenu: null,
  suppressClick: 0,
  preview: null,
  moveMode: "default",
  holdPan: false,
  apiEvents: false,
  trace: {},
  collisions: [],
  hover: null,
  kinReady: false,
  moveTool: false,
  drag: null,
  colorFor: null,
  measureOpen: false,
  measure: { a: null, b: null },
  aboutOpen: false,
  helpOpen: false,
  setSnapshot(ws) {
    set({ ws });
  },
  apply(patch) {
    get().applyMany([patch]);
  },
  applyMany(patches) {
    const cur = get().ws;
    if (!cur || !patches.length) return;
    const items: Record<string, Item> = { ...cur.items };
    let ws: Workspace = cur;
    for (const patch of patches) {
      for (const id of patch.removes) delete items[id];
      for (const it of patch.upserts) items[it.id] = it;
      ws = { ...ws, ...(patch.meta ?? {}), rev: patch.rev };
    }
    set({ ws: { ...ws, items } });
  },
  toast(t) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 7000 : 3800);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  set(p) {
    set(p);
  },
}));

export function pushView(e: Omit<ViewEvent, "seq">) {
  useRC.setState({ view: { ...e, seq: ++viewSeq } as ViewEvent });
}

export const itemOf = (id: string | null | undefined) => (id ? useRC.getState().ws?.items[id] : undefined);

 
export function useViewState(): ViewState {
  const raw = useRC((s) => s.ws?.view);
  return useMemo(() => ({ ...DEFAULT_VIEW, ...(raw ?? {}) }), [raw]);
}

export const viewState = (): ViewState => ({ ...DEFAULT_VIEW, ...(useRC.getState().ws?.view ?? {}) });

 
export const moveModeNow = (): MoveMode => {
  const hold = useRC.getState().moveMode;
  return hold !== "default" ? hold : viewState().moveMode;
};
