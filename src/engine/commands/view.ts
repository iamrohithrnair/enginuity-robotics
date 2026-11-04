import { z } from "zod";
import { ABOUT } from "../about";
import { actionParams, actionListing, findAction, MAIN_ACTIONS } from "../actions";
import { requireRef } from "../dispatch";
import { fk } from "../kinematics";
import { mul, type Mat } from "../math";
import { CommandError, defineCommand, getCommand, ItemRef, status, type CmdCtx } from "../registry";
import type { ViewState } from "../types";
import { FRAME_SIZE_KEYS, NAV_STYLES, navStyle, scaledFrameSizes, TEXT_FOR_KEYS, toolbarLayoutByName, TOOLBAR_LAYOUTS, TRACE_STYLES, viewOf } from "../view";
import { absPose, stationOf, toolPose } from "../workspace";
import { clearGuns } from "../spray";

 
 
 
 
 

const VIEWS = { iso: "Alt+1", top: "Alt+2", front: "Alt+3", right: "Alt+4", left: "Alt+5", back: "Alt+6" } as const;

function setView(ctx: CmdCtx, patch: Partial<ViewState>): ViewState {
  const next = { ...viewOf(ctx.ws), ...patch };
  ctx.tx.setMeta("view", next);
  return next;
}

function setSettings(ctx: CmdCtx, values: Record<string, number | string | boolean>) {
  if (!Object.keys(values).length) return;
  if (!ctx.services.setSetting) throw new CommandError("Display options can only be changed on the server");
  for (const [k, v] of Object.entries(values)) ctx.services.setSetting(k, v);
}

 
function displayReport(ctx: CmdCtx) {
  const s = ctx.services.settings;
  const v = viewOf(ctx.ws);
  return {
    ...v,
    traceStyle: TRACE_STYLES[Number(s.Trace_Render_Style ?? 0)] ?? "References",
    alignRotation: s.KeepRotationAligned !== false,
    frameSizes: Object.fromEntries(Object.entries(FRAME_SIZE_KEYS).map(([k, key]) => [k, Number(s[key])])),
    textFor: Object.fromEntries(Object.entries(TEXT_FOR_KEYS).map(([type, key]) => [type, s[key] === true])),
    navStyle: navStyle(s),
  };
}

defineCommand({
  name: "view.preset",
  title: "Standard View",
  description: "Orient the camera: iso (Alt+1), top (Alt+2), front (Alt+3), right (Alt+4), left (Alt+5), back (Alt+6), then fit the station.",
  category: "view",
  undoable: false,
  readonly: true,
  spec: "R-IM-20",
  schema: z.object({ view: z.enum(Object.keys(VIEWS) as [keyof typeof VIEWS, ...(keyof typeof VIEWS)[]]) }),
  run({ services }, p) {
    services.emit?.({ type: "view", action: "preset", view: p.view });
    return { view: p.view };
  },
});

defineCommand({
  name: "view.fit",
  title: "Fit All",
  description:
    "Fit the camera to all visible items (Alt+7), to given items, or to the current selection with selection=true (Alt+0; 'Select object to reframe on' when nothing is selected).",
  category: "view",
  undoable: false,
  readonly: true,
  spec: "R-IM-20",
  schema: z.object({ items: z.array(ItemRef).optional(), selection: z.boolean().optional() }),
  run({ ws, services }, p) {
    let ids = p.items?.map((r) => requireRef(ws, r).id);
    if (p.selection) {
      ids = ws.selection.filter((id) => ws.items[id]);
      if (!ids.length) throw new CommandError("Select object to reframe on");
    }
    services.emit?.({ type: "view", action: "fit", items: ids ?? null });
    return { fitted: ids?.length ?? "all" };
  },
});

const TOGGLES = ["frames", "text", "workspace", "trace", "trace-reset", "frames-bigger", "frames-smaller", "perspective", "alignRotation", "cinema", "treeInside", "showTree"] as const;

defineCommand({
  name: "view.toggle",
  title: "Toggle Display",
  description:
    "Toggle a 3D-view display aid like the View and Tools menus: frames (Alt+/), text (/), workspace (*), trace (Alt+T), trace-reset (Alt+X), frames-bigger (+, ×1.25), frames-smaller (-, ×0.8), perspective (Perspective View), alignRotation (Align Rotation), cinema (F12), treeInside (Show Tree Inside the Window), showTree. Returns the display state.",
  category: "view",
  undoable: false,
  spec: "R-IM-2, R-SLF-43, R-IM-22",
  schema: z.object({ what: z.enum(TOGGLES) }),
  run(ctx, p) {
    const v = viewOf(ctx.ws);
    switch (p.what) {
      case "frames":
      case "text":
      case "workspace":
      case "trace":
      case "perspective":
      case "cinema":
      case "treeInside":
        setView(ctx, { [p.what]: !v[p.what] });
        if (p.what === "treeInside") setView(ctx, { treeVisible: true });
        break;
      case "showTree":
        setView(ctx, { treeVisible: true });
        break;
      case "trace-reset":
        setView(ctx, { traceReset: v.traceReset + 1 });
        break;
      case "frames-bigger":
      case "frames-smaller":
        setSettings(ctx, scaledFrameSizes(ctx.services.settings, p.what === "frames-bigger" ? 1.25 : 0.8));
        break;
      case "alignRotation": {
        const on = ctx.services.settings.KeepRotationAligned === false;
        setSettings(ctx, { KeepRotationAligned: on });
         
        if (on) ctx.services.emit?.({ type: "view", action: "preset", view: "iso" });
        break;
      }
    }
    return displayReport(ctx);
  },
});

defineCommand({
  name: "view.setDisplay",
  title: "Display Options",
  description:
    "Set 3D-view display options explicitly (omitted values keep their state): frames, text, textObjectsOnly, workspace, trace, traceStyle (0 References, 1 Line, 2 Dots, 3 Points, 4 Spheres), frameSizes {ref, target, path, other} in mm (defaults 350/250/150/100), frameScale (multiply all sizes), perspective, alignRotation, cinema, treeInside, treeVisible, textFor {frame, robot, object, tool, target, program}, background {top, bottom} (#RRGGBB, '' = appearance). Returns the display state.",
  category: "view",
  undoable: false,
  spec: "R-IM-2, R-PERSIST-3, R-SLF-7, R-SLF-43, R-SCREEN-5",
  schema: z.object({
    frames: z.boolean().optional(),
    text: z.boolean().optional(),
    textObjectsOnly: z.boolean().optional(),
    workspace: z.boolean().optional(),
    trace: z.boolean().optional(),
    traceStyle: z.number().int().min(0).max(4).optional(),
    frameSizes: z.object({ ref: z.number().nonnegative().optional(), target: z.number().nonnegative().optional(), path: z.number().nonnegative().optional(), other: z.number().nonnegative().optional() }).optional(),
    frameScale: z.number().positive().optional(),
    perspective: z.boolean().optional(),
    alignRotation: z.boolean().optional(),
    cinema: z.boolean().optional(),
    treeInside: z.boolean().optional(),
    treeVisible: z.boolean().optional(),
    textFor: z.record(z.string(), z.boolean()).optional(),
    background: z.object({ top: z.string().optional(), bottom: z.string().optional() }).optional(),
    blockKeys: z.boolean().optional().describe("API BlockKeyEvents: views ignore keyboard shortcuts"),
  }),
  run(ctx, p) {
    const patch: Partial<ViewState> = {};
    for (const k of ["frames", "text", "workspace", "trace", "perspective", "cinema", "treeInside", "treeVisible", "blockKeys"] as const) if (p[k] !== undefined) patch[k] = p[k];
    if (Object.keys(patch).length) setView(ctx, patch);
    const values: Record<string, number | string | boolean> = {};
    if (p.traceStyle !== undefined) values.Trace_Render_Style = p.traceStyle;
    if (p.textObjectsOnly !== undefined) values.ShowTextObjectOnly = p.textObjectsOnly;
    if (p.alignRotation !== undefined) values.KeepRotationAligned = p.alignRotation;
    if (p.frameScale !== undefined) Object.assign(values, scaledFrameSizes(ctx.services.settings, p.frameScale));
    for (const [k, v] of Object.entries(p.frameSizes ?? {})) if (v !== undefined) values[FRAME_SIZE_KEYS[k as keyof typeof FRAME_SIZE_KEYS]] = v;
    for (const [type, on] of Object.entries(p.textFor ?? {})) {
      const key = TEXT_FOR_KEYS[type as keyof typeof TEXT_FOR_KEYS];
      if (!key) throw new CommandError(`Unknown item type for textFor: ${type} (frame, robot, object, tool, target, program)`);
      values[key] = on;
    }
    for (const [k, v] of Object.entries(p.background ?? {})) {
      if (v === undefined) continue;
      if (v !== "" && !/^#[0-9a-f]{6}$/i.test(v)) throw new CommandError(`Invalid colour ${v}: use #RRGGBB`);
      values[k === "top" ? "ColorBgTop" : "ColorBgBottom"] = v;
    }
    setSettings(ctx, values);
    return displayReport(ctx);
  },
});

defineCommand({
  name: "view.setMouse",
  title: "Mouse Operation",
  description:
    "Choose what the mouse does in the 3D view: left = none | select | rotate | pan | zoom (View ▸ No Selection / Select Items / Rotate / Pan / Zoom; API MouseClickLeft), moveMode = default | references | tools (View ▸ Default Selection / Move References / Move Tools), navStyle = robocraft (Enginuity style: drag items to move them, drag empty space to pan) | classic (classic mapping), invertZoom, rotateSpeed and zoomSpeed ratios.",
  category: "view",
  undoable: false,
  spec: "R-IM-14, R-IM-15, R-IM-21",
  schema: z.object({
    left: z.enum(["none", "select", "rotate", "pan", "zoom"]).optional(),
    moveMode: z.enum(["default", "references", "tools"]).optional(),
    navStyle: z.enum(NAV_STYLES).optional(),
    invertZoom: z.boolean().optional(),
    rotateSpeed: z.number().positive().optional(),
    zoomSpeed: z.number().positive().optional(),
  }),
  run(ctx, p) {
    const patch: Partial<ViewState> = {};
    if (p.left) patch.leftAction = p.left;
    if (p.moveMode) patch.moveMode = p.moveMode;
    if (Object.keys(patch).length) setView(ctx, patch);
    const values: Record<string, number | string | boolean> = {};
    if (p.navStyle) values.RC_NAV_STYLE = p.navStyle;
    if (p.invertZoom !== undefined) values.ZoomInvert = p.invertZoom;
    if (p.rotateSpeed !== undefined) values.Mouse3D_SpeedRotate = p.rotateSpeed;
    if (p.zoomSpeed !== undefined) values.Mouse3D_SpeedZoom = p.zoomSpeed;
    setSettings(ctx, values);
    const v = viewOf(ctx.ws);
    const s = ctx.services.settings;
    return { left: v.leftAction, moveMode: v.moveMode, navStyle: navStyle(s), invertZoom: !!s.ZoomInvert };
  },
});

defineCommand({
  name: "view.escape",
  title: "Default View",
  description:
    "Escape / View ▸ Default View (R-IM-8): resets the move mode, then does only the first applicable step — stop running programs ('Programs stopped'), stop moving robots ('Robots stopped'), clear the selection ('Cleared selection'), remove the spray guns and their particles ('Cleaned station'); with final=true it resets a Rotate/Pan/Zoom left-button operation to Select. Returns the step taken.",
  category: "view",
  undoable: false,
  spec: "R-IM-8, R-SM-6",
  schema: z.object({ final: z.boolean().optional() }),
  run(ctx, p) {
    const { ws, services } = ctx;
    const v = viewOf(ws);
    if (v.moveMode !== "default") setView(ctx, { moveMode: "default" });
    if (p.final) {
      if (v.leftAction !== "select") {
        setView(ctx, { leftAction: "select" });
        return { step: "mouse" };
      }
      return { step: null };
    }
    const busy = (ws.busy ?? []).filter((id) => ws.items[id]);
    if (busy.some((id) => ws.items[id].type === "program") || ws.running) {
      services.runner?.stopAll();
      status(ctx, "Programs stopped");
      return { step: "programs" };
    }
    if (busy.some((id) => ws.items[id].type === "robot")) {
      services.runner?.stopAll();
      status(ctx, "Robots stopped");
      return { step: "robots" };
    }
    if (ws.selection.length) {
      ctx.tx.setMeta("selection", []);
      status(ctx, "Cleared selection");
      return { step: "selection" };
    }
     
    if (clearGuns(ws.activeStation)) {
      status(ctx, "Cleaned station");
      return { step: "station" };
    }
    return { step: null };
  },
});

defineCommand({
  name: "view.toolbar",
  title: "Toolbar Layout",
  description:
    "Tools ▸ Toolbar layout: Default, Viewer, Basic, Palletizing, Simple, Complete or None (No Toolbar). The name must start with a set name (case-insensitive); an unknown name keeps the default layout.",
  category: "view",
  undoable: false,
  spec: "R-IM-27, R-SCREEN-3",
  schema: z.object({ layout: z.string() }),
  run(ctx, p) {
     
    const layout = /^\s*default\s*$/i.test(p.layout) ? "Default" : toolbarLayoutByName(p.layout);
     
    setView(ctx, { toolbar: layout ?? "Default" });
    return layout ? { layout } : { layout: "Default", warning: `Unknown toolbar set: ${p.layout}`, available: [...TOOLBAR_LAYOUTS] };
  },
});





export async function runAction(ctx: CmdCtx, name: string): Promise<{ reply: string; result?: unknown }> {
  const a = findAction(name);
  if (!a) return { reply: `Triggering action ${name}` };
  if (a.noop) return { reply: "OK" };
  if (a.command) {
    const def = getCommand(a.command);
    if (!def) throw new CommandError(`${a.text} is not available in Enginuity`);
    const parsed = def.schema.safeParse(actionParams(a, ctx.ws));
    if (!parsed.success) throw new CommandError(`${a.text}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const result = await def.run(ctx, parsed.data);
    if (ctx.undoLabel === undefined) ctx.undoLabel = def.title;
    return { reply: "OK", result };
  }
  if (a.ui) {
    if (!(ctx.services.view?.clients() ?? 0)) throw new CommandError(`${a.text} needs an open Enginuity window`);
    ctx.services.emit?.({ type: "ui-action", name: a.name });
    return { reply: "OK" };
  }
  status(ctx, a.unavailable ?? `${a.text} is not available in Enginuity`);
  return { reply: "OK" };
}

defineCommand({
  name: "view.action",
  title: "Run Menu Action",
  description:
    "Run any main-window action by its action name (case-insensitive), exactly like the menus, shortcuts and the API's TriggerAction — e.g. actionFit_All, actionShow_Cinema_Mode, actionTraceLine, action-Options, actionCollision_Map. Call with name='' to list every action as objectName|text|shortcut. Dialog actions open in the user's Enginuity window.",
  category: "view",
  spec: "R-IM-3, R-IM-4, R-IM-23",
  schema: z.object({ name: z.string() }),
  async run(ctx, p) {
    if (!p.name.trim()) {
      ctx.undoLabel = null;
      return { actions: actionListing(ctx.services.settings), count: MAIN_ACTIONS.length };
    }
    const out = await runAction(ctx, p.name);
    if (ctx.undoLabel === undefined) ctx.undoLabel = null;
    return out;
  },
});

const RENDERING = { shadows: "RC_SHADOWS", reflections: "RC_REFLECTIONS", endEffectorView: "RC_EE_VIEW" } as const;

defineCommand({
  name: "view.rendering",
  title: "Rendering Options",
  description:
    "Turn the studio rendering on or off: soft floor shadows, floor reflections, and the end-effector close-up (a picture-in-picture view that follows the active robot's tool). Omitted options keep their value; returns the resulting state.",
  category: "view",
  undoable: false,
  spec: "RC-RENDER",
  schema: z.object({ shadows: z.boolean().optional(), reflections: z.boolean().optional(), endEffectorView: z.boolean().optional() }),
  run({ services }, p) {
    if (!services.setSetting) throw new CommandError("Rendering options can only be changed on the server");
    for (const [opt, key] of Object.entries(RENDERING)) {
      const v = p[opt as keyof typeof RENDERING];
      if (v !== undefined) services.setSetting(key, v);
    }
    return Object.fromEntries(Object.entries(RENDERING).map(([opt, key]) => [opt, services.settings[key] !== false]));
  },
});

 
function defaultShotName(ctx: CmdCtx): string {
  const st = ctx.ws.activeStation ? ctx.ws.items[ctx.ws.activeStation]?.name : undefined;
  return `${(st ?? "Enginuity").replace(/[\\/:*?"<>|]+/g, "_")}_screenshot.png`;
}

defineCommand({
  name: "view.screenshot",
  title: "Take Screenshot",
  description:
    "Take a screenshot of the 3D view and save it as PNG (Ctrl+P). Default file: <station>_screenshot.png in Enginuity's screenshots folder; `file` may name another file there (the TCP API may also give an absolute path). white=true renders on a white background (API SnapshotWhite). Needs an open Enginuity window to render. Returns the saved path and image size.",
  category: "view",
  undoable: false,
  readonly: true,
  shortcut: "Ctrl+P",
  spec: "R-SLF-36",
  schema: z.object({ file: z.string().optional(), white: z.boolean().optional() }),
  async run(ctx, p) {
    if (!ctx.services.view) throw new CommandError("Screenshots are taken by the Enginuity server");
    let file = (p.file ?? "").trim() || defaultShotName(ctx);
    if (ctx.origin !== "api" && (file.includes("/") || file.includes("\\"))) throw new CommandError("The file name must not contain a folder");
    if (!/\.(png|jpe?g)$/i.test(file)) file += ".png";
    return ctx.services.view.screenshot({ file, white: !!p.white });
  },
});

 
const MeasurePoint = z.union([
  z.object({ item: ItemRef }),
  z.object({ point: z.array(z.number()).length(3), normal: z.array(z.number()).length(3).optional() }),
]);

function measurePoint(ctx: CmdCtx, m: z.infer<typeof MeasurePoint>): { p: [number, number, number]; axis?: [number, number, number]; name: string } {
  if ("item" in m) {
    const it = requireRef(ctx.ws, m.item);
    let pose: Mat = absPose(ctx.ws, it.id);
    if (it.type === "robot" && it.robot) pose = mul(mul(pose, fk(it.robot.model, it.robot.joints)), toolPose(ctx.ws, it.id));
    return { p: [pose[3], pose[7], pose[11]], axis: [pose[2], pose[6], pose[10]], name: it.name };
  }
  return { p: m.point as [number, number, number], axis: m.normal as [number, number, number] | undefined, name: "point" };
}

defineCommand({
  name: "view.measure",
  title: "Measure",
  description:
    "Measure between two points of the station (Tools ▸ Measure, Shift+M): each end is an item (its origin; a robot's TCP) or explicit station coordinates with an optional surface normal. Returns the distance (mm), delta XYZ (mm) and, when both ends have a direction (item Z axes or normals), the angle between them (deg).",
  category: "query",
  undoable: false,
  readonly: true,
  spec: "R-SLF-41",
  schema: z.object({ from: MeasurePoint, to: MeasurePoint }),
  run(ctx, p) {
    const a = measurePoint(ctx, p.from);
    const b = measurePoint(ctx, p.to);
    const delta = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const distance = Math.hypot(delta[0], delta[1], delta[2]);
    let angle: number | undefined;
    if (a.axis && b.axis) {
      const na = Math.hypot(...a.axis);
      const nb = Math.hypot(...b.axis);
      if (na > 1e-9 && nb > 1e-9) {
        const c = (a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] + a.axis[2] * b.axis[2]) / (na * nb);
        angle = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      }
    }
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return { from: a.name, to: b.name, distance: r3(distance), delta: delta.map(r3), ...(angle !== undefined ? { angle: r3(angle) } : {}) };
  },
});

defineCommand({
  name: "help.about",
  title: "About Enginuity",
  description: "Help ▸ About: product name, version, release date and the API compatibility build.",
  category: "query",
  undoable: false,
  readonly: true,
  spec: "B-HELP-07",
  schema: z.object({}),
  run(ctx) {
    const st = ctx.ws.activeStation ? stationOf(ctx.ws, ctx.ws.activeStation) : undefined;
    return { ...ABOUT, build: `${ABOUT.version}.${ABOUT.apiBuild}`, activeStation: st?.name ?? null };
  },
});

 
export const WORKSPACE_MODES = ["Do not show", "Show for wrist center", "Show for robot flange", "Show for current tool"] as const;

defineCommand({
  name: "robot.showWorkspace",
  title: "Robot Workspace",
  description:
    "Show a robot's reachable workspace in the 3D view: mode 0 hides it, 1 for the wrist center, 2 for the robot flange, 3 for the current tool (item command ShowWorkspace). Show/Hide Robot Workspace (*) shows every robot without its own setting at the flange.",
  category: "view",
  undoable: false,
  spec: "R-SLF-44",
  schema: z.object({ robot: ItemRef, mode: z.number().int().min(0).max(3) }),
  run(ctx, p) {
    const r = requireRef(ctx.ws, p.robot);
    if (r.type !== "robot") throw new CommandError(`${r.name} is not a robot`);
    ctx.tx.set(r.id, { params: { ...(r.params ?? {}), ShowWorkspace: String(p.mode) } });
    return { robot: r.name, mode: p.mode, label: WORKSPACE_MODES[p.mode] };
  },
});
