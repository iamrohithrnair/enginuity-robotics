// Verifies Python program naming, execution, output handling, and approval of Copilot-written code.
 
 
 
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { engine } from "../helpers";

type E = Awaited<ReturnType<typeof engine>>;
type Runner = import("@/server/python-runner").PythonRunner;
let mod: typeof import("@/server/python-runner");

beforeAll(async () => {
   
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "rc-a2-python-"));
  mod = await import("@/server/python-runner");
});

async function setup() {
  const e = await engine();
  const busy: [string, boolean][] = [];
  const asks: { html: string; title?: string }[] = [];
  e.services.ask = async (html, _buttons, title) => {
    asks.push({ html, title });
    return "OK";
  };
  const runner: Runner = new mod.PythonRunner(e, (key, b) => busy.push([key, b]));
  e.services.python = runner.service();
  const statuses = () => e.events.filter((x) => x.type === "status").map((x) => String(x.text));
  const confirms = () => e.events.filter((x) => x.type === "python-confirm");
  return { e, runner, busy, asks, statuses, confirms };
}

async function until(f: () => boolean, ms = 20000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const id = (r: unknown) => (r as { id: string }).id;

async function pyItem(e: E, code: string, origin: "ui" | "agent") {
  const it = id(await e.run("python.add", {}, origin));
  await e.run("python.setCode", { item: it, code }, origin);
  return it;
}

describe("Python program items", () => {
  it("are named like programs (ProgN) and start from Enginuity's template", async () => {
    const { e } = await setup();
    const r = (await e.run("python.add", {}, "ui")) as unknown as { id: string; name: string };
    expect(r.name).toBe("Prog1");
    expect(e.ws.items[r.id].python?.code).toContain("from enginuity.robolink import *");
    expect(e.ws.items[r.id].python?.code).not.toContain("pip install");
    expect(e.ws.items[r.id].python?.author).toBe("user");
  });

  it("user code runs at once with the API port in the environment; output lines go to the status bar", async () => {
    const { e, runner, busy, statuses } = await setup();
    e.services.settings.RC_API_PORT = 20777;
    const it = await pyItem(e, "import os\nprint('port', os.environ['ENGINUITY_API_PORT'])\n", "ui");
    const r = (await e.run("python.run", { item: it }, "ui")) as unknown as { started: boolean };
    expect(r.started).toBe(true);
    await until(() => !runner.isRunning(it));
    expect(statuses()).toEqual(expect.arrayContaining(["Running python script...", "Python output: port 20777", "Python script finished successfully"]));
    expect(busy).toEqual([
      [it, true],
      [it, false],
    ]);
  });

  it("a failing script reports the exit code and opens the output window (default: if errors)", async () => {
    const { e, runner, asks, statuses } = await setup();
    const it = await pyItem(e, "import sys\nprint('partial')\nsys.stderr.write('bad thing\\n')\nsys.exit(3)\n", "ui");
    await e.run("python.run", { item: it }, "ui");
    await until(() => !runner.isRunning(it));
    expect(statuses()).toContain("Python script failed returning 3");
    expect(asks).toHaveLength(1);
    expect(asks[0].title).toBe("Python script output");
    expect(asks[0].html).toContain("bad thing");
    expect(asks[0].html).toContain("partial");
  });

  it("robolink-style imports resolve to the Enginuity Python API; nothing has to be installed", async () => {
    const { e, runner, asks, statuses } = await setup();
    const code = [
      "from robodk import robolink, robomath",
      "from robodk.robolink import *",
      "from robolink import *",
      "import robomath as rm, robodialogs, robofileio",
      "print('alias', Robolink.__module__, rm.__name__, robodialogs.__name__, robofileio.__name__, transl(1, 2, 3).Pos())",
    ].join("\n");
    const it = await pyItem(e, code + "\n", "ui");
    await e.run("python.run", { item: it }, "ui");
    await until(() => !runner.isRunning(it));
    expect(statuses()).toContain("Python output: alias enginuity.robolink enginuity.robomath enginuity.dialogs enginuity.fileio [1.0, 2.0, 3.0]");
    expect(statuses()).toContain("Python script finished successfully");
    expect(asks).toHaveLength(0);
  });

  it("a script error shows the script's own traceback; a missing third-party package says what to install", async () => {
    const { e, runner, asks } = await setup();
    const it = await pyItem(e, "import missing_module_for_test\n", "ui");
    await e.run("python.run", { item: it }, "ui");
    await until(() => !runner.isRunning(it));
    expect(asks[0].html).toContain("No module named 'missing_module_for_test'");
    expect(asks[0].html).toContain("python3 -m pip install --user missing_module_for_test");
    expect(asks[0].html).not.toContain("launch.py");
    expect(mod.missingPackageHint("ModuleNotFoundError: No module named 'cv2'", "python3")).toContain("pip install --user opencv-python");
  });

  it("an import problem with the API's own module names is a plain error, never an install hint", async () => {
    const { e, runner, asks } = await setup();
    const it = await pyItem(e, "raise ModuleNotFoundError(\"No module named 'robodk.something'\")\n", "ui");
    await e.run("python.run", { item: it }, "ui");
    await until(() => !runner.isRunning(it));
    expect(asks[0].html).toContain("No module named");
    expect(asks[0].html).not.toContain("pip install");
  });

  it("a script that opens a tkinter window is not started and says so in one line", async () => {
    const { e, runner, statuses } = await setup();
    const it = await pyItem(e, "from tkinter import *\nroot = Tk()\nroot.mainloop()\n", "ui");
    const r = await e.tryRun("python.run", { item: it }, "ui");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Prog\d+ was not started: it opens a desktop window \(tkinter\)/);
    expect(statuses().some((t) => t.includes("was not started: it opens a desktop window (tkinter)"))).toBe(true);
    expect(runner.isRunning(it)).toBe(false);
  });

  it("program call arguments reach the script as sys.argv (first argument is the script path)", async () => {
    const { e, runner, statuses } = await setup();
    const it = await pyItem(e, "import os, sys\nprint('argv', os.path.basename(sys.argv[0]), sys.argv[1:])\n", "ui");
    await e.run("python.run", { item: it, args: ["0", "", "item.ptr"] }, "ui");
    await until(() => !runner.isRunning(it));
    expect(statuses()).toContain("Python output: argv Prog1.py ['0', '', 'item.ptr']");
  });

  it("Stop interrupts the process", async () => {
    const { e, runner, statuses } = await setup();
    const it = await pyItem(e, "import time\nprint('waiting', flush=True)\ntime.sleep(30)\n", "ui");
    await e.run("python.run", { item: it }, "ui");
    await until(() => statuses().includes("Python output: waiting"));
    expect((await e.run("python.stop", { item: it }, "ui")) as unknown).toEqual({ stopped: true });
    await until(() => !runner.isRunning(it));
    expect(statuses().at(-1)).toMatch(/^Python script interrupted\. Executed for \d+\.\d s$/);
  });

  it("an interpreter that can't start points to the Python options", async () => {
    const { e, runner, statuses } = await setup();
    e.services.settings.Path_PythonRun2 = "/nonexistent/python3";
    const it = await pyItem(e, "print(1)\n", "ui");
    await e.run("python.run", { item: it }, "ui");
    await until(() => !runner.isRunning(it) && statuses().some((s) => s.startsWith("Failed to run")));
    expect(statuses()).toContain("Failed to run Python script. Set the path to the Python interpreter in: Tools-Options-Python tab.");
  });

  it("Save as *.py file writes <data>/python/<name>.py", async () => {
    const { e } = await setup();
    const it = await pyItem(e, "print('saved')\n", "ui");
    const r = (await e.run("python.saveAs", { item: it }, "ui")) as unknown as { path: string; name: string };
    expect(r.path).toBe(path.join(process.env.ROBOCRAFT_DATA_DIR!, "python", "Prog1.py"));
    expect(r.name).toBe("Prog1.py");
    expect(e.events.filter((x) => x.type === "status").map((x) => x.text)).toContain("Python file saved");
  });

  it("Save All as *.py: 'Saving file: <path>' for each, then 'Done'", async () => {
    const { e } = await setup();
    const a = await pyItem(e, "print('a')\n", "ui");
    const b = await pyItem(e, "print('b')\n", "ui");
    const r = (await e.run("python.saveAll", { items: [a, b] }, "ui")) as unknown as { path: string; name: string }[];
    expect(r.map((x) => x.name)).toEqual(["Prog1.py", "Prog2.py"]);
    const st = e.events.filter((x) => x.type === "status").map((x) => x.text);
    expect(st.slice(-3)).toEqual([`Saving file: ${r[0].path}`, `Saving file: ${r[1].path}`, "Done"]);
  });

  it("opening a .py file adds a Python program named after the file", async () => {
    const { e } = await setup();
    const r = (await e.run("file.open", { fileName: "pick_place.py", base64: btoa("print('x')\n") }, "ui")) as unknown as { id: string; name: string };
    expect(r.name).toBe("pick_place");
    expect(e.ws.items[r.id].python?.code).toBe("print('x')\n");
  });
});

describe("consent for Copilot-written code", () => {
  it("agent code waits for the user's confirmation of that exact code", async () => {
    const { e, runner, busy, confirms } = await setup();
    const it = await pyItem(e, "print('from agent')\n", "agent");
    expect(e.ws.items[it].python?.author).toBe("agent");
    const r = (await e.run("python.run", { item: it }, "agent")) as unknown as { started: boolean; pending: boolean };
    expect(r).toMatchObject({ started: false, pending: true });
    expect(runner.isRunning(it)).toBe(false);
    expect(busy).toEqual([]);
    const ev = confirms()[0];
    expect(ev).toMatchObject({ item: it, code: "print('from agent')\n" });
     
    expect((await e.tryRun("python.approve", { item: it, hash: ev.hash }, "agent")).error).toBe("Only the user can confirm running Python code, from the Enginuity window");
    expect((await e.tryRun("python.approve", { item: it, hash: ev.hash }, "api")).ok).toBe(false);
     
    await e.run("python.setCode", { item: it, code: "print('changed')\n" }, "agent");
    expect((await e.tryRun("python.approve", { item: it, hash: ev.hash }, "ui")).error).toBe("The script changed since you reviewed it. Review it again.");
    await e.run("python.run", { item: it }, "agent");
    const ev2 = confirms().at(-1)!;
    const ok = (await e.run("python.approve", { item: it, hash: ev2.hash }, "ui")) as unknown as { started: boolean };
    expect(ok.started).toBe(true);
    await until(() => !runner.isRunning(it));
     
    const n = confirms().length;
    expect(((await e.run("python.run", { item: it }, "agent")) as unknown as { started: boolean }).started).toBe(true);
    await until(() => !runner.isRunning(it));
    await e.run("python.setCode", { item: it, code: "print('again')\n" }, "agent");
    expect(((await e.run("python.run", { item: it }, "agent")) as unknown as { pending: boolean }).pending).toBe(true);
    expect(confirms()).toHaveLength(n + 1);
  });

  it("the confirmation commands are not agent tools", async () => {
    const { allCommands } = await import("@/engine/registry");
    const hidden = allCommands().filter((c) => c.internal).map((c) => c.name);
    expect(hidden).toEqual(expect.arrayContaining(["python.approve", "python.approveScript", "instruction.approveCustom"]));
  });

  it("Run Script: user scripts run directly, agent scripts wait; Run Last Script reruns", async () => {
    const { e, runner, confirms, statuses } = await setup();
    await e.run("python.runScript", { name: "hello.py", code: "print('hi there')\n" }, "ui");
    await until(() => !runner.isRunning("script:hello.py"));
    expect(statuses()).toContain("Python output: hi there");
    await e.run("python.runLastScript", {}, "ui");
    await until(() => !runner.isRunning("script:hello.py"));
    expect(statuses().filter((s) => s === "Python output: hi there")).toHaveLength(2);

    const r = (await e.run("python.runScript", { name: "agent.py", code: "print('agent script')\n" }, "agent")) as unknown as { pending: boolean };
    expect(r.pending).toBe(true);
    expect(runner.isRunning("script:agent.py")).toBe(false);
     
    expect(((await e.run("python.runLastScript", {}, "ui")) as unknown as { pending: boolean }).pending).toBe(true);
    const hash = String(confirms().at(-1)!.hash);
    expect((await e.tryRun("python.approveScript", { hash }, "agent")).ok).toBe(false);
    await e.run("python.approveScript", { hash }, "ui");
    await until(() => statuses().includes("Python output: agent script") && !runner.isRunning("script:agent.py"));
  });

  it("custom instructions: a Copilot-written path or file needs confirmation; the user's own run directly", async () => {
    const { e, runner, confirms, statuses } = await setup();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const prog = id(await e.run("program.add", { name: "P" }));
    writeFileSync(path.join(mod.PYTHON_DIR, "glue_on.py"), "print('glue on')\n");
    const user = id(await e.run("program.addInstruction", { program: prog, kind: "custom", name: "Glue", path: "glue_on.py" }, "ui"));
    expect(((await e.run("instruction.runCustom", { instruction: user }, "system")) as unknown as { started: boolean }).started).toBe(true);
    await until(() => !runner.isRunning(user));
    expect(statuses()).toContain("Python output: glue on");

    const agent = id(await e.run("program.addInstruction", { program: prog, kind: "custom", name: "Glue2", path: "glue_on.py" }, "agent"));
    expect(e.ws.items[agent].params?.Author).toBe("agent");
    const r = (await e.run("instruction.runCustom", { instruction: agent }, "system")) as unknown as { pending: boolean };
    expect(r.pending).toBe(true);
    const ev = confirms().at(-1)!;
     
    expect(String(ev.code)).toContain(path.join(mod.PYTHON_DIR, "glue_on.py"));
    expect(String(ev.code)).toContain("print('glue on')");
    await e.run("instruction.approveCustom", { instruction: agent, hash: ev.hash }, "ui");
    await until(() => !runner.isRunning(agent));
    expect(statuses().filter((s) => s === "Python output: glue on")).toHaveLength(2);

     
    const py = await pyItem(e, "print('agent file')\n", "agent");
    await e.run("python.saveAs", { item: py }, "agent");
    const name = e.ws.items[py].name;
    await e.run("instruction.setCustom", { instruction: user, path: `${name}.py` }, "ui");
    expect(((await e.run("instruction.runCustom", { instruction: user }, "system")) as unknown as { pending: boolean }).pending).toBe(true);
  });
});
