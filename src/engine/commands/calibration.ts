// Registers TCP and reference-frame calibration commands.
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { fk, withinLimits } from "../kinematics";
import { inv, mul, poseToXYZRPW, type Mat } from "../math";
import { CommandError, defineCommand, ItemRef, type CmdCtx } from "../registry";
import type { Item } from "../types";
import {
  CALIB_MSG,
  CALIBRATE_FRAME_3P_P1_ON_X,
  CALIBRATE_FRAME_3P_P1_ORIGIN,
  CALIBRATE_FRAME_6P,
  CALIBRATE_TURNTABLE,
  CALIBRATE_TURNTABLE_2X,
  frameFromPoints,
  rotationAngleDeg,
  tcpByPlane,
  tcpByPoint,
  type FrameCalibration,
} from "../utilities/calibration";
import { eulerToPose } from "../utilities/euler";
import type { Vec3 } from "../utilities/linalg";
import { absPose, childFrame, robotOfTool, toolPose } from "../workspace";
import { apiNoUndo } from "./items";
import { requireRobot } from "./robot";

const f3 = (v: number) => v.toFixed(3);
const f1 = (v: number) => v.toFixed(1);

 
function robotFor(ctx: CmdCtx, ref: string | number | undefined, tool?: Item): Item | undefined {
  if (ref !== undefined) return requireRobot(ctx.ws, ref);
  if (tool) {
    const r = robotOfTool(ctx.ws, tool.id);
    if (r) return r;
  }
  try {
    return requireRobot(ctx.ws, undefined);
  } catch {
    return undefined;
  }
}

 
function flangesFromJoints(robot: Item, rows: number[][]): Mat[] {
  const model = robot.robot!.model;
  return rows.map((q, i) => {
    const joints = q.slice(0, model.nq);
    if (joints.length < model.nq || !withinLimits(model, joints)) throw new CommandError(`Joints at position ${i + 1} are not valid.`);
    return fk(model, joints);
  });
}

const EULER_DOC = "Euler format of pose rows (robolink EULER_*): 0 RX:RYp:RZpp [x,y,z,rx,ry,rz] (default), 1 RZ:RYp:RXpp (ABB/KUKA A,B,C order), 2 RZ:RYp:RZpp, 3 RZ:RXp:RZpp, 4 RX:RY:RZ (Fanuc W,P,R), 5 RZ:RY:RX, 6 quaternion [x,y,z,qw,qx,qy,qz]";

defineCommand({
  name: "calib.tool",
  title: "Define Tool Frame (TCP)",
  description:
    "Calibrate a tool center point like Utilities ▸ Define Tool Frame (TCP). Give at least 3 flange poses (or robot joints) touching the same point with different orientations (method 'point', XYZ calibration by point: pairs closer than minAngle (5°) are ignored and at least 3 valid pairs are needed), or touching the XY plane of a reference (method 'plane' / 'plane-scara', at least 4 poses). Returns the TCP [x,y,z] in the flange frame, the stationary point, error stats [mean, std, max] and per-pose errors (mm). apply=true replaces the XYZ of the tool's TCP (orientation kept).",
  category: "tools",
  spec: "B-UTIL-01",
  schema: z.object({
    rows: z.array(z.array(z.number())).min(1).describe("one row per measurement: a flange pose in the chosen Euler format, or robot joints when input='joints'"),
    input: z.enum(["poses", "joints"]).default("poses"),
    euler: z.number().int().min(0).max(6).default(0).describe(EULER_DOC),
    method: z.enum(["point", "plane", "plane-scara"]).default("point"),
    robot: ItemRef.optional().describe("robot for joints input (default: the tool's robot or the selected robot)"),
    tool: ItemRef.optional().describe("tool to compare with and to update when apply=true"),
    plane: ItemRef.optional().describe("by plane: reference frame whose XY plane the TCP touched (default: the robot base)"),
    minAngle: z.number().min(0).default(5).describe("by point: minimum angle between two orientations (deg)"),
    apply: z.boolean().default(false),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const tool = p.tool !== undefined ? requireRef(ws, p.tool, "tool") : undefined;
    if (tool && tool.type !== "tool") throw new CommandError(`${tool.name} is not a tool`);
    let flanges: Mat[];
    let robot: Item | undefined;
    if (p.input === "joints") {
      robot = robotFor(ctx, p.robot, tool);
      if (!robot) throw new CommandError("Undefined robot. Cannot calculate the TCP. Attach the tool to a robot or use poses.");
      flanges = flangesFromJoints(robot, p.rows);
    } else {
      flanges = p.rows.map((r, i) => {
        if (r.length < (p.euler === 6 ? 7 : 6)) throw new CommandError(`Invalid data format. Row ${i + 1} must have ${p.euler === 6 ? 7 : 6} values.`);
        return eulerToPose(r, p.euler);
      });
      robot = p.robot !== undefined ? requireRobot(ws, p.robot) : tool ? robotOfTool(ws, tool.id) : undefined;
    }
    const n = flanges.length;
    let res;
    let planeNote = "";
    if (p.method === "point") {
      res = tcpByPoint(flanges, p.minAngle);
    } else {
       
      let plane: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      if (p.plane !== undefined) {
        const ref = requireRef(ws, p.plane, "plane reference");
        plane = robot ? mul(inv(absPose(ws, robot.id)), absPose(ws, ref.id)) : absPose(ws, ref.id);
      }
      res = tcpByPlane(flanges, plane, { scara: p.method === "plane-scara" });
      if (res.ok && res.planeAngles) planeNote = `. Plane reference angle errors: [${f1(res.planeAngles[0])}, ${f1(res.planeAngles[1])}] deg.`;
    }
    if (!res.ok) throw new CommandError(CALIB_MSG.unable);
    const [t, s] = [res.tcp, res.point];
    let message = `Calibrated TCP [X,Y,Z] = [${f3(t[0])}, ${f3(t[1])}, ${f3(t[2])}] mm`;
    if (p.method === "point") message += `. Stationary point = [${f3(s[0])}, ${f3(s[1])}, ${f3(s[2])}] mm`;
    let errorsText = n < 4 ? CALIB_MSG.fewPoints : `Errors : [mean, std, max]=[${f3(res.stats[0])}, ${f3(res.stats[1])}, ${f3(res.stats[2])}] mm`;
    if (res.skipped > 0) errorsText += CALIB_MSG.closeConfigs;
    errorsText += planeNote;
    let previous: number[] | undefined;
    if (tool) previous = [tool.pose[3], tool.pose[7], tool.pose[11]];
    if (p.apply) {
      if (!tool) throw new CommandError("Select a tool to update its TCP");
      const pose = tool.pose.slice();
      pose[3] = t[0];
      pose[7] = t[1];
      pose[11] = t[2];
      tx.set(tool.id, { pose });
      ctx.undoLabel = `Move TCP: ${tool.name}`;
      apiNoUndo(ctx);
    } else ctx.undoLabel = null;
    return {
      tcp: t,
      ...(p.method === "point" ? { stationaryPoint: s } : { planeOffset: s[0], planeAngles: res.planeAngles }),
      stats: res.stats,
      errors: res.errors,
      pairsUsed: res.pairs,
      pairsTooClose: res.skipped,
      message,
      errorsText,
      ...(tool ? { tool: tool.name, previousTcp: previous, difference: previous ? Math.hypot(t[0] - previous[0], t[1] - previous[1], t[2] - previous[2]) : undefined } : {}),
      ...(p.apply ? { applied: true } : {}),
    };
  },
});

const FRAME_METHODS = {
  "p1-on-x": CALIBRATE_FRAME_3P_P1_ON_X,
  "p1-origin": CALIBRATE_FRAME_3P_P1_ORIGIN,
  "6-points": CALIBRATE_FRAME_6P,
  turntable: CALIBRATE_TURNTABLE,
  "turntable-2-axes": CALIBRATE_TURNTABLE_2X,
} as const;

 
export function frameMessage(pose: Mat): string {
  const v = poseToXYZRPW(pose);
  return `Calibrated frame [X,Y,Z] = [${f3(v[0])}, ${f3(v[1])}, ${f3(v[2])}] mm ; [W,P,R] = [${f3(v[3])}, ${f3(v[4])}, ${f3(v[5])}] deg`;
}

 
function turntableText(r: FrameCalibration, method: number): string {
  const s = r.stats;
   
  let t = `Avg. errors: [planar, circular] = [${f3(s[1])}, ${f3(s[0])}] mm. Max. errors: [planar, circular] = [${f3(s[4])}, ${f3(s[3])}] mm`;
  if (method === CALIBRATE_TURNTABLE_2X && s.length >= 14) t += `. Distance between axes: ${f3(s[12])} mm.  Angle between axes: ${f3(s[13])} deg.`;
  return t;
}

defineCommand({
  name: "calib.frame",
  title: "Define Reference Frame",
  description:
    "Calibrate a reference frame like Utilities ▸ Define Reference Frame, from points measured with the robot (robot base coordinates) or from robot joints (the robot's TCP is used). Methods: 'p1-on-x' (3 points: p1 and p2 on +X, p3 crosses Y+), 'p1-origin' (3 points: origin, X+, XY+), '6-points' (p1..p3 on the XY plane, p4→p5 along X, p6 on the YZ plane), 'turntable' (one point measured at ≥3 table angles: origin at the circle centre, Z the rotation axis, X towards the first point), 'turntable-2-axes' (points turning axis 1, then axis 2). Returns the frame pose relative to the robot base, the result message and the turntable statistics. apply=true moves `frame` to the result.",
  category: "tools",
  spec: "B-UTIL-02",
  schema: z.object({
    rows: z.array(z.array(z.number())).min(1).describe("points [x,y,z] (extra columns ignored) or robot joints when input='joints'"),
    input: z.enum(["points", "joints"]).default("points"),
    method: z.enum(Object.keys(FRAME_METHODS) as [keyof typeof FRAME_METHODS, ...(keyof typeof FRAME_METHODS)[]]).default("p1-origin"),
    robot: ItemRef.optional().describe("robot the points were measured with (joints input requires one)"),
    frame: ItemRef.optional().describe("reference frame to compare with and to update when apply=true"),
    apply: z.boolean().default(false),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const method = FRAME_METHODS[p.method];
    const frame = p.frame !== undefined ? requireRef(ws, p.frame, "frame") : undefined;
    if (frame && frame.type !== "frame") throw new CommandError(`${frame.name} is not a reference frame`);
    let robot: Item | undefined;
    let points: Vec3[];
    let usingTcp: number[] | undefined;
    if (p.input === "joints") {
      robot = robotFor(ctx, p.robot);
      if (!robot) throw new CommandError("Undefined robot. Cannot calculate the frame position. Select a robot or use poses.");
      const tcp = toolPose(ws, robot.id);
      usingTcp = [tcp[3], tcp[7], tcp[11]];
      points = flangesFromJoints(robot, p.rows).map((f) => {
        const m = mul(f, tcp);
        return [m[3], m[7], m[11]];
      });
    } else {
      robot = p.robot !== undefined ? requireRobot(ws, p.robot) : undefined;
      points = p.rows.map((r, i) => {
        if (r.length < 3) throw new CommandError(`Invalid data format. Data must be an array of >=6xN or 3xN values (row ${i + 1}).`);
        return [r[0], r[1], r[2]];
      });
    }
    const res = frameFromPoints(points, method);
    if (!res.ok || res.degenerate) throw new CommandError(CALIB_MSG.framePointsClose);
    const lines = [frameMessage(res.pose)];
    if (usingTcp) lines.push(`Using TCP: [${usingTcp.map(f3).join(", ")}]`);
    if (method === CALIBRATE_TURNTABLE || method === CALIBRATE_TURNTABLE_2X) lines.push(turntableText(res, method));
     
    const refAbs: Mat = robot ? absPose(ws, robot.id) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const abs = mul(refAbs, res.pose);
    let frameError: { mm: number; deg: number } | undefined;
    if (frame) {
      const cur = mul(inv(refAbs), absPose(ws, frame.id));
      const d = mul(inv(cur), res.pose);
      frameError = { mm: Math.hypot(cur[3] - res.pose[3], cur[7] - res.pose[7], cur[11] - res.pose[11]), deg: rotationAngleDeg(d) };
      lines.push(`Current frame position [X,Y,Z] = [${f3(cur[3])}, ${f3(cur[7])}, ${f3(cur[11])}] mm. Frame error is ${f3(frameError.mm)} mm and ${f3(frameError.deg)} deg.`);
      if (robot && frame.parent !== robot.parent && frame.parent !== robot.id) lines.push(`Warning: Reference not attached to ${ws.items[robot.parent ?? ""]?.name ?? robot.name}`);
    }
    if (p.apply) {
      if (!frame) throw new CommandError("Select a frame to update its position");
      tx.set(frame.id, { pose: mul(inv(childFrame(ws, frame.parent)), abs) });
      ctx.undoLabel = `Move: ${frame.name}`;
      apiNoUndo(ctx);
    } else ctx.undoLabel = null;
    return {
      pose: res.pose,
      poseAbs: abs,
      xyzwpr: poseToXYZRPW(res.pose),
      stats: res.stats,
      message: lines.join("\n"),
      ...(frameError ? { frameError } : {}),
      ...(res.radius !== undefined ? { radius: res.radius } : {}),
      ...(p.apply ? { applied: true } : {}),
    };
  },
});
