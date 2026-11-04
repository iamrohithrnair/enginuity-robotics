 
 

import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import type { Mat } from "@/engine/math";
import { DEG, eye, mul, rotx, roty, rotz, transl } from "@/engine/math";
import { fmtG } from "@/engine/commands/motion";
import type { Item } from "@/engine/types";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { broadcast, getServer } from "@/server/store";
import { ApiError, byHandle, cmd, matchesType, mutate, need, stationItems, ws } from "./bridge";
import { apiState, COMMANDS, def } from "./context";
import { jointsForTarget } from "@/engine/commands/targets";
import { descendants } from "@/engine/workspace";
import { autoName } from "@/engine/naming";
import { makeItem } from "@/engine/workspace";
import { created, writeItem } from "./cmd-items";
import { headerOf, needRobot, waitStarted } from "./cmd-robot";
import { finishProgram, generating, programStart } from "./runmode";
import { programInstructionCommand } from "./cmd-insjson";
import { collisionMapOf } from "@/engine/collision";
import { uiStationCommand } from "./cmd-actions";







export const API_COMPAT_BUILD = 26935;
export const ROBOCRAFT_VERSION = "1.0.0";
export const ROBOCRAFT_BUILD_DATE = "04-11-2026";

def("Version", "LILLS", async (c) => {
  await c.exec(() => {
     
    c.w.line(`Enginuity v${ROBOCRAFT_VERSION}`).int(64).line(`${ROBOCRAFT_VERSION}.${API_COMPAT_BUILD}`).line(ROBOCRAFT_BUILD_DATE);
  });
});

def("G_License2", "LLS", async (c) => {
  await c.exec(() => {
     
    const id = createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12).toUpperCase();
    c.w.line("Enginuity").line(id);
  });
});

 
def("S_RunMode", "S", async (c) => {
  const mode = await c.r.int();
  await c.exec(async () => {
    const wasGenerating = generating(c.conn);
    c.conn.runMode = mode;
    apiState().runMode = mode;
     
    if (wasGenerating && !generating(c.conn)) await finishProgram(c.conn);
  });
});

def("G_RunMode", "IS", async (c) => {
  await c.exec(() => {
    c.w.int(c.conn.runMode);
  });
});

 
def("ProgramStart", "IS", async (c) => {
  const name = await c.r.line();
  const folder = await c.r.line();
  const post = await c.r.line();
  await c.r.handle();
  const hr = await c.r.handle();
  await c.exec(async () => {
    const robot = hr ? needRobot(hr) : null;
    c.w.int(await programStart(c.conn, { name, folder, post, robot }));
  });
});

 







const SCMD_SETTING: Record<string, string[]> = {
  MaxDecimalsPost: ["MAX_DECIMALS_POST"],
  MoveLSplitMM: ["MoveL_Split_MM"],
  MoveLSplitDeg: ["MoveL_Split_Deg"],
  MoveLSplitMinMM: ["MoveL_Split_MM_Min"],
  MoveJSplitDeg: ["MoveJ_Split_Deg"],
  MoveCSplitMM: ["MoveC_Split_MM"],
  MoveCSplitDeg: ["MoveC_Split_Deg"],
  PathStepCollisionMM: ["PathStepCollisionMM", "PARAM_MM_STEP_COLLISION"],
  PathStepCollisionDeg: ["PathStepCollisionDeg", "PARAM_DEG_STEP_COLLISION"],
  CollisideOneStop: ["Collision_Collide_OneStop"],
};

 
function settingKeys(name: string): string[] {
  if (SCMD_SETTING[name]) return SCMD_SETTING[name];
  return name in DEFAULT_SETTINGS ? [name] : [];
}

 
const SCMD_DEFAULTS: Record<string, string> = {
  ProgramsShow: "1",
  ProgMoveJType: "0",
  ProgMoveLType: "0",
  ProgMoveCType: "0",
  ProgMoveNames: "0",
  ProgRecalc: "0",
  ProgMaxLines: "-1",
  ProgInlineSubprogs: "0",
  ProgMoveExtAxesPoses: "0",
  MaxDecimalsPost: "6",
  PathPrograms: "",
  ToleranceSingularityWrist: "2.5",
  ToleranceSingularityElbow: "2.5",
  ToleranceSingularityBack: "-1",
  ToleranceTurn180: "0.5",
  PathStepMM: "1",
  PathStepCollisionMM: "4",
  PathStepCollisionDeg: "4",
  MoveLSplitMM: "-1",
  MoveLSplitDeg: "-1",
  MoveLSplitMinMM: "0.005",
  MoveJSplitDeg: "-1",
  MoveCSplitMM: "-1",
  MoveCSplitDeg: "270",
  MoveCSplitMinMM: "0.2",
  CollisionMethod: "Fastest",
  CollisideOneStop: "0",
};

 
const STATION_SCOPE_COMMANDS = new Set(
  (
    "AddFolder AddFrame AddNotes AddStationNested AllowExternalAPI API_NODELAY API_NonFinite_Behavior CAM_APT_AUTOSPLIT " +
    "CAM_APT_SPLITPROG CAM_AUTOLOADCUTTER CAM_ZAXIS_INSIDE CamWinId ClearSelection CollisideOneStop CollisionCalcTime " +
    "CollisionHidden CollisionMap CollisionMapMaxSize CollisionMethod ColorAxisX ColorAxisY ColorAxisZ ColorBgBottom ColorBgTop " +
    "ColorPlaneXY ColorPlaneXZ ColorPlaneYZ ColorSelected CudaDevice CudaThreads DisplayCurveNormalsOnSelect DisplayCurves " +
    "DisplayPoints DisplayThreshold EXIT_LAST_COM FitAll FitIsometric FitSelection Font FontSize FrameSizes FrameSizesOther " +
    "FrameSizesPath FrameSizesRef FrameSizesTarget ImportCurvesPoints ImportSurfaceEdges KeyEvent Lang LastRender " +
    "MainProcess_ID MainWindow_ID MouseClickLeft MouseClickMid MouseClickRight MouseFeedback MouseNav MoveCSplitDeg " +
    "MoveCSplitMinMM MoveCSplitMM MoveJSplitDeg MoveLSplitDeg MoveLSplitMinMM MoveLSplitMM PATH_PROGRAMS PathCheckActiveKin " +
    "PathPostProcessor PathPrograms PathStepCollisionDeg PathStepCollisionMM PathStepMM PluginApiEvents PluginCommand " +
    "PluginLoad PluginReload PluginsList PluginsLoad PluginsUnload Popups ProgMaxLines ProgMoveCType ProgMoveJType " +
    "ProgMoveLType ProgMoveNames ProgramsShow ProgRecalc ProgressBar PYTHONPATH PythonRunCode RunProg SetSize3D Settings " +
    "ShowCoords ShowCurveNormals ShowCurvePoints ShowHiddenSelected ShowMessage ShowPointNormals ShowRef_NewObjects " +
    "ShowRef_NewReferences ShowSelectedPointNormals ShowText ShowTextObject SilentMessage SimulationSpeed SimulationTime " +
    "SizeCurveArrow SizeCurvePoints SizeNormals SizeRatioCurves Snapshot SnapshotWhite Theme Threads Time ToggleWorkspace " +
    "TolerancePickCurve TolerancePickPoint ToleranceSingularityBack ToleranceSingularityElbow ToleranceSingularityWrist " +
    "ToleranceTurn180 ToolbarLayout Trace TrajectoryTime Tree TriggerAction UseGPU Version ViewPerspective ViewPoseVR Window " +
    "ZoomInvert ZoomSpeed ProgInlineSubprogs ProgMoveExtAxesPoses MaxDecimalsPost AddTool AddScript"
  ).split(/\s+/),
);

 
export function scmdValue(name: string): string {
  const settings = getServer().services.settings;
  const key = settingKeys(name)[0];
  if (key && settings[key] !== undefined) return fmtSetting(settings[key]);
  const st = apiState();
  if (name in st.scmd) return st.scmd[name];
  return SCMD_DEFAULTS[name] ?? "";
}

function fmtSetting(v: number | string | boolean): string {
  return typeof v === "boolean" ? (v ? "1" : "0") : String(v);
}

 
async function storeScmd(name: string, value: string) {
  const keys = settingKeys(name);
  if (!keys.length) {
    apiState().scmd[name] = value;
    return;
  }
  for (const key of keys) {
    if (key in DEFAULT_SETTINGS) await cmd("settings.set", { key, value });
    else getServer().services.settings[key] = value;
  }
}

 
function helpTable(): string {
  const rows = [
    ["(Command)", "(parameter)", "(description)"],
    ["Popups", "1|0", "Show (1) or suppress (0) blocking popups"],
    ["ProgramsShow", "1|0", "Report generated programs (Enginuity never opens an editor)"],
    ["ProgMoveJType", "0|1|2", "Target type passed to the post for MoveJ"],
    ["ProgMoveLType", "0|1|2", "Target type passed to the post for MoveL"],
    ["ProgMoveCType", "0|1|2", "Target type passed to the post for MoveC"],
    ["ProgMoveNames", "1|0", "Pass target names to the post"],
    ["ProgRecalc", "1|0", "Recalculate target joints before generating"],
    ["ProgMaxLines", "int", "Split generated programs after this many lines (-1 = off)"],
    ["ProgInlineSubprogs", "1|0", "Inline called programs"],
    ["MaxDecimalsPost", "int", "Significant digits passed to the post"],
    ["PathPrograms", "path", "Default folder for generated programs"],
    ["PathPostProcessor", "", "Folder of the post processors (read only)"],
    ["PathStepMM", "mm", "Simulation step along linear paths"],
    ["PathStepCollisionMM", "mm", "Collision check step along paths"],
    ["PathStepCollisionDeg", "deg", "Collision check step for joint moves"],
    ["ToleranceSingularityWrist", "deg", "Wrist singularity tolerance"],
    ["SimulationSpeed", "ratio", "Simulation speed ratio"],
    ["AddFolder", "name", "Add a folder to the station root, returns its pointer"],
    ["AddNotes", "name", "Add notes to the station root, returns its pointer"],
    ["AddTool", "name", "Add a tool to the current robot, returns its pointer"],
    ["FitAll", "", "Fit the view to the station"],
    ["Version", "", "Enginuity version"],
  ];
  return rows.map((r) => r.join("\t")).join("<br>");
}

async function stationCommand(name: string, value: string): Promise<string> {
  const s = getServer();
   
  const ui = await uiStationCommand(name, value);
  if (ui !== undefined) return ui;
  switch (name) {
    case "Popups":
      if (value === "") return s.flags.Popups ?? "1";
      s.flags.Popups = value === "0" ? "0" : "1";
      return "OK";
    case "PathPostProcessor":
      return `${path.join(process.cwd(), "python", "robocraft_post", "posts")}/`;
    case "PATH_PROGRAMS":
      if (value !== "") await storeScmd("PathPrograms", value);
      return scmdValue("PathPrograms");
    case "SimulationSpeed":
      if (value === "") return ws().simulationSpeed.toFixed(6);
      await cmd("sim.setSpeed", { factor: Math.max(0.001, Number(value) || 0.001) });
      return "OK";
    case "SimulationTime":
      return String(simulationTime());
    case "Version":
      return `${ROBOCRAFT_VERSION}.${API_COMPAT_BUILD}`;
    case "EnginuityApi": {
       
       
       
       
      const { UNSUPPORTED_COMMANDS } = await import("./unsupported");
      const fallback = new Set(UNSUPPORTED_COMMANDS);
      const commands = [...COMMANDS.keys()].filter((n) => !fallback.has(n)).sort();
      return JSON.stringify({ product: "Enginuity", version: ROBOCRAFT_VERSION, build: API_COMPAT_BUILD, commands });
    }
    case "FitAll":
    case "FitIsometric":
    case "FitSelection":
      broadcast({ type: "view", action: name === "FitIsometric" ? "preset" : "fit", view: name === "FitIsometric" ? "iso" : undefined, items: name === "FitSelection" ? ws().selection : undefined });
      return "OK";
    case "ClearSelection":
      await cmd("edit.select", { items: [], mode: "replace" });
      return "OK";
    case "ShowMessage":
    case "SilentMessage":
      broadcast({ type: "status", text: value, ms: 10000 });
      return "OK";
    case "AddFolder":
    case "AddNotes":
    case "AddFrame": {
      const cmdName = name === "AddFolder" ? "item.addFolder" : name === "AddNotes" ? "item.addNotes" : "item.addFrame";
      const res = await cmd(cmdName, value ? { name: value } : {});
      return String(created(res).handle);
    }
    case "AddTool": {
      const res = await cmd("robot.addTool", value ? { name: value } : {});
      return String(created(res).handle);
    }
    case "AddScript": {
       
      const st = ws().activeStation;
      if (!st) throw new ApiError(3, "No active station");
      const it = await mutate((w, tx) => {
        const py = makeItem(w, "python", value || autoName(w, st, "python"), { python: { code: "" } });
        tx.add(py, st);
        return py;
      });
      return String(it.handle);
    }
    case "CollisionMap":
       
      if (value === "") return collisionMapOf(ws(), ws().activeStation).mode;
      if (/^(all|none|default)$/i.test(value)) await cmd("collision.setMap", { mode: value.toLowerCase() });
      return "OK";
    default:
      if (!STATION_SCOPE_COMMANDS.has(name) && !(name in SCMD_DEFAULTS)) return helpTable();
      if (value === "") return scmdValue(name);
      await storeScmd(name, value);
      return "OK";
  }
}

def("SCMD", "LS", async (c) => {
  const name = await c.r.line();
  const value = await c.r.line();
  await c.exec(async () => {
     
    c.w.line(await stationCommand(name, value));
  });
});

def("BlindSCMD", "", async (c) => {
  const name = await c.r.line();
  const value = await c.r.line();
  await c.exec(() => stationCommand(name, value).catch(() => ""));
  return "raw";  
});

 

async function itemCommand(h: number, name: string, value: string): Promise<string> {
  const it = need(h);
  switch (name) {
    case "PostProcessor": {
       
      let robot = it.type === "robot" ? it : undefined;
      if (it.type === "program") {
        robot = it.program?.robot ? ws().items[it.program.robot] : undefined;
        if (!robot) return "Invalid robot for program";
      }
      if (!robot?.robot) return "Invalid Item";
      if (value === "") return robot.robot.postProcessor;
       
      await cmd("robot.setPostProcessor", { robot: robot.id, post: value.replace(/\.py$/i, "") });
      return "OK";
    }
    case "Loop":
      if (it.type !== "program") return "Invalid Item";
      if (value === "") return it.params?.Loop === "1" ? "1" : "0";
      await cmd("program.setLoop", { program: it.id, loop: value === "1" });
      return "OK";
    case "Start":
      if (it.type !== "program") return "Invalid Item";
      await cmd("program.run", { program: it.id, startAt: Math.max(0, Math.trunc(Number(value) || 0)) });
      await waitStarted(it.id);
      return "OK";
    case "Stop":
      await cmd("sim.stop", {});
      return "OK";
    case "IsJointTarget":
      return it.target?.isJoint ? "1" : "0";
    case "Recalculate":
    case "RecalculateTargets": {
       
      const targets = it.type === "target" ? [it.id] : descendants(ws(), it.id).filter((d) => d.type === "target").map((d) => d.id);
      if (targets.length) await cmd("target.recalculate", { targets });
      return "OK";
    }
    case "Reachable": {
      if (!it.target) return "Invalid Item";
      const r = it.target.robot ? ws().items[it.target.robot] : undefined;
      if (!r?.robot) return "0";
      return jointsForTarget(ws(), r, it, r.robot.joints) ? "1" : "0";
    }
    case "Visible":
      if (value === "") return it.visible ? "1" : "0";
      await cmd("item.setVisible", { items: [it.id], visible: value !== "0" });
      return "OK";
    case "Tree": {
       
       
      const v = value.toLowerCase();
      const expanded = apiState().treeExpanded;
      if (v === "isexpanded") return (expanded.get(it.id) ?? it.type === "station") ? "1" : "0";
      if (v === "ishidden") return "0";
      if (v === "expand" || v === "collapse") {
        expanded.set(it.id, v === "expand");
        return "OK";
      }
      if (v === "reveal") {
         
        await cmd("view.reveal", { item: it.id });
        return "OK";
      }
      return "OK";
    }
    case "Action":
       
      if (value.toLowerCase() !== "doubleclick") return "OK";
      if (it.type === "target") await cmd("target.moveTo", { target: it.id });
      else if (it.type === "program") {
        await cmd("program.run", { program: it.id });
        await waitStarted(it.id);
      }
      else if (it.type === "station") await cmd("station.setActive", { station: it.id });
      return "OK";
    default: {
      if (it.type === "robot" && it.robot) {
        const r = await robotParam(it, name, value);
        if (r !== undefined) return r;
      }
       
      if (it.type === "program" && (/^\d+$/.test(name) || name === "Add")) return programInstructionCommand(it, name, value);
       
      if (value === "") return it.params?.[name] ?? "";
      await cmd("item.setParam", { item: it.id, key: name, value });
      return "OK";
    }
  }
}

 
export function liveHeader(robot: Item): number[] {
  const rd = robot.robot!;
  const h = headerOf(rd);
  const set = (col: number, row: number, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v)) h[col * 20 + row] = v;
  };
  set(5, 0, rd.payload);
  set(5, 1, rd.reach);
  set(5, 2, rd.repeatability);
  set(5, 3, rd.weight);
  set(6, 0, rd.speeds.linear);
  set(6, 1, rd.speeds.linearAccel);
  set(6, 2, rd.rounding ?? -1);
  set(6, 3, rd.speeds.joint);
  set(6, 4, rd.speeds.jointAccel);
  for (let i = 0; i < Math.min(rd.model.nq, 20); i++) {
    set(30, i, rd.model.userLower[i]);
    set(31, i, rd.model.userUpper[i]);
    set(32, i, rd.model.userLower[i]);
    set(33, i, rd.model.userUpper[i]);
    set(34, i, rd.home[i]);
    set(35, i, rd.joints[i]);
  }
   
  const text = (col: number, t: string) => {
    for (let r = 0; r < 20; r++) h[col * 20 + r] = r < Math.min(t.length, 19) ? t.charCodeAt(r) : 0;
  };
  text(90, robot.name);
  text(190, rd.postProcessor);
  return h;
}

 
export function parsePoseText(text: string): Mat | null {
  const parts = text.replace(/\s+/g, "").split("*").filter(Boolean);
  if (!parts.length) return null;
  let m = eye();
  for (const p of parts) {
    const f = /^(transl|rotx|roty|rotz)\(([^)]*)\)$/i.exec(p);
    if (!f) return null;
    const v = f[2].split(",").map(Number);
    if (v.some((x) => !Number.isFinite(x))) return null;
    const k = f[1].toLowerCase();
    if (k === "transl") m = mul(m, transl(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
    else m = mul(m, (k === "rotx" ? rotx : k === "roty" ? roty : rotz)((v[0] ?? 0) * DEG));
  }
  return m;
}

 
function poseXYZRxyz(m: Mat): number[] {
  const ry = Math.asin(Math.max(-1, Math.min(1, m[2])));
  return [m[3], m[7], m[11], Math.atan2(-m[6], m[10]), ry, Math.atan2(-m[1], m[0])];
}

const numberList = (v: string) => v.split(/[,\s]+/).filter(Boolean).map(Number);





async function robotParam(robot: Item, name: string, value: string): Promise<string | undefined> {
  const rd = robot.robot!;
  const key = ["RobotValue", "MechType", "TypeAxes", "Reach", "Payload", "Repeatability", "Weight", "PulsesXdeg", "MasteringJoints", "NativeName", "IsCalibrated", "IsAccuracyActive", "KinematicsPoseBase"].find((k) => name.startsWith(k));
  if (!key) return undefined;
  const update = (patch: (r: NonNullable<Item["robot"]>, h: number[]) => Partial<NonNullable<Item["robot"]>>) =>
    mutate((w, tx) => {
      const r = w.items[robot.id].robot!;
      const h = headerOf(r);
      const extra = patch(r, h);
      tx.set(robot.id, { robot: { ...r, header: h, ...extra } });
    });
  switch (key) {
    case "RobotValue": {
      const n = Math.trunc(Number(value));
      if (!(n >= 0) || n >= 16000) return "Invalid";
      return fmtG(liveHeader(robot)[n] ?? 0);
    }
    case "MechType":
      return fmtG(rd.model.mech);
    case "TypeAxes":
      return `[${rd.model.userLower.map((_, i) => (isLinearAxis(robot, i) ? "'L'" : "'R'")).join(",")}]`;
    case "NativeName":
      return rd.nativeName ?? "";
    case "IsCalibrated":
    case "IsAccuracyActive":
      return "0";
    case "MasteringJoints":
      if (value === "") return rd.home.map((v) => v.toFixed(8)).join(",");
      await update(() => ({ home: numberList(value).slice(0, rd.model.nq) }));
      return "OK";
    case "PulsesXdeg": {
      const col = 49 * 20;
      if (value === "") return Array.from({ length: rd.model.nq }, (_, i) => fmtG(headerOf(rd)[col + i] ?? 0)).join(",");
      const v = numberList(value);
      await update((_r, h) => {
        v.slice(0, 20).forEach((x, i) => (h[col + i] = x));
        return {};
      });
      return "OK";
    }
    case "KinematicsPoseBase": {
      const pose = parsePoseText(value);
      if (!pose) return "Invalid pose";
      const v = poseXYZRxyz(pose);
      await update((r, h) => {
        v.forEach((x, i) => {
          h[9 * 20 + i] = x;
          h[109 * 20 + i] = x;
        });
        return { model: { ...r.model, base: pose } };
      });
      return "OK";
    }
    default: {
       
      const field = ({ Reach: "reach", Payload: "payload", Repeatability: "repeatability", Weight: "weight" } as const)[key as "Reach"];
      const row = { Reach: 1, Payload: 0, Repeatability: 2, Weight: 3 }[key as "Reach"];
      if (value === "") return fmtG(rd[field] ?? headerOf(rd)[5 * 20 + row] ?? 0);
      const x = Number(value);
      if (!Number.isFinite(x)) return "Invalid value";
      await update((_r, h) => {
        h[5 * 20 + row] = x;
        return { [field]: x };
      });
      return "OK";
    }
  }
}

 
function isLinearAxis(robot: Item, i: number): boolean {
  const m = robot.robot!.model;
  return m.joints.some((j, r) => j.kind === "linear" && (m.map[r * m.nq + i] ?? 0) !== 0);
}

def("ICMD", "LS", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const value = await c.r.line();
  await c.exec(async () => {
    c.w.line(await itemCommand(h, name, value));
  });
});

def("BlindICMD", "", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const value = await c.r.line();
  await c.exec(() => itemCommand(h, name, value).catch(() => ""));
  return "raw";
});

 

 
function simulationTime(): number {
  return ((Date.now() - apiState().startedAt) / 1000) * ws().simulationSpeed;
}

 
let belowMinimum = false;

def("SimulateSpeed", "S", async (c) => {
  const v = await c.r.int();
  await c.exec(async () => {
     
    belowMinimum = v < 1;
    await cmd("sim.setSpeed", { factor: Math.max(0.001, v / 1000) });
  });
});

def("GetSimulateSpeed", "IS", async (c) => {
  await c.exec(() => {
    const speed = ws().simulationSpeed;
    if (belowMinimum && speed !== 0.001) belowMinimum = false;
    c.w.int(belowMinimum ? 0 : Math.round(speed * 1000));
  });
});

def("GetSimTime", "IS", async (c) => {
  await c.exec(() => {
    c.w.int(Math.round(simulationTime() * 1000));
  });
});

 

const noArgs = (name: string) =>
  def(name, "S", async (c) => {
    await c.exec(() => undefined);
  });

 
noArgs("HIDE");
noArgs("RAISE");
noArgs("QUIT");

 
for (const name of ["Refresh", "S_WindowState"]) {
  def(name, "S", async (c) => {
    await c.r.int();
    await c.exec(() => undefined);
  });
}

 
 
 
def("ShowMessage", "S", async (c) => {
  const text = await c.r.line();
  const s = getServer();
  if (s.flags.Popups === "0" || !s.services.ask) {
    await c.exec(() => broadcast({ type: "status", text, ms: 10000 }));
    return;
  }
  await s.services.ask(text, ["OK"], "Message");
});

def("ShowMessageStatus", "S", async (c) => {
  const text = await c.r.line();
  await c.exec(() => {
    broadcast({ type: "status", text, ms: 10000 });
  });
});

def("G_ViewPose", "HS", async (c) => {
  await c.exec(() => {
    c.w.pose(apiState().viewPose ?? eye());
  });
});

def("S_ViewPose", "S", async (c) => {
  const pose: Mat = await c.r.pose();
  await c.exec(() => {
    apiState().viewPose = pose;
    broadcast({ type: "view", action: "pose", pose });
  });
});






async function userPick(message: string, items: Item[]): Promise<Item | null> {
  const ask = getServer().services.ask;
  if (!ask) return null;
  const labels = new Map<string, Item>();
  for (const it of items) {
    let label = it.name || "(unnamed)";
    for (let k = 2; labels.has(label); k++) label = `${it.name} (${k})`;
    labels.set(label, it);
  }
  const answer = await ask(message || "Select an item", [...labels.keys(), "Cancel"], "Select an item");
  return labels.get(answer) ?? null;
}

def("PickItem", "TS", async (c) => {
  const message = await c.r.line();
  const type = await c.r.int();
  const items = await c.exec(() => stationItems().filter((it) => it.type !== "station" && matchesType(it, type)));
  const picked = await userPick(message, items);
  await c.exec(() => writeItem(c.w, picked && byHandle(picked.handle) ? picked : null));
});

def("PickItemList", "TS", async (c) => {
  const message = await c.r.line();
  const n = await c.r.int();
  const handles: number[] = [];
  for (let i = 0; i < n; i++) handles.push(await c.r.handle());
  const items = await c.exec(() => handles.map((h) => byHandle(h)).filter((it): it is Item => !!it));
  const picked = await userPick(message, items);
  await c.exec(() => writeItem(c.w, picked && byHandle(picked.handle) ? picked : null));
});

 
 
def("PluginLoad", "S", async (c) => {
  const name = await c.r.line();
  const load = await c.r.int();
  await c.exec(() => {
    broadcast({ type: "status", text: `Plugin not found: ${name} (${load ? "load" : "unload"})`, ms: 5000 });
  });
});

 
 
def("WinProcDock", "IS", async (c) => {
  await c.r.line();
  await c.r.line();
  await c.r.array();
  await c.r.line();
  await c.r.int();
  await c.r.int();
  await c.r.int();
  await c.exec(() => {
    c.w.int(0);
  });
});





def("S_InteractiveMode", "S", async (c) => {
  const mode = await c.r.int();
  const flags = await c.r.int();
  const n = await c.r.int();
  const custom: { h: number; flags: number }[] = [];
  for (let i = 0; i < n; i++) custom.push({ h: await c.r.handle(), flags: await c.r.int() });
  await c.exec(() => {
    const items: Record<string, number> = {};
    for (const e of custom) {
      const it = byHandle(e.h);
      if (it) items[it.id] = e.flags;
    }
    apiState().scmd.InteractiveMode = JSON.stringify({ mode, flags, items });
    broadcast({ type: "view", action: "interactive-mode", mode, flags, items });
  });
});

def("PluginCommand", "LS", async (c) => {
  await c.r.line();
  await c.r.line();
  await c.r.line();
  await c.exec(() => {
    c.w.line("");  
  });
});

