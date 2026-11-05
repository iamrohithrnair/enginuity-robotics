// Handles API program editing, instruction queries, execution and code generation.
 

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { syncDof } from "@/engine/sync/axes";
import path from "node:path";
import { addInstruction } from "@/engine/commands/programs";
import { instructionName, ioDisplayName } from "@/engine/naming";
import { getStationParam } from "@/engine/stationParams";
import { planOptionsFromSettings, planProgram, programByName } from "@/engine/sim/planner";
import type { InstructionData, Item } from "@/engine/types";
import { fk } from "@/engine/kinematics";
import { eye } from "@/engine/math";
import { broadcast, DATA_DIR, getServer } from "@/server/store";
import { ApiError, cmd, mutate, need, ws } from "./bridge";
import type { WireWriter } from "./codec";
import { apiState, def, type Ctx } from "./context";
import { created, writeItem } from "./cmd-items";
import { insertAfter, needRobot, waitStarted } from "./cmd-robot";
import { scmdValue } from "./cmd-station";
import { programFor, quickMotion } from "./runmode";
import { findPythonForCall, pythonCallArgs, splitPythonCall } from "@/server/python-calls";
import { updateProject } from "@/engine/commands/machining";
import { MachiningError } from "@/engine/machining/project";

function needProgram(h: number): Item {
  const it = need(h);
  if (it.type !== "program") throw new ApiError(3, `${it.name} is not a program`);
  return it;
}

 

def("Add_PROG", "TS", async (c) => {
  const name = await c.r.line();
  const hr = await c.r.handle();
  await c.exec(async () => {
    const robot = hr ? needRobot(hr).id : undefined;
     
    const res = await cmd("program.add", { name, robot });
    writeItem(c.w, created(res));
  });
});

def("Add_TARGET", "TS", async (c) => {
  const name = await c.r.line();
  const hp = await c.r.handle();
  const hr = await c.r.handle();
  await c.exec(async () => {
    const parent = hp ? need(hp).id : undefined;
    const robot = hr ? needRobot(hr).id : undefined;
     
    const res = await cmd("target.add", { name, parent, robot });
    writeItem(c.w, created(res));
  });
});

 

def("Add_INSMOVE", "S", async (c) => {
  const ht = await c.r.handle();
  const hp = await c.r.handle();
  const moveType = await c.r.int();
  await c.exec(async () => {
    const t = need(ht);
    const prog = needProgram(hp);
    const verb = moveType === 2 || moveType === 5 ? "program.addMoveL" : "program.addMoveJ";
    await cmd(verb, { program: prog.id, target: t.id, after: insertAfter(prog) });
  });
});

def("Add_INSMOVEC", "S", async (c) => {
  const h1 = await c.r.handle();
  const h2 = await c.r.handle();
  const hp = await c.r.handle();
  await c.exec(async () => {
    const prog = needProgram(hp);
    await cmd("program.addMoveC", { program: prog.id, via: need(h1).id, target: need(h2).id, after: insertAfter(prog) });
  });
});

def("S_Speed4", "S", async (c) => {
  const h = await c.r.handle();
  const v = await c.r.array();
  await c.exec(async () => {
    const it = await programFor(c.conn, need(h));
    const [linear = -1, joint = -1, linearAccel = -1, jointAccel = -1] = v;
    if (it.type === "program") {
      await cmd("program.addInstruction", { program: it.id, kind: "speed", linear, joint, linearAccel, jointAccel, after: insertAfter(it) });
    } else if (it.type === "robot") {
      await cmd("robot.setSpeed", { robot: it.id, linear, joint, linearAccel, jointAccel });
    }
  });
});

def("S_ZoneData", "S", async (c) => {
  const value = await c.r.int();
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = await programFor(c.conn, need(h));
     
    if (it.type === "program") await cmd("program.addInstruction", { program: it.id, kind: "rounding", rounding: value / 1000, after: insertAfter(it) });
    else if (it.type === "robot" && it.robot) {
      await mutate((w, tx) => {
        const r = w.items[it.id];
        if (r?.robot) tx.set(r.id, { robot: { ...r.robot, rounding: value / 1000 } });
      });
    }
  });
});

def("RunPause", "S", async (c) => {
  const h = await c.r.handle();
  const value = await c.r.int();
  const it = await c.exec(async () => {
    const item = await programFor(c.conn, need(h));
     
    if (item.type === "program") await cmd("program.addInstruction", { program: item.id, kind: "pause", pauseMs: value / 1000, after: insertAfter(item) });
    return item;
  });
  if (it.type === "robot" && value > 0 && !quickMotion(c.conn)) {
     
    await new Promise((r) => setTimeout(r, value / 1000 / Math.max(0.001, ws().simulationSpeed)));
  }
});

 
const CODE_KIND: Record<number, string> = { 0: "call", 1: "code", 2: "thread", 3: "comment", 4: "print" };

def("RunCode2", "IS", async (c) => {
  const h = await c.r.handle();
  const raw = await c.r.line();
  const type = await c.r.int();
  await c.exec(async () => {
    const target = await programFor(c.conn, need(h));
    const prog = target.type === "program" ? target : needProgram(h);
    const text = raw.replace(/<<br>>/g, "\n");
    await cmd("program.addInstruction", { program: prog.id, kind: CODE_KIND[type] ?? "code", text, after: insertAfter(prog) });
    c.w.int(0);
  });
});

async function setIO(c: Ctx, analog: boolean) {
  const h = await c.r.handle();
  const name = await c.r.line();
  const value = await c.r.line();
  await c.exec(async () => {
    const it = await programFor(c.conn, need(h));
    if (it.type === "program") {
      await cmd("program.addInstruction", { program: it.id, kind: "io", ioMode: "set", ioName: name, ioValue: value, analog, after: insertAfter(it) });
      return;
    }
     
    await cmd("station.setIO", { name, value, analog });
  });
}

def("setDO", "S", (c) => setIO(c, false));
def("setAO", "S", (c) => setIO(c, true));

def("waitDI", "S", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const value = await c.r.line();
  const timeout = await c.r.int();
  const it = await c.exec(async () => {
    const item = await programFor(c.conn, need(h));
    if (item.type === "program") {
       
      await cmd("program.addInstruction", {
        program: item.id,
        kind: "io",
        ioMode: "wait",
        ioName: name,
        ioValue: value,
        timeoutMs: timeout / 1000,
        after: insertAfter(item),
      });
    }
    return item;
  });
  if (it.type !== "program" && !quickMotion(c.conn)) {
     
    const key = ioDisplayName(name);
    const limit = timeout > 0 ? Date.now() + timeout / 1000 / Math.max(0.001, ws().simulationSpeed) : Infinity;
    while (getStationParam(ws(), key) !== value && Date.now() < limit) await new Promise((r) => setTimeout(r, 5));
  }
});

async function getIO(c: Ctx, analog: boolean) {
  const h = await c.r.handle();
  const name = await c.r.line();
  await c.exec(() => {
    need(h);
    c.w.line(getStationParam(ws(), ioDisplayName(name, analog)) ?? "");
  });
}

def("getDI", "LS", (c) => getIO(c, false));
def("getAI", "LS", (c) => getIO(c, true));

export const INS_TYPE: Record<InstructionData["kind"], number> = {
  move: 0,
  movec: 1,
  speed: 2,
  frame: 3,
  tool: 4,
  robot: 5,
  pause: 6,
  event: 7,
  code: 8,
  print: 9,
  rounding: 10,
  io: 11,
  custom: 12,
   
  decision: 8,
};

const MOVE_TYPE: Record<string, number> = { joint: 1, linear: 2, circular: 3, search: 5 };

def("Prog_Nins", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.int(needProgram(h).children.length);
  });
});

const invalidIns = (w: WireWriter) => w.line("invalid id").int(-1);

def("Prog_GIns", "LIS", async (c) => {
  const h = await c.r.handle();
  const index = await c.r.int();
  await c.exec(() => {
    const prog = need(h, invalidIns);
    const w = ws();
    const insItem = w.items[prog.children[index] ?? ""];
     
    if (!insItem?.instruction) throw new ApiError(1, "", invalidIns);
    const ins = insItem.instruction;
    const type = INS_TYPE[ins.kind] ?? 12;
    if (type !== 0) {
      c.w.line(insItem.name).int(type);
      return;
    }
    let pose = ins.pose ?? eye();
    let joints = ins.joints ?? [];
    let isJoint = ins.joints && !ins.pose ? 1 : 0;
    if (ins.target) {
      const t = w.items[ins.target];
       
      if (!t?.target) throw new ApiError(3, `Target at instruction ${insItem.name} has been deleted`, (ww) => ww.line(insItem.name).int(-1));
      pose = t.pose;
      joints = t.target.joints;
      isJoint = t.target.isJoint ? 1 : 0;
    } else if (!ins.pose && ins.joints) {
      const robotId = prog.program?.robot;
      const r = robotId ? w.items[robotId] : undefined;
      if (r?.robot) pose = fk(r.robot.model, ins.joints);
    }
    c.w.line(insItem.name).int(type).int(MOVE_TYPE[ins.moveType ?? "joint"] ?? 1).int(isJoint).pose(pose).array(joints);
  });
});

def("Prog_DelIns", "IS", async (c) => {
  const h = await c.r.handle();
  const index = await c.r.int();
  await c.exec(async () => {
    const prog = needProgram(h);
    const id = prog.children[index];
    if (!id) {
      c.w.int(0);
      return;
    }
    await cmd("item.delete", { items: [id] });
    c.w.int(1);
  });
});

def("Prog_SelIns", "IS", async (c) => {
  const h = await c.r.handle();
  const index = await c.r.int();
  await c.exec(() => {
    const prog = needProgram(h);
    if (index >= 0) {
       
      const id = prog.children[index];
      if (id) apiState().insRef.set(prog.id, id);
      c.w.int(id ? index : -1);
      return;
    }
     
    c.w.int(-1);
  });
});

def("Prog_SIns", "S", async (c) => {
  const h = await c.r.handle();
  const index = await c.r.int();
  const name = await c.r.line();
  const type = await c.r.int();
  let move: { moveType: number; isJoint: number } | null = null;
  if (type === 0) {
    move = { moveType: await c.r.int(), isJoint: await c.r.int() };
    await c.r.pose();
    await c.r.array();
  }
  await c.exec(async () => {
    const prog = needProgram(h);
    const id = prog.children[index];
    if (!id) throw new ApiError(1);
    await mutate((w, tx) => {
      const it = w.items[id];
      if (!it?.instruction) return;
      const ins = { ...it.instruction };
      if (move && ins.kind === "move") ins.moveType = move.moveType === 2 ? "linear" : move.moveType === 5 ? "search" : "joint";
      tx.set(id, { instruction: ins, name: name || instructionName(w, ins) });
    });
  });
});

def("Prog_ShowIns", "S", async (c) => {
  await c.r.handle();
  await c.r.int();
  await c.exec(() => undefined);
});

def("Prog_ShowTargets", "S", async (c) => {
  await c.r.handle();
  await c.r.int();
  await c.exec(() => undefined);
});

 






 
async function machiningProgram(project: Item): Promise<Item> {
  try {
    const res = await mutate((w, tx) => updateProject({ ws: w, tx, services: getServer().services }, w.items[project.id]));
    return res.program;
  } catch (e) {
    if (e instanceof MachiningError) throw new ApiError(3, e.message);
    throw e;
  }
}

async function updateProgram(c: Ctx, h: number, check: number, mmStep: number, degStep: number, withMessage = true) {
  await c.exec(async () => {
    const it = need(h);
    const prog = it.type === "machining" ? await machiningProgram(it) : needProgram(h);
    const [n, time, dist, ratio, message] =
      check > 0
        ? await cmd<[number, number, number, number, string]>("program.checkCollisions", { program: prog.id, ...(mmStep > 0 ? { mmStep } : {}), ...(degStep > 0 ? { degStep } : {}) })
        : await cmd<[number, number, number, number, string]>("program.update", { program: prog.id });
     
    c.w.array([n, time, dist, ratio]);
    if (withMessage) c.w.line(message ?? "");
  });
}

def("Update2", "ALS", async (c) => {
  const h = await c.r.handle();
  const [check = 0, mmStep = -1, degStep = -1] = await c.r.array();
  await updateProgram(c, h, check, mmStep, degStep);
});

 
 
def("Update", "AS", async (c) => {
  const h = await c.r.handle();
  await updateProgram(c, h, 0, -1, -1, false);
});

async function runProgram(prog: Item): Promise<number> {
  const res = await cmd<{ instructions?: number }>("program.run", { program: prog.id });
   
  await waitStarted(prog.id);
  return Number(res.instructions ?? 0);
}

 
async function runPython(py: Item, args: string[]): Promise<number> {
  await cmd("python.run", { item: py.id, args });
  return 0;
}

def("RunProg", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    c.w.int(it.type === "python" ? await runPython(it, []) : await runProgram(needProgram(h)));
  });
});

def("RunProgParam", "IS", async (c) => {
  const h = await c.r.handle();
   
   
  const params = await c.r.line();
  await c.exec(async () => {
    const it = need(h);
    c.w.int(it.type === "python" ? await runPython(it, pythonCallArgs(params === "" ? [] : params.split("<br>"))) : await runProgram(needProgram(h)));
  });
});

def("RunCode", "IS", async (c) => {
  const isCall = await c.r.int();
  const code = await c.r.line();
  await c.exec(async () => {
     
     
    const prog = isCall ? programByName(ws(), code) : undefined;
    if (prog) {
      c.w.int(await runProgram(prog));
      return;
    }
    const py = isCall ? findPythonForCall(ws(), code) : undefined;
    c.w.int(py ? await runPython(py, pythonCallArgs(splitPythonCall(code).args)) : 0);
  });
});

def("RunMessage", "S", async (c) => {
  const isComment = await c.r.int();
  const text = await c.r.line();
  await c.exec(() => {
     
    if (!isComment) broadcast({ type: "status", text, ms: 10000 });
  });
});

 

 
function programsFolder(): string {
  const fromCmd = scmdValue("PathPrograms") || scmdValue("PATH_PROGRAMS");
  return fromCmd || path.join(DATA_DIR, "programs");
}

def("MakeProg2", "ILIS", async (c) => {
  const h = await c.r.handle();
  const folderIn = await c.r.line();
  await c.r.int();  
  await c.exec(async () => {
    const prog = needProgram(h);
    const folder = folderIn ? folderIn : programsFolder();
    try {
       
       
      const res = await cmd<{ files?: { name: string; content: string; binary?: boolean; path?: string }[] }>("program.generate", { program: prog.id });
      mkdirSync(folder, { recursive: true });
      for (const f of res.files ?? []) {
        const target = path.join(folder, path.basename(f.name));
        if (f.path && existsSync(f.path)) {
          if (path.resolve(f.path) !== path.resolve(target)) copyFileSync(f.path, target);
        } else if (!f.binary) writeFileSync(target, f.content);
      }
       
      c.w.int(1).line("").int(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      c.w.int(0).line(msg).int(0);
    }
  });
});

 

def("G_ProgRunType", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.int(Number(needProgram(h).params?.RunType ?? 0));
  });
});

def("S_ProgRunType", "S", async (c) => {
  const h = await c.r.handle();
  const v = await c.r.int();
  await c.exec(async () => {
    await cmd("item.setParam", { item: needProgram(h).id, key: "RunType", value: String(v) });
  });
});


def("InsCustom2", "S", async (c) => {
  const h = await c.r.handle();
  const name = await c.r.line();
  const pathRun = await c.r.line();
  const pathIcon = await c.r.line();
  const runOnRobot = await c.r.line();
  const blocking = await c.r.int();
  await c.exec(async () => {
    const prog = needProgram(h);
     
    await mutate((w, tx) => {
      const p = w.items[prog.id];
      const ins = addInstruction(w, tx, p, { kind: "custom", text: name }, insertAfter(p) ?? null);
      tx.set(ins.id, { name, params: { PathRunSim: pathRun, PathIcon: pathIcon, PathRunRobot: runOnRobot, Blocking: String(blocking) } });
    });
  });
});

 

 
def("G_ProgJointList", "MILS", async (c) => {
  const h = await c.r.handle();
  const [mmStep = 10, degStep = 5, collision = 0, flags = 0] = await c.r.array();
  const file = await c.r.line();
  await c.exec(async () => {
    const prog = needProgram(h);
    const res = await cmd<{ status: number; message: string; points: { joints: number[]; error: number; instruction: number; row?: number; mm?: number; deg?: number; time: number }[] }>("program.jointList", {
      program: prog.id,
      mmStep: mmStep > 0 ? mmStep : 10,
      degStep: degStep > 0 ? degStep : 5,
      checkCollisions: collision > 0,
    });
    const robot = prog.program?.robot ? ws().items[prog.program.robot] : undefined;
     
    const n = robot?.robot ? syncDof(ws(), robot) : res.points[0]?.joints.length ?? 6;
    const rows = n + 4 + (flags >= 1 ? 1 : 0);
     
    const cols = res.points.map((q) => [...q.joints, q.error, q.mm ?? 0, q.deg ?? 0, q.row ?? q.instruction, ...(flags >= 1 ? [q.time] : [])]);
    if (file) {
       
      writeFileSync(file, cols.map((col) => col.join(",")).join("\n") + "\n");
    } else c.w.matrix(rows, cols.length, cols.flat());
    c.w.int(res.status).line(res.message);
  });
});

function planFor(prog: Item) {
  return planProgram(ws(), prog.id, planOptionsFromSettings(getServer().services.settings));
}

def("G_ProgInsList", "MIS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const prog = needProgram(h);
    const w = ws();
    const plan = planFor(prog);
    const robot = plan.robot ? w.items[plan.robot] : undefined;
    const n = robot?.robot?.model.nq ?? 6;
     
    const cols: number[][] = [];
    for (const id of prog.children) {
      const ins = w.items[id]?.instruction;
      if (ins?.kind !== "move") continue;
      const t = ins.target ? w.items[ins.target] : undefined;
      const q = t?.target?.joints ?? ins.joints ?? [];
      cols.push([...Array.from({ length: n }, (_, i) => q[i] ?? 0), ins.moveType === "linear" ? 2 : 1]);
    }
    c.w.matrix(n + 1, cols.length, cols.flat());
    const err = plan.errors.find((e) => w.items[e.instruction]?.instruction?.kind !== "movec");
    c.w.int(err ? -2 : prog.children.length);
  });
});
