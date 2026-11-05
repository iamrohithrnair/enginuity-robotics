// Verifies Python call parsing, argument substitution, blocking execution, and API dialogs.
 
 
 
 
 
 
 
 
 
 
 
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, Workspace } from "@/engine/types";
import { findPythonForCall, pythonCallArgs, splitPythonCall } from "@/server/python-calls";
import type { RdkApiServer } from "@/server/rdkapi/server";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "python/enginuity/src");

type Ev = { type: string; [k: string]: unknown };
type Srv = ReturnType<typeof import("@/server/store").getServer>;
let srv: Srv;
let api: RdkApiServer;
let run: typeof import("@/server/store").run;

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-calls-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  api = await startRdkApiServer({ ports: [0], log: () => undefined });
  srv.services.settings.RC_API_PORT = api.port;
}, 60_000);

afterAll(async () => {
  await api?.close();
});

describe("splitPythonCall / pythonCallArgs (FUN_100525444, FUN_100525610, FUN_1004f2338)", () => {
  it("splits the name and keeps empty and untrimmed parts", () => {
    expect(splitPythonCall("Extruder(0)")).toEqual({ name: "Extruder", args: ["0"] });
    expect(splitPythonCall("Extruder")).toEqual({ name: "Extruder", args: [] });
    expect(splitPythonCall("Prog()")).toEqual({ name: "Prog", args: [""] });
    expect(splitPythonCall("Prog(1, 2)")).toEqual({ name: "Prog", args: ["1", " 2"] });
    expect(splitPythonCall("Prog (1)")).toEqual({ name: "Prog ", args: ["1"] });
     
    expect(splitPythonCall("Prog(a, (b)) x")).toEqual({ name: "Prog", args: ["a", " (b x"] });
    expect(splitPythonCall("Say('a,b')")).toEqual({ name: "Say", args: ["'a", "b'"] });
  });

  it("trims each argument and substitutes item.ptr / item.name of the caller", () => {
    const caller = { handle: 1234, name: "Main" } as Item;
    expect(pythonCallArgs([" 0 ", "", "item.ptr", " item.name", "item.nameX"], caller)).toEqual(["0", "", "1234", "Main", "item.nameX"]);
    expect(pythonCallArgs(["item.ptr"], null)).toEqual(["item.ptr"]);
  });

  it("finds the Python program in the caller's folder first, then in the station", () => {
    const item = (id: string, type: Item["type"], name: string, parent: string | null, children: string[] = []) =>
      ({ id, type, name, parent, children, handle: 1, visible: true, pose: [] }) as unknown as Item;
    const items: Record<string, Item> = {
      st: item("st", "station", "S", null, ["pyA", "f1", "f2"]),
      f1: item("f1", "folder", "Calls", "st", ["main", "pyB"]),
      main: item("main", "program", "Main", "f1"),
      pyB: item("pyB", "python", "Extruder", "f1"),
      pyA: item("pyA", "python", "Extruder", "st"),
      f2: item("f2", "folder", "Other", "st", ["pyC"]),
      pyC: item("pyC", "python", " Spaced ", "f2"),
    };
    const ws = { items, activeStation: "st" } as unknown as Workspace;
    expect(findPythonForCall(ws, "Extruder(0)", items.main)?.id).toBe("pyB");
    expect(findPythonForCall(ws, "Extruder(0)", null)?.id).toBe("pyA");
     
    expect(findPythonForCall(ws, " Spaced (1)", null)?.id).toBe("pyC");
    expect(findPythonForCall(ws, "Spaced(1)", null)).toBeUndefined();
    expect(findPythonForCall(ws, "Missing(1)", items.main)).toBeUndefined();
  });
});

async function waitIdle(ms = 60_000) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 30));
  const py = () => Object.values(srv.ws.items).some((it) => it.type === "python" && srv.services.python!.isRunning(it.id));
  while (((srv.ws.busy ?? []).length || py()) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
}

describe("a Program Call runs the Python program with its arguments and waits for it", () => {
  it("Show(7, item.name) → sys.argv[1:] == ['7', 'CallsMain'] before the next instruction", async () => {
    await run("station.new", { name: "Calls" }, "ui");
    const py = (await run("python.add", { name: "Show" }, "ui")).result as { id: string };
    await run("python.setCode", { item: py.id, code: "import sys, time\ntime.sleep(0.3)\nprint('argv', sys.argv[1:])\n" }, "ui");
    const prog = (await run("program.add", { name: "CallsMain" }, "ui")).result as { id: string };
    await run("program.addInstruction", { program: prog.id, kind: "call", text: "Show(7, item.name)" }, "ui");
    await run("program.addInstruction", { program: prog.id, kind: "print", text: "after the call" }, "ui");
    const evs: Ev[] = [];
    const fn = (e: Ev) => void evs.push(e);
    srv.listeners.add(fn);
    try {
      const r = await run("program.run", { program: prog.id }, "ui");
      expect(r.ok, r.error ?? "").toBe(true);
      await waitIdle();
    } finally {
      srv.listeners.delete(fn);
    }
    const statuses = evs.filter((e) => e.type === "status").map((e) => String(e.text));
    const out = statuses.indexOf("Python output: argv ['7', 'CallsMain']");
    const after = statuses.findIndex((t) => t.includes("after the call"));
    expect(out, statuses.join("\n")).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(out);
  }, 60_000);

  it("RDK.RunProgram('Show(1, x)') over the API starts the Python program with its arguments", async () => {
    const r = await python(`
from enginuity import Enginuity
rdk = Enginuity()
rdk.RunProgram("Show(1, x)")
`);
    expect(r.code, r.err).toBe(0);
    const evs: Ev[] = [];
    const fn = (e: Ev) => void evs.push(e);
    srv.listeners.add(fn);
    try {
      await waitIdle();
    } finally {
      srv.listeners.delete(fn);
    }
     
    const py = Object.values(srv.ws.items).find((it) => it.type === "python" && it.name === "Show")!;
    expect(srv.services.python!.isRunning(py.id)).toBe(false);
  }, 60_000);
});

function python(code: string): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(SRC)})\n${code}`], {
      env: { ...process.env, ENGINUITY_API_PORT: String(api.port), ENGINUITY_HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (c) => resolve({ code: c, out, err }));
  });
}

describe("Enginuity Python API dialogs open in the Enginuity window (MB_Dialog)", () => {
  it("mbox with an entry, Yes/No questions, InputDialog and blocking ShowMessage get the user's answers", async () => {
    srv.flags.Popups = "1";
    const seen: Ev[] = [];
     
    const fn = (e: Ev) => {
      if (e.type !== "dialog") return;
      seen.push(e);
      const buttons = e.buttons as string[];
      setTimeout(() => {
        if (e.input !== undefined) srv.runner!.answer(String(e.id), buttons.at(-1)!, `typed:${e.input}`);
        else if (buttons.includes("No")) srv.runner!.answer(String(e.id), "No");
        else srv.runner!.answer(String(e.id), buttons[0]);
      }, 20);
    };
    srv.listeners.add(fn);
    try {
      const r = await python(`
from enginuity import Enginuity, dialogs
rdk = Enginuity()
dialogs.set_connection(rdk)
print("entry", dialogs.mbox("How many parts?", entry="12"))
print("yesno", dialogs.ShowMessageYesNo("Continue?"))
print("input", dialogs.InputDialog("Speed", "50"))
rdk.ShowMessage("Done<br>with <b>bold</b>")
print("button", rdk.ShowDialog("Pick one", ["Left", "Right"], "Choice"))
`);
      expect(r.err).toBe("");
      expect(r.out).toContain("entry typed:12");
      expect(r.out).toContain("yesno False");
      expect(r.out).toContain("input typed:50");
      expect(r.out).toContain("button ('Left', '')");
    } finally {
      srv.listeners.delete(fn);
    }
    expect(seen.map((e) => e.html)).toEqual(["How many parts?", "Continue?", "Speed", "Done<br>with <b>bold</b>", "Pick one"]);
    expect(seen[0].input).toBe("12");
    expect(seen[0].buttons).toEqual(["Cancel", "OK"]);
    expect(seen[3].buttons).toEqual(["OK"]);
    expect(seen[4].title).toBe("Choice");
  }, 60_000);

  it("with popups off every dialog answers its default at once", async () => {
    srv.flags.Popups = "0";
    const r = await python(`
from enginuity import Enginuity, dialogs
rdk = Enginuity()
dialogs.set_connection(rdk)
print(dialogs.mbox("Go?"), dialogs.mbox("n", entry="5"), dialogs.ShowMessageOkCancel("ok?"), dialogs.getSaveFileName(strfile="out.csv"))
rdk.ShowMessage("no popup")
`);
    expect(r.err).toBe("");
    expect(r.out.trim()).toBe("True 5 True out.csv");
    srv.flags.Popups = "1";
  }, 60_000);
});
