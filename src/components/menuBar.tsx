"use client";
// Builds action-backed main menus, toolbar groups, and layout choices.

 
 
 
 
 

import type { ReactNode } from "react";
import { effectiveShortcut, findAction } from "@/engine/actions";
import { TRACE_STYLES, TOOLBAR_LAYOUTS } from "@/engine/view";
import { cmd } from "@/client/api";
import { useRC, type MoveMode } from "@/client/store";
import { runAction } from "@/client/uiActions";
import type { ViewState, Workspace } from "@/engine/types";
import type { MenuEntry } from "./glass/Menu";
import { Icon } from "./icons";
import type { MainMenu } from "./menuContrib";

type Spec = string | "-" | MenuEntry;

export interface MenuState {
  ws: Workspace | null;
  view: ViewState;
  settings: Record<string, unknown>;
  undo: { undo: string[]; redo: string[] };
   
  hold: MoveMode;
  fullscreen: boolean;
}

const ICONS: Record<string, ReactNode> = {
  actionNew_Station: <Icon.New />,
  actionOpen: <Icon.Open />,
  actionOpen_weblib: <Icon.Library />,
  actionSave_Station: <Icon.Save />,
  actionClose_Station: <Icon.Close />,
  actionUndo: <Icon.Undo />,
  actionRedo: <Icon.Redo />,
  actionCopy: <Icon.Copy />,
  actionAdd_Frame: <Icon.Frame />,
  actionTeach_Target: <Icon.Teach />,
  actionAdd_empty_tool: <Icon.Tool />,
  actionRun_Program: <Icon.Play />,
  actionGenerate_program_fast: <Icon.Code />,
  actionFast_simulation: <Icon.FastForward />,
  actionPauseProgram: <Icon.Pause />,
  "action-AddPython": <Icon.Python />,
  "action-AddProgram": <Icon.Program />,
  actionAdd_Move_Joint: <Icon.MoveJ />,
  actionAdd_Move_Linear: <Icon.MoveL />,
  actionAdd_Move_Circular: <Icon.MoveC />,
  actionAdd_Frame_Change: <Icon.Frame />,
  actionAdd_Tool_Change: <Icon.Tool />,
  actionAdd_Code_Custom: <Icon.Call />,
  actionAdd_Message: <Icon.Message />,
  actionAdd_Pause: <Icon.Pause />,
  actionAdd_I_O_change: <Icon.IO />,
  actionAdd_Speed_Change: <Icon.Speed />,
  actionAdd_Zone_change: <Icon.Rounding />,
  actionAdd_Event: <Icon.Event />,
  actionInt_None: <Icon.NoCursor />,
  actionInt_SelectRectangle: <Icon.Cursor />,
  actionInt_Rotate: <Icon.Orbit />,
  actionInt_Pan: <Icon.Pan />,
  actionInt_Zoom: <Icon.ZoomIn />,
  actionInt_Move_None: <Icon.Cursor />,
  actionInt_Move_Frame: <Icon.MoveRef />,
  actionInt_Move_Object: <Icon.MoveTool />,
  actionPerspective_view: <Icon.Perspective />,
  actionShow_Fullscreen: <Icon.Expand />,
  actionShow_hide: <Icon.Eye />,
  actionFit_All: <Icon.Fit />,
  actionIsometric: <Icon.Cube />,
  actionTake_screenshot: <Icon.Camera />,
  actionCheck_Collisions: <Icon.Collision />,
  actionChange_Color_Form: <Icon.Palette />,
  actionMeasure_tool: <Icon.Measure />,
  actionCurveCreate: <Icon.Curve />,
  "action-Options": <Icon.Settings />,
  actionHelp: <Icon.Help />,
  "action-About": <Icon.Info />,
  actionAdd_Robot: <Icon.Robot />,
  actionAdd_Tool: <Icon.Tool />,
  actionAdd_Object: <Icon.Object />,
  actionExport_3D_Simulation: <Icon.Download />,
  actionTraceActive: <Icon.Trace />,
  actionTraceReset: <Icon.Trash />,
  actionToggleWorkspace: <Icon.Grid />,
  action3D_print_project: <Icon.Layers />,
  actionCurveProject: <Icon.Curve />,
  actionPointProject: <Icon.Target />,
  "action-MachiningProject": <Icon.Tool />,
};

 
function checked(name: string, s: MenuState): boolean | undefined {
  const v = s.view;
  const left = s.hold !== "default" ? null : v.leftAction;
  const move = s.hold !== "default" ? s.hold : v.moveMode;
  switch (name) {
    case "actionInt_None":
      return left === "none";
    case "actionInt_SelectRectangle":
      return left === "select";
    case "actionInt_Rotate":
      return left === "rotate";
    case "actionInt_Pan":
      return left === "pan";
    case "actionInt_Zoom":
      return left === "zoom";
    case "actionInt_Move_None":
      return move === "default";
    case "actionInt_Move_Frame":
      return move === "references";
    case "actionInt_Move_Object":
      return move === "tools";
    case "actionRotation_Aligned":
      return s.settings.KeepRotationAligned !== false;
    case "actionPerspective_view":
      return v.perspective;
    case "actionShow_Fullscreen":
      return s.fullscreen;
    case "actionShow_Cinema_Mode":
      return v.cinema;
    case "actionShow_Tree_in_main_Window":
      return v.treeInside;
    case "actionShow_Hide_reference_frames":
      return v.frames;
    case "actionToggleWorkspace":
      return v.workspace;
    case "actionToggleShowText":
      return v.text;
    case "actionTraceActive":
      return v.trace;
    case "actionCheck_Collisions":
      return !!s.ws?.collisionsActive;
    case "actionFast_simulation":
      return !!s.ws && s.ws.simulationSpeed === Number(s.settings.SimRatioFast ?? 100);
    case "actionPauseProgram":
      return !!s.ws?.paused;
    case "actionSensor_View":
      return false;
  }
  const style = TRACE_STYLES.findIndex((t) => `actionTrace${t}` === name);
  if (style >= 0) return Number(s.settings.Trace_Render_Style ?? 0) === style;
  const layout = TOOLBAR_LAYOUT_ACTIONS[name];
  if (layout) return v.toolbar === layout;
  return undefined;
}

const TOOLBAR_LAYOUT_ACTIONS: Record<string, string> = {
  actionRestore_default_toolbar: "Default",
  actionViewer_Toolbar: "Viewer",
  actionBasic_toolbar: "Basic",
  actionPalletizing: "Palletizing",
  actionSimple: "Simple",
  actionComplete: "Complete",
  actionNo_Toolbar: "No Toolbar",
};

 
export function actionEntry(name: string, s: MenuState, extra: Partial<MenuEntry> = {}): MenuEntry {
  const a = findAction(name);
  if (!a) return { label: name, disabled: true };
  let label = a.text.replace(/\s*\(F2\)$/, "").replace(/\.\.\.$/, "…");
  if (name === "actionUndo" && s.undo.undo.length) label = `Undo ${s.undo.undo.at(-1)}`;
  if (name === "actionRedo" && s.undo.redo.length) label = `Redo ${s.undo.redo[0]}`;
  if (name === "actionTraceActive") label = "Active";
  return {
    label,
    shortcut: name === "actionRename_item" ? "F2" : effectiveShortcut(a, s.settings),
    icon: ICONS[name],
    checked: checked(name, s),
     
    disabled: (name === "actionUndo" && !s.undo.undo.length) || (name === "actionRedo" && !s.undo.redo.length),
    onSelect: () => void runAction(name),
    ...extra,
  };
}

function build(spec: Spec[], s: MenuState): MenuEntry[] {
  return spec.map((x) => (x === "-" ? { separator: true } : typeof x === "string" ? actionEntry(x, s) : x));
}

 
export function menuBar(s: MenuState): { name: MainMenu; entries: MenuEntry[] }[] {
  const rc = s.settings;
  const File: Spec[] = [
    "actionNew_Station", "actionOpen", "actionOpen_weblib", "actionOpen_examples",
     
    { label: "Add SimReady Asset…", icon: <Icon.Package />, onSelect: () => useRC.setState({ libraryOpen: true, libraryKind: "simready" }) },
    "-", "actionSave_Station", "actionSave_Station_as", "-", "actionExport_3D_Simulation", "-", "actionClose_Station", "-", "action-Exit"];
  const Edit: Spec[] = ["actionUndo", "actionRedo", { label: "View Undo Stack", onSelect: () => void runAction("rc.undoStack") }, "-", "actionCopy", "actionCut", "actionPaste"];
  const Program: Spec[] = [
    "actionAdd_Frame", "actionTeach_Target", "actionAdd_empty_tool", "-",
    "actionTeach_Target_on_Surface", "-",
    "actionModify_target", "actionChange_target_configuration", "actionPreview_Targets", "-",
    "actionRun_Program", "actionGenerate_program", "actionGenerate_program_fast", "actionSend_Program_s_to_robot", "-",
    "actionFast_simulation", "actionPauseProgram", "-",
    "action-AddPython", "-",
    "action-AddProgram", "-",
    "actionAdd_Move_Joint", "actionAdd_Move_Linear", "actionAdd_Move_Circular", "actionAdd_Frame_Change", "actionAdd_Tool_Change", "actionAdd_Code_Custom", "actionAdd_Message", "actionAdd_Pause", "actionAdd_I_O_change", "actionAdd_Speed_Change", "actionAdd_Zone_change", "actionAdd_Event", "-",
    "action-AddEditPost",
  ];
  const View: Spec[] = [
    "actionInt_None", "actionInt_SelectRectangle", "actionInt_Rotate", "actionInt_Pan", "actionInt_Zoom", "-",
    "actionInt_Move_None", "actionInt_Move_Frame", "actionInt_Move_Object", "-",
    "actionRotation_Aligned", "actionPerspective_view", "-",
    "actionClose_Windows", "-",
    "actionShow_Fullscreen", "actionShow_Cinema_Mode", "-",
    "actionShow_Tree", "actionShow_Tree_in_main_Window", "actionShow_Hide_reference_frames", "actionShow_hide", "actionToggleWorkspace", "actionToggleShowText", "-",
    "actionFrameBigger", "actionFrameSmaller", "-",
    "actionReveal_in_the_Tree", "-",
    "actionFit_All", "actionFit_to_Selection", "-",
    "actionIsometric", "actionTop", "actionFront", "actionRight", "actionLeft", "actionBack", "-",
     
    { label: "Shadows", checked: rc.RC_SHADOWS !== false, onSelect: () => void cmd("view.rendering", { shadows: rc.RC_SHADOWS === false }) },
    { label: "Reflections", checked: rc.RC_REFLECTIONS !== false, onSelect: () => void cmd("view.rendering", { reflections: rc.RC_REFLECTIONS === false }) },
    { label: "End Effector Close-up", icon: <Icon.CloseUp />, checked: rc.RC_EE_VIEW === true, onSelect: () => void runAction("rc.endEffectorView") },
    { label: rc.RC_THEME === "dark" ? "Light Appearance" : "Dark Appearance", onSelect: () => void cmd("settings.set", { key: "RC_THEME", value: rc.RC_THEME === "dark" ? "light" : "dark" }) },
  ];
  const Tools: Spec[] = [
    "actionTake_screenshot", "-",
    {
      label: "Trace",
      icon: <Icon.Trace />,
      submenu: build(["actionTraceActive", "actionTraceReset", { label: "Style", submenu: build(["actionTraceReferences", "actionTraceLine", "actionTraceDots", "actionTracePoints", "actionTraceSpheres"], s) }], s),
    },
    "-",
    "actionCheck_Collisions", "actionCollision_Map", "-",
    "actionChange_Color_Form", "actionMeasure_tool", "actionCurveCreate", "actionCurveModify", "-",
    "actionRename_item", "actionReorder_item_after", "actionReorder_items_automatically", "-",
    "actionOpen_Notepad", "actionOpen_FTP_Client", "-",
    "actionRun_Script", "actionRun_last_Script", "action-Plugins", "-",
     
    { label: "Language", submenu: [{ label: "English", checked: true, onSelect: () => undefined }] },
    { label: "Toolbar layout", submenu: build(Object.keys(TOOLBAR_LAYOUT_ACTIONS), s) },
    "action-Options",
  ];
  const Utilities: Spec[] = [
    "actionCalibrate_tool", "actionCalibrate_frame", "-",
    "actionSyncExternalAxis", "-",
    "actionAdd_Mechanism_or_Robot", "-",
    "action-MachiningProject", "actionCurveProject", "actionPointProject", "action3D_print_project", "-",
    "actionUpdate_all_Machining_projects", "-",
    "actionBallbar_Validation", "-",
    "actionCalibrate_Robot", "actionISO_9283_Accuracy_and_Repeatability_test", "-",
    "actionPath_Accuracy_test", "-",
    "actionISO_9283_targets_and_path", "-",
    "actionImport_points", "actionImport_curve",
  ];
  const Connect: Spec[] = [
    "action-ConnectRobot", "-",
    "actionConnect_C_Track", "actionConnect_OptiTrack_Camera", "-",
    "actionConnect_API_Radian_Laser_Tracker", "actionConnect_API_Laser_Tracker", "actionConnect_Laser_Tracker", "actionConnect_Leica_Laser_Tracker", "-",
    "actionSimulate_2D_Camera", "-",
    "actionConnect_HTC_Vive_VR",
  ];
  const Help: Spec[] = ["actionHelp", "-", "action-About"];
  return [
    { name: "File", entries: build(File, s) },
    { name: "Edit", entries: build(Edit, s) },
    { name: "Program", entries: build(Program, s) },
    { name: "View", entries: build(View, s) },
    { name: "Tools", entries: build(Tools, s) },
    { name: "Utilities", entries: build(Utilities, s) },
    { name: "Connect", entries: build(Connect, s) },
    { name: "Help", entries: build(Help, s) },
  ];
}





export const TOOLBARS: Record<string, string[]> = {
  File: ["actionOpen", "actionOpen_weblib", "actionSave_Station"],
  "Undo/redo": ["actionUndo", "actionRedo"],
  Edit: ["actionCopy", "actionCut", "actionPaste"],
  "Load robot/tool/object": ["actionAdd_Robot", "actionAdd_Tool", "actionAdd_Object"],
  "Frame/Target": ["actionAdd_Frame", "actionTeach_Target"],
  View: ["actionFit_All", "actionIsometric"],
  "View (Extended)": ["actionIsometric", "actionTop", "actionFront", "actionRight", "actionLeft", "actionBack", "actionFit_All"],
  Selection: ["actionInt_Move_None", "actionInt_Move_Frame", "actionInt_Move_Object"],
  "3D View": ["actionInt_None", "actionInt_SelectRectangle", "actionInt_Rotate", "actionInt_Pan", "actionInt_Zoom"],
  Collision: ["actionCheck_Collisions"],
  Simulation: [],
  Program: ["action-AddPython", "action-AddProgram", "actionAdd_Move_Joint", "actionAdd_Move_Linear", "actionAdd_Move_Circular", "actionAdd_Pause", "actionAdd_Message", "actionAdd_Code_Custom", "actionAdd_I_O_change", "actionAdd_Event"],
  Export: ["actionExport_3D_Simulation"],
  Tools: ["actionMeasure_tool", "actionChange_Color_Form", "actionCurveCreate"],
  Manufacturing: ["action-MachiningProject", "actionCurveProject", "actionPointProject", "action3D_print_project"],
  Workspace: ["actionToggleWorkspace"],
  Trace: ["actionTraceActive", "actionTraceReset"],
};

 
export function toolbarsFor(layout: string): string[] {
  const DEFAULT = ["File", "Undo/redo", "Frame/Target", "View", "Selection", "Collision", "Simulation", "Program", "Export"];
  const hide = (list: string[], gone: string[]) => list.filter((t) => !gone.includes(t));
  switch (layout) {
    case "No Toolbar":
      return [];
    case "Viewer":
      return ["View", "Selection", "Simulation", "Workspace"];
    case "Basic":
      return hide(DEFAULT, ["Undo/redo", "Edit", "Load robot/tool/object", "File", "Collision", "Export", "View", "View (Extended)", "3D View", "Workspace"]);
    case "Simple":
      return hide(DEFAULT, ["Undo/redo", "Edit", "Load robot/tool/object", "Collision", "Simulation", "Export", "Program", "Workspace"]);
    case "Palletizing":
      return hide(DEFAULT, ["Undo/redo", "Edit", "Load robot/tool/object", "File", "Export", "View (Extended)", "3D View", "Frame/Target", "Collision", "Program", "Trace", "Workspace"]);
    case "Complete":
      return ["Edit", "Load robot/tool/object", "View (Extended)", ...hide(DEFAULT, ["View"]), "Tools", "Trace", "3D View", "Manufacturing", "Workspace"];
    default:
      return DEFAULT;
  }
}

export const LAYOUTS = TOOLBAR_LAYOUTS;
