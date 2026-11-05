// Creates machining projects and generates robot programs from their paths.
 
 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { bindAction } from "../actions";
import { requireRef } from "../dispatch";
import { objectCurves, objectPoints } from "../curves";
import { MachiningError, planProject, projectLinks } from "../machining/project";
import { mergeParams, ncProjectNames, newMachining, programName, projectName, savedDefaults } from "../machining/settings";
import { NC_EXTENSIONS } from "../machining/nc";
import { surfaceTargetPose } from "../machining/surface";
import { ikClosest } from "../kinematics";
import { inv, mul, type Mat } from "../math";
import { countIn, instructionName } from "../naming";
import { pathTolerances, planOptionsFromSettings } from "../sim/planner";
import { CommandError, defineCommand, ItemRef, Pose, status, type CmdCtx } from "../registry";
import type { InstructionData, Item, MachiningData, MachiningKind } from "../types";
import { absPose, childFrame, firstRobot, listItems, makeItem, toolPose } from "../workspace";
import { projectOnObject } from "./curves";
import { registerFileHandler } from "./files";
import { activeStationId } from "./items";
import { createProgram } from "./programs";
import { createTarget } from "./targets";

type Ctx = Pick<CmdCtx, "ws" | "tx" | "services">;

const rotOnly = (m: Mat, v: number[]) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]];
const translation = (v: number[]): Mat => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];

export const KINDS = ["machining", "curve", "point", "print3d", "weld"] as const;

export function requireProject(ws: CmdCtx["ws"], ref: string | number): Item {
  const it = requireRef(ws, ref, "machining project");
  if (it.type !== "machining") throw new CommandError(`${it.name} is not a machining project`);
  return it;
}

 
export function machiningOf(it: Item): MachiningData {
  return it.machining ?? newMachining("machining", null);
}

function defaultRobot(ws: CmdCtx["ws"]): Item | undefined {
  const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "robot");
  return sel ?? firstRobot(ws, ws.activeStation);
}

 
export function createProject(ctx: Ctx, kind: MachiningKind, opts: { name?: string; robot?: Item | null } = {}): Item {
  const { ws, tx } = ctx;
  const st = activeStationId(ws);
  const robot = opts.robot === undefined ? defaultRobot(ws) ?? null : opts.robot;
  const name = opts.name ?? projectName(kind, countIn(ws, st, ["machining"]) + 1);
   
  const m = newMachining(kind, robot?.id ?? null, {}, savedDefaults(ctx.services.settings?.RC_MACHINING_DEFAULTS));
  const it = makeItem(ws, "machining", name, { machining: m });
  tx.add(it, st);
  tx.setMeta("selection", [it.id]);
  return it;
}

 
export function setProjectInput(ctx: Ctx, project: Item, input: { object?: Item | null; curves?: number[] | null; reversed?: number[] | null; nc?: { file: string; text: string } | null }) {
  const m = machiningOf(project);
  let kind = m.kind;
  if (input.object) {
    const hasCurves = objectCurves(input.object).length > 0;
    const hasPoints = objectPoints(input.object).length > 0;
    if (!hasCurves && !hasPoints) throw new CommandError(`${input.object.name} has no curves or points`);
     
    if (kind !== "weld" && kind !== "point" && hasCurves) kind = "curve";
    else if (kind === "point" && !hasPoints) kind = "curve";
    else if (!hasCurves) kind = "point";
  } else if (input.nc && kind !== "print3d") kind = "machining";
  ctx.tx.set(project.id, {
    machining: {
      ...m,
      kind,
      input: input.nc ? { nc: input.nc } : { object: input.object?.id ?? m.input?.object ?? null, curves: input.curves ?? null, reversed: input.reversed ?? null },
    },
  });
}

 
export function updateProject(ctx: Ctx, project: Item): { program: Item; ok: boolean; ratio: number; message: string; points: number; warnings: string[] } {
  const { ws, tx, services } = ctx;
  const m = machiningOf(ws.items[project.id]);
   
  const current = m.program ? ws.items[m.program] : undefined;
   
  const plan = planProject({ ws, store: services.geometry }, m, {
    programName: current?.type === "program" ? current.name : programName(project.name),
    tolerances: pathTolerances(planOptionsFromSettings(services.settings)),
  });
  const { robot, frame } = projectLinks(ws, m);
  const ref = frame ? absPose(ws, frame.id) : childFrame(ws, robot!.parent);
   
  let prog = m.program ? ws.items[m.program] : undefined;
  if (!prog || prog.type !== "program") {
    const name = programName(project.name);
    const splits = tx.splits.length;
    prog = listItems(ws, { type: "program" }).find((p) => p.name === name) ?? createProgram(ctx, name, robot ?? undefined);
     
    tx.splits.length = splits;
  }
  if (prog.program?.robot !== robot?.id) tx.set(prog.id, { program: { ...prog.program, robot: robot?.id ?? null } });
  for (const c of [...ws.items[prog.id].children].reverse()) tx.remove(c);
  let n = 0;
  for (const it of plan.items) {
    let data: InstructionData;
    let name: string | null = null;
    if (it.type === "ins") data = it.data;
    else if (it.type === "movec") {
       
      n += 1;
      data = { kind: "movec", moveType: "circular", target: null, target2: null, pose: mul(ref, it.via.pose), pose2: mul(ref, it.end.pose), index: n };
      name = `MoveC ${n}`;
    } else {
      n += 1;
      data = { kind: "move", moveType: it.move.kind === "joint" ? "joint" : "linear", pose: mul(ref, it.move.pose), ...(it.move.joints ? { joints: it.move.joints } : {}), index: n };
    }
    tx.add(makeItem(ws, "instruction", name ?? instructionName(ws, data), { instruction: data }), prog.id);
  }
  tx.set(project.id, {
    machining: {
      ...m,
      program: prog.id,
      result: { ok: plan.ok, ratio: plan.ratio, message: plan.message, points: plan.points },
      toolpath: plan.toolpath,
    },
  });
  return { program: ws.items[prog.id], ok: plan.ok, ratio: plan.ratio, message: plan.message, points: plan.points, warnings: plan.warnings };
}

const asError = (e: unknown) => (e instanceof MachiningError ? new CommandError(e.message) : e);

function resultOf(r: ReturnType<typeof updateProject>) {
  return { program: r.program.name, programId: r.program.id, ok: r.ok, ratio: r.ratio, message: r.message, points: r.points, warnings: r.warnings };
}

defineCommand({
  name: "machining.add",
  title: "New Machining Project",
  description:
    "Create a robot machining (G-code/APT), curve follow, point follow, 3D printing or welding project ('Machining1 settings', 'Path1 settings', 'Point settings', 'Print3D settings', 'Weld1 settings') linked to a robot. Give `object` to use its curves (curve follow / welding) or points (point follow) and compute the program at once, or `ncText` + `fileName` for G-code/APT.",
  category: "tools",
  spec: "B-UTIL-05..09, R-SLF-38",
  schema: z.object({
    kind: z.enum(KINDS).default("machining"),
    name: z.string().optional(),
    robot: ItemRef.optional(),
    object: ItemRef.optional().describe("object holding the curves or points to follow"),
    curves: z.array(z.number().int().min(0)).optional().describe("curve indices (default: all curves of the object)"),
    ncText: z.string().optional().describe("NC program (G-code or APT) for machining / 3D printing projects"),
    fileName: z.string().optional().describe("NC file name (its extension tells G-code from APT)"),
  }),
  run(ctx, p) {
    const robot = p.robot !== undefined ? requireRef(ctx.ws, p.robot, "robot") : undefined;
    if (robot && robot.type !== "robot") throw new CommandError(`${robot.name} is not a robot`);
    const proj = createProject(ctx, p.kind, { name: p.name, robot: robot ?? undefined });
    ctx.undoLabel = `Add: ${proj.name}`;
    if (p.object === undefined && p.ncText === undefined) return { id: proj.id, name: proj.name, handle: proj.handle, kind: p.kind };
    const object = p.object !== undefined ? requireRef(ctx.ws, p.object, "object") : null;
    setProjectInput(ctx, ctx.ws.items[proj.id], { object, curves: p.curves ?? null, nc: p.ncText !== undefined ? { file: p.fileName ?? "program.nc", text: p.ncText } : null });
    try {
      const r = updateProject(ctx, ctx.ws.items[proj.id]);
      return { id: proj.id, name: ctx.ws.items[proj.id].name, handle: proj.handle, kind: ctx.ws.items[proj.id].machining!.kind, ...resultOf(r) };
    } catch (e) {
      throw asError(e);
    }
  },
});

defineCommand({
  name: "machining.setInput",
  title: "Project Input",
  description:
    "Select what a project follows: an object's curves (curve follow; optional curve indices and reversed curves) or points (point follow), or an NC program (G-code / APT text). Recomputes the program when the project's Auto Update is on.",
  category: "tools",
  schema: z.object({
    project: ItemRef,
    object: ItemRef.optional(),
    curves: z.array(z.number().int().min(0)).optional(),
    reversed: z.array(z.number().int().min(0)).optional(),
    ncText: z.string().optional(),
    fileName: z.string().optional(),
  }),
  run(ctx, p) {
    const proj = requireProject(ctx.ws, p.project);
    const object = p.object !== undefined ? requireRef(ctx.ws, p.object, "object") : null;
    if (!object && p.ncText === undefined) throw new CommandError("Select an APT file, curve or points");
    setProjectInput(ctx, proj, { object, curves: p.curves ?? null, reversed: p.reversed ?? null, nc: p.ncText !== undefined ? { file: p.fileName ?? "program.nc", text: p.ncText } : null });
    ctx.undoLabel = `Modify: ${proj.name}`;
    if (machiningOf(ctx.ws.items[proj.id]).settings.AutoUpdate) {
      try {
        return { updated: true, ...resultOf(updateProject(ctx, ctx.ws.items[proj.id])) };
      } catch (e) {
        throw asError(e);
      }
    }
    return { updated: false };
  },
});

defineCommand({
  name: "machining.update",
  title: "Update Program",
  description: "Solve a project's tool path (orientation search within RotZ_Range/RotZ_Step, approach/retract, events) and regenerate its program. Returns the reachable ratio and the project's result message.",
  category: "tools",
  spec: "R-SLF-38 (Update)",
  schema: z.object({ project: ItemRef }),
  run(ctx, p) {
    const proj = requireProject(ctx.ws, p.project);
    try {
      const r = updateProject(ctx, proj);
      ctx.undoLabel = `Update: ${r.program.name}`;
      return resultOf(r);
    } catch (e) {
      throw asError(e);
    }
  },
});

defineCommand({
  name: "machining.updateAll",
  title: "Update Robot Machining projects",
  description:
    "Recompute the selected machining projects, or every project in the station (Utilities ▸ Update Robot Machining projects, Ctrl+U). Returns a per-program Success/FAILED report; 'No machining projects found.' when there are none.",
  category: "tools",
  shortcut: "Ctrl+U",
  spec: "B-UTIL-10",
  schema: z.object({ projects: z.array(ItemRef).optional() }),
  run(ctx, p) {
    const { ws } = ctx;
    const sel = p.projects?.map((r) => requireProject(ws, r)) ?? ws.selection.map((s) => ws.items[s]).filter((i): i is Item => i?.type === "machining");
    const list = sel.length ? sel : listItems(ws, { type: "machining" });
    if (!list.length) {
      status(ctx, "No machining projects found.");
      ctx.undoLabel = null;
      return { results: [], report: "", title: null };
    }
    const results: { project: string; program: string; ok: boolean; message: string }[] = [];
    for (const proj of list) {
      try {
        const r = updateProject(ctx, ws.items[proj.id]);
        results.push({ project: proj.name, program: r.program.name, ok: r.ok, message: r.message });
      } catch (e) {
        results.push({ project: proj.name, program: programName(proj.name), ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    const report = results.map((r) => `Program: ${r.program} -> ${r.ok ? "Success" : "FAILED"}<br>`).join("");
    ctx.undoLabel = "Update Robot Machining projects";
    return { results, report, title: results.every((r) => r.ok) ? "Success" : "Warning" };
  },
});

const Json = z.union([z.string(), z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]))]);

defineCommand({
  name: "machining.setParams",
  title: "Project Settings",
  description:
    "Change a project's settings like the API's setParam: `machining` (JSON keys such as SpeedOperation, SpeedRapid, RotZ_Range, RotZ_Step, Algorithm, OrientXaxis_X/Y/Z, ApproachRetractAll, JoinCurvesTol, PointApproach, AvoidCollisions, AutoUpdate, VisibleNormals, PathDisplay, weld offsets), `progEvents` (CallProgStart/CallPathStart/…On, RoundingOn, Rounding, SpindleRPM, ToolChange, Extruder, Mcode…), `optimAxes`, approach / retract ('Normal 100', 'Tangent 50', 'Side 20', 'XYZ x y z', 'AbsXYZ x y z', 'NTS n t s', 'RotXYZ rx ry rz', 'ArcN d deg', 'ArcS d deg', 'ArcRotN d deg', 'ArcRotS d deg' with d the arc diameter, chained with ';' from the path outwards), robot, reference frame, tool and the path-to-tool pose. Recomputes when Auto Update is on.",
  category: "tools",
  schema: z.object({
    project: ItemRef,
    machining: Json.optional(),
    progEvents: Json.optional(),
    optimAxes: Json.optional(),
    approach: z.string().optional(),
    retract: z.string().optional(),
    approachRetract: z.string().optional(),
    robot: ItemRef.nullable().optional(),
    frame: ItemRef.nullable().optional(),
    tool: ItemRef.nullable().optional(),
    pathToTool: Pose.optional(),
    name: z.string().optional(),
    update: z.boolean().optional().describe("recompute now (default: when Auto Update is on and the project has an input)"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const proj = requireProject(ws, p.project);
    const m = machiningOf(proj);
    const ref = (r: string | number | null | undefined, type: Item["type"]) => {
      if (r === undefined) return undefined;
      if (r === null) return null;
      const it = requireRef(ws, r, type);
      if (it.type !== type) throw new CommandError(`${it.name} is not a ${type}`);
      return it.id;
    };
    const next: MachiningData = {
      ...m,
      settings: p.machining !== undefined ? mergeParams(m.settings, p.machining) : m.settings,
      events: p.progEvents !== undefined ? mergeParams(m.events, p.progEvents) : m.events,
      optimAxes: p.optimAxes !== undefined ? mergeParams(m.optimAxes, p.optimAxes) : m.optimAxes,
      approach: p.approachRetract ?? p.approach ?? m.approach,
      retract: p.approachRetract ?? p.retract ?? m.retract,
      robot: ref(p.robot, "robot") === undefined ? m.robot : ref(p.robot, "robot")!,
      frame: ref(p.frame, "frame") === undefined ? m.frame : ref(p.frame, "frame")!,
      tool: ref(p.tool, "tool") === undefined ? m.tool : ref(p.tool, "tool")!,
      pathToTool: p.pathToTool ?? m.pathToTool,
    };
    tx.set(proj.id, { machining: next, ...(p.name !== undefined ? { name: p.name } : {}) });
    ctx.undoLabel = `Modify: ${proj.name}`;
    const auto = p.update ?? (Number(next.settings.AutoUpdate) !== 0 && !!next.input);
    if (!auto) return { updated: false };
    try {
      return { updated: true, ...resultOf(updateProject(ctx, ws.items[proj.id])) };
    } catch (e) {
      throw asError(e);
    }
  },
});

defineCommand({
  name: "machining.get",
  title: "Project Settings (read)",
  description: "Read a project's kind, robot/frame/tool, settings (Machining, ProgEvents, OptimAxes), approach/retract, input, generated program and last result.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ project: ItemRef }),
  run({ ws }, p) {
    const proj = requireProject(ws, p.project);
    const m = machiningOf(proj);
    const name = (id: string | null | undefined) => (id && ws.items[id] ? ws.items[id].name : null);
    const { robot, frame, tool } = projectLinks(ws, m);
    return {
      name: proj.name,
      kind: m.kind,
      robot: robot?.name ?? null,
      frame: frame?.name ?? null,
      tool: tool?.name ?? null,
      machining: m.settings,
      progEvents: m.events,
      optimAxes: m.optimAxes,
      approach: m.approach,
      retract: m.retract,
      input: m.input ? { object: name(m.input.object ?? null), curves: m.input.curves ?? null, reversed: m.input.reversed ?? null, nc: m.input.nc ? m.input.nc.file : null } : null,
      program: name(m.program),
      result: m.result ?? null,
      pathToTool: m.pathToTool ?? null,
    };
  },
});

defineCommand({
  name: "machining.copySettings",
  title: "Copy Project Settings",
  description: "Copy settings between projects (project menu ▸ More options ▸ Copy/Paste Settings, Copy/Paste Approach/Retract, Copy/Paste Program Events).",
  category: "tools",
  schema: z.object({ from: ItemRef, to: z.array(ItemRef).min(1), what: z.enum(["settings", "approach", "events"]).default("settings") }),
  run(ctx, p) {
    const src = machiningOf(requireProject(ctx.ws, p.from));
    const names: string[] = [];
    for (const r of p.to) {
      const dst = requireProject(ctx.ws, r);
      const m = machiningOf(dst);
      const next =
        p.what === "settings" ? { ...m, settings: { ...src.settings }, optimAxes: { ...src.optimAxes } } : p.what === "approach" ? { ...m, approach: src.approach, retract: src.retract } : { ...m, events: { ...src.events } };
      ctx.tx.set(dst.id, { machining: next });
      names.push(dst.name);
    }
    status(ctx, `Pasted robot machining settings to: ${names.join(", ")}`);
    ctx.undoLabel = `Paste settings: ${names.join(", ")}`;
    return { pasted: names };
  },
});

defineCommand({
  name: "machining.setDefaults",
  title: "Set Default Project Settings",
  description:
    "Use this project's settings for new projects (project menu ▸ More options ▸ Set Defaults: path settings, approach and retract; `what: 'events'` is Set Default Program Events). `reset` returns to the factory defaults.",
  category: "tools",
  undoable: false,
  schema: z.object({ project: ItemRef.optional(), what: z.enum(["settings", "events"]).default("settings"), reset: z.boolean().default(false) }),
  run(ctx, p) {
    if (!ctx.services.setSetting) throw new CommandError("Defaults can only be changed on the server");
    if (p.reset) {
      ctx.services.setSetting("RC_MACHINING_DEFAULTS", "");
      return { reset: true };
    }
    if (p.project === undefined) throw new CommandError("Select a project");
    const m = machiningOf(requireProject(ctx.ws, p.project));
    const saved = savedDefaults(ctx.services.settings.RC_MACHINING_DEFAULTS);
    const next = p.what === "events" ? { ...saved, progEvents: m.events } : { ...saved, machining: m.settings, approach: m.approach, retract: m.retract };
    ctx.services.setSetting("RC_MACHINING_DEFAULTS", JSON.stringify(next));
    return { saved: p.what };
  },
});

 





export function openNcProgram(ctx: Ctx, file: { name: string; text: string }, opts: { kind?: MachiningKind; robot?: Item | null } = {}) {
  const { ws } = ctx;
  const names = ncProjectNames(file.name);
  let proj = listItems(ws, { type: "machining" }).find((it) => it.name === names.project);
  if (!proj) proj = createProject(ctx, opts.kind ?? "machining", { name: names.project, robot: opts.robot });
  else ctx.tx.setMeta("selection", [proj.id]);
  setProjectInput(ctx, ws.items[proj.id], { nc: { file: file.name, text: file.text } });
  if (opts.kind === "print3d") ctx.tx.set(proj.id, { machining: { ...machiningOf(ws.items[proj.id]), kind: "print3d" } });
   
  if (!machiningOf(ws.items[proj.id]).program) {
    const existing = listItems(ws, { type: "program" }).find((p) => p.name === names.program);
    if (existing) ctx.tx.set(proj.id, { machining: { ...machiningOf(ws.items[proj.id]), program: existing.id } });
  }
  try {
    const r = updateProject(ctx, ws.items[proj.id]);
    status(ctx, r.ok ? `Robot program updated successfully with toolpath ${r.program.name}` : `Problems generating robot program for ${r.program.name}`);
    return { project: ws.items[proj.id].name, projectId: proj.id, ...resultOf(r) };
  } catch (e) {
    status(ctx, `Problems generating robot program for ${names.program}`);
    throw asError(e);
  }
}

defineCommand({
  name: "machining.openNc",
  title: "Load NC Machining Program",
  description:
    "Load a G-code or APT program as a robot machining project (or a 3D printing project with kind 'print3d'): creates or updates '<file> Settings' and regenerates the program '<file>'. G0 moves run at the rapid speed, feeds become Set Speed instructions, spindle/tool/M-code/extruder words become program calls.",
  category: "tools",
  spec: "B-UTIL-05, B-UTIL-09",
  schema: z.object({ fileName: z.string(), text: z.string(), kind: z.enum(["machining", "print3d"]).default("machining"), robot: ItemRef.optional() }),
  run(ctx, p) {
    const robot = p.robot !== undefined ? requireRef(ctx.ws, p.robot, "robot") : undefined;
    const r = openNcProgram(ctx, { name: p.fileName, text: p.text }, { kind: p.kind, robot: robot ?? undefined });
    ctx.undoLabel = `Load NC program: ${p.fileName}`;
    return r;
  },
});

registerFileHandler(NC_EXTENSIONS, (ctx, file) => openNcProgram(ctx, { name: file.name, text: new TextDecoder().decode(file.bytes) }));

 







defineCommand({
  name: "target.teachOnSurface",
  title: "Teach Target(s) on Surface",
  description:
    "Create a target on an object's surface (Program ▸ Teach Target(s) on Surface, Ctrl+Shift+T): give a point and its outward surface normal in absolute coordinates (or a point on `object`, projected onto it). Mode 'normal' keeps the tool Z axis normal to the surface, 'constant' keeps the robot's current tool orientation; rotX/rotY/rotZ rotate about the tool axes (deg). The robot moves to the closest solution and the target is taught there (robot's active reference frame, with joints); an unreachable point creates nothing and the robot stays (reachable: false).",
  category: "target",
  spec: "B-PROG-04",
  shortcut: "Ctrl+Shift+T",
  schema: z.object({
    point: z.array(z.number()).length(3),
    normal: z.array(z.number()).length(3).optional(),
    object: ItemRef.optional().describe("object to project the point onto (normal recalculated from its surface)"),
    robot: ItemRef.optional(),
    mode: z.enum(["normal", "constant"]).default("normal"),
    rotX: z.number().default(0),
    rotY: z.number().default(0),
    rotZ: z.number().default(0),
    name: z.string().optional(),
  }),
  run(ctx, p) {
    const { ws } = ctx;
    const robot = p.robot !== undefined ? requireRef(ws, p.robot, "robot") : defaultRobot(ws);
    if (!robot?.robot) throw new CommandError("Select a robot first");
    let point = p.point;
    let normal = p.normal ?? [0, 0, 1];
    if (p.object !== undefined) {
      const obj = requireRef(ws, p.object, "object");
      const parentAbs = childFrame(ws, obj.parent);
      const toParent = inv(parentAbs);
      const inParent = mul(toParent, translation(point));
      const proj = projectOnObject(ctx, obj.id, [[inParent[3], inParent[7], inParent[11], ...(p.normal ? rotOnly(toParent, normal) : [0, 0, 1])]], p.normal ? 3 : 4)[0];
      const abs = mul(parentAbs, translation(proj));
      point = [abs[3], abs[7], abs[11]];
      normal = rotOnly(parentAbs, [proj[3], proj[4], proj[5]]);
    }
    const pose = surfaceTargetPose(ws, robot, point, normal, p.mode, [p.rotX, p.rotY, p.rotZ]);
    const flange = mul(mul(inv(absPose(ws, robot.id)), pose), inv(toolPose(ws, robot.id)));
    const joints = ikClosest(robot.robot.model, flange, robot.robot.joints);
     
    if (!joints) return { reachable: false };
     
    ctx.tx.set(robot.id, { robot: { ...robot.robot, joints } });
    ctx.tx.split(`Move robot: ${robot.name}`);
    const t = createTarget(ctx, robot, { name: p.name, pose, absolute: true, joints });
    ctx.tx.setMeta("selection", [t.id]);
    ctx.undoLabel = null;
    return { id: t.id, name: t.name, reachable: true, joints: t.target?.joints ?? [] };
  },
});



 

 
function selectedSource(ws: CmdCtx["ws"], what: "curves" | "points"): string | undefined {
  for (const id of ws.selection) {
    const it = ws.items[id];
    if (it?.type === "object" && (what === "curves" ? objectCurves(it).length : objectPoints(it).length)) return it.id;
  }
  return undefined;
}

bindAction("action-MachiningProject", { command: "machining.add", params: { kind: "machining" } });
bindAction("actionCurveProject", { command: "machining.add", params: (ws) => ({ kind: "curve", ...(selectedSource(ws, "curves") ? { object: selectedSource(ws, "curves") } : {}) }) });
bindAction("actionPointProject", { command: "machining.add", params: (ws) => ({ kind: "point", ...(selectedSource(ws, "points") ? { object: selectedSource(ws, "points") } : {}) }) });
bindAction("action3D_print_project", { command: "machining.add", params: { kind: "print3d" } });
bindAction("actionRobotWeldingProject", { command: "machining.add", params: (ws) => ({ kind: "weld", ...(selectedSource(ws, "curves") ? { object: selectedSource(ws, "curves") } : {}) }) });
bindAction("actionUpdate_all_Machining_projects", { command: "machining.updateAll", params: {} });
 
bindAction("actionImport_points", { ui: true });
bindAction("actionImport_curve", { ui: true });
bindAction("actionCurveCreate", { ui: true });
bindAction("actionCurveModify", { ui: true });
bindAction("actionTeach_Target_on_Surface", { ui: true });
