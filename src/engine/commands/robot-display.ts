 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { CommandError, defineCommand, ItemRef } from "../registry";
import type { Item, RobotModel } from "../types";
import { DEG as DEG_ } from "../math";
import { internalLimits } from "../utilities/mechanism";

export const SHOW_FRAME_LABELS = { base: "Base (0)", tool: "Tool Frame", ref: "Ref. Frame", flange: "Robot Flange", all: "All/None" } as const;

 
export function robotShowFrames(r: Item) {
  const p = r.params ?? {};
  const links = (p.ShowLinkFrames ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return { links, tool: p.ShowToolFrame !== "0", ref: p.ShowRefFrame !== "0", flange: p.ShowFlange !== "0" };
}

defineCommand({
  name: "robot.showFrames",
  title: "Show Frames",
  description:
    "Choose which frames of a robot the 3D view draws (robot panel ▸ Show Frames): links = link frame indices (0 = base, 1…n after each joint), tool (Tool Frame), ref (the robot's reference frame), flange (Robot Flange); all=true/false checks or clears every box (All/None). Omitted values keep their state. Defaults: tool, ref and flange on, link frames off.",
  category: "view",
  undoable: false,
  spec: "B-PANEL-07",
  schema: z.object({
    robot: ItemRef,
    links: z.array(z.number().int().min(0)).optional(),
    tool: z.boolean().optional(),
    ref: z.boolean().optional(),
    flange: z.boolean().optional(),
    all: z.boolean().optional(),
  }),
  run(ctx, p) {
    const r = requireRef(ctx.ws, p.robot);
    if (r.type !== "robot" || !r.robot) throw new CommandError(`${r.name} is not a robot`);
    const cur = robotShowFrames(r);
    const n = r.robot.model.nq;
    const all = p.all;
    const links = all !== undefined ? (all ? Array.from({ length: n + 1 }, (_, i) => i) : []) : (p.links ?? cur.links).filter((i) => i <= n);
    const flag = (v: boolean | undefined, c: boolean) => ((all ?? v ?? c) ? "1" : "0");
    const next = {
      ...(r.params ?? {}),
      ShowLinkFrames: [...new Set(links)].sort((a, b) => a - b).join(","),
      ShowToolFrame: flag(p.tool, cur.tool),
      ShowRefFrame: flag(p.ref, cur.ref),
      ShowFlange: flag(p.flange, cur.flange),
    };
    ctx.tx.set(r.id, { params: next });
    return { robot: r.name, ...robotShowFrames({ ...r, params: next }) };
  },
});

 
 
 
 
 
 
 
 
 
 


export const SENSES_TEXT = {
  title: "Joint axis senses",
  prompt: "Set the robot axis senses, in order:<br>+1 (default) or -1 (inverted).",
  coupling: "Note: The 7th value represents the coupling between axes 2 and 3.",
  swap5: "Note: Set the 6th value to -1 to swap the order of axes 1 and 2.",
} as const;

 
export function robotSenses(m: RobotModel): number[] {
  const n = m.nq;
  const s = Array.from({ length: n }, (_, i) => m.map[i * n + i] ?? 1);
  if (n === 6 && m.joints.length === n) s.push(m.map[2 * n + 1] ?? 0);
  return s;
}

const requireRobotItem = (ws: Parameters<typeof requireRef>[0], ref: Parameters<typeof requireRef>[1]) => {
  const r = requireRef(ws, ref);
  if (r.type !== "robot" || !r.robot) throw new CommandError(`${r.name} is not a robot`);
  return r;
};

defineCommand({
  name: "robot.setSenses",
  title: "Joint Senses",
  description:
    "Set a robot's joint axis senses (Robot Parameters ▸ Joint Senses): one value per joint, +1 (default) or -1 (inverted); `senses` may also be text split on ';', ',', tabs, spaces or new lines. For 6-axis robots a 7th value couples axes 2 and 3 (J3 moves with J2, e.g. -1 for Fanuc) and builds the J2–J3 limit polygon from the current J2/J3 limits; 0 clears the coupling and the polygon. Internal limits follow.",
  category: "robot",
  spec: "B-PANEL-08, D-28, R-KIN-39",
  schema: z.object({ robot: ItemRef, senses: z.union([z.array(z.number()), z.string()]) }),
  run(ctx, p) {
    const r = requireRobotItem(ctx.ws, p.robot);
    const old = r.robot!.model;
    const n = old.nq;
    const vals = typeof p.senses === "string" ? p.senses.split(/;|,|\t| |\n/).filter((x) => x.trim() !== "").map(Number) : p.senses;
    if (vals.some((v) => !Number.isFinite(v)) || vals.length < n) throw new CommandError(`Provide ${n} values: ${SENSES_TEXT.prompt.replace("<br>", " ")}`);
    if (old.joints.length !== n) throw new CommandError(`${r.name} has coupled or passive joints: its senses can't be edited`);
    const map = old.map.slice();
    for (let i = 0; i < n; i++) map[i * n + i] = vals[i] < 0 ? -1 : 1;
    let polygon = old.polygon;
    if (n === 6) {
      const c = vals[6] ?? 0;
      map[2 * n + 1] = Math.abs(c) > 0.001 ? c : 0;
       
      const [l2, h2, l3, h3] = [old.userLower[1], old.userUpper[1], old.userLower[2], old.userUpper[2]];
      polygon = Math.abs(c) > 0.001 ? [[l2, l3], [h2, l3], [h2, h3], [l2, h3], [l2, l3]] : [];
    }
    const lim = internalLimits(map, n, old.userLower, old.userUpper);
    const model: RobotModel = { ...old, map, polygon, joints: old.joints.map((j, i) => ({ ...j, lower: lim.lower[i], upper: lim.upper[i] })) };
    ctx.tx.set(r.id, { robot: { ...r.robot!, model } });
    ctx.undoLabel = `Robot parameters: ${r.name}`;
    return { robot: r.name, senses: robotSenses(model), polygon };
  },
});

 
export function kinematicsTable(m: RobotModel, model: "DHM" | "DH"): number[][] {
  const dhm = m.joints.map((j) => [j.alpha / DEG_, j.a, j.theta / DEG_, j.d]);
  if (model === "DHM") return dhm;
   
   
  return dhm.map((row, i) => [row[3], row[2], dhm[i + 1]?.[1] ?? 0, dhm[i + 1]?.[0] ?? 0]);
}

const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6);

defineCommand({
  name: "robot.exportKinematics",
  title: "Export Robot Kinematics",
  description:
    "Robot Parameters ▸ Export Table: the robot's kinematic table as rows of 4 values. model DHM (Denavit Hartenberg Modified: alpha, a, theta, d per joint, deg/mm) or DH (standard Denavit Hartenberg: d, theta, a, alpha; the first DHM row's alpha/a belong to the base). Enginuity robots are nominal (no calibrated kinematics). Returns rows and tab-separated text ('copy data').",
  category: "robot",
  readonly: true,
  undoable: false,
  spec: "B-PANEL-08, D-32, R-KIN-42",
  schema: z.object({ robot: ItemRef, model: z.enum(["DHM", "DH"]).default("DHM") }),
  run(ctx, p) {
    const r = requireRobotItem(ctx.ws, p.robot);
    const rows = kinematicsTable(r.robot!.model, p.model);
    return { robot: r.name, model: p.model, kinematics: "Nominal", rows, text: rows.map((row) => row.map(fmt).join("\t")).join("\n") };
  },
});

defineCommand({
  name: "robot.pasteKinematics",
  title: "Paste Robot Kinematics",
  description:
    "Robot Parameters ▸ Export Table ▸ paste data: replace the robot's DHM table from text, one row of 4 values (alpha, a, theta, d; deg/mm) per joint, separated by spaces, commas, semicolons or tabs. Fails with 'Invalid size: provide a Nx4 matrix of values' when the size does not match.",
  category: "robot",
  spec: "B-PANEL-08, D-32",
  schema: z.object({ robot: ItemRef, text: z.string() }),
  run(ctx, p) {
    const r = requireRobotItem(ctx.ws, p.robot);
    const n = r.robot!.model.joints.length;
    const rows = p.text
      .split(/\r?\n/)
      .map((l) => l.split(/[;,\t ]+/).filter((x) => x !== "").map(Number))
      .filter((row) => row.length);
    if (rows.length !== n || rows.some((row) => row.length !== 4 || row.some((v) => !Number.isFinite(v)))) throw new CommandError(`Invalid size: provide a ${n}x4 matrix of values`);
    const old = r.robot!.model;
    const model: RobotModel = { ...old, joints: old.joints.map((j, i) => ({ ...j, alpha: rows[i][0] * DEG_, a: rows[i][1], theta: rows[i][2] * DEG_, d: rows[i][3] })) };
    ctx.tx.set(r.id, { robot: { ...r.robot!, model } });
    ctx.undoLabel = `Robot parameters: ${r.name}`;
    return { robot: r.name, rows };
  },
});
