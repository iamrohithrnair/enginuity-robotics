 
 
 
 
 
 
import { describe, expect, it } from "vitest";
import type { MenuEntry } from "@/components/glass/Menu";
import { useRC } from "@/client/store";
import { instructionMenu, instructionsMenu, programMenu, programsMenu, pythonMenu, pythonsMenu, targetMenu, type MenuKit } from "@/components/tree/menus-program";
import type { Item } from "@/engine/types";
import { engine } from "../helpers";

const id = (r: unknown) => (r as { id: string }).id;
const kit: MenuKit = {
  tail: () => [],
  visibleEntry: () => ({ label: "Visible" }),
  reframe: () => ({ label: "Reframe" }),
  robotsSubmenu: () => [],
  changeSupport: () => ({ label: "Change support" }),
  itemsOfType: (ws, type) => Object.values(ws.items).filter((i) => i.type === type),
  renameGroup: () => ({ label: "Rename Group" }),
};

 
const labels = (m: MenuEntry[]) => m.map((e) => ("separator" in e && e.separator ? "—" : `${(e as { disabled?: boolean }).disabled ? "!" : ""}${(e as { label: string }).label}`));

async function cell() {
  const e = await engine();
  const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
  const t1 = id(await e.run("target.teach", { robot, name: "T1" }));
  const t2 = id(await e.run("target.teach", { robot, name: "T2" }));
  const prog = id(await e.run("program.add", { name: "P", robot }));
  const add = async (kind: string, extra: Record<string, unknown> = {}) => id(await e.run("program.addInstruction", { program: prog, kind, ...extra }));
  return { e, robot, t1, t2, prog, add, item: (i: string) => e.ws.items[i] as Item };
}

describe("instruction menus", () => {
  it("Move: Execute, Start From Here, targets, move type, Target Linked", async () => {
    const c = await cell();
    const m = id(await c.e.run("program.addMoveL", { program: c.prog, target: c.t1 }));
    expect(labels(instructionMenu(c.e.ws, c.item(m), [m]))).toEqual([
      "Execute Instruction",
      "Start from Here",
      "Select Target",
      "Hide Target Object",
      "Teach Current Position",
      "—",
      "Target Options...",
      "—",
      "Joint Move",
      "Linear Move",
      "Search Linear",
      "—",
      "Target Linked",
      "—",
      "Delete",
    ]);
     
    await c.e.run("instruction.setMoveType", { instructions: [m], moveType: "search" });
    expect(labels(instructionMenu(c.e.ws, c.item(m), [m]))).toContain("Show Contact Point");
  });

  it("Move without robot: Execute Instruction is disabled", async () => {
    const c = await cell();
    const m = id(await c.e.run("program.addMoveJ", { program: c.prog, target: c.t1 }));
    await c.e.run("program.setRobot", { program: c.prog, robot: null });
    expect(labels(instructionMenu(c.e.ws, c.item(m), [m]))[0]).toBe("!Execute Instruction");
  });

  it("per type", async () => {
    const c = await cell();
    const menu = async (kind: string, extra: Record<string, unknown> = {}) => {
      const i = await c.add(kind, extra);
      return labels(instructionMenu(c.e.ws, c.item(i), [i]));
    };
    expect(await menu("speed", { linear: 100 })).toEqual(["Edit", "Execute Instruction", "Start from Here", "—", "Delete"]);
    expect(await menu("pause", { pauseMs: 500 })).toEqual(["Execute Instruction", "Skip Wait", "Modify", "—", "Delete"]);
    expect(await menu("event", { eventAction: "attach" })).toEqual(["Execute Instruction", "Skip Wait", "Modify", "—", "Delete", "—", "Record all Objects"]);
    expect(await menu("print", { text: "hi" })).toEqual(["Execute Instruction", "Modify", "—", "Delete"]);
    expect(await menu("io", { ioMode: "wait", ioName: "DI_1", ioValue: 1 })).toEqual(["Execute Instruction", "Skip DI Wait", "Modify", "—", "Delete"]);
    expect(await menu("code", { codeType: 0, text: "Missing" })).toEqual(["Execute Instruction", "Start from Here", "Modify", "!Reveal in the tree", "—", "Delete"]);
    expect(await menu("custom", { name: "Glue", path: "glue.py" })).toEqual([
      "Execute Instruction",
      "Stop Instruction",
      "Start from Here",
      "—",
      "Set Name",
      "Modify Path",
      "Modify Icon",
      "Blocking",
      "Modify 'Run on Robot' Command",
      "Edit instruction",
      "—",
      "Delete",
    ]);
  });

  it("several moves: the targets menu; several program calls: one Modify", async () => {
    const c = await cell();
    const a = id(await c.e.run("program.addMoveL", { program: c.prog, target: c.t1 }));
    const b = id(await c.e.run("program.addMoveJ", { program: c.prog, target: c.t2 }));
    const m = instructionsMenu(c.e.ws, [a, b]);
    expect(labels(m)).toEqual([
      "Offset Targets",
      "Relative Tool Shift",
      "—",
      "Select Targets",
      "Hide Target Objects",
      "—",
      "Set Move Joint",
      "Set Move Linear",
      "—",
      "Set as Joint Targets",
      "Set as Cartesian Targets",
    ]);
    expect(labels((m[1] as { submenu: MenuEntry[] }).submenu)).toEqual(["Tx", "Ty", "Tz", "Rx", "Ry", "Rz"]);
    const x = await c.add("code", { codeType: 0, text: "A" });
    const y = await c.add("code", { codeType: 0, text: "B" });
    expect(labels(instructionsMenu(c.e.ws, [x, y]))).toEqual(["Modify"]);
  });
});

describe("program, target and Python menus", () => {
  it("program: run flags, checks, generation (robot drivers disabled)", async () => {
    const c = await cell();
    expect(labels(programMenu(c.e.ws, c.item(c.prog), [c.prog], false, kit))).toEqual([
      "Run",
      "!Run on Robot",
      "Loop",
      "Show Instructions",
      "Display Path",
      "Locked",
      "—",
      "Check Path",
      "Check Path and Collisions",
      "—",
      "Recalculate Targets",
      "—",
      "Generate Robot Program as...",
      "Generate Robot Program",
      "!Send Program to Robot",
      "!Start on Robot",
      "Select Post Processor",
      "—",
      "Export Simulation...",
      "—",
      "Robot",
    ]);
    await c.e.run("program.setFlags", { programs: [c.prog], locked: true });
    expect(labels(programMenu(c.e.ws, c.item(c.prog), [c.prog], false, kit))).toContain("!Recalculate Targets");
    const q = id(await c.e.run("program.add", { name: "Q", robot: c.robot }));
    expect(labels(programsMenu(c.e.ws, [c.prog, q], kit))).toEqual([
      "Make Main Program",
      "!Run on Robot",
      "Show Instructions",
      "Display path",
      "—",
      "Generate Robot Programs",
      "!Send Programs to Robot",
      "—",
      "Robot",
      "—",
      "Rename Group",
      "Delete Programs",
    ]);
  });

  it("target", async () => {
    const c = await cell();
    expect(labels(targetMenu(c.e.ws, c.item(c.t1), [c.t1], false, kit))).toEqual([
      "Move to Target",
      "Go to Target",
      "Teach Current Position",
      "—",
      "Visible",
      "Select",
      "Reframe",
      "—",
      "Cartesian Target",
      "Joint Target",
      "Robot Linked",
      "Change support",
      "Align Target Orientation",
      "—",
      "Options...",
      "Change Configuration",
    ]);
  });

  it("Python program", async () => {
    const c = await cell();
    const py = id(await c.e.run("python.add", {}));
    expect(labels(pythonMenu(c.e.ws, c.item(py), [py], false, kit))).toEqual([
      "Run Python Script",
      "Edit Python Script",
      "—",
      "Display Path",
      "—",
      "Quick Program Check",
      "Generate Robot Program",
      "—",
      "!Run on Robot",
      "Upload to Robot",
      "—",
      "Save as *.py file...",
    ]);
     
    const entry = (m: MenuEntry[], label: string) => m.find((e) => (e as { label?: string }).label === label) as { checked?: boolean; shortcut?: string };
    expect(entry(pythonMenu(c.e.ws, c.item(py), [py], false, kit), "Display Path")).toMatchObject({ checked: false, shortcut: "F7" });
    useRC.setState({ trace: { [`python:${py}`]: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]] } });
    expect(entry(pythonMenu(c.e.ws, c.item(py), [py], false, kit), "Display Path").checked).toBe(true);
    expect(labels(pythonsMenu(c.e.ws, [py]))).toEqual(["Save All as *.py", "Display Path", "—", "Delete"]);
    expect(entry(pythonsMenu(c.e.ws, [py]), "Display Path").checked).toBe(true);
    useRC.setState({ trace: {} });
     
    c.e.ws.busy = [py];
    expect(labels(pythonMenu(c.e.ws, c.item(py), [py], false, kit))[0]).toBe("Stop Python Script");
  });
});
