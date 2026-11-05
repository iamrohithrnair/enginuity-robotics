// Verifies station-tree naming, parenting, deletion, clipboard, and undo behavior.
 
 
 
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventName, instructionName, ioName, pauseName, roundingName, speedName } from "@/engine/naming";
import { formatProgramTime, programFinishedText } from "@/engine/sim/timefmt";
import { profileAt, trapezoidTime } from "@/engine/sim/planner";
import type { Item } from "@/engine/types";
import { engine, LIBRARY_FILE, near } from "../helpers";

 
const MIRROR_TOOL = LIBRARY_FILE("tools", "3D-Printer-Extruder-Tool.tool");
const mirrorTool = () => new Uint8Array(readFileSync(MIRROR_TOOL));

type R = { id: string; name: string; handle: number };
const names = (e: Awaited<ReturnType<typeof engine>>, type: Item["type"]) =>
  Object.values(e.ws.items)
    .filter((i) => i.type === type)
    .map((i) => i.name);
const y = (e: Awaited<ReturnType<typeof engine>>, id: string) => e.ws.items[id].pose[7];

describe("station tree naming (R-TREE-2..6)", () => {
  it("R-TREE-3: 'Frame N' counts frames, so names repeat after deletes (B01–B07)", async () => {
    const e = await engine();
    const f1 = (await e.run("item.addFrame", {})) as unknown as R;
    const f2 = (await e.run("item.addFrame", {})) as unknown as R;
    const f3 = (await e.run("item.addFrame", {})) as unknown as R;
    expect([f1.name, f2.name, f3.name]).toEqual(["Frame 1", "Frame 2", "Frame 3"]);
    await e.run("item.rename", { item: f2.id, name: "Renamed" });
    expect(((await e.run("item.addFrame", {})) as unknown as R).name).toBe("Frame 4");
    await e.run("item.delete", { items: [f1.id] });
    expect(((await e.run("item.addFrame", {})) as unknown as R).name).toBe("Frame 4");
    expect(names(e, "frame")).toEqual(["Renamed", "Frame 3", "Frame 4", "Frame 4"]);
  });

  it("R-TREE-2: 'New Station (N)' uses the number of open stations", async () => {
    const e = await engine();
    expect(((await e.run("station.new", {})) as unknown as R).name).toBe("New Station (2)");
    const s3 = (await e.run("station.new", {})) as unknown as R;
    expect(s3.name).toBe("New Station (3)");
    await e.run("station.close", { station: s3.id });
    expect(((await e.run("station.new", {})) as unknown as R).name).toBe("New Station (3)");
  });

  it("R-TREE-17: closing the active station activates the first one; closing the last creates 'New Station (1)'", async () => {
    const e = await engine();
    const first = e.ws.stations[0];
    await e.run("station.new", {});
    const s3 = (await e.run("station.new", {})) as unknown as R;
    await e.run("station.close", { station: s3.id });
    expect(e.ws.activeStation).toBe(first);
    for (const s of e.ws.stations.slice()) await e.run("station.close", { station: s });
    expect(e.ws.stations.length).toBe(1);
    expect(e.ws.items[e.ws.stations[0]].name).toBe("New Station (1)");
  });

  it("R-TREE-5/6: 'ProgN' counts programs and Python programs; folders and notes count their own kind", async () => {
    const e = await engine();
    await e.run("program.add", { name: "P1" });
    await e.run("program.add", { name: "P2" });
    await e.run("program.add", { name: "" });
    expect(((await e.run("program.add", {})) as unknown as R).name).toBe("Prog4");
    expect(((await e.run("item.addFolder", {})) as unknown as R).name).toBe("Folder 1");
    await e.run("item.addFolder", { name: "Mine" });
    expect(((await e.run("item.addFolder", {})) as unknown as R).name).toBe("Folder 3");
    expect(((await e.run("item.addNotes", {})) as unknown as R).name).toBe("Note 1");
    expect(((await e.run("item.addNotes", {})) as unknown as R).name).toBe("Note 2");
  });
});

describe("placement and parents (R-TREE-8..14)", () => {
  it("R-TREE-10: new frames are placed 1 m apart along Y; the next goes 1 m past the farthest (B02, B08–B12)", async () => {
    const e = await engine();
    const a = (await e.run("item.addFrame", {})) as unknown as R;
    const b = (await e.run("item.addFrame", {})) as unknown as R;
    const c = (await e.run("item.addFrame", {})) as unknown as R;
    expect([y(e, a.id), y(e, b.id), y(e, c.id)]).toEqual([0, 1000, 2000]);
    await e.run("item.setPose", { item: c.id, xyzrpw: [0, 5000, 0, 0, 0, 0] });
    const next = (await e.run("item.addFrame", { name: "Next" })) as unknown as R;
    expect(y(e, next.id)).toBe(6000);
    const nested = (await e.run("item.addFrame", { name: "Nested", parent: b.id })) as unknown as R;
    expect(e.ws.items[nested.id].parent).toBe(b.id);
    expect(y(e, nested.id)).toBe(7000);
  });

  it("R-TREE-9: a frame added with one frame selected goes under that frame (B13)", async () => {
    const e = await engine();
    const a = (await e.run("item.addFrame", {})) as unknown as R;
    await e.run("edit.select", { items: [a.id] });
    const b = (await e.run("item.addFrame", {})) as unknown as R;
    expect(e.ws.items[b.id].parent).toBe(a.id);
  });

  it("R-TREE-8/11: a robot gets '<name> Base', starts without an active frame, and the next frame becomes its active frame (B14–B21)", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R & { base: string };
    const robot = e.ws.items[r.id];
    const base = e.ws.items[robot.parent!];
    expect(base.name).toBe(`${robot.name} Base`);
    expect(base.type).toBe("frame");
    expect(robot.robot!.activeFrame ?? null).toBeNull();
    const work = (await e.run("item.addFrame", { name: "Work" })) as unknown as R;
    expect(e.ws.items[r.id].robot!.activeFrame).toBe(work.id);
    await e.run("item.addFrame", { name: "Later" });
    expect(e.ws.items[r.id].robot!.activeFrame).toBe(work.id);
  });

  it("R-TREE-14: loaded objects go to the current robot's active frame and ignore the selection (B51–B53)", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const f = (await e.run("item.addFrame", { name: "F" })) as unknown as R;
    const g = (await e.run("item.addFrame", { name: "G" })) as unknown as R;
    await e.run("edit.select", { items: [g.id] });
    const box = (await e.run("object.addShape", { shape: "box" })) as unknown as R;
    expect(e.ws.items[box.id].parent).toBe(f.id);
  });

  it.skipIf(!existsSync(MIRROR_TOOL))("R-TREE-14: a tool file with two robots asks which robot (pick_robot)", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("library.load", { file: "UR5e.robot" });
    const load = e.services.library!.load;
    e.services.library!.load = async (file, kind) => (file.endsWith(".tool") ? { bytes: mirrorTool(), url: `file://${file}` } : load(file, kind));
    const r = await e.tryRun("library.load", { file: "3D-Printer-Extruder-Tool.tool", kind: "tool" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Select a robot to place the tool");
  });

  it("R-TREE-12: a target in an empty station auto-creates 'Frame 1' (B48)", async () => {
    const e = await engine();
    const t = (await e.run("target.add", { name: "T0" })) as unknown as R;
    expect(e.ws.items[e.ws.items[t.id].parent!].name).toBe("Frame 1");
    expect(e.ws.items[t.id].target!.robot ?? null).toBeNull();
  });

  it("R-TREE-4 / R-PROG-56: Teach Target names 'Target N' per frame and selects it", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const a = (await e.run("item.addFrame", { name: "A" })) as unknown as R;
    const b = (await e.run("item.addFrame", { name: "B" })) as unknown as R;
    const t1 = (await e.run("target.teach", { parent: a.id })) as unknown as R;
    const t2 = (await e.run("target.teach", { parent: a.id })) as unknown as R;
    const t3 = (await e.run("target.teach", { parent: b.id })) as unknown as R;
    expect([t1.name, t2.name, t3.name]).toEqual(["Target 1", "Target 2", "Target 1"]);
    expect(e.ws.selection).toEqual([t3.id]);
  });

  it("R-PROG-56: Teach Target without a robot reports 'Select robot first' and creates nothing", async () => {
    const e = await engine();
    const before = Object.keys(e.ws.items).length;
    await e.run("target.teach", {});
    expect(Object.keys(e.ws.items).length).toBe(before);
    expect(e.events.some((ev) => ev.type === "status" && ev.text === "Select robot first")).toBe(true);
  });
});

describe("delete, re-parenting and visibility (R-TREE-21..34)", () => {
  it("R-TREE-27: deleting a robot alone in its base frame deletes the base frame; linked targets lose the robot", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    const baseId = e.ws.items[r.id].parent!;
    const f = (await e.run("item.addFrame", { name: "W" })) as unknown as R;
    const t = (await e.run("target.teach", { parent: f.id })) as unknown as R;
    await e.run("item.delete", { items: [r.id] });
    expect(e.ws.items[baseId]).toBeUndefined();
    expect(e.ws.items[t.id].target!.robot).toBeNull();
  });

  it("R-TREE-34: setParent keeps the relative pose, setParentStatic (keepAbsolute) the absolute pose", async () => {
    const e = await engine();
    const a = (await e.run("item.addFrame", { name: "A", xyzrpw: [100, 0, 0, 0, 0, 0] })) as unknown as R;
    const b = (await e.run("item.addFrame", { name: "B", xyzrpw: [0, 500, 0, 0, 0, 90] })) as unknown as R;
    const c = (await e.run("item.addFrame", { name: "C", parent: a.id, xyzrpw: [10, 20, 30, 0, 0, 0] })) as unknown as R;
    await e.run("item.setParent", { item: c.id, parent: b.id });
    const rel = e.ws.items[c.id].pose;
    expect([rel[3], rel[7], rel[11]]).toEqual([10, 20, 30]);
    const abs = (await e.run("item.info", { item: c.id })) as unknown as { absolute: number[] };
    if (abs.absolute) {
      expect(near(abs.absolute[0], -20)).toBe(true);
      expect(near(abs.absolute[1], 510)).toBe(true);
    }
    await e.run("item.setParent", { item: c.id, parent: a.id, keepAbsolute: true });
    const p = e.ws.items[c.id].pose;
    expect(near(p[3], -120)).toBe(true);
    expect(near(p[7], 510)).toBe(true);
  });

  it("R-TREE-34: re-parenting under a descendant is refused", async () => {
    const e = await engine();
    const a = (await e.run("item.addFrame", { name: "A" })) as unknown as R;
    const b = (await e.run("item.addFrame", { name: "B", parent: a.id })) as unknown as R;
    const r = await e.tryRun("item.setParent", { item: a.id, parent: b.id });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("The parent can not be a child of the current item");
  });

  it("R-TREE-30: the UI refuses dropping a target onto a robot but accepts a frame", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    const f = (await e.run("item.addFrame", { name: "F" })) as unknown as R;
    const t = (await e.run("target.teach", { parent: f.id })) as unknown as R;
    expect((await e.tryRun("item.setParent", { item: t.id, parent: r.id }, "ui")).ok).toBe(false);
    const g = (await e.run("item.addFrame", { name: "G" })) as unknown as R;
    expect((await e.tryRun("item.setParent", { item: t.id, parent: g.id }, "ui")).ok).toBe(true);
  });

  it("R-TREE-32: dropping an object on a robot turns it into a tool", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    const o = (await e.run("object.addShape", { shape: "box" })) as unknown as R;
    await e.run("item.setParent", { item: o.id, parent: r.id }, "ui");
    expect(e.ws.items[o.id].type).toBe("tool");
    expect(e.events.some((ev) => ev.text === "The object has automatically been transformed into a tool")).toBe(true);
  });

  it("R-TREE-21: visibility is per item; F7 toggles each selected item; nothing selected swaps all", async () => {
    const e = await engine();
    const a = (await e.run("item.addFrame", { name: "A" })) as unknown as R;
    const b = (await e.run("item.addFrame", { name: "B", parent: a.id })) as unknown as R;
    await e.run("item.setVisible", { items: [a.id], visible: false });
    expect(e.ws.items[b.id].visible).toBe(true);
    await e.run("item.setVisible", { items: [a.id, b.id] });
    expect([e.ws.items[a.id].visible, e.ws.items[b.id].visible]).toEqual([true, false]);
    await e.run("edit.select", { items: [] });
    await e.run("item.setVisible", {});
    expect([e.ws.items[a.id].visible, e.ws.items[b.id].visible]).toEqual([false, true]);
  });
});

describe("clipboard (R-IM-36..39)", () => {
  it("R-IM-36/37: copy puts the items marker on the clipboard; paste keeps names and relative poses (D3/D4)", async () => {
    const e = await engine();
    const src = (await e.run("item.addFrame", { name: "CopyMe", xyzrpw: [100, 200, 300, 0, 0, 0] })) as unknown as R;
    await e.run("item.addFrame", { name: "CopyMeChild", parent: src.id, xyzrpw: [0, 0, 50, 0, 0, 0] });
    const dst = (await e.run("item.addFrame", { name: "PasteTarget", xyzrpw: [0, 1000, 0, 0, 0, 0] })) as unknown as R;
    const c = (await e.run("edit.copy", { items: [src.id] })) as unknown as { clipboardText: string };
    expect(c.clipboardText).toBe("%Enginuity items%");
    await e.run("edit.select", { items: [dst.id] });
    const p = (await e.run("edit.paste", { text: "%Enginuity items%" })) as unknown as { ids: string[] };
    const copy = e.ws.items[p.ids[0]];
    expect(copy.name).toBe("CopyMe");
    expect(copy.parent).toBe(dst.id);
    expect([copy.pose[3], copy.pose[7], copy.pose[11]]).toEqual([100, 200, 300]);
    expect(e.ws.items[copy.children[0]].name).toBe("CopyMeChild");
  });

  it("R-IM-39: copy with nothing selected copies the robot joints tab-separated with 6 decimals (D1)", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    await e.run("robot.setJoints", { robot: r.id, joints: [1, 2, 3, 4, 5, 6] });
    await e.run("edit.select", { items: [] });
    const c = (await e.run("edit.copy", {})) as unknown as { clipboardText: string };
    expect(c.clipboardText).toBe("1.000000\t2.000000\t3.000000\t4.000000\t5.000000\t6.000000");
  });

  it("R-IM-38: pasted numbers become joints, 'Pasted Points', 'Pasted Curve' or nothing (C2, D6–D8)", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    await e.run("edit.paste", { text: "10 20 30 40 50 60" });
    expect(e.ws.items[r.id].robot!.joints).toEqual([10, 20, 30, 40, 50, 60]);
    await e.run("edit.select", { items: [] });
    await e.run("edit.paste", { text: "1 2 3\n4 5 6\n7 8 9" });
    expect(names(e, "object")).toContain("Pasted Points");
    await e.run("edit.paste", { text: "1 2 3 0 0 1\n4 5 6 0 0 1\n7 8 9 0 0 1" });
    expect(names(e, "object")).toContain("Pasted Curve");
    const before = Object.keys(e.ws.items).length;
    await e.run("edit.paste", { text: "hello world" });
    expect(Object.keys(e.ws.items).length).toBe(before);
    expect(e.events.some((ev) => ev.text === "Cannot paste data.")).toBe(true);
  });
});

describe("undo (R-IM-28..35)", () => {
  it("R-IM-28: each station keeps its own history", async () => {
    const e = await engine();
    await e.run("item.addFrame", { name: "A" }, "ui");
    expect(e.undo.list().undo).toEqual(["Add: A"]);
    await e.run("station.new", {});
    expect(e.undo.list().undo).toEqual([]);
    await e.run("station.setActive", { station: e.ws.stations[0] });
    expect(e.undo.list().undo).toEqual(["Add: A"]);
  });

  it("R-IM-30/31: UI renames and joint moves record RoboDK texts; API setters record nothing", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    e.undo.clear();
    await e.run("item.rename", { item: r.id, name: "R1" }, "ui");
    await e.run("robot.setJoints", { robot: r.id, joints: [0, 10, 0, 0, 0, 0] }, "ui");
    await e.run("item.setVisible", { items: [r.id] }, "ui");
    await e.run("robot.setJoints", { robot: r.id, joints: [0, 20, 0, 0, 0, 0] }, "api");
    await e.run("item.rename", { item: r.id, name: "R2" }, "api");
    expect(e.undo.list().undo).toEqual(["Set item name to R1", "Move robot: R1"]);
  });
});

describe("instruction names (R-PROG-4..13)", () => {
  it("R-PROG-4: Set Speed name precedence and 1-decimal rounding", () => {
    expect(speedName({ linear: 250, joint: -1, linearAccel: -1, jointAccel: -1 })).toBe("Set speed (250.0 mm/s)");
    expect(speedName({ linear: 0.05, joint: -1, linearAccel: -1, jointAccel: -1 })).toBe("Set speed (0.1 mm/s)");
    expect(speedName({ linear: 250.25, joint: -1, linearAccel: -1, jointAccel: -1 })).toBe("Set speed (250.3 mm/s)");
    expect(speedName({ linear: 600.05, joint: -1, linearAccel: -1, jointAccel: -1 })).toBe("Set speed (600.0 mm/s)");
    expect(speedName({ linear: 99.95, joint: -1, linearAccel: -1, jointAccel: -1 })).toBe("Set speed (100.0 mm/s)");
    expect(speedName({ linear: -1, joint: 30, linearAccel: 800, jointAccel: -1 })).toBe("Set accel. (800.0 mm/s2)");
    expect(speedName({ linear: -1, joint: 30, linearAccel: -1, jointAccel: 50 })).toBe("Set speed (30.0 deg/s)");
    expect(speedName({ linear: -1, joint: -1, linearAccel: -1, jointAccel: 50 })).toBe("Set accel. (50.0 deg/s2)");
    expect(speedName({ linear: -1, joint: -1, linearAccel: -1, jointAccel: -1 })).toBe("Change speed (unset)");
  });

  it("R-PROG-6/9: rounding and pause names", () => {
    expect([-2, 0, 0.4, 0.5, 2.5, 10.75].map(roundingName)).toEqual(["Accurate", "Smooth(0)", "Smooth(0)", "Smooth(1)", "Smooth(3)", "Smooth(11)"]);
    expect([-0.5, 0.5, 999, 999.5, 1000, 1049, 1050, 61000].map(pauseName)).toEqual([
      "Stop",
      "Pause 1 ms",
      "Pause 999 ms",
      "Pause 1000 ms",
      "Pause 1.0 s",
      "Pause 1.0 s",
      "Pause 1.1 s",
      "Pause 61.0 s",
    ]);
  });

  it("R-PROG-12: IO names, prefixes and wait timeouts", () => {
    expect(ioName({ mode: "set", name: "0", value: "0" })).toBe("Set IO_0=0");
    expect(ioName({ mode: "set", name: "0", value: "0", analog: true })).toBe("Set AO_0=0");
    expect(ioName({ mode: "set", name: "Valve", value: "0" })).toBe("Set Valve=0");
    expect(ioName({ mode: "set", name: "DO[3]", value: "1" })).toBe("Set DO[3]=1");
    expect(ioName({ mode: "wait", name: "2", value: "1" })).toBe("Wait IO_2=1");
    expect(ioName({ mode: "wait", name: "2", value: "1", timeoutMs: 999 })).toBe("Wait IO_2=1 T999ms");
    expect(ioName({ mode: "wait", name: "4", value: "0", timeoutMs: 1050 })).toBe("Wait IO_4=0 T1.1s");
    expect(ioName({ mode: "wait", name: "4", value: "0", timeoutMs: 1500 })).toBe("Wait IO_4=0 T1.5s");
  });

  it("R-PROG-7/8/13: reference, tool, move and event names", async () => {
    const e = await engine();
    expect(instructionName(e.ws, { kind: "frame", frame: null })).toBe("Change Frame");
    expect(instructionName(e.ws, { kind: "tool", tool: null })).toBe("Set Tool");
    expect(instructionName(e.ws, { kind: "move", moveType: "joint", joints: [0], index: 26 })).toBe("MoveJ 26");
    expect(eventName(e.ws, undefined)).toBe("Not defined");
    expect(eventName(e.ws, { action: "home" })).toBe("Home mechanisms");
  });

  it("R-PROG-4..12: GUI defaults of inserted instructions", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const p = (await e.run("program.add", {})) as unknown as R;
    for (const kind of ["pause", "speed", "rounding", "print", "call", "io"]) await e.run("program.addInstruction", { program: p.id, kind });
    const labels = e.ws.items[p.id].children.map((c) => e.ws.items[c].name);
    expect(labels).toEqual(["Pause 500 ms", "Set speed (500.0 mm/s)", "Accurate", "Display message", "Program1", "Set IO_5=1"]);
  });
});

describe("timing model (R-PROG-17..24)", () => {
  it("R-PROG-18: trapezoidal and triangular profiles", () => {
    expect(near(trapezoidTime(90, 200, 150), 2 * Math.sqrt(90 / 150), 1e-9)).toBe(true);
    expect(near(trapezoidTime(100, 1000, 1500), 0.5164, 1e-4)).toBe(true);
    expect(near(trapezoidTime(100, 50, 400), 2.125, 1e-9)).toBe(true);
    const p = { d: 100, v: 50, a: 400 };
    expect(near(profileAt(p, trapezoidTime(100, 50, 400)), 100, 1e-9)).toBe(true);
    expect(near(profileAt(p, trapezoidTime(100, 50, 400) / 2), 50, 1e-9)).toBe(true);
  });

  it("R-PROG-19/23: Update() times MoveJ on the largest joint delta and ignores Set Speed instructions", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    await e.run("robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 30, 0] });
    const p = (await e.run("program.add", { robot: r.id })) as unknown as R;
    await e.run("program.addInstruction", { program: p.id, kind: "speed", linear: 50, linearAccel: 400 });
    await e.run("program.addMoveJ", { program: p.id, joints: [90, 30, 0, -90, 30, 90], createTarget: false });
    const u = (await e.run("program.update", { program: p.id })) as unknown as number[];
    expect(u[0]).toBe(2);
    expect(near(u[1], 2 * Math.sqrt(90 / 150), 1e-6)).toBe(true);
    expect(u[3]).toBe(1);
  });

  it("R-PROG-19/24: MoveJ distance is the TCP path length (probe2 T0/T2 on ABB IRB 120 with a 100 mm TCP)", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    await e.run("robot.addTool", { robot: r.id, xyzrpw: [0, 0, 100, 0, 0, 0] });
    const p = (await e.run("program.add", { robot: r.id })) as unknown as R;
    await e.run("robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 0, 0] });
    await e.run("program.addMoveJ", { program: p.id, joints: [0, 0, 0, 0, 30, 0], createTarget: false });
    const u0 = (await e.run("program.update", { program: p.id })) as unknown as number[];
    expect(near(u0[1], 0.8944, 1e-4)).toBe(true);
    expect(near(u0[2], 90.0578, 1e-3)).toBe(true);
    const q = (await e.run("program.add", { robot: r.id })) as unknown as R;
    await e.run("robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 30, 0] });
    await e.run("program.addMoveJ", { program: q.id, joints: [90, 0, 0, 0, 30, 0], createTarget: false });
    const u1 = (await e.run("program.update", { program: q.id })) as unknown as number[];
    expect(near(u1[1], 1.5492, 1e-4)).toBe(true);
    expect(near(u1[2], 708.3516, 1e-3)).toBe(true);
  });

  it("R-PROG-26: the estimate stops at the first unreachable move with ratio 0", async () => {
    const e = await engine();
    const r = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as R;
    const p = (await e.run("program.add", { robot: r.id })) as unknown as R;
    await e.run("program.addMoveJ", { program: p.id, joints: [10, 0, 0, 0, 30, 0], createTarget: false });
    const far = (await e.run("target.add", { name: "far", xyzrpw: [5000, 0, 0, 0, 180, 0] })) as unknown as R;
    await e.run("program.addMoveJ", { program: p.id, target: far.id });
    await e.run("program.addMoveJ", { program: p.id, joints: [20, 0, 0, 0, 30, 0], createTarget: false });
    const u = (await e.run("program.update", { program: p.id })) as unknown as number[];
    expect(u[0]).toBe(1);
    expect(u[3]).toBe(0);
    expect(u[4]).toBe("");
  });

  it("R-PROG-34: program time format and the finished status text", () => {
    expect(formatProgramTime(0)).toBe("0.000s");
    expect(formatProgramTime(1.0954)).toBe("1.1s");
    expect(formatProgramTime(75.3)).toBe(" 1m 15.3s");
    expect(formatProgramTime(3725)).toBe("01h 02m 05s");
    expect(programFinishedText("FinishProg", 354.18, 1.0954)).toBe("Program FinishProg finished (path length: 354.2 mm, program time: 1.1s)");
    expect(programFinishedText("Quick", 0, 0.005)).toBe("Program Quick finished");
  });
});
