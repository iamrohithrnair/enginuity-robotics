// Defines menu actions, command bindings and configurable keyboard shortcuts.
 
 
 
 
 
 
 
 
 
 

import type { Workspace } from "./types";

export type MenuName = "File" | "Edit" | "Program" | "View" | "Tools" | "Utilities" | "Connect" | "Help" | "None";

export interface ActionBinding {
   
  command?: string;
   
  params?: Record<string, unknown> | ((ws: Workspace) => Record<string, unknown>);
   
  ui?: boolean;
   
  unavailable?: string;
   
  noop?: boolean;
}

export interface ActionDef extends ActionBinding {
   
  name: string;
   
  text: string;
   
  shortcut?: string;
  menu: MenuName;
}

const sel = (ws: Workspace) => ws.selection.filter((id) => ws.items[id]);

 
export function selectedProgram(ws: Workspace): string | undefined {
  for (const id of sel(ws)) {
    const it = ws.items[id];
    if (it.type === "program") return it.id;
    if (it.type === "instruction" && it.parent) return it.parent;
  }
  return undefined;
}

const inProgram = (extra: Record<string, unknown> = {}) => (ws: Workspace) => {
  const p = selectedProgram(ws);
  return p ? { program: p, ...extra } : extra;
};

const na = (text: string) => ({ unavailable: `${text} is not available in Enginuity` });






const reorderAutoItems = (ws: Workspace) => ({ items: sel(ws).filter((id) => ws.items[id].type !== "station" && ws.items[id].type !== "instruction") });

 
type Row = [string, string, string, MenuName, ActionBinding];

const ROWS: Row[] = [
  ["actionSave_Station", "Save Station", "Ctrl+S", "File", { command: "station.save" }],
  ["action-Exit", "Exit", "Alt+F4", "File", { unavailable: "Enginuity runs in the browser: close the tab to exit" }],
  ["actionIsometric", "Isometric", "Alt+1", "View", { command: "view.preset", params: { view: "iso" } }],
  ["actionTop", "Top", "Alt+2", "View", { command: "view.preset", params: { view: "top" } }],
  ["actionFront", "Front", "Alt+3", "View", { command: "view.preset", params: { view: "front" } }],
  ["actionRight", "Right", "Alt+4", "View", { command: "view.preset", params: { view: "right" } }],
  ["actionLeft", "Left", "Alt+5", "View", { command: "view.preset", params: { view: "left" } }],
  ["actionBack", "Back", "Alt+6", "View", { command: "view.preset", params: { view: "back" } }],
  ["actionFit_All", "Fit All", "Alt+7", "View", { command: "view.fit", params: {} }],
  ["action-Options", "Options", "Shift+O", "Tools", { ui: true }],
  ["actionOpen", "Open...", "Ctrl+O", "File", { ui: true }],
  ["actionNew_Station", "New Station", "Ctrl+N", "File", { command: "station.new" }],
  ["actionClose_Station", "Close Current Station", "Ctrl+F4", "File", { command: "station.close" }],
  ["actionSave_Station_as", "Save Station as...", "Ctrl+Shift+S", "File", { ui: true }],
  ["actionAdd_Robot", "Add Robot", "", "None", { ui: true }],
  ["actionAdd_Tool", "Add Tool", "", "None", { ui: true }],
  ["actionAdd_Object", "Add Object", "", "None", { ui: true }],
  ["actionAdd_Frame", "Add Reference Frame", "", "Program", { command: "item.addFrame" }],
  ["actionCollision_Map", "Collision Map", "Shift+X", "Tools", { ui: true }],
  ["actionCheck_Collisions", "Check Collisions", "Shift+C", "Tools", { command: "collision.setActive" }],
  ["actionInt_SelectRectangle", "Select Items", "", "View", { command: "view.setMouse", params: { left: "select" } }],
  ["actionInt_Move_Frame", "Move References (hold ALT)", "", "View", { command: "view.setMouse", params: { moveMode: "references" } }],
  ["actionInt_Move_Object", "Move Tools (hold ALT+Shift)", "", "View", { command: "view.setMouse", params: { moveMode: "tools" } }],
  ["actionRotation_Aligned", "Align Rotation", "", "View", { command: "view.toggle", params: { what: "alignRotation" } }],
  ["actionChange_Color_Form", "Change Color", "Shift+T", "Tools", { ui: true }],
  ["actionTraceActive", "Active", "Alt+T", "Tools", { command: "view.toggle", params: { what: "trace" } }],
  ["actionTraceReset", "Reset", "Alt+X", "Tools", { command: "view.toggle", params: { what: "trace-reset" } }],
  ["actionTeach_Target", "Teach Target", "Ctrl+T", "Program", { command: "target.teach" }],
  ["actionHelp", "Help", "F1", "Help", { ui: true }],
  ["actionLicense", "License", "", "None", na("License information")],
  ["action-About", "About", "", "Help", { ui: true }],
  ["actionMake_demo_station", "Make a Demo Station", "", "None", { ui: true }],
  ["action-AddProgram", "Add Program", "", "Program", { command: "program.add" }],
  ["actionAdd_Move_Joint", "Move Joint Instruction", "", "Program", { command: "program.addMoveJ", params: inProgram() }],
  ["actionAdd_Move_Linear", "Move Linear Instruction", "", "Program", { command: "program.addMoveL", params: inProgram() }],
  ["actionAdd_Move_Circular", "Move Circular Instruction", "", "Program", { command: "program.addMoveC", params: inProgram() }],
  ["actionAdd_Tool_Change", "Set Tool Frame Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "tool" }) }],
  ["actionAdd_Frame_Change", "Set Reference Frame Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "frame" }) }],
  ["actionAdd_Pause", "Pause Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "pause" }) }],
  ["actionAdd_Event", "Simulation Event Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "event" }) }],
  ["actionAdd_Speed_Change", "Set Speed Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "speed" }) }],
  ["actionAdd_Robot_Change", "Change Selected Robot", "", "None", { ui: true }],
  ["actionCut", "Cut", "Ctrl+X", "Edit", { command: "edit.cut" }],
  ["actionCopy", "Copy", "Ctrl+C", "Edit", { command: "edit.copy" }],
  ["actionPaste", "Paste", "Ctrl+V", "Edit", { command: "edit.paste" }],
  ["action-AddPython", "Add Python Program", "", "Program", na("Python programs")],
  ["actionOpen_weblib", "Open Robot Library", "Ctrl+Shift+O", "File", { ui: true }],
  ["actionTake_screenshot", "Take Screenshot", "Ctrl+P", "Tools", { command: "view.screenshot" }],
  ["actionInt_Rotate", "Rotate", "", "View", { command: "view.setMouse", params: { left: "rotate" } }],
  ["actionInt_Pan", "Pan", "", "View", { command: "view.setMouse", params: { left: "pan" } }],
  ["actionInt_Zoom", "Zoom", "", "View", { command: "view.setMouse", params: { left: "zoom" } }],
  ["actionInt_None", "No Selection", "", "View", { command: "view.setMouse", params: { left: "none" } }],
  ["actionCalibrate_tool", "Define Tool Frame (TCP)", "", "Utilities", na("Define Tool Frame (TCP)")],
  ["actionCalibrate_frame", "Define Reference Frame (User frame)", "", "Utilities", na("Define Reference Frame")],
  ["action-MachiningProject", "Robot Machining Project", "Ctrl+M", "Utilities", na("Robot Machining")],
  ["actionBallbar_Validation", "Ballbar Accuracy Test", "", "Utilities", na("Ballbar Accuracy Test")],
  ["actionFast_simulation", "Fast Simulation", "", "Program", { command: "sim.fastToggle" }],
  ["actionFrameBigger", "Make Reference Frames Larger", "+", "View", { command: "view.toggle", params: { what: "frames-bigger" } }],
  ["actionFrameSmaller", "Make Reference Frames Smaller", "-", "View", { command: "view.toggle", params: { what: "frames-smaller" } }],
  ["actionToggleShowText", "Show/Hide Text", "/", "View", { command: "view.toggle", params: { what: "text" } }],
  ["actionToggleWorkspace", "Show/Hide Robot Workspace", "*", "View", { command: "view.toggle", params: { what: "workspace" } }],
  ["actionAdd_Code_Custom", "Program Call Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "call" }) }],
  ["actionCalibrate_Robot", "Calibrate Robot", "", "Utilities", na("Robot calibration")],
  ["action-ConnectRobot", "Connect Robot", "", "Connect", na("Connecting to a robot")],
  ["actionConnect_C_Track", "Connect Creaform's C-Track Optical CMM", "", "Connect", na("C-Track")],
  ["actionImport_points", "Import Points", "", "Utilities", na("Import Points")],
  ["actionAdd_Message", "Show Message Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "print" }) }],
  ["actionAdd_empty_tool", "Add Tool (TCP)", "", "Program", { command: "robot.addTool", params: {} }],
  ["actionImport_curve", "Import Curve", "", "Utilities", na("Import Curve")],
  ["actionConnect_Laser_Tracker", "Connect Faro Laser Tracker", "", "Connect", na("Laser trackers")],
  ["actionUpdate_all_Machining_projects", "Update Robot Machining projects", "Ctrl+U", "Utilities", na("Robot Machining")],
   
   
  ["actionReorder_item_after", "Reorder Selected Items...", "", "Tools", { ui: true }],
  ["actionRun_Program", "Run Program", "Ctrl+R", "Program", { command: "program.run", params: inProgram() }],
  ["actionGenerate_program", "Generate Program...", "Shift+F6", "Program", { command: "program.generate", params: inProgram() }],
  ["actionGenerate_program_fast", "Generate Program(s)", "F6", "Program", { command: "program.generate", params: inProgram() }],
  ["actionShow_hide", "Show/Hide Item", "F7", "View", { command: "item.setVisible", params: (ws) => ({ items: sel(ws) }) }],
  ["actionOpen_Notepad", "Open Text Editor", "", "Tools", { ui: true }],
  ["actionOpen_FTP_Client", "Open FTP Client", "", "Tools", { unavailable: "FileZilla FTP Client not found" }],
  ["actionISO_9283_Accuracy_and_Repeatability_test", "Test Position Accuracy (ISO 9283)", "", "Utilities", na("Accuracy tests")],
  ["actionPath_Accuracy_test", "Test Path Accuracy (ISO 9283)", "", "Utilities", na("Accuracy tests")],
  ["actionModify_target", "Modify Target", "F3", "Program", { ui: true }],
  ["actionChange_target_configuration", "Change Target Configuration", "F4", "Program", { ui: true }],
  ["actionCheck_for_updates", "Check for Updates...", "", "None", na("Checking for updates")],
   
  ["actionDraw_curve_on_part", "Draw Curve on Part", "", "None", na("Draw Curve on Part")],
  ["actionISO_9283_targets_and_path", "Create ISO 9283 cube (targets and path)", "", "Utilities", na("Create ISO 9283 cube")],
  ["actionAdd_Zone_change", "Set Rounding Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "rounding" }) }],
  ["actionTeach_Target_on_Surface", "Teach Target(s) on Surface", "Ctrl+Shift+T", "Program", na("Teach Target(s) on Surface")],
  ["action-AddEditPost", "Add/Edit Post Processor", "", "Program", { ui: true }],
  ["actionShow_Hide_reference_frames", "Show/Hide Reference Frames", "Alt+/", "View", { command: "view.toggle", params: { what: "frames" } }],
  ["actionPauseProgram", "Pause Program", "Backspace", "Program", { command: "sim.pause" }],
  ["actionSyncExternalAxis", "Synchronize External Axes", "", "Utilities", na("Synchronize External Axes")],
  ["actionAdd_Mechanism_or_Robot", "Model Mechanism or Robot", "", "Utilities", na("Model Mechanism or Robot")],
  ["actionExport_3D_Simulation", "Export Simulation", "Ctrl+E", "File", na("Export Simulation")],
  ["actionRename_item", "Rename Item... (F2)", "", "Tools", { ui: true }],
  ["actionRestore_default_toolbar", "Default", "", "Tools", { command: "view.toolbar", params: { layout: "Default" } }],
  ["action3D_print_project", "3D Printing Project", "", "Utilities", na("3D Printing Project")],
  ["actionSlicer_for_3D_print", "Open 3D print slicer", "", "None", na("The 3D print slicer")],
  ["actionCurveProject", "Curve Follow Project", "", "Utilities", na("Curve Follow Project")],
  ["actionPointProject", "Point Follow Project", "", "Utilities", na("Point Follow Project")],
  ["actionMeasure_tool", "Measure", "Shift+M", "Tools", { ui: true }],
  ["actionPerspective_view", "Perspective View", "", "View", { command: "view.toggle", params: { what: "perspective" } }],
  ["actionShow_Tree_in_main_Window", "Show Tree Inside the Window", "", "View", { command: "view.toggle", params: { what: "treeInside" } }],
  ["actionSimulate_2D_Camera", "Simulate 2D Camera", "", "Connect", na("Simulate 2D Camera")],
  ["actionAdd_I_O_change", "Set or Wait I/O Instruction", "", "Program", { command: "program.addInstruction", params: inProgram({ kind: "io" }) }],
  ["actionClose_Windows", "Close Side Windows", "Alt+C", "View", { ui: true }],
  ["actionOpen_DXF_editor", "Open DXF Editor", "", "None", na("The DXF editor")],
  ["actionShow_Fullscreen", "Show Fullscreen", "F11", "View", { ui: true }],
  ["actionShow_Cinema_Mode", "Show Cinema Mode", "F12", "View", { command: "view.toggle", params: { what: "cinema" } }],
  ["actionConnect_Leica_Laser_Tracker", "Connect Leica Laser Tracker", "", "Connect", na("Laser trackers")],
  ["actionConnect_API_Laser_Tracker", "Connect API OT2 Laser Tracker", "", "Connect", na("Laser trackers")],
  ["actionFit_to_Selection", "Fit to Selection", "Alt+0", "View", { command: "view.fit", params: { selection: true } }],
  ["actionSend_Program_s_to_robot", "Send Program(s) to Robot", "Ctrl+F6", "Program", na("Sending programs to a robot")],
  ["actionBasic_toolbar", "Basic", "", "Tools", { command: "view.toolbar", params: { layout: "Basic" } }],
  ["actionComplete", "Complete", "", "Tools", { command: "view.toolbar", params: { layout: "Complete" } }],
  ["actionReorder_items_automatically", "Reorder Selected Items Automatically", "Shift+R", "Tools", { command: "item.reorderAuto", params: reorderAutoItems }],
  ["actionPurchase_License", "Purchase License", "", "None", na("License purchase")],
  ["actionRenew_License", "Renew License", "", "None", na("License renewal")],
  ["actionRequest_Support", "Request Support", "", "None", na("Support requests")],
  ["actionConnect_API_Radian_Laser_Tracker", "Connect API Radian Laser Tracker", "", "Connect", na("Laser trackers")],
  ["actionInt_Move_None", "Default Selection", "", "View", { command: "view.setMouse", params: { moveMode: "default" } }],
  ["actionPreview_Targets", "Preview Targets", "F5", "Program", { ui: true }],
  ["actionTraceReferences", "References", "", "Tools", { command: "view.setDisplay", params: { traceStyle: 0 } }],
  ["actionTracePoints", "Points", "", "Tools", { command: "view.setDisplay", params: { traceStyle: 3 } }],
  ["actionTraceSpheres", "Spheres", "", "Tools", { command: "view.setDisplay", params: { traceStyle: 4 } }],
  ["actionTraceDots", "Dots", "", "Tools", { command: "view.setDisplay", params: { traceStyle: 2 } }],
  ["actionTraceLine", "Line", "", "Tools", { command: "view.setDisplay", params: { traceStyle: 1 } }],
  ["actionNo_Toolbar", "No Toolbar", "", "Tools", { command: "view.toolbar", params: { layout: "None" } }],
  ["action-Plugins", "Add-ins", "Shift+I", "Tools", na("Add-ins")],
  ["actionConnect_HTC_Vive_VR", "Connect VR Headset", "Shift+V", "Connect", { unavailable: "Virtual Reality is not supported on this version of Enginuity." }],
  ["actionRun_Script", "Run Script", "Shift+S", "Tools", na("Python scripts")],
  ["actionVR_View", "VR View", "", "None", na("VR View")],
   
  ["actionSensor_View", "Sensor View", "", "None", na("Sensor View")],
  ["actionRun_last_Script", "Run Last Script", "Shift+L", "Tools", na("Python scripts")],
  ["actionReveal_in_the_Tree", "Reveal in the Tree", "F8", "View", { ui: true }],
  ["actionDefaultView", "Default View", "", "None", { command: "view.escape" }],
  ["actionViewer_Toolbar", "Viewer", "", "Tools", { command: "view.toolbar", params: { layout: "Viewer" } }],
  ["actionCurveCreate", "Create Curves", "Shift+P", "Tools", na("Create Curves")],
  ["actionCurveModify", "Modify Curves", "", "Tools", na("Modify Curves")],
  ["actionConnect_SteamVR", "Connect SteamVR System", "", "None", na("SteamVR")],
  ["actionRobotWeldingProject", "Robot Welding project", "", "None", na("Robot Welding")],
  ["actionSimple", "Simple", "", "Tools", { command: "view.toolbar", params: { layout: "Simple" } }],
  ["actionPalletizing", "Palletizing", "", "Tools", { command: "view.toolbar", params: { layout: "Palletizing" } }],
  ["actionOpen_examples", "Open Sample Stations", "", "File", { ui: true }],
  ["actionConnect_OptiTrack_Camera", "Connect OptiTrack Camera", "", "Connect", na("OptiTrack cameras")],
  ["actionShow_Tree", "Show Tree", "", "View", { command: "view.toggle", params: { what: "showTree" } }],
  ["actionUndo", "Undo", "Ctrl+Z", "Edit", { command: "edit.undo" }],
  ["actionRedo", "Redo", "Ctrl+Y", "Edit", { command: "edit.redo" }],
];

export const MAIN_ACTIONS: ActionDef[] = ROWS.map(([name, text, shortcut, menu, b]) => ({ name, text, ...(shortcut ? { shortcut } : {}), menu, ...b }));

const byName = new Map(MAIN_ACTIONS.map((a) => [a.name.toLowerCase(), a]));

 
export function findAction(name: string): ActionDef | undefined {
  return byName.get(name.trim().toLowerCase());
}





export function bindAction(name: string, binding: ActionBinding) {
  const a = findAction(name);
  if (!a) throw new Error(`Unknown action: ${name}`);
  delete a.command;
  delete a.params;
  delete a.ui;
  delete a.unavailable;
  delete a.noop;
  Object.assign(a, binding);
}

 
export function actionParams(a: ActionDef, ws: Workspace): Record<string, unknown> {
  return typeof a.params === "function" ? a.params(ws) : { ...(a.params ?? {}) };
}





export function shortcutOverrides(settings?: Record<string, unknown>): Record<string, string> {
  if (!settings) return {};
  try {
    const o = JSON.parse(String(settings.Shortcuts ?? "{}"));
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

 
export function effectiveShortcut(a: ActionDef, settings?: Record<string, unknown>): string | undefined {
  const o = shortcutOverrides(settings)[a.name];
  if (o !== undefined) return o || undefined;
  return a.shortcut;
}





export function actionListing(settings?: Record<string, unknown>): string {
  return MAIN_ACTIONS.map((a) => {
    const sc = effectiveShortcut(a, settings);
    return `${a.name}|${a.text.replace(/\|/g, " ")}${sc ? `|${sc}` : ""}||`;
  }).join("");
}

const MAC_KEYS: Record<string, string> = { Backspace: "⌫", Delete: "⌦", Escape: "⎋", Esc: "⎋", Return: "↩", Enter: "⌤", Tab: "⇥", Left: "←", Right: "→", Up: "↑", Down: "↓", Home: "↖", End: "↘", PgUp: "⇞", PgDown: "⇟" };

 
function parsePortable(seq: string): { mods: Set<string>; key: string } {
  if (seq === "+" || seq === "-" || seq.length === 1) return { mods: new Set(), key: seq };
  const parts = seq.split("+");
  const key = parts.pop() ?? "";
  return { mods: new Set(parts.map((p) => p.trim())), key };
}






export function nativeShortcut(portable: string): string {
  const { mods, key } = parsePortable(portable);
  let s = "";
  if (mods.has("Meta")) s += "⌃";
  if (mods.has("Alt")) s += "⌥";
  if (mods.has("Shift")) s += "⇧";
  if (mods.has("Ctrl")) s += "⌘";
  return s + (MAC_KEYS[key] ?? key);
}

 
export function actionForKeySequence(seq: string, settings?: Record<string, unknown>): ActionDef | undefined {
  const want = seq.trim().toLowerCase();
  if (!want) return undefined;
  return MAIN_ACTIONS.find((a) => {
    const sc = effectiveShortcut(a, settings);
    return !!sc && nativeShortcut(sc).toLowerCase() === want;
  });
}
