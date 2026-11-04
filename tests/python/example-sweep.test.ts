 
 
 
 
 
 
 
 
 
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { isOriginalPackage } from "@/engine/python-imports";
import { LIBRARY_KIND_DIR } from "../library";

const ROOT = path.resolve(__dirname, "../..");
const LIB = LIBRARY_KIND_DIR("stations");
const enabled = process.env.ENGINUITY_SWEEP === "1" && existsSync(LIB);
const OUT = process.env.ENGINUITY_SWEEP_OUT ?? path.join(ROOT, "research/evidence/python-api/example-sweep.json");
const TIMEOUT = Number(process.env.SWEEP_TIMEOUT_MS ?? 12_000);
const ONLY = process.env.ENGINUITY_SWEEP_ONLY ? new RegExp(process.env.ENGINUITY_SWEEP_ONLY) : null;

type Srv = ReturnType<typeof import("@/server/store").getServer>;
let srv: Srv;
let api: RdkApiServer;
let run: typeof import("@/server/store").run;

interface Result {
  station: string;
  script: string;
  outcome: "ok" | "running-at-timeout" | "error" | "skipped" | "not-started";
  category?: string;
  detail?: string;
   
  trace?: string;
  seconds?: number;
}

 
function categorize(err: string): { category: string; detail: string } {
  const lines = err.trim().split("\n").filter(Boolean);
  const last = lines.at(-1) ?? "";
  const pick = (category: string) => ({ category, detail: last.slice(0, 300) });
  if (/Missing parentheses in call to 'print'/.test(err)) return pick("python-2-print");
  if (/^SyntaxError|^TabError|^IndentationError/.test(last)) return pick("syntax-error");
  const mod = /No module named '([^']+)'/.exec(err);
  if (mod) return { category: /^(robolink|robomath|robodialogs|robofileio|enginuity)/.test(mod[1]) || isOriginalPackage(mod[1].split(".")[0]) ? "api-import" : `third-party-module:${mod[1].split(".")[0]}`, detail: last.slice(0, 300) };
  if (/NotSupportedError/.test(last)) return pick("not-supported-command");
  if (/InvalidItemError/.test(last)) return pick("invalid-item");
  if (/TargetReachError/.test(last)) return pick("target-reach");
  if (/EnginuityTimeoutError|EnginuityConnectionError/.test(last)) return pick("connection");
  if (/InputError|EnginuityError/.test(last)) return pick("api-error");
  if (/AttributeError: .*'(Enginuity|Item|Mat)'/.test(last)) return pick("missing-api-attribute");
  if (/NameError/.test(last)) return pick("name-error");
  return pick("script-error");
}

 
function scriptTrace(err: string): string {
  const lines = err.trim().split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*File "([^"]+)"/.exec(lines[i]);
    if (m && m[1].includes(`${path.sep}enginuity${path.sep}`)) {
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.slice(-8).join("\n").slice(0, 900);
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-sweep-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  api = await startRdkApiServer({ ports: [0], log: () => undefined });
  srv.services.settings.RC_API_PORT = api.port;
  srv.flags.Popups = "0";
  srv.services.settings.RC_PYTHON_OUTPUT = "Never";
}, 60_000);

afterAll(async () => {
  await api?.close();
});

type Runner = import("@/server/python-runner").PythonRunner;
let runner: Runner;

 
function runScript(id: string): Promise<{ code: number | null; err: string; timedOut: boolean; seconds: number }> {
  const it = srv.ws.items[id];
  const t0 = Date.now();
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      runner.stop(id);
    }, TIMEOUT);
    runner.start(id, it.name, it.python?.code ?? "", {
      onEnd: (r) => {
        clearTimeout(timer);
        resolve({ code: r.exitCode, err: r.err, timedOut, seconds: (Date.now() - t0) / 1000 });
      },
    });
  });
}

describe.skipIf(!enabled)("example stations: Python programs run unmodified (sweep)", () => {
  it("runs every Python program of every example station", async () => {
    const { PythonRunner } = await import("@/server/python-runner");
     
    runner = new PythonRunner(srv, (key, busy) => void run("sim.setBusy", { program: key, busy }, "system"));
    srv.services.python = runner.service();
    const results: Result[] = [];
    const files = readdirSync(LIB).filter((f) => /\.rdk$/i.test(f) && (!ONLY || ONLY.test(f))).sort();
    for (const file of files) {
      const opened = await run("station.openRdk", { base64: readFileSync(path.join(LIB, file)).toString("base64"), name: file.replace(/\.rdk$/i, "") }, "ui");
      if (!opened.ok) continue;
      const st = srv.ws.activeStation!;
      const inStation = (id: string) => {
        for (let cur = srv.ws.items[id]; cur; cur = cur.parent ? srv.ws.items[cur.parent] : (undefined as never)) if (cur.id === st) return true;
        return false;
      };
      const pys = Object.values(srv.ws.items).filter((it) => it.type === "python" && inStation(it.id));
      for (const py of pys) {
        const code = py.python?.code ?? "";
        const base = { station: file, script: py.name };
        if (/^\s*(from\s+tkinter|import\s+tkinter|from\s+Tkinter|import\s+Tkinter)/m.test(code)) {
          results.push({ ...base, outcome: "skipped", category: "desktop-gui-tkinter" });
          continue;
        }
        if (!srv.ws.items[py.id]) {
          results.push({ ...base, outcome: "not-started", category: "deleted-by-an-earlier-script" });
          continue;
        }
        const r = await runScript(py.id);
        if (r.timedOut) results.push({ ...base, outcome: "running-at-timeout", seconds: r.seconds, detail: r.err.trim().split("\n").at(-1)?.slice(0, 200) });
        else if (r.code === 0) results.push({ ...base, outcome: "ok", seconds: r.seconds });
        else results.push({ ...base, outcome: "error", seconds: r.seconds, ...categorize(r.err), trace: scriptTrace(r.err) });
        await run("sim.stop", {}, "system");
      }
      if (srv.ws.items[st]) await run("station.close", { station: st, ifUnsaved: "discard" }, "ui");
    }
    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    const categories: Record<string, number> = {};
    for (const r of results) if (r.category) categories[`${r.outcome}:${r.category}`] = (categories[`${r.outcome}:${r.category}`] ?? 0) + 1;
    const { pythonInterpreter } = await import("@/server/python-runner");
    const interp = pythonInterpreter(srv.services.settings);
    const version = spawnSync(interp.exe, ["-I", "-c", "import sys; print(sys.version.split()[0])"], { encoding: "utf8" }).stdout.trim();
    const interpreter = `${interp.managed ? "Enginuity's Python environment" : interp.exe}, Python ${version}`;
    const summary = { interpreter, stations: files.length, scripts: results.length, ok: count("ok"), runningAtTimeout: count("running-at-timeout"), error: count("error"), skipped: count("skipped"), notStarted: count("not-started"), timeoutMs: TIMEOUT, categories };
    mkdirSync(path.dirname(OUT), { recursive: true });
     
    const text = JSON.stringify({ summary, results }, null, 1).split(ROOT).join("<repo>").split(os.tmpdir()).join("<tmp>");
    writeFileSync(OUT, text);
    expect(results.length).toBeGreaterThan(0);
  }, 6 * 3600_000);
});
