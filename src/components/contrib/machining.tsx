"use client";
// Registers machining project, curve editing, and toolpath actions.

 
 
 
 
 
 
 

import { cmd, selectNow, setStatus } from "@/client/api";
import { useMachiningUi } from "@/client/machiningUi";
import { askNumber, askText, copyText } from "@/client/programUi";
import { pushView, useRC } from "@/client/store";
import { registerUiAction } from "@/client/uiActions";
import { objectCurves, objectPoints } from "@/engine/curves";
import { projectLinks } from "@/engine/machining/project";
import type { Item, Workspace } from "@/engine/types";
import { listItems } from "@/engine/workspace";
import type { MenuEntry } from "../glass/Menu";
import { Icon } from "../icons";
import { contributeItemMenu } from "../menuContrib";
import { finishCurveTool } from "../viewport/Curves";

const selected = (ws: Workspace, type: Item["type"]) => ws.selection.map((s) => ws.items[s]).filter((i): i is Item => i?.type === type);

 
async function newProject(kind: "machining" | "curve" | "point" | "print3d" | "weld") {
  const ws = useRC.getState().ws;
  if (!ws) return;
  const objects = selected(ws, "object");
  const source = kind === "point" ? objects.find((o) => objectPoints(o).length) : kind === "curve" || kind === "weld" ? objects.find((o) => objectCurves(o).length) : undefined;
  const r = (await cmd("machining.add", { kind, ...(source ? { object: source.id } : {}) })) as { id?: string } | undefined;
  if (!r?.id) return;
  void selectNow([r.id]);
  useRC.setState({ rightPanel: "inspector" });
  if (kind === "machining" || kind === "print3d") useMachiningUi.setState({ picker: { kind: kind === "print3d" ? "print3d" : "nc", project: r.id } });
  else if (!source) useMachiningUi.setState({ tool: { mode: "select", project: r.id, kind: kind === "point" ? "point" : "curve", object: null, curves: [] } });
}

registerUiAction("action-MachiningProject", () => newProject("machining"));
registerUiAction("actionCurveProject", () => newProject("curve"));
registerUiAction("actionPointProject", () => newProject("point"));
registerUiAction("action3D_print_project", () => newProject("print3d"));
registerUiAction("actionRobotWeldingProject", () => newProject("weld"));
registerUiAction("actionUpdate_all_Machining_projects", async () => {
  const r = (await cmd("machining.updateAll", {})) as { results?: unknown[]; report?: string; title?: string | null } | undefined;
  if (r?.results?.length && r.title) useMachiningUi.setState({ report: { title: r.title, html: r.report ?? "" } });
});
registerUiAction("actionImport_points", () => useMachiningUi.setState({ picker: { kind: "points" } }));
registerUiAction("actionImport_curve", () => useMachiningUi.setState({ picker: { kind: "curve" } }));




function curveTool(modify: boolean) {
  const { tool } = useMachiningUi.getState();
  if (tool?.mode === "create" && !!tool.modify === modify) return void finishCurveTool();
  const ws = useRC.getState().ws;
  const objects = ws ? selected(ws, "object") : [];
  const obj = modify ? (objects.find((o) => objectCurves(o).length) ?? objects[0]) : objects[0];
  useMachiningUi.setState({ tool: { mode: "create", modify, object: obj?.id ?? null, points: [] } });
}
registerUiAction("actionCurveCreate", () => curveTool(false));
registerUiAction("actionCurveModify", () => curveTool(true));
registerUiAction("actionTeach_Target_on_Surface", () => useMachiningUi.setState({ tool: { mode: "surface", orient: "normal", rot: [0, 0, 0], preview: true } }));

 







function curveEntries(ws: Workspace, it: Item): MenuEntry[] {
  const { picked: f, tool } = useMachiningUi.getState();
  if (!f || f.object !== it.id) return [];
  const edit = (op: string, extra: Record<string, unknown> = {}) => () => void cmd("object.editCurve", { object: it.id, curve: f.index, op, ...extra });
  const curve = f.kind === "curve" ? objectCurves(it)[f.index] : undefined;
  const out: MenuEntry[] = [];
  if (curve && tool?.mode === "create" && tool.object === it.id && curve.points.length > 2) {
    out.push({ label: "Delete Curve Point", icon: <Icon.Trash />, onSelect: edit("deletePoint", { point: f.point ?? 0 }) }, { separator: true });
  }
  if (curve && tool?.mode === "select" && tool.kind === "curve" && (!tool.object || tool.object === it.id)) {
     
    const add = () => useMachiningUi.setState({ tool: { ...tool, object: it.id, curves: [...new Set([...(tool.object === it.id ? tool.curves : []), f.index])].sort((a, b) => a - b) } });
    out.push({ label: "Add Selected Curve", onSelect: add }, { separator: true });
  }
  if (curve) {
    out.push(
      {
        label: "Rename Curve",
        onSelect: async () => {
          const name = await askText("Rename curve", "Name:", curve.name ?? "");
          if (name !== null) await cmd("object.editCurve", { object: it.id, curve: f.index, op: "rename", name });
        },
      },
      { separator: true },
      { label: "Flip Curve Normals", onSelect: edit("flipNormals") },
      {
        label: "Tilt Curve Normals",
        onSelect: async () => {
          const a = await askNumber("Tilt curve normals", "Enter the angle (in degrees) to rotate the curve normals around the tangent", 0, { decimals: 3 });
          if (a !== null) await cmd("object.editCurve", { object: it.id, curve: f.index, op: "tiltNormals", angle: a });
        },
      },
      {
        label: "Split Curve",
        submenu: [
          {
            label: "Split Curve in Corners",
            onSelect: async () => {
              const a = await askNumber("Split Curve in Corners", "Corner angle (deg)", 30, { decimals: 1, min: 0, max: 180 });
              if (a !== null) await cmd("object.editCurve", { object: it.id, curve: f.index, op: "splitCorners", angle: a });
            },
          },
          { label: "Split Curve in half", onSelect: edit("splitHalf") },
          { label: "Split Ends", onSelect: edit("splitEnds") },
          { separator: true },
          {
            label: "Set Point Spacing",
            onSelect: async () => {
              const d = await askNumber("Set Point Spacing", "Point spacing (mm)", 1, { decimals: 3, min: 0.001 });
              if (d) await cmd("object.editCurve", { object: it.id, curve: f.index, op: "spacing", spacing: d });
            },
          },
          { separator: true },
          { label: "Split Here", onSelect: edit("splitHere", { at: f.at }) },
        ],
      },
      { label: "Extract Curve Points", onSelect: edit("extractPoints") },
      { label: "Export Curve", onSelect: () => void exportCurves(it, f.index) },
      { separator: true },
      { label: "Delete Curve", icon: <Icon.Trash />, danger: true, onSelect: () => void cmd("object.deleteCurves", { object: it.id, curve: f.index }) },
      { separator: true },
      { label: "Delete All Curves", icon: <Icon.Trash />, onSelect: () => void cmd("object.deleteCurves", { object: it.id }) },
    );
  } else if (f.kind === "point") {
    out.push(
      {
        label: "Rename Point",
        onSelect: async () => {
          const name = await askText("Rename point", "Name:", it.object?.pointNames?.[f.index] ?? "");
          if (name !== null) await cmd("object.renamePoint", { object: it.id, point: f.index, name });
        },
      },
      { separator: true },
      { label: "Delete Point", icon: <Icon.Trash />, danger: true, onSelect: () => void cmd("object.deletePoints", { object: it.id, point: f.index }) },
      { label: "Delete All Points", icon: <Icon.Trash />, onSelect: () => void cmd("object.deletePoints", { object: it.id }) },
    );
  }
  void ws;
  return out;
}

 
async function exportCurves(it: Item, curve?: number) {
  const r = (await cmd("object.exportCurves", { object: it.id, ...(curve !== undefined ? { curve } : {}) })) as { fileName: string; text: string } | undefined;
  if (!r) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([r.text], { type: "text/csv" }));
  a.download = r.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  await copyText(r.text);
}

contributeItemMenu((ws, it, sel, { from3D }) => {
  if (it.type !== "object") return [];
  const picked = from3D ? curveEntries(ws, it) : [];
  if (picked.length) return picked;
  void sel;
   
  return objectCurves(it).length ? [{ label: "Export Curves", onSelect: () => void exportCurves(it) }] : [];
}, 40);

 

let copied: { project: string; what: "settings" | "approach" | "events" } | null = null;

contributeItemMenu((ws, it, sel) => {
  if (it.type !== "machining" || !it.machining) return [];
  const projects = sel.map((s) => ws.items[s]).filter((i): i is Item => i?.type === "machining");
  const ids = projects.length ? projects.map((p) => p.id) : [it.id];
  const m = it.machining;
  const { robot } = projectLinks(ws, m);
  const setAll = (patch: Record<string, unknown>) => () => {
    for (const id of ids) void cmd("machining.setParams", { project: id, ...patch });
  };
  const frames = listItems(ws, { type: "frame" });
  const tools = robot ? listItems(ws, { type: "tool" }).filter((t) => t.parent === robot.id) : [];
  const visible = String(m.settings.PathDisplay ?? "Estimated") !== "None";
  const prog = m.program ? ws.items[m.program] : undefined;
  if (ids.length > 1) {
    return [
      { label: "Visible Toolpath", checked: visible, onSelect: setAll({ machining: { PathDisplay: visible ? "None" : "Estimated" }, update: false }) },
      { label: "Auto Update", checked: !!Number(m.settings.AutoUpdate), onSelect: setAll({ machining: { AutoUpdate: Number(m.settings.AutoUpdate) ? 0 : 1 }, update: false }) },
      { label: "Reference", submenu: frames.map((f) => ({ label: f.name, onSelect: setAll({ frame: f.id }) })) },
      { label: "Tool", submenu: tools.map((t) => ({ label: t.name, onSelect: setAll({ tool: t.id }) })) },
      {
        label: "Set Path to Tool Pose",
        onSelect: async () => {
          const v = await askText("Set Path to Tool Pose", "Provide the Path to Tool pose (x, y, z, rx, ry, rz)", "0, 0, 0, 0, 0, 0");
          if (v === null) return;
          const n = v.split(/[\s,;]+/).map(Number);
          if (n.length !== 6 || n.some((x) => !Number.isFinite(x))) return setStatus("Enter the new pose");
          const { xyzrpwToPose } = await import("@/engine/math");
          for (const id of ids) await cmd("machining.setParams", { project: id, pathToTool: xyzrpwToPose(n) });
        },
      },
      { label: "Update Programs", onSelect: () => void cmd("machining.updateAll", { projects: ids }).then((r) => {
        const res = r as { results?: unknown[]; report?: string; title?: string } | undefined;
        if (res?.title) useMachiningUi.setState({ report: { title: res.title, html: res.report ?? "" } });
      }) },
    ];
  }
  return [
    { label: "Visible Toolpath", checked: visible, onSelect: setAll({ machining: { PathDisplay: visible ? "None" : "Estimated" }, update: false }) },
    { label: "Visible Normals", checked: !!Number(m.settings.VisibleNormals), onSelect: setAll({ machining: { VisibleNormals: Number(m.settings.VisibleNormals) ? 0 : 1 }, update: false }) },
     
    { label: "Reframe On", icon: <Icon.Fit />, onSelect: () => pushView({ action: "fit", items: [m.input?.object && ws.items[m.input.object] ? m.input.object : robot?.id ?? it.id] }) },
    { label: "Options...", onSelect: () => (void selectNow([it.id]), useRC.setState({ rightPanel: "inspector" })) },
    { label: "Auto Update", checked: !!Number(m.settings.AutoUpdate), onSelect: setAll({ machining: { AutoUpdate: Number(m.settings.AutoUpdate) ? 0 : 1 }, update: false }) },
    { label: "Reference", submenu: frames.map((f) => ({ label: f.name, checked: m.frame === f.id, onSelect: setAll({ frame: f.id }) })) },
    { label: "Tool", submenu: tools.map((t) => ({ label: t.name, checked: m.tool === t.id, onSelect: setAll({ tool: t.id }) })) },
    { separator: true },
    { label: "Update Program", onSelect: () => void cmd("machining.update", { project: it.id }) },
    { label: "Simulate Program", disabled: !prog, onSelect: () => prog && void cmd("program.run", { program: prog.id }) },
    {
      label: "More options",
      submenu: [
        { label: "Set Defaults", onSelect: () => void cmd("machining.setDefaults", { project: it.id }) },
        { label: "Set Default Program Events", onSelect: () => void cmd("machining.setDefaults", { project: it.id, what: "events" }) },
        { separator: true },
        { label: "Copy Settings", onSelect: () => ((copied = { project: it.id, what: "settings" }), setStatus(`Copied robot machining settings from: ${it.name}`)) },
        { label: "Paste Settings", disabled: copied?.what !== "settings", onSelect: () => copied && void cmd("machining.copySettings", { from: copied.project, to: ids, what: "settings" }) },
        { label: "Copy Approach/Retract", onSelect: () => ((copied = { project: it.id, what: "approach" }), setStatus(`Copied approach/retract settings from: ${it.name}`)) },
        { label: "Paste Approach/Retract", disabled: copied?.what !== "approach", onSelect: () => copied && void cmd("machining.copySettings", { from: copied.project, to: ids, what: "approach" }) },
        { label: "Copy Program Events", onSelect: () => ((copied = { project: it.id, what: "events" }), setStatus(`Copied program events from: ${it.name}`)) },
        { label: "Paste Program Events", disabled: copied?.what !== "events", onSelect: () => copied && void cmd("machining.copySettings", { from: copied.project, to: ids, what: "events" }) },
      ],
    },
  ];
}, 20);
