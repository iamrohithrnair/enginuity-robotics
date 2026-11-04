 
 
 
 
 

import type { Item, Workspace, WorkspacePatch } from "./types";

type MetaKey = keyof NonNullable<WorkspacePatch["meta"]> & keyof Workspace;







export type Op =
  | { kind: "set"; id: string; before: Partial<Item>; after: Partial<Item> }
  | { kind: "add"; item: Item; parent: string | null; index: number }
  | { kind: "remove"; item: Item; parent: string | null; index: number }
  | { kind: "meta"; key: MetaKey; before: unknown; after: unknown };

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export class Tx {
  readonly ops: Op[] = [];
   
  readonly splits: { at: number; label: string }[] = [];
  readonly touched = new Set<string>();
  readonly removed = new Set<string>();
  readonly metaTouched = new Set<MetaKey>();
   
  private ownedLists = new Set<string>();

  constructor(readonly ws: Workspace) {}

  get(id: string): Item {
    const it = this.ws.items[id];
    if (!it) throw new Error(`Invalid item provided: The item identifier provided is not valid or it does not exist.`);
    return it;
  }

   
  set(id: string, patch: Partial<Item>): void {
    if ("children" in patch) this.ownedLists.delete(id);
    const it = this.get(id);
    const before: Partial<Item> = {};
    const after: Partial<Item> = {};
    let changed = false;
    for (const k of Object.keys(patch) as (keyof Item)[]) {
      const nv = patch[k];
      if (JSON.stringify(it[k]) === JSON.stringify(nv)) continue;
      (before as Record<string, unknown>)[k] = clone(it[k]);
      (after as Record<string, unknown>)[k] = clone(nv);
      (it as unknown as Record<string, unknown>)[k] = clone(nv);
      changed = true;
    }
    if (changed) {
      this.ops.push({ kind: "set", id, before, after });
      this.touched.add(id);
    }
  }

   
  add(item: Item, parent: string | null, index?: number): Item {
    this.ws.items[item.id] = item;
    item.parent = parent;
    let idx = -1;
    if (parent) {
      const children = this.childList(parent);
      idx = index === undefined || index < 0 || index > children.length ? children.length : index;
      children.splice(idx, 0, item.id);
      this.touched.add(parent);
    }
    this.ops.push({ kind: "add", item: clone(item), parent, index: idx });
    this.touched.add(item.id);
    return item;
  }

  




  split(label: string): void {
    const prev = this.splits.at(-1)?.at ?? 0;
    if (this.ops.length > prev) this.splits.push({ at: this.ops.length, label });
  }

   
  remove(id: string, perNode?: (item: Item) => void): void {
    const it = this.get(id);
    for (const c of it.children.slice().reverse()) this.remove(c, perNode);
    const fresh = this.get(id);
    let idx = -1;
    if (fresh.parent && this.ws.items[fresh.parent]) {
      const children = this.childList(fresh.parent);
       
      idx = children.lastIndexOf(id);
      if (idx >= 0) children.splice(idx, 1);
      this.touched.add(fresh.parent);
    }
    this.ops.push({ kind: "remove", item: clone(fresh), parent: fresh.parent, index: idx });
    delete this.ws.items[id];
    this.removed.add(id);
    this.touched.delete(id);
    perNode?.(fresh);
  }

   
  private childList(parentId: string): string[] {
    const p = this.get(parentId);
    if (!this.ownedLists.has(parentId)) {
      p.children = p.children.slice();
      this.ownedLists.add(parentId);
    }
    return p.children;
  }

  setMeta<K extends MetaKey>(key: K, value: Workspace[K]): void {
    const before = clone(this.ws[key]);
    if (JSON.stringify(before) === JSON.stringify(value)) return;
    (this.ws as unknown as Record<string, unknown>)[key] = clone(value);
    this.ops.push({ kind: "meta", key, before, after: clone(value) });
    this.metaTouched.add(key);
  }

  get changed(): boolean {
    return this.ops.length > 0;
  }

  patch(): WorkspacePatch {
    const meta: Record<string, unknown> = {};
    for (const k of this.metaTouched) meta[k] = clone(this.ws[k]);
    return {
      rev: this.ws.rev,
      upserts: [...this.touched].filter((id) => this.ws.items[id]).map((id) => clone(this.ws.items[id])),
      removes: [...this.removed],
      meta: Object.keys(meta).length ? (meta as WorkspacePatch["meta"]) : undefined,
    };
  }
}

 
export function replay(ws: Workspace, ops: Op[], direction: "undo" | "redo"): WorkspacePatch {
  const touched = new Set<string>();
  const removed = new Set<string>();
  const metaTouched = new Set<MetaKey>();
  const seq = direction === "undo" ? ops.slice().reverse() : ops;
  const owned = new Set<string>();
  const childList = (id: string | null, index: number): string[] | null => {
    const p = id && index >= 0 ? ws.items[id] : undefined;
    if (!p) return null;
    if (!owned.has(p.id)) {
      p.children = p.children.slice();
      owned.add(p.id);
    }
    touched.add(p.id);
    return p.children;
  };
  for (const op of seq) {
    if (op.kind === "set") {
      const it = ws.items[op.id];
      if (!it) continue;
      Object.assign(it, clone(direction === "undo" ? op.before : op.after));
      touched.add(op.id);
    } else if (op.kind === "meta") {
      (ws as unknown as Record<string, unknown>)[op.key] = clone(direction === "undo" ? op.before : op.after);
      metaTouched.add(op.key);
    } else {
      const adding = (op.kind === "add") === (direction === "redo");
      const list = childList(op.parent, op.index);
      if (adding) {
        ws.items[op.item.id] = clone(op.item);
        list?.splice(Math.min(op.index, list.length), 0, op.item.id);
        touched.add(op.item.id);
        removed.delete(op.item.id);
      } else {
        delete ws.items[op.item.id];
        if (list) {
          const at = list[op.index] === op.item.id ? op.index : list.lastIndexOf(op.item.id);
          if (at >= 0) list.splice(at, 1);
        }
        removed.add(op.item.id);
        touched.delete(op.item.id);
      }
    }
  }
  const meta: Record<string, unknown> = {};
  for (const k of metaTouched) meta[k] = clone(ws[k]);
  return {
    rev: ws.rev,
    upserts: [...touched].filter((id) => ws.items[id]).map((id) => clone(ws.items[id])),
    removes: [...removed],
    meta: Object.keys(meta).length ? (meta as WorkspacePatch["meta"]) : undefined,
  };
}

 
function mergePatches(ws: Workspace, patches: WorkspacePatch[]): WorkspacePatch {
  const ids = new Set<string>();
  const metaKeys = new Set<string>();
  for (const p of patches) {
    for (const u of p.upserts) ids.add(u.id);
    for (const r of p.removes) ids.add(r);
    for (const k of Object.keys(p.meta ?? {})) metaKeys.add(k);
  }
  const meta: Record<string, unknown> = {};
  for (const k of metaKeys) meta[k] = clone((ws as unknown as Record<string, unknown>)[k]);
  return {
    rev: ws.rev,
    upserts: [...ids].filter((id) => ws.items[id]).map((id) => clone(ws.items[id])),
    removes: [...ids].filter((id) => !ws.items[id]),
    meta: metaKeys.size ? (meta as WorkspacePatch["meta"]) : undefined,
  };
}

export interface UndoEntry {
  label: string;
  ops: Op[];
  at: number;
}





export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  



  private cleanAt = 0;
  constructor(public limit = 0) {}

  push(entry: UndoEntry) {
     
    if (this.cleanAt > this.done.length) this.cleanAt = -1;
    this.done.push(entry);
    this.undone = [];
    if (this.limit > 0 && this.done.length > this.limit) {
      const drop = this.done.length - this.limit;
      this.done.splice(0, drop);
      this.cleanAt = this.cleanAt >= drop ? this.cleanAt - drop : -1;
    }
  }

   
  get index() {
    return this.done.length;
  }

   
  isClean = () => this.cleanAt === this.done.length;

  setClean() {
    this.cleanAt = this.done.length;
  }

  canUndo = () => this.done.length > 0;
  canRedo = () => this.undone.length > 0;
  undoLabel = () => this.done.at(-1)?.label ?? null;
  redoLabel = () => this.undone.at(-1)?.label ?? null;

  undo(ws: Workspace): WorkspacePatch | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return replay(ws, e.ops, "undo");
  }

  redo(ws: Workspace): WorkspacePatch | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return replay(ws, e.ops, "redo");
  }

  



  undoTo(ws: Workspace, index: number): WorkspacePatch | null {
    const target = Math.max(0, Math.min(this.done.length + this.undone.length, Math.round(index)));
    const patches: WorkspacePatch[] = [];
    while (this.done.length > target) patches.push(this.undo(ws)!);
    while (this.done.length < target) patches.push(this.redo(ws)!);
    return patches.length ? mergePatches(ws, patches) : null;
  }

   
  clear() {
    this.done = [];
    this.undone = [];
    this.cleanAt = 0;
  }

  get size() {
    return this.done.length + this.undone.length;
  }

  list() {
    return {
      index: this.done.length,
      clean: this.isClean(),
      cleanIndex: this.cleanAt,
      undo: this.done.map((e) => e.label),
      redo: this.undone.map((e) => e.label).reverse(),
    };
  }
}





export class UndoGroup {
  private stacks = new Map<string, UndoStack>();
  constructor(public limit = 0) {}

  stack(station: string | null): UndoStack {
    const key = station ?? "";
    let s = this.stacks.get(key);
    if (!s) {
      s = new UndoStack(this.limit);
      this.stacks.set(key, s);
    }
    return s;
  }

  active(ws: Workspace): UndoStack {
    return this.stack(ws.activeStation);
  }

   
  drop(station: string) {
    this.stacks.delete(station);
  }

  



  setLimit(limit: number, ws: Workspace): boolean {
    if (this.active(ws).size > 0) return false;
    this.limit = limit;
    for (const s of this.stacks.values()) if (s.size === 0) s.limit = limit;
    return true;
  }

  clearAll() {
    this.stacks.clear();
  }
}








export class UndoMacro {
  private entries = new Map<UndoStack, UndoEntry[]>();
   
  private order: UndoEntry[] = [];
  constructor(readonly label: string) {}

  add(stack: UndoStack, entry: UndoEntry) {
    const list = this.entries.get(stack) ?? [];
    list.push(entry);
    this.entries.set(stack, list);
    this.order.push(entry);
  }

   
  get size() {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }

   
  commit(): UndoStack[] {
    const out: UndoStack[] = [];
    for (const [stack, list] of this.entries) {
      if (!list.length) continue;
      stack.push({ label: this.label, ops: list.flatMap((e) => e.ops), at: list[0].at });
      out.push(stack);
    }
    this.entries.clear();
    this.order = [];
    return out;
  }

   
  revert(ws: Workspace): WorkspacePatch | null {
    const ops = this.order.flatMap((e) => e.ops);
    this.entries.clear();
    this.order = [];
    return ops.length ? replay(ws, ops, "undo") : null;
  }
}
