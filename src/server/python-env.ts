// Manages the Python environment and allowlisted dependency installation.
 
 
 
 
 
 

import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

export const PYTHON_ENV_DIR = process.env.ENGINUITY_PYTHON_ENV ? path.resolve(process.env.ENGINUITY_PYTHON_ENV) : path.join(  DATA_DIR, "python-env");

const ENV_TOOLS = path.join(  process.cwd(), "python", "env");
export const PYTHON_ENV_SETUP = path.join(ENV_TOOLS, "setup_env.py");
export const PYTHON_ENV_ALLOWLIST = path.join(ENV_TOOLS, "allowlist.json");

 
export function envPython(dir = PYTHON_ENV_DIR): string {
  return process.platform === "win32" ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python3");
}

 
export function managedPython(): string | null {
  const py = envPython();
  return existsSync(py) ? py : null;
}

interface Allowlist {
  modules: Record<string, { packages: string[] }>;
  packages: Record<string, { license: string; home: string; pins: { version: string; marker?: string }[] }>;
}

let cached: Allowlist | null = null;
export function allowlist(): Allowlist {
  cached ??= JSON.parse(readFileSync(PYTHON_ENV_ALLOWLIST, "utf8")) as Allowlist;
  return cached;
}

 
export const installable = (module: string) => Object.hasOwn(allowlist().modules, module);

export interface InstallResult {
  ok: boolean;
   
  log: string;
}

const pending = new Map<string, Promise<InstallResult>>();







export function installModules(modules: string[], base: string, onLine: (line: string) => void, onChild?: (child: ChildProcess) => void): Promise<InstallResult> {
  const key = [...modules].sort().join(" ");
  const running = pending.get(key);
  if (running) return running;
  const job = new Promise<InstallResult>((resolve) => {
    let log = "";
    let child: ChildProcess;
    try {
      child = spawn(base, ["-I", "-u", PYTHON_ENV_SETUP, "--env", PYTHON_ENV_DIR, ...modules], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, log: String(e) });
      return;
    }
    onChild?.(child);
    let partial = "";
    const take = (d: Buffer) => {
      const text = d.toString("utf8");
      log = (log + text).slice(-4000);
      partial += text;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) onLine(l.trim());
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
     
    child.on("error", (e) => resolve({ ok: false, log: `${log}\n${e.message}`.trim() }));
    child.on("close", (code) => resolve({ ok: code === 0, log: log.trim() }));
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
