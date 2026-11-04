import { z } from "zod";
import { requireRef } from "../dispatch";
import { autoName } from "../naming";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";
import type { Item } from "../types";
import { makeItem } from "../workspace";
import { desktopGuiMessage } from "../python-gui";
import { registerFileHandler } from "./files";
import { activeStationId } from "./items";

 
 
 
 
 
 
 
 

 
export const PYTHON_TEMPLATE = `# Enginuity Python program
# Runs against this station through the Enginuity Python API (the enginuity package).
# Scripts written for the robolink API (robolink-style imports) run unchanged too.
from enginuity.robolink import *    # Enginuity (alias Robolink), Item, ITEM_TYPE_* constants
from enginuity.robomath import *    # pose helpers: transl, rotx, roty, rotz, ...

RDK = Enginuity()

# list the items of the station
for item in RDK.ItemList():
    print(item.Name())
`;

function requirePython(ctx: Pick<CmdCtx, "ws">, ref: string | number): Item {
  const it = requireRef(ctx.ws, ref, "Python program");
  if (it.type !== "python") throw new CommandError(`${it.name} is not a Python program`);
  return it;
}

function pythonService(ctx: CmdCtx) {
  if (!ctx.services.python) throw new CommandError("Python programs run on the Enginuity server");
  return ctx.services.python;
}

const author = (ctx: CmdCtx): "user" | "agent" => (ctx.origin === "agent" ? "agent" : "user");

 
function needsApproval(ctx: CmdCtx, py: NonNullable<Item["python"]>): boolean {
  return py.author === "agent" && py.approved !== pythonService(ctx).hash(py.code);
}

function askApproval(ctx: CmdCtx, e: { item?: string; name: string; code: string }) {
  const hash = pythonService(ctx).hash(e.code);
  ctx.services.emit?.({ type: "python-confirm", item: e.item ?? null, name: e.name, code: e.code, hash });
  status(ctx, `Waiting for you to confirm running ${e.name}`);
  return { started: false, pending: true, message: `The Copilot wrote this Python code. Enginuity asked the user to review and confirm running ${e.name}.` };
}

function startItem(ctx: CmdCtx, it: Item, args: string[] = []) {
  const py = pythonService(ctx);
  if (py.isRunning(it.id)) return { started: false, running: true, message: `${it.name} is already running` };
  const gui = desktopGuiMessage(it.name, it.python?.code ?? "");
  if (gui) {
    status(ctx, gui);
    throw new CommandError(gui);
  }
  py.start(it.id, it.name, it.python?.code ?? "", { args });
  return { started: true, name: it.name, ...(args.length ? { args } : {}) };
}

defineCommand({
  name: "python.add",
  title: "Add Python Program",
  description:
    "Add a Python program 'ProgN' (numbered with the programs) at the station root. Its code runs against the Enginuity Python API (package enginuity; robolink-style imports of existing scripts resolve to it). Code written by the Copilot needs the user's confirmation before it runs.",
  category: "program",
  spec: "B-PROG-14, R-SLF-47, R-TREE-5",
  schema: z.object({ name: z.string().optional(), code: z.string().optional() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const st = activeStationId(ws);
    const it = makeItem(ws, "python", p.name ?? autoName(ws, st, "python"), { python: { code: p.code ?? PYTHON_TEMPLATE, author: author(ctx), approved: null } });
    tx.add(it, st);
    tx.split(`Add: ${it.name}`);
    tx.setMeta("selection", [it.id]);
    ctx.undoLabel = null;
    return { id: it.id, name: it.name, handle: it.handle };
  },
});

 
registerFileHandler(["py"], (ctx, file) => {
  const { ws, tx } = ctx;
  const st = activeStationId(ws);
  const name = file.name.replace(/^.*[\\/]/, "").replace(/\.py$/i, "") || autoName(ws, st, "python");
  const code = new TextDecoder().decode(file.bytes);
  const it = makeItem(ws, "python", name, { python: { code, author: author(ctx), approved: null } });
  tx.add(it, st);
  tx.split(`Add: ${it.name}`);
  tx.setMeta("selection", [it.id]);
  return { id: it.id, name: it.name, type: "python" };
});

defineCommand({
  name: "python.setCode",
  title: "Edit Python Script",
  description: "Replace the code of a Python program (Edit Python Script, F3).",
  category: "program",
  spec: "R-SLF-47 (Edit Python Script)",
  schema: z.object({ item: ItemRef, code: z.string() }),
  run(ctx, p) {
    const it = requirePython(ctx, p.item);
    if (it.python?.code === p.code) return { changed: false };
    ctx.tx.set(it.id, { python: { code: p.code, author: author(ctx), approved: null } });
    ctx.undoLabel = `Modify: ${it.name}`;
    return { changed: true };
  },
});

defineCommand({
  name: "python.getCode",
  title: "Read Python Script",
  description: "Read the code of a Python program and whether it is running.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const it = requirePython(ctx, p.item);
    return { name: it.name, code: it.python?.code ?? "", author: it.python?.author ?? "user", running: !!ctx.services.python?.isRunning(it.id) };
  },
});

defineCommand({
  name: "python.run",
  title: "Run Python Script",
  description:
    "Run a Python program (double-click / Run Python Script) against the Enginuity Python API. `args` become sys.argv[1:] (a program call 'Name(a, b)' passes 'a' and 'b'). Returns at once; the status bar shows the output and the result. Code the Copilot wrote waits for the user's confirmation in Enginuity before it runs (the result says it is pending).",
  category: "program",
  undoable: false,
  spec: "R-SLF-47 (Run Python Script); program call arguments FUN_100525610 / FUN_1004f2338",
  schema: z.object({ item: ItemRef, args: z.array(z.string()).optional() }),
  run(ctx, p) {
    const it = requirePython(ctx, p.item);
    const py = it.python ?? { code: "" };
    if (needsApproval(ctx, py)) return askApproval(ctx, { item: it.id, name: it.name, code: py.code });
    return startItem(ctx, it, p.args ?? []);
  },
});

defineCommand({
  name: "python.approve",
  title: "Confirm Running Python Code",
  description: "The user confirms running Copilot-written Python code they reviewed (UI only). The hash must match the code shown.",
  category: "program",
   
  internal: true,
  undoable: false,
  spec: "Enginuity consent rule for agent-written code",
  schema: z.object({ item: ItemRef, hash: z.string() }),
  run(ctx, p) {
    if (ctx.origin !== "ui") throw new CommandError("Only the user can confirm running Python code, from the Enginuity window");
    const it = requirePython(ctx, p.item);
    const code = it.python?.code ?? "";
    if (pythonService(ctx).hash(code) !== p.hash) throw new CommandError("The script changed since you reviewed it. Review it again.");
    ctx.tx.set(it.id, { python: { ...it.python!, approved: p.hash } });
    ctx.undoLabel = null;
    return startItem(ctx, it);
  },
});

defineCommand({
  name: "python.stop",
  title: "Stop Python Script",
  description: "Stop a running Python program ('Python script interrupted. Executed for N s').",
  category: "program",
  undoable: false,
  readonly: true,
  spec: "R-SLF-47 (Stop Python Script)",
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const it = requirePython(ctx, p.item);
    return { stopped: pythonService(ctx).stop(it.id) };
  },
});

defineCommand({
  name: "python.saveAs",
  title: "Save as *.py file",
  description: "Save a Python program's code as a .py file (data/python/<name>.py on the Enginuity server); returns the path and the code.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "R-TREE-43 (Save as *.py file...)",
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const it = requirePython(ctx, p.item);
    const code = it.python?.code ?? "";
    const file = pythonService(ctx).saveScript(it.name, code, { agent: it.python?.author === "agent" });
    status(ctx, "Python file saved");
    return { path: file, name: `${it.name}.py`, code };
  },
});

defineCommand({
  name: "python.saveAll",
  title: "Save All as *.py",
  description: "Save several Python programs as .py files in the Enginuity Python folder (data/python), overwriting existing files ('Saving file: <path>' for each, then 'Done'); returns each path and code.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "R-TREE-43 (several Python programs ▸ Save All as *.py, FUN_1004f3ac0)",
  schema: z.object({ items: z.array(ItemRef).min(1) }),
  run(ctx, p) {
    const py = pythonService(ctx);
    const saved = p.items.map((r) => {
      const it = requirePython(ctx, r);
      const code = it.python?.code ?? "";
      const file = py.saveScript(it.name, code, { agent: it.python?.author === "agent" });
      status(ctx, `Saving file: ${file}`);
      return { path: file, name: `${it.name}.py`, code };
    });
    status(ctx, "Done");
    return saved;
  },
});

 

 
let lastScript: { name: string; code: string; author: "user" | "agent"; approved: string | null } | null = null;
 
const pendingScripts = new Map<string, { name: string; code: string }>();

function startScript(ctx: CmdCtx, s: NonNullable<typeof lastScript>) {
  const py = pythonService(ctx);
  const hash = py.hash(s.code);
  if (s.author === "agent" && s.approved !== hash) {
    pendingScripts.set(hash, { name: s.name, code: s.code });
    return askApproval(ctx, { name: s.name, code: s.code });
  }
  const key = `script:${s.name}`;
  if (py.isRunning(key)) return { started: false, running: true, message: `${s.name} is already running` };
  const gui = desktopGuiMessage(s.name, s.code);
  if (gui) {
    status(ctx, gui);
    throw new CommandError(gui);
  }
  py.start(key, s.name.replace(/\.py$/i, ""), s.code);
  return { started: true, name: s.name };
}

defineCommand({
  name: "python.runScript",
  title: "Run Script",
  description:
    "Run a Python script file (Run Script, Shift+S): its name and code. It runs against the Enginuity Python API (package enginuity) like a Python program; Run Last Script (Shift+L) runs it again. Copilot-written code waits for the user's confirmation.",
  category: "tools",
  undoable: false,
  readonly: true,
  spec: "B-TOOL-20, R-SLF-47",
  schema: z.object({ name: z.string().default("script.py"), code: z.string() }),
  run(ctx, p) {
    lastScript = { name: p.name, code: p.code, author: author(ctx), approved: null };
    return startScript(ctx, lastScript);
  },
});

defineCommand({
  name: "python.runLastScript",
  title: "Run Last Script",
  description: "Run the last script started with Run Script again (Shift+L).",
  category: "tools",
  undoable: false,
  readonly: true,
  spec: "B-TOOL-21, R-SLF-47",
  schema: z.object({}),
  run(ctx) {
    if (!lastScript) throw new CommandError("No script was run yet. Use Run Script first.");
    return startScript(ctx, lastScript);
  },
});

defineCommand({
  name: "python.approveScript",
  title: "Confirm Running a Script",
  description: "The user confirms a Copilot-written script they reviewed (UI only).",
  category: "tools",
   
  internal: true,
  undoable: false,
  readonly: true,
  spec: "Enginuity consent rule for agent-written code",
  schema: z.object({ hash: z.string() }),
  run(ctx, p) {
    if (ctx.origin !== "ui") throw new CommandError("Only the user can confirm running Python code, from the Enginuity window");
    const s = pendingScripts.get(p.hash);
    if (!s) throw new CommandError("This script is no longer waiting for confirmation");
    pendingScripts.delete(p.hash);
    if (lastScript && pythonService(ctx).hash(lastScript.code) === p.hash) lastScript.approved = p.hash;
    return startScript(ctx, { name: s.name, code: s.code, author: "agent", approved: p.hash });
  },
});
