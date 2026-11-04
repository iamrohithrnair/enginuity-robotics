 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Services } from "@/engine/registry";
import { desktopGuiMessage } from "@/engine/python-gui";
import { isOriginalPackage, rewritePythonImports } from "@/engine/python-imports";
import { installable, installModules, managedPython, PYTHON_ENV_DIR } from "./python-env";
import { DATA_DIR, run, type ServerState } from "./store";

export const codeHash = (code: string) => createHash("sha256").update(code).digest("hex").slice(0, 16);

export const PYTHON_DIR = path.join(  DATA_DIR, "python");

 
export const pyFileName = (name: string) => `${name.replace(/[^A-Za-z0-9_]/g, "") || "Script"}.py`;

export interface PythonResult {
  exitCode: number | null;
  out: string;
  err: string;
  interrupted: boolean;
  seconds: number;
   
  failedToStart?: string;
}

 
export const PYTHON_API_SRC = path.join(  process.cwd(), "python", "enginuity", "src");

 
export const PYTHON_LAUNCHER = path.join(PYTHON_API_SRC, "enginuity", "launch.py");

 
const PIP_NAMES: Record<string, string> = { cv2: "opencv-python", PIL: "Pillow", sklearn: "scikit-learn", skimage: "scikit-image", yaml: "PyYAML", serial: "pyserial" };
 
const API_MODULES = new Set(["enginuity", "robolink", "robomath", "robodialogs", "robofileio", "robolinkutils"]);

 
export function missingModule(err: string): string | null {
  const all = [...err.matchAll(/No module named '([^']+)'/g)];
  return all.length ? all[all.length - 1][1].split(".")[0] : null;
}





export function missingPackageHint(err: string, interpreter: string, inEnv = false): string {
  const top = missingModule(err);
  if (!top || API_MODULES.has(top) || isOriginalPackage(top)) return "";
  const pip = PIP_NAMES[top] ?? top;
  const what = pip === top ? `"${pip}"` : `"${pip}" (module ${top})`;
  const own = installable(top) ? "" : ", which Enginuity does not install by itself";
  return `The script needs the Python package ${what}${own}. Install it for this interpreter with: ${interpreter} -m pip install ${inEnv ? "" : "--user "}${pip}`;
}






export function pythonInterpreter(settings: Record<string, unknown>): { exe: string; managed: boolean; custom: boolean; base: string } {
  const configured = String(settings.Path_PythonRun2 ?? "").trim();
  if (configured && configured !== "python3") return { exe: configured, managed: false, custom: true, base: configured };
  const env = managedPython();
  return { exe: env ?? "python3", managed: !!env, custom: false, base: "python3" };
}

interface StartOptions {
  file?: string;
  args?: string[];
  onEnd?: (r: PythonResult) => void;
   
  installed?: string[];
}

export class PythonRunner {
   
  private procs = new Map<string, { child?: ChildProcess; started: number; stopped: boolean }>();
   
  private agentFiles = new Map<string, string>();

  constructor(
    private state: Pick<ServerState, "services"> & { flags?: Record<string, string> },
     
    private setBusy: (key: string, busy: boolean) => void = (key, busy) => void run("sim.setBusy", { program: key, busy }, "system"),
  ) {}

   
  service(): NonNullable<Services["python"]> {
    return {
      start: (key, name, code, opts) => this.start(key, name, code, opts),
      stop: (key) => this.stop(key),
      isRunning: (key) => this.isRunning(key),
      saveScript: (name, code, opts) => this.saveScript(name, code, opts),
      fileState: (file) => this.fileState(file),
      startFile: (key, name, file) => this.startFile(key, name, file),
      hash: codeHash,
    };
  }

  private emit(e: { type: string; [k: string]: unknown }) {
    this.state.services.emit?.(e);
  }

  private status(text: string, ms = 10000) {
    this.emit({ type: "status", text, ms });
  }

  isRunning(key: string) {
    return this.procs.has(key);
  }

  running() {
    return [...this.procs.keys()];
  }

   
  saveScript(name: string, code: string, opts: { agent?: boolean } = {}): string {
    mkdirSync(PYTHON_DIR, { recursive: true });
    const file = path.join(PYTHON_DIR, pyFileName(name));
    const text = rewritePythonImports(code);
    writeFileSync(file, text);
    if (opts.agent) this.agentFiles.set(file, codeHash(text));
    else this.agentFiles.delete(file);
    return file;
  }

   
  fileState(file: string): { full: string; exists: boolean; agentWritten: boolean; contentHash: string | null; text?: string } {
    const full = path.isAbsolute(file) ? file : path.join(PYTHON_DIR, file);
    if (!existsSync(full)) return { full, exists: false, agentWritten: false, contentHash: null };
    const content = readFileSync(full, "utf8");
    const contentHash = codeHash(content);
     
    return { full, exists: true, agentWritten: this.agentFiles.get(full) === contentHash, contentHash, text: content.length <= 200_000 && !content.includes("\u0000") ? content : undefined };
  }

  



  start(key: string, name: string, code: string, opts: StartOptions = {}) {
    if (this.procs.has(key)) return false;
    const file = opts.file ?? this.saveScript(name, code);
    const settings = this.state.services.settings;
    const interp = pythonInterpreter(settings);
    const exe = interp.exe;
    const env = {
      ...process.env,
      ENGINUITY_API_PORT: String(settings.RC_API_PORT ?? 20500),
      ENGINUITY_HOST: "127.0.0.1",
      PYTHON_EXEC: exe,
    };
    const started = Date.now();
    let out = "";
    let err = "";
    let child: ChildProcess;
    try {
       
       
      const py = file.toLowerCase().endsWith(".py");
      const args = opts.args ?? [];
      if (py && !existsSync(PYTHON_LAUNCHER)) throw new Error(`The Enginuity Python API is missing: ${PYTHON_LAUNCHER} does not exist`);
      child = spawn(py ? exe : file, py ? ["-I", "-u", "-X", "utf8", PYTHON_LAUNCHER, file, ...args] : args, { cwd: path.dirname(file), env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      this.finish(key, name, { exitCode: null, out, err, interrupted: false, seconds: 0, failedToStart: String(e) }, opts.onEnd);
      return true;
    }
    const entry = { child, started, stopped: false };
    this.procs.set(key, entry);
    this.setBusy(key, true);
    this.status("Running python script...");
    let pending = "";
    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString("utf8");
      out += text;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      const last = lines.filter((l) => l.trim()).at(-1);
      if (last) this.status(`Python output: ${last}`);
    });
    child.stderr?.on("data", (d: Buffer) => (err += d.toString("utf8")));
    let spawnError: string | undefined;
    child.on("error", (e) => (spawnError = e.message));
    child.on("close", (status) => {
      this.procs.delete(key);
      const seconds = (Date.now() - started) / 1000;
      const r: PythonResult = { exitCode: status, out, err, interrupted: entry.stopped, seconds, failedToStart: spawnError };
      if (file.toLowerCase().endsWith(".py") && this.installAndRunAgain(key, name, code, opts, r, interp)) return;
      this.finish(key, name, r, opts.onEnd);
    });
    return true;
  }

  





  private installAndRunAgain(key: string, name: string, code: string, opts: StartOptions, r: PythonResult, interp: ReturnType<typeof pythonInterpreter>): boolean {
    if (r.interrupted || r.failedToStart || r.exitCode === 0 || interp.custom) return false;
    const missing = missingModule(r.err);
    if (!missing || API_MODULES.has(missing) || !installable(missing) || opts.installed?.includes(missing)) return false;
    const entry: { child?: ChildProcess; started: number; stopped: boolean } = { started: Date.now(), stopped: false };
    this.procs.set(key, entry);
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    this.status(`Installing ${missing} for ${name}…`, 120000);
    const dialog =
      this.state.flags?.Popups === "0"
        ? undefined
        : this.state.services.progress?.(
            `<strong>Installing ${esc(missing)} for this script…</strong><br>${esc(name)} needs the Python package ${esc(missing)}. Enginuity installs it once, into its own Python environment (${esc(PYTHON_ENV_DIR)}), from its list of pinned, hash-checked packages, then runs the script again.`,
            "Installing a Python package",
          );
    void installModules([missing], interp.base, (line) => this.status(`Installing ${missing}: ${line}`, 120000), (child) => (entry.child = child)).then((res) => {
      dialog?.close();
      this.procs.delete(key);
      const seconds = r.seconds + (Date.now() - entry.started) / 1000;
      if (entry.stopped) {
        this.finish(key, name, { ...r, interrupted: true, seconds }, opts.onEnd);
      } else if (!res.ok) {
        const why = res.log.split("\n").slice(-6).join("\n");
        this.finish(key, name, { ...r, seconds, err: `${r.err.trimEnd()}\n\nEnginuity could not install ${missing}:\n${why}` }, opts.onEnd);
      } else {
        this.status(`${missing} is installed in Enginuity's Python environment. Running ${name} again.`);
        this.start(key, name, code, { ...opts, installed: [...(opts.installed ?? []), missing] });
      }
    });
    return true;
  }

  



  startFile(key: string, name: string, file: string): string | null {
    const full = path.isAbsolute(file) ? file : path.join(PYTHON_DIR, file);
    if (!existsSync(full)) return `File not found: ${full}`;
    if (full.toLowerCase().endsWith(".py")) {
      const gui = desktopGuiMessage(name, readFileSync(full, "utf8"));
      if (gui) {
        this.status(gui);
        return gui;
      }
    }
    this.start(key, name, "", { file: full });
    return null;
  }

  stop(key: string): boolean {
    const p = this.procs.get(key);
    if (!p) return false;
    p.stopped = true;
    p.child?.kill("SIGTERM");
    return true;
  }

  stopAll() {
    for (const k of [...this.procs.keys()]) this.stop(k);
  }

  private finish(key: string, name: string, r: PythonResult, onEnd?: (r: PythonResult) => void) {
    this.setBusy(key, false);
    const mode = String(this.state.services.settings.RC_PYTHON_OUTPUT ?? "If errors");
    if (r.failedToStart) {
      this.status("Failed to run Python script. Set the path to the Python interpreter in: Tools-Options-Python tab.");
    } else if (r.interrupted) {
      this.status(`Python script interrupted. Executed for ${r.seconds.toFixed(1)} s`);
    } else if (r.exitCode === 0) {
      this.status("Python script finished successfully");
      if (mode === "Always") this.showOutput(name, r, false);
    } else {
      this.status(`Python script failed returning ${r.exitCode}`);
      if (mode !== "Never") this.showOutput(name, r, true);
    }
    onEnd?.(r);
  }

  private showOutput(name: string, r: PythonResult, failed: boolean) {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    const interp = pythonInterpreter(this.state.services.settings);
    const missing = failed ? missingPackageHint(r.err, interp.exe, interp.managed) : "";
    const body = failed
      ? `<strong>${esc(name)}</strong><br>Python execution error: <br><span style="color:#d33;font-family:var(--font-mono)">${esc(r.err.trim())}</span>${missing ? `<br><br>${esc(missing)}` : ""}${r.out.trim() ? `<br><br>Python output: <br>${esc(r.out.trim())}` : ""}`
      : `<strong>${esc(name)}</strong><br>${esc(r.out.trim()) || "(no output)"}<br><br><em>You see this window because you chose to always display this output after a Python script finishes successfully.</em>`;
    void this.state.services.ask?.(body, ["OK"], "Python script output");
  }
}
