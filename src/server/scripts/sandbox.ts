// Runs JavaScript robotics scripts in a resource-limited QuickJS sandbox.
 
 
 
 
 
 

import "server-only";
import variant from "@jitl/quickjs-singlefile-cjs-release-asyncify";
import { newQuickJSAsyncWASMModuleFromVariant, type QuickJSAsyncContext, type QuickJSHandle } from "quickjs-emscripten-core";
import { SCRIPT_LIMITS } from "@/engine/scripts";
import { PRELUDE, PRELUDE_FILE } from "./prelude";

export const SCRIPT_FILE = "script.js";

export interface SandboxHost {
   
  call(name: string, params: unknown): Promise<unknown>;
  log(line: string): void;
   
  aborted(): boolean;
}

export interface SandboxError {
  message: string;
  line?: number;
  column?: number;
   
  source?: string;
  stack?: string;
}

export interface SandboxOutcome {
  ok: boolean;
  result?: unknown;
  error?: SandboxError;
  calls: number;
}

export type ScriptLimits = { -readonly [K in keyof typeof SCRIPT_LIMITS]: number };

 
function locate(stack: string | undefined): { line?: number; column?: number } {
  const m = stack ? new RegExp(`${SCRIPT_FILE.replace(".", "\\.")}:(\\d+)(?::(\\d+))?`).exec(stack) : null;
  return m ? { line: Number(m[1]), column: m[2] ? Number(m[2]) : undefined } : {};
}

function toError(ctx: QuickJSAsyncContext, handle: QuickJSHandle): SandboxError {
  let dumped: unknown;
  try {
    dumped = ctx.dump(handle);
  } catch {
    dumped = "Unknown error";
  }
  if (dumped && typeof dumped === "object") {
    const e = dumped as { name?: string; message?: string; stack?: string };
    const name = e.name && e.name !== "Error" ? `${e.name}: ` : "";
    const message = e.message === "interrupted" ? "Script stopped (time limit or Stop)" : `${name}${e.message ?? String(dumped)}`;
    return { message, stack: e.stack, ...locate(e.stack) };
  }
  return { message: String(dumped) };
}

function dispose(...items: { dispose(): void; alive?: boolean }[]) {
  for (const it of items) {
    try {
      if (it.alive !== false) it.dispose();
    } catch {
       
    }
  }
}

export async function runInSandbox(code: string, host: SandboxHost, limits: ScriptLimits = { ...SCRIPT_LIMITS }): Promise<SandboxOutcome> {
  const mod = await newQuickJSAsyncWASMModuleFromVariant(variant as never);
  const rt = mod.newRuntime();
  rt.setMemoryLimit(limits.memoryBytes);
  rt.setMaxStackSize(limits.stackBytes);
  const deadline = Date.now() + limits.timeMs;
  rt.setInterruptHandler(() => host.aborted() || Date.now() > deadline);
  const ctx = rt.newContext();
  let calls = 0;

  const guard = () => {
    if (host.aborted()) throw new Error("Script stopped");
    if (Date.now() > deadline) throw new Error(`Script time limit reached (${Math.round(limits.timeMs / 1000)} s)`);
  };

  const callFn = ctx.newAsyncifiedFunction("__mb_call", async (nameH, paramsH) => {
    guard();
    if (++calls > limits.calls) throw new Error(`Script call limit reached (${limits.calls} engine calls)`);
    const name = ctx.getString(nameH);
    let params: unknown;
    try {
      params = JSON.parse(ctx.getString(paramsH));
    } catch {
      throw new Error(`Invalid parameters for ${name}`);
    }
    const result = await host.call(name, params);
    guard();
    return ctx.newString(JSON.stringify(result ?? null));
  });
  const sleepFn = ctx.newAsyncifiedFunction("__mb_sleep", async (msH) => {
    guard();
    const ms = Math.max(0, Math.min(ctx.getNumber(msH), deadline - Date.now()));
    await new Promise((r) => setTimeout(r, ms));
    guard();
  });
  const logFn = ctx.newFunction("__mb_log", (textH) => {
    host.log(ctx.getString(textH));
  });
  ctx.setProp(ctx.global, "__mb_call", callFn);
  ctx.setProp(ctx.global, "__mb_sleep", sleepFn);
  ctx.setProp(ctx.global, "__mb_log", logFn);
  dispose(callFn, sleepFn, logFn);

  try {
    const pre = await ctx.evalCodeAsync(PRELUDE, PRELUDE_FILE);
    if (pre.error) {
      const err = toError(ctx, pre.error);
      dispose(pre.error);
      return { ok: false, error: { message: `Script API failed to start: ${err.message}` }, calls };
    }
    dispose(pre.value);

    const res = await ctx.evalCodeAsync(code, SCRIPT_FILE);
    let outcome: SandboxOutcome;
    if (res.error) {
      const error = toError(ctx, res.error);
      const source = error.line ? code.split("\n")[error.line - 1]?.trim() : undefined;
      outcome = { ok: false, error: source ? { ...error, source: source.slice(0, 240) } : error, calls };
      dispose(res.error);
    } else {
      let result: unknown;
      try {
        result = ctx.dump(res.value);
        JSON.stringify(result);
      } catch {
        result = undefined;
      }
      dispose(res.value);
      outcome = { ok: true, result: typeof result === "function" ? undefined : result, calls };
    }
     
    if (!host.aborted()) {
      const fin = await ctx.evalCodeAsync("__mbFinish()", "finish.js");
      if (fin.error) {
        const err = toError(ctx, fin.error);
        dispose(fin.error);
        if (outcome.ok) outcome = { ok: false, error: { message: `Program generation failed: ${err.message}` }, calls };
      } else dispose(fin.value);
    }
    return { ...outcome, calls };
  } finally {
    dispose(ctx, rt);
  }
}
