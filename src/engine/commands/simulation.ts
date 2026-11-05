// Registers program playback, simulated robot motion, events and collision controls.
import { z } from "zod";
import { checkCollisions } from "../collision";
import { requireRef } from "../dispatch";
import { clampJoints, fk } from "../kinematics";
import { inv, mul, type Mat } from "../math";
import { ioDisplayName } from "../naming";
import { CommandError, defineCommand, getCommand, ItemRef, status } from "../registry";
import { conveyorGoal, conveyorOf, createCopies, liveAbsPose, liveChildFrame, similarObjects, waitStep, type LiveJoints } from "../sim/events";
import { jointsAt, planProgram } from "../sim/planner";
import { formatProgramTime } from "../sim/timefmt";
import { setStationParam } from "../stationParams";
import { jointsByItem } from "../sync/axes";
import type { Item, Workspace } from "../types";
import type { Tx } from "../tx";
import { descendants, listItems, stationOf } from "../workspace";
import { activeStationId } from "./items";
import { requireRobot } from "./robot";
import { jointsForTarget, tcpIn } from "./targets";

 
export function programToRun(ws: Workspace, ref: string | number | undefined): Item {
  if (ref !== undefined) {
    const it = requireRef(ws, ref, "program");
    if (it.type !== "program") throw new CommandError(`${it.name} is not a program`);
    return it;
  }
  const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "program" || i?.type === "instruction");
  if (sel?.type === "program") return sel;
  if (sel?.type === "instruction" && sel.parent) return ws.items[sel.parent];
  const progs = listItems(ws, { type: "program" });
  if (progs.length === 1) return progs[0];
  throw new CommandError(progs.length ? "Select a program to run" : "No program to run", progs.length ? "pick_program" : "command_failed");
}

defineCommand({
  name: "program.run",
  title: "Run Program",
  description:
    "Simulate a program (Ctrl+R / double-click). Returns immediately with the number of valid instructions; the simulation runs at the current speed ratio. Pauses scale with the ratio, Pause ≤ 0 asks to continue, messages go to the status bar, calls run synchronously and threads in parallel.",
  category: "simulation",
  shortcut: "Ctrl+R",
  undoable: false,
  spec: "R-PROG-33..43",
  schema: z.object({ program: ItemRef.optional(), loop: z.boolean().optional(), startAt: z.number().int().min(0).optional() }),
  run({ ws, services }, p) {
    const prog = programToRun(ws, p.program);
    if (!services.runner) throw new CommandError("Simulation is only available on the server");
    const plan = planProgram(ws, prog.id);
    services.runner.start(prog.id, { loop: p.loop ?? prog.params?.Loop === "1", startAt: p.startAt ?? 0 });
    return { program: prog.name, instructions: plan.validInstructions, time: plan.duration, ok: plan.ok };
  },
});

defineCommand({
  name: "sim.status",
  title: "Simulation Status",
  description: "Whether programs or robots are still running (Busy), the main running program, pause state and simulation speed ratio.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-33",
  schema: z.object({}),
  run({ ws }) {
    const busy = ws.busy ?? [];
    return {
      busy: busy.map((id) => ({ id, name: ws.items[id]?.name, type: ws.items[id]?.type })),
      running: ws.running ? ws.items[ws.running.program]?.name ?? null : null,
      paused: !!ws.paused,
      ratio: ws.simulationSpeed,
    };
  },
});

defineCommand({
  name: "program.setLoop",
  title: "Loop",
  description: "Set a program to loop: it restarts at its first instruction after finishing until stopped (program command Loop 1/0).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-43",
  schema: z.object({ program: ItemRef, loop: z.boolean() }),
  run({ ws, tx }, p) {
    const prog = requireRef(ws, p.program, "program");
    tx.set(prog.id, { params: { ...(prog.params ?? {}), Loop: p.loop ? "1" : "0" } });
    return { loop: p.loop };
  },
});

defineCommand({
  name: "sim.stop",
  title: "Stop",
  description: "Stop all running programs and robot movements; robots stay where they are (Escape).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-41",
  schema: z.object({}),
  run({ ws, services }) {
    const was = (ws.busy?.length ?? 0) > 0 || !!ws.running;
    services.runner?.stopAll();
    return { stopped: was };
  },
});

defineCommand({
  name: "sim.pause",
  title: "Pause Program",
  description: "Freeze running programs (Backspace); invoking it again resumes them.",
  category: "simulation",
  shortcut: "Backspace",
  undoable: false,
  spec: "R-PROG-42",
  schema: z.object({ paused: z.boolean().optional() }),
  run({ ws, tx }, p) {
    const v = p.paused ?? !ws.paused;
    tx.setMeta("paused", v);
    return { paused: v };
  },
});

 
export function clampRatio(v: number): number {
  if (!(v >= 0.001)) return 0;
  return Math.round(v * 1000) / 1000;
}

defineCommand({
  name: "sim.setSpeed",
  title: "Simulation Speed",
  description: "Set the simulation time ratio (1 = real time, the default normal speed; fast 100).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-44",
  schema: z.object({ factor: z.number().max(100000) }),
  run(ctx, p) {
    const v = clampRatio(p.factor);
    ctx.tx.setMeta("simulationSpeed", v);
    status(ctx, `Simulation speed ratio set to: ${v}`);
    return { factor: v };
  },
});

defineCommand({
  name: "sim.fastToggle",
  title: "Fast Simulation",
  description: "Toggle between the normal (5) and fast (100) simulation ratios (Space). A custom ratio switches to fast.",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-44, R-IM-7",
  schema: z.object({}),
  run(ctx) {
    const { ws, tx, services } = ctx;
    const fast = Number(services.settings.SimRatioFast ?? 100);
    const normal = Number(services.settings.SimRatioNormal ?? 5);
    const v = ws.simulationSpeed === fast ? normal : fast;
    tx.setMeta("simulationSpeed", v);
    if (ws.paused) tx.setMeta("paused", false);
    status(ctx, `Current simulation speed ratio: ${v.toFixed(1)}`);
    return { factor: v, fast: v === fast };
  },
});

 

defineCommand({
  name: "sim.setBusy",
  title: "Program State",
  description: "Internal: mark a program as running or finished.",
  internal: true,
  category: "simulation",
  undoable: false,
  schema: z.object({ program: z.string(), busy: z.boolean(), main: z.boolean().default(false) }),
  run({ ws, tx }, p) {
    const busy = new Set(ws.busy ?? []);
    if (p.busy) busy.add(p.program);
    else busy.delete(p.program);
    tx.setMeta("busy", [...busy]);
    if (p.main) tx.setMeta("running", p.busy ? { program: p.program, startedAt: Date.now(), duration: 0 } : null);
    if (!busy.size && ws.paused) tx.setMeta("paused", false);
    return { busy: [...busy] };
  },
});

defineCommand({
  name: "sim.setJoints",
  title: "Robot Joints (simulation)",
  description: "Internal: commit robot joints reached by a simulated motion (no clamping, no undo).",
  internal: true,
  category: "simulation",
  undoable: false,
  schema: z.object({ robot: z.string(), joints: z.array(z.number()) }),
  run({ ws, tx }, p) {
    const r = ws.items[p.robot];
    if (!r?.robot) return null;
     
    for (const [id, q] of jointsByItem(ws, r.id, p.joints)) tx.set(id, { robot: { ...ws.items[id].robot!, joints: q.slice() } });
    return { joints: p.joints };
  },
});

defineCommand({
  name: "sim.robotState",
  title: "Robot State (simulation)",
  description: "Internal: speed/rounding/frame/tool changes executed by a running program (they persist, R-PROG-17).",
  internal: true,
  category: "simulation",
  undoable: false,
  schema: z.object({
    robot: z.string(),
    speed: z.object({ linear: z.number(), joint: z.number(), linearAccel: z.number(), jointAccel: z.number() }).optional(),
    rounding: z.number().optional(),
    frame: z.string().nullable().optional(),
    tool: z.string().nullable().optional(),
     
    framePose: z.array(z.number()).length(16).nullable().optional(),
    toolPose: z.array(z.number()).length(16).nullable().optional(),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const r = ws.items[p.robot];
    if (!r?.robot) return null;
    const rd = { ...r.robot };
    if (p.speed) {
      const s = { ...rd.speeds };
      if (p.speed.linear >= 0) s.linear = p.speed.linear;
      if (p.speed.joint >= 0) s.joint = p.speed.joint;
      if (p.speed.linearAccel >= 0) s.linearAccel = p.speed.linearAccel;
      if (p.speed.jointAccel >= 0) s.jointAccel = p.speed.jointAccel;
      if (s.linear < 0.1) {
        status(ctx, "Robot speed is invalid (too small or zero).");
        s.linear = 2000;
      }
      rd.speeds = s;
    }
    if (p.rounding !== undefined) rd.rounding = p.rounding;
    if (p.frame !== undefined) {
      rd.activeFrame = p.frame;
      rd.framePose = null;
    }
    if (p.tool !== undefined) {
      rd.activeTool = p.tool;
      rd.tcp = null;
    }
    if (p.framePose !== undefined) rd.framePose = p.framePose;
    if (p.toolPose !== undefined) rd.tcp = p.toolPose;
    tx.set(r.id, { robot: rd });
    return { ok: true };
  },
});

 
 
function reparentKeep(ws: Workspace, tx: Tx, it: Item, parentId: string, live?: LiveJoints) {
  reparentTo(ws, tx, it, parentId, mul(inv(liveChildFrame(ws, parentId, live)), liveAbsPose(ws, it.id, live)));
}

 
function reparentTo(ws: Workspace, tx: Tx, it: Item, parentId: string, pose: Mat) {
  if (it.parent !== parentId) {
    if (it.parent && ws.items[it.parent]) tx.set(it.parent, { children: ws.items[it.parent].children.filter((c) => c !== it.id) });
    tx.set(parentId, { children: [...ws.items[parentId].children.filter((c) => c !== it.id), it.id] });
    tx.set(it.id, { parent: parentId });
  }
  tx.set(it.id, { pose });
}

 
function underItem(ws: Workspace, id: string, root: string): boolean {
  for (let cur: string | null = id; cur; cur = ws.items[cur]?.parent ?? null) if (cur === root) return true;
  return false;
}

 
function originDistance(ws: Workspace, it: Item, tcp: Mat, live?: LiveJoints): number {
  const a = liveAbsPose(ws, it.id, live);
  return Math.hypot(a[3] - tcp[3], a[7] - tcp[7], a[11] - tcp[11]);
}

 
function geometryDistance(ws: Workspace, geometry: { get(id: string): Float32Array | undefined }, it: Item, tcp: Mat, live?: LiveJoints): number {
  const local = mul(inv(liveAbsPose(ws, it.id, live)), tcp);
  const p = [local[3], local[7], local[11]];
  let best = Infinity;
  for (const m of it.object?.meshes ?? []) {
    const tri = geometry.get(m.geometry);
    if (!tri) continue;
    for (let i = 0; i + 8 < tri.length; i += 9) best = Math.min(best, pointTriangle(p, tri, i));
  }
  return Number.isFinite(best) ? best : originDistance(ws, it, tcp, live);
}

 
function pointTriangle(p: number[], t: Float32Array, i: number): number {
  const a = [t[i], t[i + 1], t[i + 2]];
  const ab = [t[i + 3] - a[0], t[i + 4] - a[1], t[i + 5] - a[2]];
  const ac = [t[i + 6] - a[0], t[i + 7] - a[1], t[i + 8] - a[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (v: number, w: number) => Math.hypot(a[0] + ab[0] * v + ac[0] * w - p[0], a[1] + ab[1] * v + ac[1] * w - p[1], a[2] + ab[2] * v + ac[2] * w - p[2]);
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(0, 0);
  const bp = [ap[0] - ab[0], ap[1] - ab[1], ap[2] - ab[2]];
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = [ap[0] - ac[0], ap[1] - ac[1], ap[2] - ac[2]];
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return at(1 - w, w);
  }
  const den = 1 / (va + vb + vc);
  return at(vb * den, vc * den);
}

 
type EventPositions = { positions?: { item: string; parent: string | null; pose: Mat }[]; relative?: boolean };







defineCommand({
  name: "sim.event",
  title: "Simulation Event",
  description:
    "Internal: execute a simulation event instruction (attach/detach/show/hide/tmp/xxxx position, create objects, remove objects, one poll of wait for object, the goal of move conveyor; the runner animates conveyor moves and repeats the wait polls).",
  internal: true,
  category: "simulation",
  undoable: false,
  schema: z.object({
    robot: z.string().nullable(),
    instruction: z.string(),
     
    live: z.record(z.string(), z.array(z.number())).optional(),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const ins = ws.items[p.instruction]?.instruction;
    const ev = ins?.event;
    if (!ev) return null;
    const live = p.live;
    const robot = p.robot ? ws.items[p.robot] : undefined;
    const st = activeStationId(ws);
    if (ev.action === "create") {
       
      const made = createCopies(ws, tx, ev, live);
      return { created: made.map((c) => c.name), ids: made.map((c) => c.id) };
    }
    if (ev.action === "remove") {
       
      const gone = similarObjects(ws, ctx.services.geometry, ev, stationOf(ws, p.instruction)?.id ?? st);
      for (const it of gone) if (ws.items[it.id]) tx.remove(it.id);
      if (gone.length) tx.setMeta("selection", ws.selection.filter((s) => ws.items[s]));
      return { removed: gone.map((it) => it.name) };
    }
    if (ev.action === "wait") {
       
      const step = waitStep(ws, tx, ctx.services.geometry, ev, live);
      if (step.removed) tx.setMeta("selection", ws.selection.filter((s) => ws.items[s]));
      return step;
    }
    if (ev.action === "conveyor") {
       
      const mech = conveyorOf(ws, ev);
      if (!mech) return { mechanism: null };
      const start = live?.[mech.id] ?? mech.robot!.joints;
      return { mechanism: mech.id, start, goal: conveyorGoal(start, ev.distance ?? 200) };
    }
    const objs = (ev.objects ?? (ev.object ? [ev.object] : [])).map((id) => ws.items[id]).filter(Boolean) as Item[];
    if (ev.action === "attach" || ev.action === "detach" || ev.action === "detach-all") {
      const toolId = ev.tool ?? robot?.robot?.activeTool ?? null;
      const tool = toolId ? ws.items[toolId] : undefined;
      if (!tool) {
        status(ctx, "Tool to attach has been deleted, select another tool");
        return null;
      }
      if (ev.action === "attach") {
         
         
         
         
        const holder = tool.parent ? ws.items[tool.parent] : undefined;
        const tcp = holder?.robot ? mul(mul(liveAbsPose(ws, holder.id, live), fk(holder.robot.model, live?.[holder.id] ?? holder.robot.joints)), tool.pose) : liveAbsPose(ws, tool.id, live);
        const option = ev.option ?? 0;
        const reach = option === 0 ? 200 : ev.distance ?? 200;
        const pool = option >= 3 ? objs : descendants(ws, st);
        let best: { it: Item; d: number } | null = null;
        for (const it of pool) {
           
          if (it.type !== "object" || it.locked || ws.items[it.parent ?? ""]?.type === "tool") continue;
          const d = option === 2 || option === 4 ? geometryDistance(ws, ctx.services.geometry, it, tcp, live) : originDistance(ws, it, tcp, live);
          if (d < reach && (!best || d < best.d)) best = { it, d };
        }
        if (!best) {
          status(ctx, `No object is close enough to attach to ${tool.name}`);
          return null;
        }
        reparentKeep(ws, tx, best.it, tool.id, live);
        return { attached: best.it.name };
      }
      const dest = ev.frame && ws.items[ev.frame] ? ev.frame : st;
      const moved: string[] = [];
      for (const c of tool.children.slice()) {
        const it = ws.items[c];
        if (it?.type !== "object") continue;
        reparentKeep(ws, tx, it, dest, live);
        moved.push(it.name);
      }
      return { detached: moved };
    }
    if (ev.action === "show" || ev.action === "hide") {
      for (const o of objs) tx.set(o.id, { visible: ev.action === "show" });
      return { ok: true };
    }
    if (ev.action === "home") {
       
      for (const m of objs) if (m.robot) tx.set(m.id, { robot: { ...m.robot, joints: m.robot.home.slice() } });
      return { ok: true };
    }
    if (ev.action === "move") {
       
       
       
       
      const { positions = [], relative = false } = ev as EventPositions;
      const moved: string[] = [];
      for (const pos of positions) {
        const it = ws.items[pos.item];
         
        if (!it || it.type === "station") continue;
        const recorded = pos.parent && ws.items[pos.parent] && !underItem(ws, pos.parent, it.id) ? pos.parent : null;
        const parent = recorded ?? it.parent ?? st;
        const local = relative ? pos.pose : mul(inv(liveChildFrame(ws, parent, live)), pos.pose);
        if (parent !== it.parent) reparentTo(ws, tx, it, parent, local);
        else tx.set(it.id, { pose: local });
        moved.push(it.name);
      }
      return { moved };
    }
    return null;
  },
});

defineCommand({
  name: "station.setIO",
  title: "Set IO",
  description: "Internal: Set DO/AO from a simulated program — stores a station parameter named like the displayed IO (IO_<n>, AO_<n> or the literal name).",
  internal: true,
  category: "simulation",
  undoable: false,
  spec: "R-PROG-39",
  schema: z.object({ name: z.string(), value: z.string(), analog: z.boolean().optional() }),
  run({ ws, tx }, p) {
     
    if (!setStationParam({ ws, tx }, ioDisplayName(p.name, p.analog), p.value)) throw new CommandError("No station");
    return { ok: true };
  },
});

 







defineCommand({
  name: "target.moveTo",
  title: "Move to Target",
  description: "Jump the robot to a target (double-click). With alt=true the target is updated from the robot instead.",
  category: "target",
  spec: "R-TREE-20, R-TREE-11",
  schema: z.object({ target: ItemRef, alt: z.boolean().default(false) }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const t = requireRef(ws, p.target, "target");
    if (!t.target) throw new CommandError(`${t.name} is not a target`);
    const r = t.target.robot ? ws.items[t.target.robot] : undefined;
    if (!r?.robot) {
      status(ctx, "Select robot first");
      ctx.undoLabel = null;
      return { moved: false };
    }
    const frame = t.parent ? ws.items[t.parent] : undefined;
    if (frame?.type === "frame" && r.robot.activeFrame !== frame.id) {
      tx.set(r.id, { robot: { ...ws.items[r.id].robot!, activeFrame: frame.id } });
      status(ctx, `Reference frame for robot ${r.name} updated to ${frame.name} to reach target ${t.name}`);
    }
    if (p.alt) {
      if (!t.parent) throw new CommandError("The target is not placed on a reference frame");
      tx.set(t.id, { pose: tcpIn(ws, ws.items[r.id], t.parent), target: { ...t.target, joints: r.robot.joints.slice() } });
      ctx.undoLabel = `Move target: ${t.name}`;
      return { updated: true };
    }
    const q = jointsForTarget(ws, ws.items[r.id], t, r.robot.joints);
    if (!q) {
      status(ctx, "Target is not reachable");
      ctx.undoLabel = null;
      return { moved: false };
    }
    tx.set(r.id, { robot: { ...ws.items[r.id].robot!, joints: clampJoints(r.robot.model, q) } });
    ctx.undoLabel = `Move robot: ${r.name}`;
    return { moved: true, joints: q };
  },
});

defineCommand({
  name: "robot.moveJ",
  title: "Move Joint (simulated)",
  description: "Animate the robot to a target or joint values with a joint move at the current simulation speed (API MoveJ).",
  category: "simulation",
  undoable: false,
  spec: "R-PROG-19",
  schema: z.object({ robot: ItemRef.optional(), target: ItemRef.optional(), joints: z.array(z.number()).optional(), linear: z.boolean().default(false) }),
  async run({ ws, services }, p) {
    const r = requireRobot(ws, p.robot);
    let q = p.joints ?? null;
    if (!q && p.target !== undefined) {
      const t = requireRef(ws, p.target, "target");
      q = jointsForTarget(ws, r, t, r.robot!.joints);
      if (!q) throw new CommandError("Target cannot be reached", "target_reach");
    }
    if (!q) throw new CommandError("Provide a target or joints");
    if (!services.runner) throw new CommandError("Simulation is only available on the server");
    services.runner.moveRobot(r.id, q, p.linear ? "linear" : "joint");
    return { joints: q };
  },
});

defineCommand({
  name: "collision.setActive",
  title: "Check Collisions",
  description:
    "Turn collision checking on or off (Shift+C, default off). When on, colliding bodies turn red and simulated movements stop at the first collision ('Collision detected. Robot stopped.').",
  category: "simulation",
  shortcut: "Shift+C",
  undoable: false,
  spec: "R-PROG-48",
  schema: z.object({ active: z.boolean().optional() }),
  run({ ws, tx, services }, p) {
    const v = p.active ?? !ws.collisionsActive;
    tx.setMeta("collisionsActive", v);
    const st = ws.activeStation;
    const pairs = st ? checkCollisions(ws, services.geometry, st, Number(services.settings.Collision_Clearance ?? 0)) : [];
    services.emit?.({ type: "collisions", items: v ? [...new Set(pairs.flatMap((x) => [x.a, x.b]))] : [] });
    return { active: v, collisions: pairs.length };
  },
});

defineCommand({
  name: "collision.check",
  title: "Collision Check",
  description: "Number of colliding pairs right now (regardless of the global toggle) and the pairs themselves.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-52",
  schema: z.object({}),
  run({ ws, services }) {
    const st = activeStationId(ws);
    const pairs = checkCollisions(ws, services.geometry, st, Number(services.settings.Collision_Clearance ?? 0));
    return { count: pairs.length, pairs: pairs.map((x) => ({ a: ws.items[x.a]?.name, b: ws.items[x.b]?.name, linkA: x.linkA, linkB: x.linkB, label: `${x.labelA} ↔ ${x.labelB}` })) };
  },
});

export { clampJoints };

 

const PY_RUN_MODES = { simulate: 1, check: 2, generate: 3, upload: 4, start: 5 } as const;

defineCommand({
  name: "python.runMode",
  title: "Run Python Program in a Run Mode",
  description:
    "Run a Python program like its context menu entries do: 'check' = Quick Program Check (the script's robot moves are validated without animation, RUNMODE_QUICKVALIDATE), 'generate' = Generate Robot Program (the script's robot commands are recorded and generated with the robot's post processor when the script ends or calls ProgramStart again, RUNMODE_MAKE_ROBOTPROG; 'upload' and 'start' generate the same way, there is no robot connection to send the program to), 'path' = Display Path (a quick check whose TCP path stays drawn in the 3D view; show=false removes it), 'simulate' = Run Python Script. Code the Copilot wrote still waits for the user's confirmation.",
  category: "program",
  undoable: false,
  spec: "CM-PY-04/05/06, CM-PYM-02 (FUN_1004f0eac → FUN_1004f2338, FUN_100347218)",
  schema: z.object({
    item: ItemRef,
    mode: z.enum(["simulate", "check", "generate", "upload", "start", "path"]),
    show: z.boolean().default(true).describe("mode 'path' only: false removes the displayed path"),
  }),
  run(ctx, p) {
    const it = requireRef(ctx.ws, p.item, "Python program");
    if (it.type !== "python") throw new CommandError(`${it.name} is not a Python program`);
    const api = ctx.services.api;
    if (!api) throw new CommandError("Python programs run on the Enginuity server");
    if (p.mode === "path" && !p.show) {
      api.clearPath(it.id);
      return { item: it.id, path: false };
    }
    api.setPendingRunMode(p.mode === "path" ? PY_RUN_MODES.check : PY_RUN_MODES[p.mode], it.id, it.name, { path: p.mode === "path" });
    const runPython = getCommand("python.run");
    if (!runPython) throw new CommandError("Python programs are not available");
    return runPython.run(ctx, { item: it.id });
  },
});

defineCommand({
  name: "program.seek",
  title: "Program Sequence Slider",
  description:
    "Move a program's robot to where it would be `t` seconds into the program's simulation (the simulation sequence slider): plans the program from the robot's current joints, sets the robot there and, unless the option 'Select instructions from simulation slider' is off, selects the instruction running at that time. Returns the time, the program duration and the instruction. Not undoable.",
  category: "simulation",
  undoable: false,
  spec: "B-PANEL-14, R-SCREEN-7",
  schema: z.object({ program: ItemRef, t: z.number().min(0), from: z.array(z.number()).optional().describe("robot joints the sequence starts from (default: the current joints)") }),
  run(ctx, p) {
    const { ws, tx, services } = ctx;
    const prog = requireRef(ws, p.program);
    if (prog.type !== "program") throw new CommandError("Select a program");
    if (ws.running?.program === prog.id) throw new CommandError(`The program ${prog.name} is running`);
    const plan = planProgram(ws, prog.id, p.from);
    const robot = plan.robot ? ws.items[plan.robot] : undefined;
    if (!robot?.robot) throw new CommandError(`Select a robot for the program ${prog.name}`);
    const t = Math.min(p.t, plan.duration);
    const joints = jointsAt(plan, t, robot.robot.joints);
     
    for (const [id, q] of jointsByItem(ws, robot.id, joints)) tx.set(id, { robot: { ...ws.items[id].robot!, joints: q } });
    const seg = plan.segments.find((g) => t >= g.t0 && t <= g.t1) ?? plan.segments.at(-1);
    if (seg && services.settings.ProgSequence_SelectIns !== false) tx.setMeta("selection", [seg.instruction]);
    ctx.undoLabel = null;
    status(ctx, `<strong>${prog.name}</strong> time: ${formatProgramTime(t)}`);
    return { t, duration: plan.duration, instruction: seg ? ws.items[seg.instruction]?.name ?? null : null, joints };
  },
});
