 
 
 
 

import { z } from "zod";
import { bindAction } from "../actions";
import { requireRef } from "../dispatch";
import { CommandError, defineCommand, ItemRef, status } from "../registry";
import type { Item, RobotConnection, Workspace } from "../types";
import { viewOf } from "../view";

 

 
export const VR_MESSAGE = "Virtual Reality is not supported on this version of Enginuity.";

defineCommand({
  name: "vr.connect",
  title: "Connect VR Headset",
  description: "Connect ▸ Connect VR Headset (Shift+V). Enginuity has no virtual reality support: shows and returns the 'not supported' message.",
  category: "view",
  undoable: false,
  readonly: true,
  spec: "B-CONN-10",
  schema: z.object({}),
  run(ctx) {
    if (ctx.origin !== "api" && (ctx.services.view?.clients() ?? 0) > 0) void ctx.services.ask?.(VR_MESSAGE, ["OK"]);
    return { message: VR_MESSAGE };
  },
});

defineCommand({
  name: "view.vrView",
  title: "VR View",
  description:
    "VR View (an action without a menu entry): the 3D view angle becomes twice the View angle setting and, in the Enginuity window, the view goes full screen with the side windows closed. on toggles when omitted; returns the new state.",
  category: "view",
  undoable: false,
  spec: "B-OTHER-04",
  schema: z.object({ on: z.boolean().optional() }),
  run(ctx, p) {
    const cur = viewOf(ctx.ws);
    const on = p.on ?? !cur.vr;
    ctx.tx.setMeta("view", { ...cur, vr: on });
    const angle = Number(ctx.services.settings.ViewAngle ?? 30) || 30;
    return { vr: on, viewAngle: on ? angle * 2 : angle };
  },
});

 

 
export const CONNECTION_DEFAULTS: RobotConnection = { ip: "192.168.0.100", port: 2000, remotePath: "/", ftpUser: "anonymous", ftpPass: "", state: -2, message: "Robot disconnected" };

 
export const ROBOTCOM = { PROBLEMS: -3, DISCONNECTED: -2, NOT_CONNECTED: -1, READY: 0, WORKING: 1, WAITING: 2 } as const;

 
export const NO_DRIVER_MESSAGE = "Connection problems";

export const connectionOf = (r: Item): RobotConnection => ({ ...CONNECTION_DEFAULTS, ...(r.robot?.connection ?? {}) });

function connRobot(ws: Workspace, ref: string | number | undefined): Item {
  if (ref === undefined) {
    const sel = ws.selection.map((id) => ws.items[id]).find((i) => i?.type === "robot");
    if (sel) return sel;
    const any = Object.values(ws.items).find((i) => i.type === "robot");
    if (!any) throw new CommandError("No robot to connect");
    return any;
  }
  const it = requireRef(ws, ref, "robot");
  if (it.type !== "robot" || !it.robot) throw new CommandError("Invalid item provided");
  return it;
}

defineCommand({
  name: "robot.setConnection",
  title: "Robot Connection Settings",
  description: "Set a robot's driver connection parameters (Connect ▸ Connect Robot panel / robolink setConnectionParams): IP or COM port, port, remote FTP path, FTP user and password. Omitted values are kept.",
  category: "robot",
  spec: "B-CONN-01",
  schema: z.object({
    robot: ItemRef.optional(),
    ip: z.string().optional(),
    port: z.number().int().optional(),
    remotePath: z.string().optional(),
    ftpUser: z.string().optional(),
    ftpPass: z.string().optional(),
  }),
  run(ctx, p) {
    const r = connRobot(ctx.ws, p.robot);
    const c = connectionOf(r);
    const next: RobotConnection = {
      ...c,
      ...(p.ip !== undefined ? { ip: p.ip } : {}),
      ...(p.port !== undefined ? { port: p.port } : {}),
      ...(p.remotePath !== undefined ? { remotePath: p.remotePath } : {}),
      ...(p.ftpUser !== undefined ? { ftpUser: p.ftpUser } : {}),
      ...(p.ftpPass !== undefined ? { ftpPass: p.ftpPass } : {}),
    };
    ctx.tx.set(r.id, { robot: { ...r.robot!, connection: next } });
    ctx.undoLabel = null;
    return { robot: r.name, ip: next.ip, port: next.port, remotePath: next.remotePath, ftpUser: next.ftpUser };
  },
});

defineCommand({
  name: "robot.connectionState",
  title: "Robot Connection State",
  description: "Connection parameters and state of a robot driver: ROBOTCOM code (−3 problems, −2 disconnected, −1 not connected, 0 ready, 1 working, 2 waiting) and message.",
  category: "robot",
  readonly: true,
  undoable: false,
  spec: "B-CONN-01",
  schema: z.object({ robot: ItemRef.optional() }),
  run(ctx, p) {
    const r = connRobot(ctx.ws, p.robot);
    const c = connectionOf(r);
    return { robot: r.name, ip: c.ip, port: c.port, remotePath: c.remotePath, ftpUser: c.ftpUser, state: c.state, message: c.message };
  },
});

 
export function attemptConnection(c: RobotConnection): RobotConnection {
  return { ...c, state: ROBOTCOM.PROBLEMS, message: NO_DRIVER_MESSAGE };
}

defineCommand({
  name: "robot.connect",
  title: "Connect Robot",
  description:
    "Connect a robot to its controller through a robot driver (Connect ▸ Connect Robot / robolink Connect). Enginuity has no robot drivers: the attempt reports the driver's connection problem at once, as when no controller answers. Programs can still be simulated and generated offline.",
  category: "robot",
  undoable: false,
  spec: "B-CONN-01",
  schema: z.object({ robot: ItemRef.optional(), ip: z.string().optional() }),
  run(ctx, p) {
    const r = connRobot(ctx.ws, p.robot);
    let c = connectionOf(r);
    if (p.ip) {
      c = { ...c, ip: p.ip };
      status(ctx, `Robot IP updated to ${p.ip} for robot ${r.name}`);
    }
    c = attemptConnection(c);
    ctx.tx.set(r.id, { robot: { ...r.robot!, connection: c } });
    ctx.undoLabel = null;
    return { robot: r.name, connected: false, state: c.state, message: c.message };
  },
});

defineCommand({
  name: "robot.disconnect",
  title: "Disconnect Robot",
  description: "Disconnect a robot driver (robolink Disconnect); the state becomes \"Robot disconnected\".",
  category: "robot",
  undoable: false,
  spec: "B-CONN-01",
  schema: z.object({ robot: ItemRef.optional() }),
  run(ctx, p) {
    const r = connRobot(ctx.ws, p.robot);
    const c: RobotConnection = { ...connectionOf(r), state: ROBOTCOM.DISCONNECTED, message: "Robot disconnected" };
    ctx.tx.set(r.id, { robot: { ...r.robot!, connection: c } });
    ctx.undoLabel = null;
    return { robot: r.name, state: c.state, message: c.message };
  },
});

 

 
export const HARDWARE_FEATURES = {
  ballbar: { action: "actionBallbar_Validation", text: "Ballbar Accuracy Test", message: "Failed to measure with ballbar" },
  "calibrate-robot": { action: "actionCalibrate_Robot", text: "Calibrate Robot", message: "The laser tracker is not ready, connect to the tracker first." },
  "iso-accuracy": { action: "actionISO_9283_Accuracy_and_Repeatability_test", text: "Test Position Accuracy (ISO 9283)", message: "The laser tracker is not ready, connect to the tracker first." },
  "path-accuracy": { action: "actionPath_Accuracy_test", text: "Test Path Accuracy (ISO 9283)", message: "The laser tracker is not ready, connect to the tracker first." },
  "c-track": { action: "actionConnect_C_Track", text: "Connect Creaform's C-Track Optical CMM", message: "Connection status: disconnected" },
  optitrack: { action: "actionConnect_OptiTrack_Camera", text: "Connect OptiTrack Camera", message: "Connection status: disconnected" },
  faro: { action: "actionConnect_Laser_Tracker", text: "Connect Faro Laser Tracker", message: "Connection problems with the laser tracker." },
  leica: { action: "actionConnect_Leica_Laser_Tracker", text: "Connect Leica Laser Tracker", message: "Connection problems with the laser tracker." },
  "api-ot2": { action: "actionConnect_API_Laser_Tracker", text: "Connect API OT2 Laser Tracker", message: "Connection problems with the laser tracker." },
  "api-radian": { action: "actionConnect_API_Radian_Laser_Tracker", text: "Connect API Radian Laser Tracker", message: "Connection problems with the laser tracker." },
} as const;

type HardwareFeature = keyof typeof HARDWARE_FEATURES;

defineCommand({
  name: "utilities.hardware",
  title: "Measurement Hardware",
  description:
    "Robot calibration, ballbar and ISO 9283 accuracy tests and the laser tracker / optical CMM connections need measurement hardware that Enginuity cannot reach: returns (and shows) the no-device message for the feature.",
  category: "tools",
  undoable: false,
  readonly: true,
  spec: "B-UTIL-13..16, B-CONN-02..08",
  schema: z.object({ feature: z.enum(Object.keys(HARDWARE_FEATURES) as [HardwareFeature, ...HardwareFeature[]]) }),
  run(ctx, p) {
    const f = HARDWARE_FEATURES[p.feature];
    status(ctx, f.message);
    return { feature: f.text, available: false, message: f.message };
  },
});

 

 
for (const name of [
  "actionCalibrate_tool",
  "actionCalibrate_frame",
  "actionAdd_Mechanism_or_Robot",
  "actionISO_9283_targets_and_path",
  "action-ConnectRobot",
  "actionSimulate_2D_Camera",
  "actionVR_View",
]) {
  bindAction(name, { ui: true });
}
bindAction("actionConnect_HTC_Vive_VR", { command: "vr.connect" });
for (const [feature, f] of Object.entries(HARDWARE_FEATURES)) bindAction(f.action, { command: "utilities.hardware", params: { feature } });
