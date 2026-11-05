// Validates command arguments, resolves item references and dispatches transactional handlers.
 
 
 

import { CommandError, getCommand, type CmdCtx, type Origin, type Services } from "./registry";
import { Tx, UndoMacro, UndoStack, type UndoEntry } from "./tx";
import type { Item, Workspace, WorkspacePatch } from "./types";
import { byHandle, findByName } from "./workspace";

export interface DispatchResult {
  ok: boolean;
  result?: unknown;
  error?: string;
   
  code?: string;
  patch?: WorkspacePatch;
}

 
export function resolveRef(ws: Workspace, ref: string | number | null | undefined): Item | undefined {
  if (ref === null || ref === undefined || ref === "") return undefined;
  if (typeof ref === "number") return byHandle(ws, ref);
  if (ws.items[ref]) return ws.items[ref];
  if (/^\d+$/.test(ref)) {
    const h = byHandle(ws, Number(ref));
    if (h) return h;
  }
  return findByName(ws, ref);
}

export function requireRef(ws: Workspace, ref: string | number | null | undefined, what = "item"): Item {
  const it = resolveRef(ws, ref);
  if (!it) throw new CommandError(`Invalid item provided: The item identifier provided is not valid or it does not exist. (${what}: ${String(ref)})`, "invalid_item");
  return it;
}

export async function dispatch(
  ws: Workspace,
  undo: UndoStack,
  services: Services,
  name: string,
  params: unknown,
  origin: Origin,
  




  opts: { macro?: UndoMacro; station?: string | null } = {},
): Promise<DispatchResult> {
  const def = getCommand(name);
  if (!def) return { ok: false, error: `Unknown command: ${name}` };
  if (opts.station !== undefined && (ws.activeStation ?? null) !== opts.station) {
    const label = (id: string | null | undefined) => (id ? (ws.items[id]?.name ?? id) : "(none)");
    return { ok: false, code: "station_changed", error: `The active station changed from "${label(opts.station)}" to "${label(ws.activeStation)}" (someone switched stations)` };
  }
  const parsed = def.schema.safeParse(params ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid parameters for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}` };
  }
  const tx = new Tx(ws);
  const ctx: CmdCtx = { ws, tx, origin, services };
  const record = (entry: UndoEntry) => (opts.macro ? opts.macro.add(undo, entry) : undo.push(entry));
  try {
    const result = await def.run(ctx, parsed.data);
    if (tx.changed) {
      ws.rev += 1;
      if (def.undoable !== false && !def.readonly) {
         
         
        let from = 0;
        const at = Date.now();
        for (const sp of tx.splits) {
          record({ label: sp.label, ops: tx.ops.slice(from, sp.at), at });
          from = sp.at;
        }
        if (from < tx.ops.length && ctx.undoLabel !== null) record({ label: ctx.undoLabel ?? def.title, ops: tx.ops.slice(from), at });
      }
    }
    return { ok: true, result, patch: tx.changed ? tx.patch() : undefined };
  } catch (err) {
     
    if (tx.changed) {
      const { replay } = await import("./tx");
      replay(ws, tx.ops, "undo");
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, code: err instanceof CommandError ? err.code : undefined };
  }
}
