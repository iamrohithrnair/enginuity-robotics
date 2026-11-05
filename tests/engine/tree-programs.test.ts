// Verifies station-tree edits, program instructions, undo/redo, and library placement.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { engine, LIBRARY_FILE } from "../helpers";

 
const MIRROR_TOOL = LIBRARY_FILE("tools", "3D-Printer-Extruder-Tool.tool");
const mirrorTool = () => new Uint8Array(readFileSync(MIRROR_TOOL));

describe("TREE: station tree", () => {
  it("STN-NEW: stations are named 'New Station (N)' with an increasing counter", async () => {
    const e = await engine();
    expect(e.ws.items[e.ws.activeStation!].name).toBe("New Station (1)");
    await e.run("station.new");
    expect(e.ws.items[e.ws.activeStation!].name).toBe("New Station (2)");
  });

  it("TREE-ROBOT-BASE: loading a robot creates '<robot> Base' frame containing the robot", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
    const base = e.ws.items[robot.parent!];
    expect(robot.name).toBe("ABB IRB 120-3/0.6");
    expect(base.type).toBe("frame");
    expect(base.name).toBe("ABB IRB 120-3/0.6 Base");
    expect(e.ws.items[base.parent!].type).toBe("station");
  });

  it("TREE-DELETE: deleting a frame removes its subtree", async () => {
    const e = await engine();
    const f = (await e.run("item.addFrame", { name: "F" })) as unknown as { id: string };
    await e.run("item.addFrame", { name: "Child", parent: f.id });
    await e.run("item.delete", { items: [f.id] });
    expect(Object.values(e.ws.items).some((i) => i.name === "Child")).toBe(false);
  });

  it("R-TREE-24: the rename dialog ignores empty text; the API accepts empty and untrimmed names", async () => {
    const e = await engine();
    const f = (await e.run("item.addFrame", { name: "F" })) as unknown as { id: string };
    await e.run("item.rename", { item: f.id, name: "" }, "ui");
    expect(e.ws.items[f.id].name).toBe("F");
    await e.run("item.rename", { item: f.id, name: "   " }, "ui");
    expect(e.ws.items[f.id].name).toBe("   ");
    await e.run("item.rename", { item: f.id, name: "" }, "api");
    expect(e.ws.items[f.id].name).toBe("");
  });

  it("API-ITEM-INVALID: unknown items produce RoboDK's invalid-item message", async () => {
    const e = await engine();
    const r = await e.tryRun("item.rename", { item: "DoesNotExist", name: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Invalid item provided: The item identifier provided is not valid or it does not exist.");
  });
});

describe("PRG: program instructions", () => {
  it("PRG-INS-NAME: instruction names match RoboDK's observed formats", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const frame = (await e.run("item.addFrame", { name: "ProbeFrame Renamed" })) as unknown as { id: string };
    await e.run("robot.addTool", { name: "ProbeTool", xyzrpw: [0, 0, 100, 0, 0, 0] });
    await e.run("robot.setJoints", { joints: [0, -10, 20, 0, 30, 0] });
    const t1 = (await e.run("target.teach", { name: "Target 1", parent: frame.id })) as unknown as { id: string };
    const t2 = (await e.run("target.teach", { name: "Target 2", parent: frame.id })) as unknown as { id: string };
    const p = (await e.run("program.add", { name: "ProbeProg" })) as unknown as { id: string };
    const add = (kind: string, extra: Record<string, unknown>) => e.run("program.addInstruction", { program: p.id, kind, ...extra });
    await add("frame", { frame: frame.id });
    await add("tool", { tool: "ProbeTool" });
    await add("speed", { linear: 250 });
    await add("rounding", { rounding: 5 });
    await e.run("program.addMoveJ", { program: p.id, target: t1.id });
    await e.run("program.addMoveL", { program: p.id, target: t2.id });
    await add("pause", { pauseMs: 500 });
    await add("io", { ioMode: "set", ioName: "IO_1", ioValue: 1 });
    await add("io", { ioMode: "wait", ioName: "IO_2", ioValue: 1, timeoutMs: 1000 });
    const names = e.ws.items[p.id].children.map((c) => e.ws.items[c].name);
    expect(names).toEqual([
      "Set Ref.: ProbeFrame Renamed",
      "Set Tool: ProbeTool",
      "Set speed (250.0 mm/s)",
      "Smooth(5)",
      "MoveJ (Target 1)",
      "MoveL (Target 2)",
      "Pause 500 ms",
      "Set IO_1=1",
      "Wait IO_2=1 T1.0s",
    ]);
  });

  it("PRG-UPDATE: Update returns [instructions, time, distance, 1, ''] for a valid program", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("robot.setJoints", { joints: [0, -10, 20, 0, 30, 0] });
    const p = (await e.run("program.add", { name: "P" })) as unknown as { id: string };
    await e.run("program.addMoveJ", { program: p.id });
    await e.run("robot.jogCartesian", { axis: "y", delta: 50 });
    await e.run("program.addMoveL", { program: p.id });
    const r = (await e.run("program.update", { program: p.id })) as unknown as unknown[];
    expect(r[0]).toBe(2);
    expect(r[3]).toBe(1);
    expect(r[4]).toBe("");
    expect(Number(r[2])).toBeGreaterThan(49);
  });
});

describe("UNDO: undo/redo", () => {
  it("UNDO-RENAME: Ctrl+Z restores the previous name and Ctrl+Y re-applies it", async () => {
    const e = await engine();
    const f = (await e.run("item.addFrame", { name: "A" })) as unknown as { id: string };
    await e.run("item.rename", { item: f.id, name: "B" });
    await e.run("edit.undo");
    expect(e.ws.items[f.id].name).toBe("A");
    await e.run("edit.redo");
    expect(e.ws.items[f.id].name).toBe("B");
  });

  it("R-IM-31/35: a delete records one 'Delete:' step per node; undo restores the parent first, then the child", async () => {
    const e = await engine();
    const f = (await e.run("item.addFrame", { name: "F" })) as unknown as { id: string };
    await e.run("item.addFrame", { name: "Child", parent: f.id });
    e.undo.clear();
    await e.run("item.delete", { items: [f.id] }, "ui");
    expect(e.undo.list().undo).toEqual(["Delete: Child", "Delete: F"]);
    await e.run("edit.undo");
    expect(e.ws.items[f.id].children).toEqual([]);
    await e.run("edit.undo");
    expect(e.ws.items[f.id].children.map((c) => e.ws.items[c].name)).toEqual(["Child"]);
  });

  it("UNDO-QUERIES: read-only commands never create undo steps", async () => {
    const e = await engine();
    await e.run("workspace.describe");
    await e.run("item.list");
    expect(e.undo.list().undo).toEqual([]);
  });
});

describe("CLIP: clipboard", () => {
  it("CLIP-PASTE: a pasted target keeps its name (observed 'Target 1' → 'Target 1')", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const t = (await e.run("target.teach", { name: "Target 1" })) as unknown as { id: string };
    await e.run("edit.copy", { items: [t.id] });
    const r = (await e.run("edit.paste")) as unknown as { pasted: string[] };
    expect(r.pasted).toEqual(["Target 1"]);
  });
});

describe("LIB: library placement (R-SLF-20)", () => {
  it("LIB-PLACE: the first robot base is at the origin, the next one 1000 mm along +Y", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const bases = Object.values(e.ws.items).filter((i) => i.type === "frame" && i.name.endsWith(" Base"));
    expect(bases.map((b) => [b.pose[3], b.pose[7], b.pose[11]])).toEqual([
      [0, 0, 0],
      [0, 1000, 0],
    ]);
  });

  it.skipIf(!existsSync(MIRROR_TOOL))("LIB-TOOL-MULTI: loading a tool with several robots and none selected asks for a robot", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("edit.select", { items: [] });
    const load = e.services.library!.load;
    e.services.library!.load = async (file, kind) => (file.endsWith(".tool") ? { bytes: mirrorTool(), url: `file://${file}` } : load(file, kind));
    const r = await e.tryRun("library.load", { file: "3D-Printer-Extruder-Tool.tool", kind: "tool" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Select a robot to place the tool");
  });
});
