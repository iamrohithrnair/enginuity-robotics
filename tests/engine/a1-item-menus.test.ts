// Verifies item-menu display flags, locking, geometry splitting, exports, and alignment.
 
 
 
import { describe, expect, it } from "vitest";
import { dropIndices, dropPlan, DRAG_INSTRUCTIONS_LOCKED, REORDER_RUNNING, treeChildren } from "@/client/treeDrop";
import { alignedOrientation, AXIS_ROTATIONS } from "@/engine/align";
import { reorderLessThan } from "@/engine/commands/items";
import { displayFlag } from "@/engine/display";
import { exportFileName } from "@/engine/itemExport";
import { parseMesh } from "@/engine/meshio";
import { absPose } from "@/engine/workspace";
import { DEG, mul, rotx, rotz, transl, type Mat } from "@/engine/math";
import type { Item } from "@/engine/types";
import { engine, near } from "../helpers";

type E = Awaited<ReturnType<typeof engine>>;
const id = (r: unknown) => (r as { id: string }).id;
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");
const statuses = (e: E) => e.events.filter((x) => x.type === "status").map((x) => String(x.text));
const samePose = (a: Mat, b: Mat) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

 
const twoColourPly = [
  "ply",
  "format ascii 1.0",
  "element vertex 6",
  "property float x",
  "property float y",
  "property float z",
  "element face 2",
  "property list uchar int vertex_indices",
  "property uchar red",
  "property uchar green",
  "property uchar blue",
  "end_header",
  "0 0 0",
  "10 0 0",
  "0 10 0",
  "0 0 5",
  "10 0 5",
  "0 10 5",
  "3 0 1 2 255 0 0",
  "3 3 4 5 0 0 255",
  "",
].join("\n");

async function withPart(e: E, name = "Part") {
  return id(await e.run("file.open", { fileName: `${name}.ply`, base64: b64(twoColourPly) }));
}

describe("Visible … entries (item.setDisplay, R-TREE-38/40/42)", () => {
  it("toggle the item flags without undo steps; object references start hidden (ShowRef_NewObjects)", async () => {
    const e = await engine();
    const st = e.ws.activeStation!;
    const part = await withPart(e);
    expect(displayFlag(e.ws.items[part], "ShowFrame", e.services.settings)).toBe(false);
    expect(displayFlag(e.ws.items[st], "ShowGrid", e.services.settings)).toBe(true);
    e.undo.clear();
    await e.run("item.setDisplay", { items: [st], what: "grid" }, "ui");
    await e.run("item.setDisplay", { items: [part], what: "reference" }, "ui");
    expect(e.ws.items[st].params?.ShowGrid).toBe("0");
    expect(e.ws.items[part].params?.ShowFrame).toBe("1");
    e.services.settings.ShowRef_NewObjects = true;
    expect(displayFlag({ ...e.ws.items[part], params: {} }, "ShowFrame", e.services.settings)).toBe(true);
    expect(e.undo.list().undo).toEqual([]);
  });

  it("robot Visible Tool Frame targets the active tool's TCP", async () => {
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    const tool = id(await e.run("robot.addTool", { robot, xyzrpw: [0, 0, 100, 0, 0, 0] }));
    const r = await e.run("item.setDisplay", { items: [robot], what: "tool", visible: false });
    expect(r.changed).toEqual([{ item: e.ws.items[tool].name, key: "ShowTCP", visible: false }]);
    expect(e.ws.items[tool].params?.ShowTCP).toBe("0");
  });
});

describe("Lock (item.lock, FUN_100056eb8 / FUN_100057108)", () => {
  it("a locked object or tool refuses moves from the UI with RoboDK's status", async () => {
    const e = await engine();
    const part = await withPart(e);
    await e.run("item.lock", { items: [part] });
    expect(e.ws.items[part].locked).toBe(true);
    const before = e.ws.items[part].pose.slice();
    await e.tryRun("item.setPose", { item: part, xyzrpw: [100, 0, 0, 0, 0, 0] }, "ui");
    expect(e.ws.items[part].pose).toEqual(before);
    expect(statuses(e)).toContain("This object is locked");
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    const tool = id(await e.run("robot.addTool", { robot, xyzrpw: [0, 0, 100, 0, 0, 0] }));
    await e.run("item.lock", { items: [tool], locked: true });
    await e.tryRun("item.setPose", { item: tool, xyzrpw: [0, 0, 150, 0, 0, 0] }, "ui");
    expect(statuses(e)).toContain("This tool is locked");
    await e.run("item.lock", { items: [part] });
    expect(e.ws.items[part].locked).toBe(false);
  });
});

describe("Split Object (FUN_1004b4500)", () => {
  it("each shape becomes '<name>-i' under the emptied original, one 'Add:' step each", async () => {
    const e = await engine();
    const part = await withPart(e, "Bracket");
    expect(e.ws.items[part].object!.meshes).toHaveLength(2);
    e.undo.clear();
    const r = await e.run("object.split", { item: part }, "ui");
    expect(r.created).toEqual(["Bracket-0", "Bracket-1"]);
    expect(e.ws.items[part].object!.meshes).toEqual([]);
    expect(e.ws.items[part].children.map((c) => e.ws.items[c].name)).toEqual(["Bracket-0", "Bracket-1"]);
    expect(e.undo.list().undo).toEqual(["Add: Bracket-0", "Add: Bracket-1"]);
    expect((e.ws.items[(r.ids as string[])[1]] as Item).object!.meshes[0].color.slice(0, 3)).toEqual([0, 0, 1]);
  });

  it("an object without geometry reports it and records nothing", async () => {
    const e = await engine();
    const part = await withPart(e, "Bracket");
    await e.run("object.split", { item: part });
    e.undo.clear();
    const r = await e.run("object.split", { item: part }, "ui");
    expect(r.created).toEqual([]);
    expect(statuses(e)).toContain("Bracket has no geometry to split");
    expect(e.undo.list().undo).toEqual([]);
  });
});

describe("Save As (item.saveAs, robot.saveAs)", () => {
  it("STL, PLY and VRML exports read back with the same triangles", async () => {
    const e = await engine();
    const part = await withPart(e);
    for (const format of ["stl", "ply", "wrl"] as const) {
      const r = await e.run("item.saveAs", { items: [part], format });
      expect(r.fileName).toBe(`Part.${format}`);
      const tris = parseMesh(String(r.fileName), Buffer.from(String(r.base64), "base64"));
      expect(tris.length).toBe(2 * 9);
    }
  });

  it("Save as *.sld writes RoboDK's uncompressed object stream that opens back as the same object", async () => {
    const e = await engine();
    const part = await withPart(e, "Bracket");
    const r = await e.run("item.saveAs", { items: [part], format: "sld" });
    expect(r.fileName).toBe("Bracket.sld");
    const bytes = Buffer.from(String(r.base64), "base64");
     
    expect([0, 1, 2, 3].map((k) => bytes.readDoubleLE(k * 8))).toEqual([1, 1600, 16, 100]);
    const back = await e.run("file.open", { fileName: "copy.sld", base64: String(r.base64) });
    const obj = e.ws.items[id(back)];
    expect(obj.name).toBe("Bracket");
    expect(obj.object!.meshes).toHaveLength(2);
    expect(obj.object!.meshes.map((m) => e.services.geometry.get(m.geometry)!.length)).toEqual([9, 9]);
  });

  it("a tool saves as a .tool file that loads back with its TCP", async () => {
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    const tool = id(await e.run("robot.addTool", { robot, name: "Gripper", xyzrpw: [0, 0, 120, 0, 0, 0] }));
    const r = await e.run("item.saveAs", { items: [tool], format: "tool" });
    expect(r.fileName).toBe("Gripper.tool");
    const back = await e.run("file.open", { fileName: "Gripper copy.tool", base64: String(r.base64), robot });
    const loaded = e.ws.items[id(back)];
    expect(loaded.type).toBe("tool");
    expect(near(loaded.pose[11], 120)).toBe(true);
  });

  it("Save Robot proposes '-' for spaces, brackets and dots and writes a loadable robot file", async () => {
    expect(exportFileName("UR5e (2).v1", "robot")).toBe("UR5e-2-v1.robot");
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    await e.run("item.rename", { item: robot, name: "Cell UR" });
    await e.run("robot.setJoints", { robot, joints: [10, -80, 70, -80, -90, 5] });
    const r = await e.run("robot.saveAs", { robot });
    expect(r.fileName).toBe("Cell-UR.robot");
    const back = await e.run("file.open", { fileName: String(r.fileName), base64: String(r.base64) });
    const loaded = e.ws.items[id(back)];
    expect(loaded.name).toBe("Cell UR");
    expect(loaded.robot!.model.nq).toBe(6);
    expect(loaded.robot!.joints.map((v) => Math.round(v))).toEqual([10, -80, 70, -80, -90, 5]);
    expect(loaded.robot!.links.length).toBe(e.ws.items[robot].robot!.links.length);
  });
});

describe("Align orientation (FUN_1004be260 / FUN_1004bdf24)", () => {
  it("24 distinct axis-aligned rotations", () => {
    const keys = new Set(AXIS_ROTATIONS.map((m) => m.map((v) => Math.round(v)).join(",")));
    expect(keys.size).toBe(24);
  });

  it("snaps to the closest aligned orientation, keeps the position, and is a no-op when aligned", async () => {
    const e = await engine();
    const frame = id(await e.run("item.addFrame", { name: "Fixture", pose: mul(transl(100, 200, 300), mul(rotz(80 * DEG), rotx(-170 * DEG))) }));
    e.undo.clear();
    const r = await e.run("frame.alignOrientation", { item: frame }, "ui");
    expect(r.aligned).toBe(true);
    const p = e.ws.items[frame].pose;
    expect([p[3], p[7], p[11]].map((v) => Math.round(v))).toEqual([100, 200, 300]);
    expect(samePose(p, mul(transl(100, 200, 300), mul(rotz(90 * DEG), rotx(-180 * DEG))))).toBe(true);
    expect(e.undo.list().undo).toEqual(["Move: Fixture"]);
    const again = await e.run("frame.alignOrientation", { item: frame }, "ui");
    expect(again.aligned).toBe(false);
    expect(e.undo.list().undo).toEqual(["Move: Fixture"]);
    expect(alignedOrientation(p).changed).toBe(false);
  });

  it("robot Align Tool Orientation reports 'Align already done' the second time", async () => {
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    await e.run("robot.setJoints", { robot, joints: [0, -90, 90, -80, -95, 10] });
    await e.run("robot.alignToolOrientation", { robot }, "ui");
    expect(statuses(e)).toContain("Aligned");
    await e.run("robot.alignToolOrientation", { robot }, "ui");
    expect(statuses(e).at(-1)).toBe("Align already done");
  });
});

describe("Robot configurations (D-27, FUN_10047d840)", () => {
  it("lists every IK solution of the current pose with exactly one current", async () => {
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
    await e.run("robot.setJoints", { robot, joints: [20, 10, 15, 30, 40, 50] });
    const r = (await e.run("robot.configurations", { robot })) as unknown as { title: string; configurations: { joints: number[]; current: boolean }[] };
    expect(r.title).toBe(`${e.ws.items[robot].name}: Robot Configurations`);
    expect(r.configurations.length).toBeGreaterThan(1);
    expect(r.configurations.filter((c) => c.current)).toHaveLength(1);
  });
});

describe("Reorder (R-TREE-35, FUN_1003e0978 / FUN_100452638)", () => {
  const item = (type: Item["type"], name: string) => ({ type, name }) as Item;

  it("comparator: type priority, Main/Safe programs first, APT numbers padded, case-sensitive names", () => {
    expect(reorderLessThan(item("robot", "Z"), item("object", "A"))).toBe(true);
    expect(reorderLessThan(item("frame", "A"), item("tool", "Z"))).toBe(false);
    expect(reorderLessThan(item("program", "Main"), item("program", "Approach"))).toBe(true);
    expect(reorderLessThan(item("program", "Safe pos"), item("program", "Pick"))).toBe(true);
    expect(reorderLessThan(item("program", "APT2_x"), item("program", "APT10_x"))).toBe(true);
    expect(reorderLessThan(item("object", "b"), item("object", "B"))).toBe(false);
  });

  it("Move to the Top / Bottom / Specify keep the selection order; errors use RoboDK's texts", async () => {
    const e = await engine();
    const st = e.ws.activeStation!;
    const [a, b, c] = [await withPart(e, "A"), await withPart(e, "B"), await withPart(e, "C")];
    const names = () => e.ws.items[st].children.map((x) => e.ws.items[x].name);
    await e.run("item.reorder", { items: [c], to: "top" });
    expect(names()).toEqual(["C", "A", "B"]);
    await e.run("item.reorder", { items: [c, a], to: "bottom" });
    expect(names()).toEqual(["B", "C", "A"]);
    await e.run("item.reorder", { items: [a], before: c });
    expect(names()).toEqual(["B", "A", "C"]);
    expect((await e.tryRun("item.reorder", { items: [st] })).error).toBe("A station can not be reordered");
    const sub = id(await e.run("item.addFrame", { name: "F" }));
    await e.run("item.setParent", { item: b, parent: sub });
    expect((await e.tryRun("item.reorder", { items: [a, b] })).error).toBe("All items must belong to the same object");
  });

  it("Reorder automatically places an item before the first sibling it sorts before", async () => {
    const e = await engine();
    const st = e.ws.activeStation!;
    const part = await withPart(e, "Part");
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    const base = e.ws.items[robot].parent!;
    const names = () => e.ws.items[st].children.map((x) => e.ws.items[x].name);
    expect(names()).toEqual(["Part", "UR5e Base"]);
    await e.run("item.reorderAuto", { items: [base] });
     
    expect(names()).toEqual(["Part", "UR5e Base"]);
    void part;
  });
});

describe("Get with Robot and Move to a New Project", () => {
  it("attaches the object to the active tool keeping its place in the world", async () => {
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    const tool = id(await e.run("robot.addTool", { robot, name: "Gripper", xyzrpw: [0, 0, 100, 0, 0, 0] }));
    const part = await withPart(e);
    await e.run("item.setPose", { item: part, xyzrpw: [300, 100, 50, 0, 0, 30] });
    const abs = absPose(e.ws, part);
    e.undo.clear();
    await e.run("object.getWithRobot", { item: part, robot }, "ui");
    expect(e.ws.items[part].parent).toBe(tool);
    expect(samePose(absPose(e.ws, part), abs)).toBe(true);
    expect(e.undo.list().undo).toEqual(["Attach Part to Gripper"]);
  });

  it("moves a folder with its contents into a new active station", async () => {
    const e = await engine();
    const first = e.ws.activeStation!;
    const folder = id(await e.run("item.addFolder", { name: "Cell" }));
    const part = await withPart(e);
    await e.run("item.setParent", { item: part, parent: folder });
    const r = await e.run("folder.moveToNewStation", { item: folder }, "ui");
    expect(e.ws.activeStation).toBe(r.id);
    expect(e.ws.activeStation).not.toBe(first);
    expect(e.ws.items[folder].parent).toBe(r.id);
    expect(e.ws.items[first].children).not.toContain(folder);
    expect(e.ws.items[part].parent).toBe(folder);
  });
});

describe("tree drag & drop (B-TREE-07, FUN_100428e24)", () => {
  async function cell() {
    const e = await engine();
    const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
    const t1 = id(await e.run("target.teach", { robot, name: "A" }));
    const t2 = id(await e.run("target.teach", { robot, name: "B" }));
    const main = id(await e.run("program.add", { name: "Main", robot }));
    const other = id(await e.run("program.add", { name: "Other", robot }));
    await e.run("program.addMoveJ", { program: main, target: t1 });
    await e.run("program.addMoveL", { program: main, target: t2 });
    await e.run("program.addMoveJ", { program: other, target: t1 });
    return { e, main, other, t1, t2 };
  }

  it("siblings always reorder; a running or locked program refuses with RoboDK's status", async () => {
    const { e, main } = await cell();
    const [i1, i2] = e.ws.items[main].children;
    expect(dropPlan(e.ws, i1, "before", [i2]).plan).toEqual({ parent: main, index: 0 });
    await e.run("program.setFlags", { programs: [main], locked: true });
    expect(dropPlan(e.ws, i1, "before", [i2])).toEqual({ plan: null, status: REORDER_RUNNING.replace("%1", "Main") });
  });

  it("instructions can't leave or enter a locked program", async () => {
    const { e, main, other } = await cell();
    const ins = e.ws.items[other].children[0];
    expect(dropPlan(e.ws, main, "inside", [ins]).plan).toEqual({ parent: main });
    await e.run("program.setFlags", { programs: [other], locked: true });
    expect(dropPlan(e.ws, main, "inside", [ins])).toEqual({ plan: null, status: DRAG_INSTRUCTIONS_LOCKED.replace("%1", "Other") });
  });

  it("an instruction dropped on an instruction goes after it; cross-station drops are refused silently", async () => {
    const { e, main, other } = await cell();
    const ins = e.ws.items[other].children[0];
    const first = e.ws.items[main].children[0];
    expect(dropPlan(e.ws, first, "inside", [ins]).plan).toEqual({ parent: main, index: 1 });
    await e.run("station.new");
    const frame = id(await e.run("item.addFrame", { name: "Elsewhere" }));
    expect(dropPlan(e.ws, frame, "inside", [main])).toEqual({ plan: null });
  });

  it("several items move one by one and end up together, in order", async () => {
    const e = await engine();
    const st = e.ws.activeStation!;
    const [a, b, c, d] = [await withPart(e, "A"), await withPart(e, "B"), await withPart(e, "C"), await withPart(e, "D")];
    const plan = dropPlan(e.ws, d, "after", [a, b]).plan!;
    const idx = dropIndices(e.ws, plan, [a, b]);
    for (const [k, src] of [a, b].entries()) await e.run("item.setParent", { item: src, parent: plan.parent, index: idx[k] }, "ui");
    expect(e.ws.items[st].children.map((x) => e.ws.items[x].name)).toEqual(["C", "D", "A", "B"]);
    void c;
  });

  it("Show Instructions off hides a program's instructions in the tree", async () => {
    const { e, main } = await cell();
    expect(treeChildren(e.ws, e.ws.items[main])).toHaveLength(2);
    await e.run("program.setFlags", { programs: [main], showInstructions: false });
    expect(treeChildren(e.ws, e.ws.items[main])).toEqual([]);
  });
});

describe("copy / paste with the list curve model (R-IM-36..38)", () => {
  it("a pasted object keeps all its curves and its point list", async () => {
    const e = await engine();
    const obj = id(await e.run("object.addCurve", { points: [[0, 0, 0, 0, 0, 1], [10, 0, 0, 0, 0, 1]], name: "A", projection: 0 }));
    await e.run("object.addCurve", { object: obj, addToRef: true, points: [[0, 5, 0, 0, 0, 1], [10, 5, 0, 0, 0, 1], [10, 9, 0, 0, 0, 1]], name: "B", projection: 0 });
    await e.run("object.addPoints", { object: obj, addToRef: true, points: [[1, 1, 0], [2, 2, 0], [3, 3, 0]], projection: 0 });
    const before = (await e.run("object.curves", { object: obj })) as unknown as { curves: { name: string; points: number[][] }[]; points: number[][] };
    expect(before.curves.map((c) => c.name)).toEqual(["A", "B"]);
    await e.run("edit.copy", { items: [obj] });
    const r = await e.run("edit.paste", { parent: e.ws.activeStation! });
    const copy = (r.pasted as string[])[0];
    expect(copy).not.toBe(obj);
    const after = (await e.run("object.curves", { object: copy })) as unknown as typeof before;
    expect(after.curves).toEqual(before.curves);
    expect(after.points).toEqual(before.points);
    expect(after.points).toHaveLength(3);
  });

  it("pasted text becomes a 'Pasted Curve' / 'Pasted Points' object in the list format", async () => {
    const e = await engine();
    const r1 = await e.run("edit.paste", { text: "0 0 0 0 0 1\n10 0 0 0 0 1\n10 10 0 0 0 1" });
    const curve = e.ws.items[(r1.pasted as string[])[0]];
    expect(curve.name).toBe("Pasted Curve");
    expect(curve.object!.curves).toEqual([{ points: [[0, 0, 0, 0, 0, 1], [10, 0, 0, 0, 0, 1], [10, 10, 0, 0, 0, 1]] }]);
    expect(curve.curve).toBeUndefined();
    const r2 = await e.run("edit.paste", { text: "1 2 3\n4 5 6" });
    const pts = e.ws.items[(r2.pasted as string[])[0]];
    expect(pts.name).toBe("Pasted Points");
    expect(pts.object!.points).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});
