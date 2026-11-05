// Verifies workspace display settings, view actions, selection resets, and item dragging.
 
 
import { describe, expect, it } from "vitest";
import { applySettings, coerceSetting } from "@/engine/commands/settings";
import { fk } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { viewOf } from "@/engine/view";
import { absPose, toolPose } from "@/engine/workspace";
import { engine, near } from "../helpers";

const id = (r: unknown) => (r as { id: string }).id;
const pos = (m: number[]) => [m[3], m[7], m[11]];

async function cell() {
  const e = await engine();
  const box = id(await e.run("object.addShape", { shape: "box", name: "Box", sizeX: 100, sizeY: 100, sizeZ: 100 }));
  const ball = id(await e.run("object.addShape", { shape: "sphere", name: "Ball", radius: 50 }));
  await e.run("item.setPose", { item: ball, xyzrpw: [500, 0, 0, 0, 0, 0], relativeTo: "station" });
  e.undo.clear();
  return { e, box, ball };
}

describe("display state (R-IM-2, R-SLF-43, R-PERSIST-3)", () => {
  it("toggles live in the workspace and are not undo steps", async () => {
    const { e } = await cell();
    expect(viewOf(e.ws).frames).toBe(true);
    const r = await e.run("view.toggle", { what: "frames" });
    expect(r.frames).toBe(false);
    expect(viewOf(e.ws).frames).toBe(false);
    await e.run("view.toggle", { what: "trace" });
    await e.run("view.toggle", { what: "trace-reset" });
    expect(viewOf(e.ws)).toMatchObject({ trace: true, traceReset: 1 });
    expect(e.undo.list().undo).toHaveLength(0);
  });

  it("'+' and '-' scale every frame size by 1.25 and 0.8 with no upper limit", async () => {
    const { e } = await cell();
    expect([350, 250, 150, 100]).toEqual(["FrameSizesRef", "FrameSizesTarget", "FrameSizesPath", "FrameSizesOther"].map((k) => e.services.settings[k]));
    for (let i = 0; i < 30; i++) await e.run("view.toggle", { what: "frames-bigger" });
    expect(Number(e.services.settings.FrameSizesRef)).toBeCloseTo(350 * 1.25 ** 30, 0);
    await e.run("view.toggle", { what: "frames-smaller" });
    expect(Number(e.services.settings.FrameSizesRef)).toBeCloseTo(350 * 1.25 ** 30 * 0.8, 0);
  });

  it("setDisplay sets trace style, text flags, sizes and background, checking colours", async () => {
    const { e } = await cell();
    const r = await e.run("view.setDisplay", { traceStyle: 2, textFor: { robot: true, tool: false }, frameSizes: { target: 80 }, background: { top: "#ffeedd" } });
    expect(r).toMatchObject({ traceStyle: "Dots", frameSizes: { ref: 350, target: 80, path: 150, other: 100 } });
    expect(e.services.settings).toMatchObject({ Trace_Render_Style: 2, TextFor_Robots: true, TextFor_Tools: false, ColorBgTop: "#ffeedd" });
    const bad = await e.tryRun("view.setDisplay", { background: { bottom: "red" } });
    expect(bad.error).toBe("Invalid colour red: use #RRGGBB");
    const unknown = await e.tryRun("view.setDisplay", { textFor: { curve: true } });
    expect(unknown.ok).toBe(false);
  });

  it("Align Rotation switched on snaps to the isometric view", async () => {
    const { e } = await cell();
    await e.run("view.toggle", { what: "alignRotation" });
    expect(e.services.settings.KeepRotationAligned).toBe(false);
    e.events.length = 0;
    await e.run("view.toggle", { what: "alignRotation" });
    expect(e.services.settings.KeepRotationAligned).toBe(true);
    expect(e.events).toContainEqual({ type: "view", action: "preset", view: "iso" });
  });

  it("mouse operation, move mode and navigation style", async () => {
    const { e } = await cell();
    const r = await e.run("view.setMouse", { left: "pan", moveMode: "references", navStyle: "classic", invertZoom: true });
    expect(r).toEqual({ left: "pan", moveMode: "references", navStyle: "classic", invertZoom: true });
    expect(e.services.settings).toMatchObject({ RC_NAV_STYLE: "classic", ZoomInvert: true });
  });

  it("Fit to Selection needs a selection", async () => {
    const { e, box } = await cell();
    await e.run("edit.select", { items: [] });
    expect((await e.tryRun("view.fit", { selection: true })).error).toBe("Select object to reframe on");
    await e.run("edit.select", { items: [box] });
    expect(await e.run("view.fit", { selection: true })).toEqual({ fitted: 1 });
  });
});

describe("Escape (R-IM-8)", () => {
  it("resets the move mode, clears the selection, then the left operation", async () => {
    const { e, box } = await cell();
    await e.run("view.setMouse", { left: "zoom", moveMode: "tools" });
    await e.run("edit.select", { items: [box] });
    expect(await e.run("view.escape")).toEqual({ step: "selection" });
    expect(e.ws.selection).toEqual([]);
    expect(viewOf(e.ws).moveMode).toBe("default");
    expect(e.events.some((x) => x.type === "status" && x.text === "Cleared selection")).toBe(true);
    expect(await e.run("view.escape")).toEqual({ step: null });
    expect(await e.run("view.escape", { final: true })).toEqual({ step: "mouse" });
    expect(viewOf(e.ws).leftAction).toBe("select");
  });
});

describe("toolbar layouts (R-IM-27)", () => {
  it("unknown names keep the default layout with the original's message", async () => {
    const { e } = await cell();
    expect(await e.run("view.toolbar", { layout: "viewer" })).toEqual({ layout: "Viewer" });
    expect(viewOf(e.ws).toolbar).toBe("Viewer");
    const r = await e.run("view.toolbar", { layout: "bogus" });
    expect(r).toMatchObject({ layout: "Default", warning: "Unknown toolbar set: bogus" });
    expect(viewOf(e.ws).toolbar).toBe("Default");
    expect(await e.run("view.toolbar", { layout: "Default" })).toEqual({ layout: "Default" });
  });

  it("the menu actions reach the layouts", async () => {
    const { e } = await cell();
    await e.run("view.action", { name: "actionNo_Toolbar" });
    expect(viewOf(e.ws).toolbar).toBe("No Toolbar");
    await e.run("view.action", { name: "actionComplete" });
    expect(viewOf(e.ws).toolbar).toBe("Complete");
  });
});

describe("menu actions through view.action (R-IM-23)", () => {
  it("lists every action and runs command-bound ones", async () => {
    const { e } = await cell();
    const list = await e.run("view.action", { name: "" });
    expect(list.count).toBe(147);
    expect(String(list.actions).startsWith("actionSave_Station|Save Station|Ctrl+S||")).toBe(true);
    await e.run("view.action", { name: "actionTraceSpheres" });
    expect(e.services.settings.Trace_Render_Style).toBe(4);
    await e.run("view.action", { name: "actionPerspective_view" });
    expect(viewOf(e.ws).perspective).toBe(false);
  });

  it("answers unknown names like TriggerAction and reports unavailable features", async () => {
    const { e } = await cell();
    expect(await e.run("view.action", { name: "actionNope" })).toEqual({ reply: "Triggering action actionNope" });
    e.events.length = 0;
    await e.run("view.action", { name: "actionOpen_FTP_Client" });
    expect(e.events).toContainEqual(expect.objectContaining({ type: "status", text: "FileZilla FTP Client not found" }));
  });

  it("dialog actions need an open window, and are forwarded to it", async () => {
    const { e } = await cell();
    expect((await e.tryRun("view.action", { name: "action-Options" })).error).toBe("Options needs an open Enginuity window");
    e.services.view = { clients: () => 1, screenshot: async () => ({ path: "", width: 0, height: 0 }) };
    e.events.length = 0;
    await e.run("view.action", { name: "action-Options" });
    expect(e.events).toContainEqual({ type: "ui-action", name: "action-Options" });
  });
});

describe("dragging items: item.moveBy (R-IM-21, R-IM-30)", () => {
  it("moves an object as one undo step labelled like the original", async () => {
    const { e, box } = await cell();
    await e.run("item.moveBy", { items: [box], translate: [100, -20, 5] }, "ui");
    expect(pos(absPose(e.ws, box))).toEqual([100, -20, 5]);
    expect(e.undo.list().undo).toEqual(["Move: Box"]);
    e.undo.undo();
    expect(pos(absPose(e.ws, box))).toEqual([0, 0, 0]);
  });

  it("moves the selection together and rotates about the vertical through the pivot", async () => {
    const { e, box, ball } = await cell();
    await e.run("item.moveBy", { items: [box, ball], rotateZ: 90, pivot: [0, 0, 0] }, "ui");
    const b = pos(absPose(e.ws, ball));
    expect(near(b[0], 0) && near(b[1], 500) && near(b[2], 0)).toBe(true);
    expect(e.undo.list().undo).toEqual(["Move: Box, Ball"]);
  });

  it("children follow their parent and are not moved twice", async () => {
    const { e, box, ball } = await cell();
    await e.run("item.setParent", { item: ball, parent: box, keepAbsolute: true });
    await e.run("item.moveBy", { items: [box, ball], translate: [0, 0, 100] }, "ui");
    expect(pos(absPose(e.ws, ball))).toEqual([500, 0, 100]);
  });

  it("refuses locked items", async () => {
    const { e, box } = await cell();
    await e.run("item.lock", { items: [box], locked: true });
    const r = await e.tryRun("item.moveBy", { items: [box], translate: [10, 0, 0] }, "ui");
    expect(r.error).toBe("Box is locked");
    expect(pos(absPose(e.ws, box))).toEqual([0, 0, 0]);
  });

  it("a robot moves with its base frame; a tool moves its robot so the TCP follows", async () => {
    const { e } = await cell();
    const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
    const base = e.ws.items[robot].parent!;
    const [bx, by, bz] = pos(absPose(e.ws, base));
    await e.run("item.moveBy", { items: [robot], translate: [0, 200, 0] }, "ui");
    expect(pos(absPose(e.ws, base))).toEqual([bx, by + 200, bz]);
    const tool = id(await e.run("robot.addTool", { robot, name: "Gripper", xyzrpw: [0, 0, 100, 0, 0, 0] }));
    const tcp = () => {
      const r = e.ws.items[robot];
      return pos(mul(mul(absPose(e.ws, robot), fk(r.robot!.model, r.robot!.joints)), toolPose(e.ws, robot)));
    };
    const before = tcp();
    await e.run("item.moveBy", { items: [tool], translate: [0, 0, -50] }, "ui");
    const after = tcp();
    expect(near(after[0], before[0], 1e-3) && near(after[1], before[1], 1e-3) && near(after[2], before[2] - 50, 1e-3)).toBe(true);
    expect(pos(absPose(e.ws, base))).toEqual([bx, by + 200, bz]);
  });
});

describe("Measure (R-SLF-41)", () => {
  it("measures distance, delta and the angle between directions", async () => {
    const { e, box, ball } = await cell();
    expect(await e.run("view.measure", { from: { item: box }, to: { item: ball } })).toEqual({ from: "Box", to: "Ball", distance: 500, delta: [500, 0, 0], angle: 0 });
    const r = await e.run("view.measure", { from: { point: [0, 0, 0], normal: [0, 0, 1] }, to: { point: [30, 40, 0], normal: [1, 0, 0] } });
    expect(r).toMatchObject({ distance: 50, delta: [30, 40, 0], angle: 90 });
  });
});

describe("options (R-SLF-1, R-IM-33)", () => {
  it("coerces values to the type of their default", () => {
    expect(coerceSetting("FrameSizesRef", "500")).toBe(500);
    expect(coerceSetting("TextFor_Robots", "1")).toBe(true);
    expect(coerceSetting("TextFor_Robots", 0)).toBe(false);
    expect(coerceSetting("RC_THEME", "dark")).toBe("dark");
    expect(() => coerceSetting("FrameSizesRef", "big")).toThrow("FrameSizesRef needs a number");
  });

  it("a new undo limit needs an empty history", async () => {
    const { e, box } = await cell();
    e.services.undo!.setLimit = (limit) => e.undo.group.setLimit(limit, e.ws);
    await e.run("item.moveBy", { items: [box], translate: [1, 0, 0] }, "ui");
    const refused = applySettings(e.services, { UndoStackLimit: 20, FrameSizesRef: "400" });
    expect(refused.message).toBe("Current buffer stack must be deleted to apply changes");
    expect(e.services.settings.UndoStackLimit).toBe(500);
    expect(e.services.settings.FrameSizesRef).toBe(400);
    expect((await e.tryRun("settings.set", { key: "UndoStackLimit", value: 20 })).error).toBe("Current buffer stack must be deleted to apply changes");
    await e.run("edit.clearUndo");
    expect(applySettings(e.services, { UndoStackLimit: 20 })).toEqual({ applied: { UndoStackLimit: 20 } });
  });

  it("Set default settings restores the factory values and keeps the Copilot connection", async () => {
    const { e } = await cell();
    e.services.settings.FrameSizesRef = 999;
    e.services.settings.RC_AGENT_MODEL = "my-model";
    await e.run("settings.reset");
    expect(e.services.settings.FrameSizesRef).toBe(DEFAULT_SETTINGS.FrameSizesRef);
    expect(e.services.settings.RC_AGENT_MODEL).toBe("my-model");
  });
});

describe("robot workspace (R-SLF-44)", () => {
  it("stores the mode on the robot", async () => {
    const { e } = await cell();
    const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
    expect(await e.run("robot.showWorkspace", { robot, mode: 3 })).toEqual({ robot: "ABB IRB 120-3/0.6", mode: 3, label: "Show for current tool" });
    expect(e.ws.items[robot].params?.ShowWorkspace).toBe("3");
    expect((await e.tryRun("robot.showWorkspace", { robot: id(await e.run("item.addFrame", { name: "F" })), mode: 1 })).error).toBe("F is not a robot");
  });
});

describe("screenshots and About", () => {
  it("names the file after the station and keeps it in the screenshots folder", async () => {
    const { e } = await cell();
    expect((await e.tryRun("view.screenshot")).error).toBe("Screenshots are taken by the Enginuity server");
    const asked: { file: string; white: boolean }[] = [];
     
    e.services.view = { clients: () => 1, screenshot: async (o) => (asked.push(o), { path: `/shots/${o.file}`, width: 10, height: 10 }) };
    const station = e.ws.items[e.ws.activeStation!].name;
    await e.run("view.screenshot", {}, "ui");
    await e.run("view.screenshot", { file: "cell", white: true }, "ui");
    expect(asked).toEqual([
      { file: `${station}_screenshot.png`, white: false },
      { file: "cell.png", white: true },
    ]);
    expect((await e.tryRun("view.screenshot", { file: "../x.png" }, "ui")).error).toBe("The file name must not contain a folder");
    await e.run("view.screenshot", { file: "/tmp/api.png" }, "api");
    expect(asked.at(-1)).toEqual({ file: "/tmp/api.png", white: false });
  });

  it("About reports the product, version and API build", async () => {
    const { e } = await cell();
    expect(await e.run("help.about")).toMatchObject({ product: "Enginuity", apiBuild: 26935, build: expect.stringMatching(/\.26935$/) });
     
    const about = (await e.run("help.about")) as unknown as Record<string, unknown>;
    expect(about.license).toBeUndefined();
    expect(JSON.stringify(about)).not.toMatch(/RoboDK|reconstruction/i);
  });
});
