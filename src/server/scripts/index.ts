// Manages sandbox script runs, stored scripts and generated program results.
 
 
 
 

import "server-only";
import { randomUUID } from "node:crypto";
import type { DispatchResult } from "@/engine/dispatch";
import type { WorkspacePatch } from "@/engine/types";
import { getCommand } from "@/engine/registry";
import { SCRIPT_LIMITS, type ScriptGenerated, type ScriptItemRef, type ScriptRunResult, type ScriptServices } from "@/engine/scripts";
import { UndoMacro } from "@/engine/tx";
import type { Item, Workspace } from "@/engine/types";
import { runInSandbox, type ScriptLimits } from "./sandbox";

export interface ScriptEnv {
  




  call(name: string, params: unknown, macro: UndoMacro, station: string | null): Promise<DispatchResult>;
  workspace(): Workspace;
  emit?(e: { type: string; [k: string]: unknown }): void;
   
  afterCommit?(): void;
   
  revert?(revert: () => WorkspacePatch | null): Promise<void>;
   
  flush?(): Promise<void>;
  limits?: Partial<ScriptLimits>;
}

 
const BLOCKED = /^script\./;
 
const MAX_INLINE = 20_000;

const ref = (it: Pick<Item, "id" | "name" | "type">): ScriptItemRef => ({ id: it.id, name: it.name, type: it.type });

function generatedOf(result: unknown): ScriptGenerated | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { program?: unknown; post?: unknown; files?: { name: string; path?: string; content?: string }[] };
  return {
    program: String(r.program ?? ""),
    post: String(r.post ?? ""),
    files: (r.files ?? []).map((f) => {
      const text = typeof f.content === "string" ? f.content : "";
      return { name: f.name, path: f.path, bytes: text.length, ...(text.length <= MAX_INLINE ? { content: text } : {}) };
    }),
  };
}

export function createScriptService(env: ScriptEnv): ScriptServices {
  const active = new Map<string, { name: string; since: number; stop: boolean }>();
  return {
    running: () => [...active].map(([run, a]) => ({ run, name: a.name, since: a.since })),
    stop(run) {
      const a = active.get(run);
      if (!a) return false;
      a.stop = true;
      return true;
    },
    async run(req): Promise<ScriptRunResult> {
      const run = req.run && !active.has(req.run) ? req.run : randomUUID().slice(0, 8);
      const limits: ScriptLimits = { ...SCRIPT_LIMITS, ...env.limits };
      const state = { name: req.name, since: Date.now(), stop: false };
      active.set(run, state);
      const macro = new UndoMacro(`Script: ${req.name}`);
      const before = new Map(Object.values(env.workspace().items).map((i) => [i.id, ref(i)]));
       
      let station = env.workspace().activeStation ?? null;
      const touched = new Set<string>();
      const generated: ScriptGenerated[] = [];
      const logs: string[] = [];
      let logBytes = 0;
      let truncated = false;
      const t0 = Date.now();
      env.emit?.({ type: "script", phase: "start", run, name: req.name });
      let outcome;
      try {
        outcome = await runInSandbox(
          req.code,
          {
            aborted: () => state.stop,
            log(line) {
              if (truncated) return;
              logBytes += line.length + 1;
              if (logBytes > limits.logBytes) {
                truncated = true;
                logs.push(`… output truncated at ${limits.logBytes / 1000} kB`);
                return;
              }
              logs.push(line);
              env.emit?.({ type: "script-log", run, line });
            },
            async call(rawName, params) {
               
              const name = getCommand(rawName) ? rawName : rawName.replace(/_/g, ".");
              const def = getCommand(name);
              if (!def) throw new Error(`Unknown command: ${name}`);
              if (def.internal || BLOCKED.test(name)) throw new Error(`Scripts can't call ${name}`);
              const res = await env.call(name, params, macro, station);
              if (res.code === "station_changed") throw new Error(`${res.error} during the run, so the script stopped`);
               
              station = env.workspace().activeStation ?? null;
              if (res.patch) {
                for (const u of res.patch.upserts) touched.add(u.id);
                for (const id of res.patch.removes) touched.add(id);
              }
              if (!res.ok) throw new Error(res.error ?? `${name} failed`);
              if (name === "program.generate") {
                const g = generatedOf(res.result);
                if (g) generated.push(g);
              }
              return res.result;
            },
          },
          limits,
        );
      } finally {
        active.delete(run);
        await env.flush?.();
      }
       
      const ws = env.workspace();
      const created: ScriptItemRef[] = [];
      const changed: ScriptItemRef[] = [];
      const deleted: ScriptItemRef[] = [];
      for (const id of touched) {
        const now = ws.items[id];
        const was = before.get(id);
        if (now && !was) created.push(ref(now));
        else if (now && was) changed.push(ref(now));
        else if (!now && was) deleted.push(was);
      }
      const steps = macro.size;
      const reverted = !outcome.ok && steps > 0 && !req.keepOnError;
      if (reverted) {
        if (env.revert) await env.revert(() => macro.revert(ws));
        else macro.revert(ws);
      } else {
        macro.commit();
        if (steps) env.afterCommit?.();
      }
      const ms = Date.now() - t0;
      env.emit?.({ type: "script", phase: "end", run, name: req.name, ok: outcome.ok, ms });
      return {
        ok: outcome.ok,
        run,
        name: req.name,
        logs,
        ...(truncated ? { truncated } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
        calls: outcome.calls,
        ms,
        created,
        changed,
        deleted,
        generated,
        undo: steps && !reverted ? macro.label : null,
        ...(reverted ? { reverted } : {}),
      };
    },
  };
}
