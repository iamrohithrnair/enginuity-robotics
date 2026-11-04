 
 
 
 
 
 
 
 
 
 
 
 

import "server-only";
import { checkCollisions } from "@/engine/collision";
import { fk, withinLimits } from "@/engine/kinematics";
import { ioDisplayName } from "@/engine/naming";
import { physicsMotion, physicsWait } from "@/engine/physics/clock";
import { conveyorGoal, conveyorOf, invalidStartText, waitStep, type WaitStep } from "@/engine/sim/events";
import { describePathError, ERROR_KINEMATIC, motionState, planMove, planOptionsFromSettings, programByName, segmentJointsAt, type Profile } from "@/engine/sim/planner";
import { eye, type Mat } from "@/engine/math";
import { programFinishedText } from "@/engine/sim/timefmt";
import { largestJointChange, motionTiming } from "@/engine/sim/timing";
import { getStationParam } from "@/engine/stationParams";
import { jointsByItem, syncItemIds } from "@/engine/sync/axes";
import type { InstructionData, Item } from "@/engine/types";
import { findPythonForCall, pythonCallArgs, splitPythonCall } from "./python-calls";
import { sprayMotion } from "./spray";
import type { ServerState } from "./store";
import { run } from "./store";

 
export interface InstructionExecContext {
  ws: import("@/engine/types").Workspace;
  program: Item;
  instruction: Item;
   
  robot: Item | undefined;
  settings: Record<string, number | string | boolean>;
   
  sleep(ms: number): Promise<boolean>;
   
  callProgram(name: string): Promise<"ok" | "stopped" | "error" | "missing">;
   
  startProgram(name: string): boolean;
   
  setIO(name: string, value: string, analog?: boolean): Promise<void>;
  status(text: string, ms?: number): void;
   
  ask(html: string, buttons: string[], title?: string): Promise<string>;
   
  run(name: string, params: Record<string, unknown>): ReturnType<typeof run>;
   
  stopAll(): void;
  stopped(): boolean;
}

 
export type InstructionExecutor = (ctx: InstructionExecContext, ins: InstructionData) => Promise<void | "ok" | "stop" | "error">;

const EXECUTORS_KEY = "__robocraft_instruction_executors";

function executors(): Map<string, InstructionExecutor> {
  const g = globalThis as unknown as Record<string, Map<string, InstructionExecutor> | undefined>;
  g[EXECUTORS_KEY] ??= new Map();
  return g[EXECUTORS_KEY]!;
}






export function registerInstructionExecutor(kind: string, executor: InstructionExecutor) {
  executors().set(kind, executor);
}

interface RunCtx {
  gen: number;
  loop: boolean;
  startAt: number;
  main: boolean;
   
  count?: number;
}

type Outcome = "ok" | "stopped" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
 
const LIVE_HZ = 30;

export class Runner {
  private gen = 0;
  private dialogs = new Map<string, (button: string, text?: string) => void>();
   
  private open = new Map<string, { type: "dialog"; id: string; title: string; html: string; buttons: string[]; input?: string }>();
  private moving = new Set<string>();
   
  private waiting = new Map<string, { dialog?: string }>();
   
  private skip = new Set<string>();
   
  private live = new Map<string, number[]>();
   
  private liveSent = new Map<string, number>();
   
  private halted = new Set<string>();

  constructor(private state: ServerState) {}

  private get ws() {
    return this.state.ws;
  }
  private emit(e: { type: string; [k: string]: unknown }) {
    this.state.services.emit?.(e);
  }
  private status(text: string, ms = 10000) {
    this.emit({ type: "status", text, ms });
  }
  private popups() {
    return this.state.flags.Popups !== "0";
  }
  private stopped(ctx: { gen: number }) {
    return ctx.gen !== this.gen;
  }

   
  ask(html: string, buttons: string[], title = "", onOpen?: (id: string) => void): Promise<string> {
    return this.prompt(html, buttons, title, undefined, onOpen).then((r) => r.button);
  }

   
  prompt(html: string, buttons: string[], title = "", input?: string, onOpen?: (id: string) => void): Promise<{ button: string; text: string }> {
    const id = `dlg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ev = { type: "dialog" as const, id, title, html, buttons, ...(input !== undefined ? { input } : {}) };
    this.open.set(id, ev);
    this.emit(ev);
    onOpen?.(id);
    return new Promise((resolve) => this.dialogs.set(id, (button, text) => resolve({ button, text: text ?? input ?? "" })));
  }

  





  private async callPython(py: Item, wait: boolean, ctx: RunCtx, args: string[] = []): Promise<"ok" | "stopped"> {
    const svc = this.state.services.python;
    if (!svc) return "ok";
    if (svc.isRunning(py.id)) {
      this.status("Warning: Program is already running. Program call is queued.");
      while (svc.isRunning(py.id)) {
        if (this.stopped(ctx)) return "stopped";
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    const res = await run("python.run", { item: py.id, args }, "system");
    if (!res.ok) {
      this.status(res.error ?? `Python program ${py.name} could not run`);
      return "ok";
    }
    if (!wait) return "ok";
    for (let i = 0; i < 50 && !svc.isRunning(py.id); i++) await new Promise((r) => setTimeout(r, 10));
    while (svc.isRunning(py.id)) {
      if (this.stopped(ctx)) {
        svc.stop(py.id);
        return "stopped";
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return "ok";
  }

  pendingDialogs() {
    return [...this.open.values()];
  }

  answer(id: string, button: string, text?: string) {
    const f = this.dialogs.get(id);
    if (!f) return false;
    this.dialogs.delete(id);
    this.open.delete(id);
    this.emit({ type: "dialog-close", id });
    f(button, text);
    return true;
  }

  isMoving(robotId: string) {
    return this.moving.has(robotId);
  }

   
  liveJointsOf(robotId: string): number[] | undefined {
    const q = this.live.get(robotId);
    return q ? q.slice() : undefined;
  }

  





  skipWait(programId?: string): string[] {
    const ids = programId ? (this.waiting.has(programId) ? [programId] : []) : [...this.waiting.keys()];
    for (const id of ids) {
      this.skip.add(id);
      const dialog = this.waiting.get(id)?.dialog;
      if (dialog) this.answer(dialog, "OK");
    }
    return ids;
  }

   
  private async waitFor<T>(pid: string, body: (skipped: () => boolean, onDialog: (id: string) => void) => Promise<T>): Promise<T> {
    this.skip.delete(pid);
    this.waiting.set(pid, {});
    try {
      return await body(
        () => this.skip.delete(pid),
        (id) => this.waiting.set(pid, { dialog: id }),
      );
    } finally {
      this.waiting.delete(pid);
      this.skip.delete(pid);
    }
  }

  





  start(programId: string, opts: { loop?: boolean; startAt?: number; count?: number }) {
    const count = opts.count !== undefined && opts.count > 0 ? Math.floor(opts.count) : undefined;
    const ctx: RunCtx = { gen: this.gen, loop: !!opts.loop && count === undefined, startAt: opts.startAt ?? 0, main: true, count };
     
    setTimeout(() => {
      void this.runProgram(programId, ctx).catch((err) => this.status(`Simulation error: ${err instanceof Error ? err.message : String(err)}`));
    }, 0);
  }

  stopAll() {
    this.gen += 1;
    for (const [id, f] of this.dialogs) {
      this.emit({ type: "dialog-close", id });
      f("Cancel");
    }
    this.dialogs.clear();
    this.open.clear();
  }

   
  moveRobot(robotId: string, joints: number[], kind: "joint" | "linear") {
    const ctx = { gen: this.gen };
    setTimeout(async () => {
      const robot = this.ws.items[robotId];
      if (!robot?.robot) return;
      const fake: Item = {
        id: "__move",
        handle: 0,
        type: "instruction",
        name: kind === "linear" ? "MoveL" : "MoveJ",
        parent: null,
        children: [],
        visible: true,
        pose: fk(robot.robot.model, joints),
        instruction: { kind: "move", moveType: kind, joints },
      };
      const r = planMove(this.ws, robot, motionState(this.ws, robot), fake, planOptionsFromSettings(this.state.services.settings));
      if (!r.ok) {
        this.status(r.error!.text.replace(/<[^>]+>/g, " "));
        return;
      }
      await this.animate(robot.id, r.samples, r.profile, r.time, ctx);
    }, 0);
  }

   
  moveRobotArc(robotId: string, via: Mat, end: Mat) {
    const ctx = { gen: this.gen };
    setTimeout(async () => {
      const robot = this.ws.items[robotId];
      if (!robot?.robot) return;
      const fake: Item = { id: "__movec", handle: 0, type: "instruction", name: "MoveC", parent: null, children: [], visible: true, pose: end, instruction: { kind: "movec", pose: via, pose2: end } };
      const r = planMove(this.ws, robot, motionState(this.ws, robot), fake, planOptionsFromSettings(this.state.services.settings));
      if (!r.ok) {
        this.status(r.error!.text.replace(/<br>/g, " ").replace(/<[^>]+>/g, ""));
        return;
      }
      await this.animate(robot.id, r.samples, r.profile, r.time, ctx, true);
    }, 0);
  }

   
  private async animate(robotId: string, samples: number[][], profile: Profile | undefined, T: number, ctx: { gen: number }, discrete = false): Promise<"ok" | "stopped" | "collision" | "halted"> {
    this.moving.add(robotId);
    await run("sim.setBusy", { program: robotId, busy: true }, "system");
    let simT = 0;
    let last = performance.now();
    let q = samples[0];
    let lastCheck = -Infinity;
    let outcome: "ok" | "stopped" | "collision" | "halted" = "ok";
    const seg = { samples, profile, t0: 0, t1: T };
     
     
    const clock = physicsMotion(this.state.services, this.ws, robotId, (t) => segmentJointsAt(seg, t), T);
     
    const spray = sprayMotion(this.state, robotId, seg, T);
    try {
       
      if (discrete && samples.length > 1 && T > 0) {
        q = samples[1];
        this.emitLive(robotId, q);
      }
      this.live.set(robotId, q);
      while (simT < T) {
        await sleep(16);
        if (this.stopped(ctx)) {
          outcome = "stopped";
          break;
        }
         
        if (this.halted.has(robotId)) {
          outcome = "halted";
          break;
        }
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        if (clock) simT = clock.elapsed();
        else if (!this.ws.paused) simT = Math.min(T, simT + dt * this.ws.simulationSpeed);
        q = segmentJointsAt(seg, simT, discrete);
        this.live.set(robotId, q);
        spray.update(simT);
        this.emitLive(robotId, q);
        if (this.ws.collisionsActive && now - lastCheck > 40) {
          lastCheck = now;
          if (this.collides(robotId, q)) {
            outcome = "collision";
            break;
          }
        }
      }
      if (outcome === "ok") q = samples[samples.length - 1];
       
      this.emitLive(robotId, q, true);
      await run("sim.setJoints", { robot: robotId, joints: q }, "system");
      if (outcome === "collision") {
        this.stopAll();
        this.status("Collision detected. Robot stopped.");
      }
    } finally {
      clock?.end();
      spray.end(simT, outcome === "ok");
      this.moving.delete(robotId);
      this.live.delete(robotId);
      this.halted.delete(robotId);
      for (const id of syncItemIds(this.ws, robotId)) this.emit({ type: "live-end", robot: id });
      await run("sim.setBusy", { program: robotId, busy: false }, "system");
    }
    return outcome;
  }

  



  private emitLive(robotId: string, q: number[], force = false) {
    const now = Date.now();
    if (!force && now - (this.liveSent.get(robotId) ?? 0) < 1000 / LIVE_HZ) return;
    this.liveSent.set(robotId, now);
    for (const [id, joints] of jointsByItem(this.ws, robotId, q)) this.emit({ type: "live", robot: id, joints, t: now });
  }

  private collides(robotId: string, joints: number[]): boolean {
    const st = this.ws.activeStation;
    if (!st) return false;
    const pairs = checkCollisions(this.ws, this.state.services.geometry, st, Number(this.state.services.settings.Collision_Clearance ?? 0), Object.fromEntries(jointsByItem(this.ws, robotId, joints)));
    const hit = pairs.some((p) => p.a === robotId || p.b === robotId || this.ws.items[p.a]?.parent === robotId || this.ws.items[p.b]?.parent === robotId);
    if (hit) this.emit({ type: "collisions", items: [...new Set(pairs.flatMap((p) => [p.a, p.b]))] });
    return hit;
  }

   
  private async sleepSim(ms: number, ctx: { gen: number }, pid = "") {
    return this.waitFor(pid, async (skipped) => {
      let simT = 0;
      let last = performance.now();
       
      const clock = physicsWait(this.state.services, this.ws, ms);
      while (simT < ms) {
        await sleep(Math.min(20, Math.max(1, (ms - simT) / Math.max(0.001, this.ws.simulationSpeed))));
        if (this.stopped(ctx)) return false;
        if (skipped()) return true;
        const now = performance.now();
        if (clock) simT = clock.elapsed();
        else if (!this.ws.paused) simT += (now - last) * this.ws.simulationSpeed;
        last = now;
      }
      return true;
    });
  }

   
  private execContext(pid: string, instruction: Item, robot: Item | undefined, ctx: RunCtx): InstructionExecContext {
    return {
      ws: this.ws,
      program: this.ws.items[pid],
      instruction,
      robot,
      settings: this.state.services.settings,
      sleep: (ms) => this.sleepSim(ms, ctx, pid),
      callProgram: async (name) => {
        const callee = programByName(this.ws, name);
        if (!callee) return "missing";
        return this.runProgram(callee.id, { gen: ctx.gen, loop: false, startAt: 0, main: false });
      },
      startProgram: (name) => {
        const callee = programByName(this.ws, name);
        if (!callee) return false;
        void this.runProgram(callee.id, { gen: ctx.gen, loop: false, startAt: 0, main: false });
        return true;
      },
      setIO: async (name, value, analog = false) => {
        await run("station.setIO", { name, value, analog }, "system");
      },
      status: (text, ms) => this.status(text, ms),
      ask: (html, buttons, title) => (this.popups() ? this.ask(html, buttons, title) : Promise.resolve(buttons.at(-1) ?? "")),
      run: (name, params) => run(name, params, "system"),
      stopAll: () => this.stopAll(),
      stopped: () => this.stopped(ctx),
    };
  }

  private async waitWhilePaused(ctx: { gen: number }) {
    while (this.ws.paused && !this.stopped(ctx)) await sleep(20);
  }

  private async fail(text: string): Promise<Outcome> {
    await this.notice(text);
    return "error";
  }

   
  private async notice(text: string) {
    if (this.popups()) await this.ask(text, ["OK"]);
    else this.status(text.replace(/<br>/g, " ").replace(/<[^>]+>/g, ""));
  }

   
  private async untilStopped(ctx: { gen: number }): Promise<Outcome> {
    while (!this.stopped(ctx)) await sleep(20);
    return "stopped";
  }

   
  private liveJoints(): Record<string, number[]> | undefined {
    return this.live.size ? Object.fromEntries(this.live) : undefined;
  }

  





  private async runEvent(pid: string, item: Item, robot: Item | undefined, ctx: RunCtx): Promise<{ outcome: Outcome; time: number; distance: number }> {
    const ev = item.instruction?.event;
    const none = { outcome: "ok" as Outcome, time: 0, distance: 0 };
    const call = (live = this.liveJoints()) => run("sim.event", { robot: robot?.id ?? null, instruction: item.id, ...(live ? { live } : {}) }, "system");
    if (ev?.action === "wait") {
      const outcome = await this.waitFor(pid, async (skipped) => {
        for (;;) {
          if (this.stopped(ctx)) return "stopped" as const;
          if (skipped()) return "ok" as const;
           
          const ins = this.ws.items[item.id]?.instruction?.event;
          if (!ins) return "ok" as const;
          if (waitStep(this.ws, null, this.state.services.geometry, ins, this.liveJoints()).done) {
            const step = (await call()).result as WaitStep | null;
            if (!step || step.done) {
               
              if (step?.stopRobot && this.moving.has(step.stopRobot)) this.halted.add(step.stopRobot);
              return "ok" as const;
            }
          }
          await sleep(5);
        }
      });
      return { ...none, outcome };
    }
    if (ev?.action !== "conveyor") {
      await call();
      return none;
    }
    const prog = this.ws.items[pid];
    const mech = conveyorOf(this.ws, ev);
    if (!mech?.robot) {
       
       
      const outcome = await this.waitFor(pid, async (skipped) => {
        while (!this.stopped(ctx)) {
          if (skipped()) return "ok" as const;
          await sleep(20);
        }
        return "stopped" as const;
      });
      return { ...none, outcome };
    }
     
    while (this.moving.has(mech.id) && !this.stopped(ctx)) await sleep(5);
    if (this.stopped(ctx)) return { ...none, outcome: "stopped" };
    const start = this.ws.items[mech.id].robot!.joints.slice();
    const goal = conveyorGoal(start, ev.distance ?? 200);
     
    if (!withinLimits(mech.robot.model, start)) return { ...none, outcome: await this.fail(invalidStartText(prog?.name ?? "", item.name, start)) };
    const move: Item = { id: "__conveyor", handle: 0, type: "instruction", name: item.name, parent: null, children: [], visible: true, pose: eye(), instruction: { kind: "move", moveType: "joint", joints: goal } };
    const r = planMove(this.ws, mech, motionState(this.ws, mech, start), move, planOptionsFromSettings(this.state.services.settings));
    if (!r.ok) {
       
      this.status(`${prog?.name ?? ""}-${item.name}: ${describePathError(ERROR_KINEMATIC)}`);
      return { ...none, outcome: "error" };
    }
    const res = await this.animate(mech.id, r.samples, r.profile, r.time, ctx);
    if (res === "halted") return { ...none, outcome: await this.untilStopped(ctx) };
    if (res !== "ok") return { ...none, outcome: "stopped" };
    return { outcome: "ok", time: r.time, distance: r.distance };
  }

  async runProgram(pid: string, ctx: RunCtx): Promise<Outcome> {
    let prog = this.ws.items[pid];
    if (!prog) return "error";
    if (this.ws.busy?.includes(pid) && !ctx.main) {
      this.status("Warning: Program is already running. Program call is queued.");
      while (this.ws.busy?.includes(pid) && !this.stopped(ctx)) await sleep(20);
    }
    await run("sim.setBusy", { program: pid, busy: true, main: ctx.main }, "system");
    let simTime = 0;
    let distance = 0;
    let outcome: Outcome = "ok";
    try {
      do {
        const end = ctx.count !== undefined ? ctx.startAt + ctx.count : Infinity;
        for (let i = ctx.startAt; i < end; i++) {
          prog = this.ws.items[pid];
          if (!prog || i >= prog.children.length) break;
          if (this.stopped(ctx)) return (outcome = "stopped");
          await this.waitWhilePaused(ctx);
          const item = this.ws.items[prog.children[i]];
          const ins = item?.instruction;
          if (!ins) continue;
          this.emit({ type: "sim-instruction", program: pid, instruction: item.id });
          const robot = prog.program?.robot ? this.ws.items[prog.program.robot] : undefined;
          switch (ins.kind) {
            case "move":
            case "movec": {
              if (!robot?.robot) {
                 
                 
                 
                 
                while (!this.stopped(ctx)) await sleep(20);
                return (outcome = "stopped");
              }
              const st = motionState(this.ws, robot);
               
              const opts = planOptionsFromSettings(this.state.services.settings);
              const r = planMove(this.ws, robot, st, item, opts);
              if (!r.ok) {
                if (r.error!.kind === "path" && r.samples.length > 1) {
                  const d = (r.samples.length - 1) * (opts.stepMM ?? 1);
                  const { profile, time } = motionTiming(st, d, largestJointChange(r.samples[0], r.samples[r.samples.length - 1]), "linear", opts.moveTimeCalc);
                  await this.animate(robot.id, r.samples, profile, time, ctx);
                }
                return (outcome = await this.fail(r.error!.text));
              }
              const linear = ins.kind === "movec" || ins.moveType === "linear" || ins.moveType === "search";
              const res = await this.animate(robot.id, r.samples, r.profile, r.time, ctx, linear);
               
              if (res === "halted") return (outcome = await this.untilStopped(ctx));
              if (res !== "ok") return (outcome = "stopped");
              simTime += r.time;
              distance += r.distance;
              break;
            }
            case "speed":
            case "rounding":
               
               
               
              if (!robot?.robot) return (outcome = await this.fail("Robot is undefined"));
              await run("sim.robotState", ins.kind === "speed" ? { robot: robot.id, speed: ins.speed } : { robot: robot.id, rounding: ins.rounding ?? -1 }, "system");
              break;
            case "frame": {
               
               
              if (!robot?.robot) {
                await this.notice(`Robot is undefined (${item.name})`);
                break;
              }
               
              const linked = ins.frame && this.ws.items[ins.frame] ? ins.frame : null;
              if (robot && ins.pose && (ins.forcePose || !linked)) await run("sim.robotState", { robot: robot.id, ...(linked ? { frame: linked } : {}), framePose: ins.pose }, "system");
              else if (robot && linked) await run("sim.robotState", { robot: robot.id, frame: linked }, "system");
              break;
            }
            case "tool": {
              if (!robot?.robot) {
                await this.notice(`Robot is undefined (${item.name})`);
                break;
              }
               
              const linked = ins.tool && this.ws.items[ins.tool] ? ins.tool : null;
              if (robot && ins.pose && (ins.forcePose || !linked)) await run("sim.robotState", { robot: robot.id, ...(linked ? { tool: linked } : {}), toolPose: ins.pose }, "system");
              else if (robot && linked) await run("sim.robotState", { robot: robot.id, tool: linked }, "system");
              break;
            }
            case "custom": {
               
               
              const res = await run("instruction.runCustom", { instruction: item.id }, "system");
              if (!res.ok) {
                this.status(res.error ?? `Custom instruction ${item.name} failed`);
                break;
              }
              const py = this.state.services.python;
              if (item.params?.Blocking !== "0" && py) {
                while (py.isRunning(item.id)) {
                  await sleep(20);
                  if (this.stopped(ctx)) {
                    py.stop(item.id);
                    return (outcome = "stopped");
                  }
                }
              }
              break;
            }
            case "pause": {
              const ms = ins.pauseMs ?? -1;
              if (ms > 0) {
                if (!(await this.sleepSim(ms, ctx, pid))) return (outcome = "stopped");
                simTime += ms / 1000;
              } else if (this.popups()) {
                const name = prog.name;
                const b = await this.waitFor(pid, (_skipped, onDialog) => this.ask(`Program <strong>${name}</strong> paused.<br>Press OK to continue.`, ["Cancel", "OK"], "", onDialog));
                if (b !== "OK") {
                  this.stopAll();
                  return (outcome = "stopped");
                }
              } else {
                 
                this.status("Simulated pause skipped (NOUI)");
              }
              break;
            }
            case "print":
              this.status(`${prog.name} message: ${ins.text ?? ""}`);
              break;
            case "io": {
              const io = ins.io!;
              if (io.mode === "set") {
                await run("station.setIO", { name: io.name, value: io.value, analog: !!io.analog }, "system");
                break;
              }
              const key = ioDisplayName(io.name);
              const waitResult = await this.waitFor(pid, async (skipped) => {
                let waited = 0;
                let last = performance.now();
                 
                while ((getStationParam(this.ws, key) ?? "") !== io.value) {
                  await sleep(5);
                  if (this.stopped(ctx)) return "stopped" as const;
                  if (skipped()) return "ok" as const;  
                  const now = performance.now();
                  if (!this.ws.paused) waited += (now - last) * this.ws.simulationSpeed;
                  last = now;
                  if ((io.timeoutMs ?? -1) > 0 && waited >= io.timeoutMs!) return "timeout" as const;
                }
                return "ok" as const;
              });
              if (waitResult === "stopped") return (outcome = "stopped");
              const timedOut = waitResult === "timeout";
              if (timedOut && this.popups()) {
                const b = await this.ask(`Timed out while waiting for Digital Input (DI):<br>${key} = ${io.value}<br>Continue?`, ["No", "Yes"], "Timed out");
                if (b !== "Yes") {
                  this.stopAll();
                  return (outcome = "stopped");
                }
              }
              break;
            }
            case "code": {
              const text = ins.text ?? "";
              if (ins.codeType === 0 || ins.codeType === 2) {
                const callee = programByName(this.ws, text);
                if (!callee) {
                   
                   
                  const caller = this.ws.items[pid];
                  const py = findPythonForCall(this.ws, text, caller);
                  if (py) {
                    const args = pythonCallArgs(splitPythonCall(text).args, caller);
                    const res = await this.callPython(py, ins.codeType === 0, ctx, args);
                    if (res === "stopped") return (outcome = "stopped");
                    break;
                  }
                  this.status(ins.codeType === 0 ? `Program ${text} does not exist. Skipping function call.` : `Program ${text} does not exist. Skipping thread.`);
                  break;
                }
                const sub: RunCtx = { gen: ctx.gen, loop: false, startAt: 0, main: false };
                 
                 
                const loops = callee.params?.Loop === "1";
                if (ins.codeType === 2) {
                  void this.runProgram(callee.id, { ...sub, loop: loops });
                  break;
                }
                const res = await this.runProgram(callee.id, sub);
                if (res === "stopped" || this.stopped(ctx)) return (outcome = "stopped");
                 
                if (loops && res === "ok") void this.runProgram(callee.id, { ...sub, loop: true });
              }
              break;
            }
            case "event": {
              const res = await this.runEvent(pid, item, robot, ctx);
              if (res.outcome !== "ok") return (outcome = res.outcome);
              simTime += res.time;
              distance += res.distance;
              break;
            }
            default: {
              const executor = executors().get(ins.kind);
              if (!executor) break;
              const res = await executor(this.execContext(pid, item, robot, ctx), ins);
              if (res === "stop" || this.stopped(ctx)) return (outcome = "stopped");
              if (res === "error") return (outcome = "error");
              break;
            }
          }
        }
        ctx.startAt = 0;
        prog = this.ws.items[pid];
        if (!prog) break;
        if (ctx.loop && !this.stopped(ctx)) {
          this.status(`${programFinishedText(prog.name, distance, simTime)}`);
          simTime = 0;
          distance = 0;
          continue;
        }
        break;
      } while (true);
      if (prog && outcome === "ok" && ctx.count === undefined) this.status(programFinishedText(prog.name, distance, simTime));
      return outcome;
    } finally {
      await run("sim.setBusy", { program: pid, busy: false, main: ctx.main }, "system");
      this.emit({ type: "sim-instruction", program: pid, instruction: null });
    }
  }
}
