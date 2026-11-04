 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MenuEntry } from "@/components/glass/Menu";
import { menuBar, toolbarsFor, TOOLBARS, type MenuState } from "@/components/menuBar";
import { actionForKeySequence, actionListing, effectiveShortcut, findAction, nativeShortcut, MAIN_ACTIONS, shortcutOverrides } from "@/engine/actions";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { DEFAULT_VIEW, toolbarLayoutByName } from "@/engine/view";
import { ROOT } from "../helpers";

const EVIDENCE = (f: string) => readFileSync(path.join(ROOT, "research/evidence/interaction-model", f), "utf8");

describe("action registry (R-IM-3, R-IM-4)", () => {
  it("lists the 147 actions exactly like the original's TriggerAction('')", () => {
    expect(MAIN_ACTIONS).toHaveLength(147);
    expect(actionListing({})).toBe(EVIDENCE("trigger-action-list.txt").trim());
  });

  it("finds actions by objectName case-insensitively", () => {
    expect(findAction("ACTIONFIT_ALL")?.text).toBe("Fit All");
    expect(findAction(" action-Options ")?.shortcut).toBe("Shift+O");
    expect(findAction("actionNope")).toBeUndefined();
  });

  it("writes the shortcut field only for actions that have one", () => {
    const listing = actionListing({});
    expect(listing.startsWith("actionSave_Station|Save Station|Ctrl+S||action-Exit|Exit|Alt+F4||")).toBe(true);
    expect(listing).toContain("||actionAdd_Robot|Add Robot||actionAdd_Tool|Add Tool||");
  });

  it("every action is bound to something real: a command, a UI handler, or an explicit message", () => {
    for (const a of MAIN_ACTIONS) expect(!!(a.command || a.ui || a.unavailable || a.noop), a.name).toBe(true);
  });
});

describe("KeyEvent sequences (R-IM-4)", () => {
  it("renders Qt's macOS NativeText: ⌃⌥⇧⌘ then the key", () => {
    expect(nativeShortcut("Ctrl+N")).toBe("⌘N");
    expect(nativeShortcut("Alt+3")).toBe("⌥3");
    expect(nativeShortcut("Ctrl+Shift+S")).toBe("⇧⌘S");
    expect(nativeShortcut("Shift+F5")).toBe("⇧F5");
    expect(nativeShortcut("Alt+/")).toBe("⌥/");
    expect(nativeShortcut("+")).toBe("+");
    expect(nativeShortcut("Ctrl+Backspace")).toBe("⌘⌫");
  });

  it("matches the probe: Ctrl+N fails, ⌘N and ⌘n trigger New Station", () => {
    const probe = EVIDENCE("probe-keyevent-native.txt");
    expect(probe).toContain("KeyEvent Ctrl+N -> Action for shortcut found: Ctrl+N");
    expect(actionForKeySequence("Ctrl+N")).toBeUndefined();
    expect(probe).toContain("KeyEvent ⌘N -> OK");
    expect(actionForKeySequence("⌘N")?.name).toBe("actionNew_Station");
    expect(actionForKeySequence("⌘n")?.name).toBe("actionNew_Station");
  });

  it("uses the native text of Alt shortcuts: ⌥3 is Front, Alt+3 is nothing", () => {
    expect(actionForKeySequence("⌥3")?.name).toBe("actionFront");
    expect(actionForKeySequence("Alt+3")).toBeUndefined();
    expect(actionForKeySequence("")).toBeUndefined();
  });
});

describe("customized shortcuts (Options ▸ Customize shortcuts, D-23)", () => {
  const custom = { Shortcuts: JSON.stringify({ actionFit_All: "Ctrl+Shift+F", actionTop: "" }) };

  it("overrides and removals apply to menus, listing and KeyEvent alike", () => {
    expect(shortcutOverrides(custom)).toEqual({ actionFit_All: "Ctrl+Shift+F", actionTop: "" });
    expect(effectiveShortcut(findAction("actionFit_All")!, custom)).toBe("Ctrl+Shift+F");
    expect(effectiveShortcut(findAction("actionTop")!, custom)).toBeUndefined();
    expect(actionListing(custom)).toContain("||actionFit_All|Fit All|Ctrl+Shift+F||");
    expect(actionListing(custom)).toContain("||actionTop|Top||");
    expect(actionForKeySequence("⇧⌘F", custom)?.name).toBe("actionFit_All");
    expect(actionForKeySequence("⌥7", custom)).toBeUndefined();
    expect(actionForKeySequence("⌥2", custom)).toBeUndefined();
  });

  it("ignores a broken Shortcuts value", () => {
    expect(shortcutOverrides({ Shortcuts: "{not json" })).toEqual({});
    expect(effectiveShortcut(findAction("actionFit_All")!, { Shortcuts: "{not json" })).toBe("Alt+7");
  });
});

const state = (patch: Partial<MenuState> = {}): MenuState => ({ ws: null, view: { ...DEFAULT_VIEW }, settings: { ...DEFAULT_SETTINGS }, undo: { undo: [], redo: [] }, hold: "default", fullscreen: false, ...patch });
const labels = (m: MenuEntry[]) => m.filter((e) => !("separator" in e && e.separator)).map((e) => (e as { label: string }).label);

describe("menu bar (R-SCREEN-2, R-IM-25)", () => {
  it("has the original's menus in the original's order", () => {
    expect(menuBar(state()).map((m) => m.name)).toEqual(["File", "Edit", "Program", "View", "Tools", "Utilities", "Connect", "Help"]);
  });

  it("View holds the original's view actions, Help ends with About", () => {
    const m = Object.fromEntries(menuBar(state()).map((x) => [x.name, labels(x.entries)]));
    for (const l of ["Fit All", "Isometric", "Show/Hide Reference Frames", "Perspective View", "Align Rotation", "No Selection", "Close Side Windows"]) expect(m.View, l).toContain(l);
    expect(m.Help.at(-1)).toBe("About");
    expect(m.Tools).toContain("Measure");
  });

  it("disables only Undo and Redo, and names the step to undo", () => {
    const empty = menuBar(state()).find((x) => x.name === "Edit")!.entries as { label: string; disabled?: boolean }[];
    expect(empty.find((e) => e.label === "Undo")?.disabled).toBe(true);
    const full = menuBar(state({ undo: { undo: ["Move: Box"], redo: [] } })).find((x) => x.name === "Edit")!.entries as { label: string; disabled?: boolean }[];
    expect(full.some((e) => e.label === "Undo Move: Box" && !e.disabled)).toBe(true);
  });
});

describe("toolbar layouts (R-IM-27, FUN_10039fe44)", () => {
  it("matches names that start with a set name, case-insensitively, in the original's order", () => {
    expect(toolbarLayoutByName("None")).toBe("No Toolbar");
    expect(toolbarLayoutByName("viewer")).toBe("Viewer");
    expect(toolbarLayoutByName("Viewer2")).toBe("Viewer");
    expect(toolbarLayoutByName("BASIC")).toBe("Basic");
    expect(toolbarLayoutByName("Palletizing")).toBe("Palletizing");
    expect(toolbarLayoutByName("CompleteX")).toBe("Complete");
  });

  it("does not match prefixes of set names (unknown sets keep the default)", () => {
    expect(toolbarLayoutByName("View")).toBeNull();
    expect(toolbarLayoutByName("No")).toBeNull();
    expect(toolbarLayoutByName("No Toolbar")).toBeNull();
    expect(toolbarLayoutByName("Default")).toBeNull();
    expect(toolbarLayoutByName("bogus")).toBeNull();
  });

  it("shows the original's toolbars per layout", () => {
    expect(toolbarsFor("Default")).toEqual(["File", "Undo/redo", "Frame/Target", "View", "Selection", "Collision", "Simulation", "Program", "Export"]);
    expect(toolbarsFor("No Toolbar")).toEqual([]);
    expect(toolbarsFor("Viewer")).toEqual(["View", "Selection", "Simulation", "Workspace"]);
    expect(toolbarsFor("Basic")).not.toContain("File");
    expect(toolbarsFor("Complete")).toEqual(expect.arrayContaining(["Tools", "Trace", "3D View", "Manufacturing", "Workspace"]));
    expect(Object.keys(TOOLBARS)).toHaveLength(17);
    for (const names of Object.values(TOOLBARS)) for (const n of names) expect(findAction(n), n).toBeDefined();
  });
});
