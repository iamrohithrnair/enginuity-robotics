 

import { addInstruction } from "@/engine/commands/programs";
import { fk, ikAllDetailed, ikClosest, jointsConfig, linkFrames, withinLimits } from "@/engine/kinematics";
import { eye, inv, mul, type Mat } from "@/engine/math";
import { motionState, planMove, planOptionsFromSettings } from "@/engine/sim/planner";
import type { InstructionData, Item, Workspace } from "@/engine/types";
import { absPose, activeToolOf, childFrame, descendants, toolPose } from "@/engine/workspace";
import { getServer } from "@/server/store";
import { ApiError, byHandle, cmd, mutate, need, robotJoints, ws } from "./bridge";
import { commitJoints } from "@/engine/sync/axes";
import { colMajorToMat, type WireWriter } from "./codec";
import { apiState, COMMANDS, def, type Ctx } from "./context";
import { activeStation, created, writeItem } from "./cmd-items";
import { addPath, generating, quickMotion, record } from "./runmode";

 

export function needRobot(h: number): Item {
  const it = need(h);
  if (it.type !== "robot" || !it.robot) throw new ApiError(3, `${it.name} is not a robot`);
  return it;
}

 
export function padJoints(robot: Item, q: number[]): number[] {
  const n = robot.robot!.model.nq;
  return Array.from({ length: n }, (_, i) => (Number.isFinite(q[i]) ? q[i] : 0));
}

 
export function robotRefAbs(w: Workspace, robot: Item): Mat {
  const f = robot.robot?.activeFrame;
  if (f && w.items[f]) return absPose(w, f);
  return absPose(w, robot.id);
}

 
export function robotPose(w: Workspace, robot: Item, joints?: number[]): Mat {
  const tcpAbs = mul(mul(absPose(w, robot.id), fk(robot.robot!.model, joints ?? robot.robot!.joints)), toolPose(w, robot.id));
  return mul(inv(robotRefAbs(w, robot)), tcpAbs);
}

 
function flangeInBase(w: Workspace, robot: Item, pose: Mat): Mat {
  return mul(mul(inv(absPose(w, robot.id)), mul(robotRefAbs(w, robot), pose)), inv(toolPose(w, robot.id)));
}

function setRobotJoints(robot: Item, q: number[]) {
  return mutate((w, tx) => {
    const r = w.items[robot.id];
     
    if (r?.robot) commitJoints(w, tx, r.id, q);
  });
}

 

def("G_Hlocal", "HS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    const w = ws();
    if (it.type === "robot" && it.robot) c.w.pose(robotPose(w, it, robotJoints(it)));
    else if (it.type === "station") c.w.pose(eye());
    else c.w.pose(it.pose);
  });
});

async function setPose(it: Item, pose: Mat, absolute: boolean) {
  const w = ws();
  if (it.type === "robot" && it.robot && !absolute) {
     
    const q = ikClosest(it.robot.model, flangeInBase(w, it, pose), it.robot.joints);
    if (!q) throw new ApiError(10, "Target cannot be reached");
    await setRobotJoints(it, q);
    return;
  }
  if (it.type === "station") return;
  if (absolute) {
    await mutate((ww, tx) => {
      const cur = ww.items[it.id];
      if (cur) tx.set(cur.id, { pose: mul(inv(childFrame(ww, cur.parent)), pose) });
    });
    return;
  }
   
  await mutate((ww, tx) => {
    if (ww.items[it.id]) tx.set(it.id, { pose });
  });
}

def("S_Hlocal", "S", async (c) => {
  const h = await c.r.handle();
  const pose = await c.r.pose();
  await c.exec(() => setPose(need(h), pose, false));
});

def("G_Hlocal_Abs", "HS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    c.w.pose(it.type === "station" ? eye() : absPose(ws(), it.id));
  });
});

def("S_Hlocal_Abs", "S", async (c) => {
  const h = await c.r.handle();
  const pose = await c.r.pose();
  await c.exec(() => setPose(need(h), pose, true));
});

async function setPoses(c: Ctx, absolute: boolean) {
  const n = await c.r.int();
  const pairs: { h: number; pose: Mat }[] = [];
  for (let i = 0; i < n; i++) pairs.push({ h: await c.r.handle(), pose: await c.r.pose() });
  await c.exec(async () => {
    for (const p of pairs) await setPose(need(p.h), p.pose, absolute);
  });
}

def("S_Hlocals", "S", (c) => setPoses(c, false));
def("S_Hlocal_AbsS", "S", (c) => setPoses(c, true));

 

def("G_Thetas", "AS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    c.w.array(it.robot ? robotJoints(it) : it.target?.joints ?? []);
  });
});

def("G_Thetas_Sim", "AS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    c.w.array(it.robot ? robotJoints(it) : []);
  });
});

async function setJoints(it: Item, joints: number[]) {
  if (it.type === "robot") {
     
    await cmd("robot.setJoints", { robot: it.id, joints });
    return;
  }
  if (it.type === "target" && it.target) {
     
    await mutate((w, tx) => {
      const t = w.items[it.id];
      if (t?.target) tx.set(t.id, { target: { ...t.target, joints: joints.slice() } });
    });
    return;
  }
  throw new ApiError(3, `${it.name} has no joints`);
}

def("S_Thetas", "S", async (c) => {
  const joints = await c.r.array();
  const h = await c.r.handle();
  await c.exec(() => setJoints(need(h), joints));
});

def("G_ThetasList", "AS", async (c) => {
  const n = await c.r.int();
  const hs: number[] = [];
  for (let i = 0; i < n; i++) hs.push(await c.r.handle());
  await c.exec(() => {
    const items = hs.map((h) => need(h));
    for (const it of items) c.w.array(it.robot ? robotJoints(it) : it.target?.joints ?? []);
  });
});

def("S_ThetasList", "S", async (c) => {
  const n = await c.r.int();
  const rows: { h: number; q: number[] }[] = [];
  for (let i = 0; i < n; i++) rows.push({ h: await c.r.handle(), q: await c.r.array() });
  await c.exec(async () => {
    for (const r of rows) await setJoints(need(r.h), r.q);
  });
});

def("G_Home", "AS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.array(needRobot(h).robot!.home);
  });
});

def("S_Home", "S", async (c) => {
  const joints = await c.r.array();
  const h = await c.r.handle();
  await c.exec(async () => {
    const r = needRobot(h);
    await cmd("robot.setHome", { robot: r.id, joints: padJoints(r, joints) });
  });
});

def("G_RobLimits", "AAIS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const m = needRobot(h).robot!.model;
    c.w.array(m.userLower).array(m.userUpper);
     
    c.w.int(1000);
  });
});

def("S_RobLimits", "S", async (c) => {
  const h = await c.r.handle();
  const lower = await c.r.array();
  const upper = await c.r.array();
  await c.exec(async () => {
    const r = needRobot(h);
    await cmd("robot.setJointLimits", { robot: r.id, lower: padJoints(r, lower), upper: padJoints(r, upper) });
  });
});

 

def("G_FK", "HS", async (c) => {
  const joints = await c.r.array();
  const h = await c.r.handle();
  await c.exec(() => {
    const r = needRobot(h);
     
    c.w.pose(fk(r.robot!.model, padJoints(r, joints)));
  });
});

def("G_Thetas_Config", "AS", async (c) => {
  const joints = await c.r.array();
  const h = await c.r.handle();
  await c.exec(() => {
    const r = needRobot(h);
    c.w.array(jointsConfig(r.robot!.model, padJoints(r, joints)));
  });
});

def("G_IK", "AS", async (c) => {
  const pose = await c.r.pose();
  const h = await c.r.handle();
  await c.exec(() => {
    const r = needRobot(h);
     
    c.w.array(ikClosest(r.robot!.model, pose, r.robot!.joints) ?? []);
  });
});

def("G_IK_jnts", "AS", async (c) => {
  const pose = await c.r.pose();
  const seed = await c.r.array();
  const h = await c.r.handle();
  await c.exec(() => {
    const r = needRobot(h);
    c.w.array(ikClosest(r.robot!.model, pose, padJoints(r, seed)) ?? []);
  });
});






function ikComplete(r: Item, pose: Mat): { rows: number; cols: number; data: number[] } {
  const sols = ikAllDetailed(r.robot!.model, pose, 64, r.robot!.joints);
  const extras = sols[0]?.extras.length ?? 0;
  const data: number[] = [];
  for (const s of sols) data.push(...s.joints, ...Array.from({ length: extras }, (_, i) => s.extras[i] ?? 0));
  return { rows: sols.length ? r.robot!.model.nq + extras : 0, cols: sols.length, data };
}

def("G_IK_cmpl", "MS", async (c) => {
  const pose = await c.r.pose();
  const h = await c.r.handle();
  await c.exec(() => {
    const m = ikComplete(needRobot(h), pose);
    c.w.matrix(m.rows, m.cols, m.data);
  });
});

def("G_LinkPoses", "IS", async (c) => {
  const h = await c.r.handle();
  const joints = await c.r.array();
  await c.exec(() => {
    const r = needRobot(h);
    const frames = linkFrames(r.robot!.model, joints.length ? padJoints(r, joints) : r.robot!.joints);
     
    const poses = frames.slice(0, r.robot!.model.joints.length + 1);
    c.w.int(poses.length);
    for (const p of poses) c.w.pose(p);
  });
});

def("G_AbsAccOn", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    needRobot(h);
    c.w.int(0);  
  });
});

def("S_AbsAccOn", "S", async (c) => {
  await c.r.handle();
  await c.r.int();
  await c.exec(() => undefined);
});

 

def("AddToolEmpty", "TS", async (c) => {
  const h = await c.r.handle();
  const pose = await c.r.pose();
  const name = await c.r.line();
  await c.exec(async () => {
    const r = needRobot(h);
    const res = await cmd("robot.addTool", { robot: r.id, name, pose });
    writeItem(c.w, created(res));
  });
});

def("G_Tool", "HS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h);
    if (it.type === "robot") c.w.pose(toolPose(ws(), it.id));
    else if (it.type === "tool") c.w.pose(it.pose);
    else c.w.pose(eye());
  });
});

 
export function insertAfter(prog: Item): string | undefined {
  const ref = apiState().insRef.get(prog.id);
  if (ref && prog.children.includes(ref)) return ref;
  return prog.children.at(-1);
}

 
export function addRawInstruction(progId: string, data: InstructionData) {
  return mutate((w, tx) => {
    const prog = w.items[progId];
    if (!prog) throw new ApiError(1);
    return addInstruction(w, tx, prog, data, insertAfter(prog) ?? null);
  });
}

def("S_Tool", "S", async (c) => {
  const pose = await c.r.pose();
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    if (it.type === "program") {
      await addRawInstruction(it.id, { kind: "tool", tool: null, pose });
      return;
    }
    if (it.type === "tool") {
       
      await mutate((w, tx) => {
        if (w.items[it.id]) tx.set(it.id, { pose });
      });
      return;
    }
    const robot = it.type === "robot" ? it : undefined;
    if (!robot) throw new ApiError(3, `${it.name} is not a robot or program`);
    if (generating(c.conn)) await record(c.conn, robot, { kind: "tool", tool: null, pose });
    await setRobotTool(robot, pose);
  });
});

 
async function setRobotTool(robot: Item, pose: Mat) {
  const tool = activeToolOf(ws(), robot.id);
  await mutate((w, tx) => {
    if (tool && w.items[tool.id]) tx.set(tool.id, { pose });
    else {
      const r = w.items[robot.id];
      if (r?.robot) tx.set(r.id, { robot: { ...r.robot, tcp: pose } });
    }
  });
}

def("G_Frame", "HS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const r = needRobot(h);
    const w = ws();
     
    c.w.pose(mul(inv(absPose(w, r.id)), robotRefAbs(w, r)));
  });
});

def("S_Frame", "S", async (c) => {
  const pose = await c.r.pose();
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    if (it.type === "program") {
      await addRawInstruction(it.id, { kind: "frame", frame: null, pose });
      return;
    }
    if (it.type !== "robot" || !it.robot) throw new ApiError(3, `${it.name} is not a robot or program`);
    if (generating(c.conn)) await record(c.conn, it, { kind: "frame", frame: null, pose });
    const fId = it.robot.activeFrame;
    if (!fId || !ws().items[fId]) return;
    await mutate((w, tx) => {
      const f = w.items[fId];
      const abs = mul(absPose(w, it.id), pose);
      tx.set(f.id, { pose: mul(inv(childFrame(w, f.parent)), abs) });
    });
  });
});






def("S_Link_ptr", "S", async (c) => {
  const hl = await c.r.handle();
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    const link = hl ? need(hl) : undefined;
    if (it.type === "program") {
      if (!link || link.type === "robot") {
        await mutate((w, tx) => {
          const p = w.items[it.id];
          tx.set(p.id, { program: { ...(p.program ?? {}), robot: link?.id ?? null } });
        });
      } else if (link.type === "frame") {
        await cmd("program.addInstruction", { program: it.id, kind: "frame", frame: link.id, after: insertAfter(it) });
      } else if (link.type === "tool") {
        await cmd("program.addInstruction", { program: it.id, kind: "tool", tool: link.id, after: insertAfter(it) });
      }
      return;
    }
    if (it.type === "robot" && link) {
      if (generating(c.conn) && (link.type === "frame" || link.type === "tool")) await record(c.conn, it, link.type === "frame" ? { kind: "frame", frame: link.id } : { kind: "tool", tool: link.id });
      if (link.type === "frame") await cmd("robot.setActiveFrame", { robot: it.id, frame: link.id });
      else if (link.type === "tool") await cmd("robot.setActiveTool", { robot: it.id, tool: link.id });
      return;
    }
    if (it.type === "target" && (!link || link.type === "robot")) {
      await mutate((w, tx) => {
        const t = w.items[it.id];
        if (t?.target) tx.set(t.id, { target: { ...t.target, robot: link?.id ?? null } });
      });
    }
  });
});

def("S_Tool_ptr", "S", async (c) => {
  const ht = await c.r.handle();
  const h = await c.r.handle();
  await c.exec(async () => {
    const tool = need(ht);
    const it = need(h);
    if (it.type === "program") {
      await cmd("program.addInstruction", { program: it.id, kind: "tool", tool: tool.id, after: insertAfter(it) });
    } else if (it.type === "robot") {
      if (generating(c.conn)) await record(c.conn, it, { kind: "tool", tool: tool.id });
      await cmd("robot.setActiveTool", { robot: it.id, tool: tool.id });
    }
  });
});

def("S_Robot", "S", async (c) => {
  const h = await c.r.handle();
  const hr = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    const robot = hr ? needRobot(hr) : undefined;
    await mutate((w, tx) => {
      const cur = w.items[it.id];
      if (cur?.program) tx.set(cur.id, { program: { ...cur.program, robot: robot?.id ?? null } });
      else if (cur?.target) tx.set(cur.id, { target: { ...cur.target, robot: robot?.id ?? null } });
    });
  });
});

def("G_LinkType", "TS", async (c) => {
  const h = await c.r.handle();
  const type = await c.r.int();
  await c.exec(() => {
    const it = need(h);
    const w = ws();
    let link: Item | undefined;
    if (it.type === "robot" && it.robot) {
      if (type === 3) link = it.robot.activeFrame ? w.items[it.robot.activeFrame] : undefined;
      if (type === 4) link = activeToolOf(w, it.id);
    } else if (it.type === "machining" && it.machining) {
       
      const m = it.machining;
      const id = type === 2 ? m.robot : type === 3 ? m.frame : type === 4 ? m.tool : type === 8 ? m.program : null;
      link = id ? w.items[id] : undefined;
    } else if (type === 2) {
      const rid = it.program?.robot ?? it.target?.robot ?? (it.type === "tool" ? it.parent : null);
      link = rid ? w.items[rid] : undefined;
      if (link?.type !== "robot") link = undefined;
    }
    writeItem(c.w, link);
  });
});

 

def("Target_Is_JT", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.int(need(h).target?.isJoint ? 1 : 0);
  });
});

async function setTargetType(c: Ctx, isJoint: boolean) {
  const h = await c.r.handle();
  await c.exec(async () => {
    const it = need(h);
    if (!it.target) throw new ApiError(3, `${it.name} is not a target`);
    await cmd("target.setJoint", { target: it.id, isJoint });
  });
}

def("S_Target_As_JT", "S", (c) => setTargetType(c, true));
def("S_Target_As_RT", "S", (c) => setTargetType(c, false));

 

const MOVE_LINEAR = 2;

interface MoveSpec {
  kind: number;
  values: number[];
  target: number;
}

async function readMoveSpec(c: Ctx): Promise<MoveSpec> {
  const kind = await c.r.int();
  const values = await c.r.array();
  const target = await c.r.handle();
  return { kind, values, target };
}

const busyIds = () => ws().busy ?? [];

 
export function robotBusy(id: string): boolean {
  return busyIds().includes(id);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

 
async function waitStarted(id: string, ms = 250) {
  const until = Date.now() + ms;
  while (!busyIds().includes(id) && Date.now() < until) await sleep(5);
}

 
export async function waitIdle(it: Item) {
  while (busyIds().includes(it.id)) await sleep(20);
}







function planApiMotion(w: Workspace, robot: Item, moveType: number, spec: MoveSpec): { joints: number[]; samples: number[][] } {
  const rd = robot.robot!;
  const linear = moveType === MOVE_LINEAR || moveType === 5;
  const ins: InstructionData = { kind: "move", moveType: linear ? "linear" : "joint" };
  if (spec.kind === 1) {
    const q = padJoints(robot, spec.values);
    if (!withinLimits(rd.model, q)) throw new ApiError(10, "Joint axes outside limits");
     
    ins.joints = rd.sync?.length && spec.values.length > q.length ? [...q, ...spec.values.slice(q.length)] : q;
  } else if (spec.kind === 2) {
     
    ins.pose = mul(robotRefAbs(w, robot), colMajorToMat(spec.values));
  } else {
    const t = byHandle(spec.target);
    if (!t) throw new ApiError(1);
    ins.target = t.id;
  }
  const fake: Item = { id: "__api_move", handle: 0, type: "instruction", name: linear ? "MoveL" : "MoveJ", parent: null, children: [], visible: true, pose: eye(), instruction: ins };
  const res = planMove(w, robot, motionState(w, robot), fake, planOptionsFromSettings(getServer().services.settings));
  if (!res.ok) throw new ApiError(10, res.error?.kind === "path" ? "" : "Target cannot be reached");
  return { joints: res.joints, samples: res.samples };
}

function planApiMove(w: Workspace, robot: Item, moveType: number, spec: MoveSpec): number[] {
  return planApiMotion(w, robot, moveType, spec).joints;
}

 
function recordedMove(robot: Item, linear: boolean, spec: MoveSpec): InstructionData {
  const data: InstructionData = { kind: "move", moveType: linear ? "linear" : "joint" };
  if (spec.kind === 3) data.target = need(spec.target).id;
  else if (spec.kind === 1) data.joints = padJoints(robot, spec.values);
  else data.pose = colMajorToMat(spec.values);
  return data;
}





async function quickMove(c: Ctx, robot: Item, moveType: number, spec: MoveSpec) {
  const linear = moveType === MOVE_LINEAR || moveType === 5;
  const res = planApiMotion(ws(), robot, moveType, spec);
  if (generating(c.conn)) await record(c.conn, robot, recordedMove(robot, linear, spec));
  addPath(c.conn, robot, res.samples);
  await setRobotJoints(robot, res.joints);
}

 
async function moveIntoProgram(prog: Item, moveType: number, spec: MoveSpec) {
  const linear = moveType === MOVE_LINEAR || moveType === 5;
  if (spec.kind === 3) {
    await cmd(linear ? "program.addMoveL" : "program.addMoveJ", { program: prog.id, target: need(spec.target).id, after: insertAfter(prog) });
    return;
  }
   
   
   
   
  const st = apiState();
  await mutate((w, tx) => {
    const p = w.items[prog.id];
    const prev = st.lastTargetless.get(p.id);
    const k = prev ? p.children.indexOf(prev) : -1;
    const data: InstructionData = { kind: "move", moveType: linear ? "linear" : "joint", index: k };
    if (spec.kind === 1) data.joints = spec.values.slice();
    else data.pose = colMajorToMat(spec.values);
    const after = k >= 0 ? prev! : insertAfter(p) ?? null;
    const ins = addInstruction(w, tx, p, data, after);
    st.lastTargetless.set(p.id, ins.id);
  });
}

async function moveCommand(c: Ctx, blocking: boolean): Promise<"raw"> {
  const moveType = await c.r.int();
  const spec = await readMoveSpec(c);
  const h = await c.r.handle();
  const robot = await c.exec(async () => {
    const it = need(h);
    if (it.type === "program") {
      await moveIntoProgram(it, moveType, spec);
      return null;
    }
    if (it.type !== "robot" || !it.robot) throw new ApiError(3, `${it.name} is not a robot`);
    if (quickMotion(c.conn)) {
      await quickMove(c, it, moveType, spec);
      return null;
    }
    const q = planApiMove(ws(), it, moveType, spec);
     
    await cmd("robot.moveJ", { robot: it.id, joints: q, linear: moveType === MOVE_LINEAR || moveType === 5 });
    await waitStarted(it.id);
    return it;
  });
  c.w.status(0);
  if (!blocking) return "raw";
   
  c.flush();
  if (robot) await waitIdle(robot);
  c.w.status(0);
  return "raw";
}

def("MoveX", "S", (c) => moveCommand(c, false));
def("MoveXb", "S", (c) => moveCommand(c, true));

 
function arcPoint(w: Workspace, robot: Item, m: MoveSpec): Mat {
  if (m.kind === 3) {
    const t = need(m.target);
    if (t.target?.isJoint && t.target.joints.length) return mul(mul(absPose(w, robot.id), fk(robot.robot!.model, t.target.joints)), toolPose(w, robot.id));
    return absPose(w, t.id);
  }
  if (m.kind === 1) return mul(mul(absPose(w, robot.id), fk(robot.robot!.model, padJoints(robot, m.values))), toolPose(w, robot.id));
  return mul(robotRefAbs(w, robot), colMajorToMat(m.values));
}

 
async function quickArc(c: Ctx, robot: Item, a: MoveSpec, b: MoveSpec) {
  const w = ws();
  const ins: InstructionData = { kind: "movec", pose: arcPoint(w, robot, a), pose2: arcPoint(w, robot, b) };
  const fake: Item = { id: "__api_movec", handle: 0, type: "instruction", name: "MoveC", parent: null, children: [], visible: true, pose: eye(), instruction: ins };
  const res = planMove(w, robot, motionState(w, robot), fake, planOptionsFromSettings(getServer().services.settings));
  if (!res.ok) throw new ApiError(10, res.error?.kind === "path" ? "" : "Target cannot be reached");
  if (generating(c.conn)) {
    const data: InstructionData = { kind: "movec" };
    if (a.kind === 3) data.target = need(a.target).id;
    else data.pose = mul(inv(robotRefAbs(w, robot)), ins.pose!);
    if (b.kind === 3) data.target2 = need(b.target).id;
    else data.pose2 = mul(inv(robotRefAbs(w, robot)), ins.pose2!);
    await record(c.conn, robot, data);
  }
  addPath(c.conn, robot, res.samples);
  await setRobotJoints(robot, res.joints);
}

async function moveCircular(c: Ctx, blocking: boolean): Promise<"raw"> {
  await c.r.int();  
  const a = await readMoveSpec(c);
  const b = await readMoveSpec(c);
  const h = await c.r.handle();
  let robot: Item | null = null;
  await c.exec(async () => {
    const it = need(h);
    if (it.type === "program") {
      if (a.kind !== 3 || b.kind !== 3) {
        throw new ApiError(
          3,
          "Adding a movement instruction to a program given joints or a pose is not supported. Use a target item instead, for example, add a target as with RDK.AddTarget(...) and set the pose or joints.",
        );
      }
      await cmd("program.addMoveC", { program: it.id, via: need(a.target).id, target: need(b.target).id, after: insertAfter(it) });
      return;
    }
    if (it.type !== "robot" || !it.robot) throw new ApiError(3, `${it.name} is not a robot`);
    const goal = (m: MoveSpec) => (m.kind === 3 ? { target: need(m.target).id } : m.kind === 1 ? { joints: padJoints(it, m.values) } : { pose: colMajorToMat(m.values) });
    if (quickMotion(c.conn)) {
      await quickArc(c, it, a, b);
      return;
    }
    await cmd("robot.moveC", { robot: it.id, via: goal(a), to: goal(b) });
    await waitStarted(it.id);
    robot = it;
  });
  c.w.status(0);
  if (blocking) {
    c.flush();
    if (robot) await waitIdle(robot);
    c.w.status(0);
  }
  return "raw";
}

def("MoveC", "S", (c) => moveCircular(c, false));
def("MoveCb", "S", (c) => moveCircular(c, true));

def("WaitMove", "SS", async (c) => {
  const h = await c.r.handle();
  const it = await c.exec(() => need(h));
  c.w.status(0);
  c.flush();
  await waitIdle(it);
  c.w.status(0);
  return "raw";
});

def("IsBusy", "IS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    c.w.int(robotBusy(need(h).id) ? 1 : 0);
  });
});

def("Stop", "S", async (c) => {
  const h = await c.r.handle();
  await c.exec(async () => {
    need(h);
     
    await cmd("sim.stop", {});
  });
});

 

 
function listRobot(h: number): Item | undefined {
  const it = byHandle(h);
  return it?.type === "robot" && it.robot ? it : undefined;
}

 
function robotOrFirst(h: number): Item | undefined {
  if (h) return listRobot(h);
  return descendants(ws(), activeStation().id).find((it) => it.type === "robot" && it.robot);
}

 
def("G_LFK", "S", async (c) => {
  const n = await c.r.int();
  const list: { q: number[]; h: number }[] = [];
  for (let i = 0; i < n; i++) list.push({ q: await c.r.array(), h: await c.r.handle() });
  await c.exec(() => {
    for (const e of list) {
      const r = listRobot(e.h);
      c.w.pose(r ? fk(r.robot!.model, padJoints(r, e.q)) : eye());
      c.w.int(r ? 1 : -1);
    }
  });
});

 
def("G_LIK", "S", async (c) => {
  const n = await c.r.int();
  const list: { pose: Mat; h: number }[] = [];
  for (let i = 0; i < n; i++) list.push({ pose: await c.r.pose(), h: await c.r.handle() });
  await c.exec(() => {
    for (const e of list) {
      const r = listRobot(e.h);
      c.w.array(r ? (ikClosest(r.robot!.model, e.pose, r.robot!.joints) ?? []) : []);
    }
  });
});

 
def("G_LIK_jnts", "S", async (c) => {
  const n = await c.r.int();
  const list: { pose: Mat; seed: number[]; h: number }[] = [];
  for (let i = 0; i < n; i++) list.push({ pose: await c.r.pose(), seed: await c.r.array(), h: await c.r.handle() });
  await c.exec(() => {
    for (const e of list) {
      const r = listRobot(e.h);
      c.w.array(r ? (ikClosest(r.robot!.model, e.pose, padJoints(r, e.seed)) ?? []) : []);
    }
  });
});

 
def("G_LIK_cmpl", "S", async (c) => {
  const n = await c.r.int();
  const list: { pose: Mat; h: number }[] = [];
  for (let i = 0; i < n; i++) list.push({ pose: await c.r.pose(), h: await c.r.handle() });
  await c.exec(() => {
    for (const e of list) {
      const r = robotOrFirst(e.h);
      const m = r ? ikComplete(r, e.pose) : { rows: 0, cols: 0, data: [] };
      c.w.matrix(m.rows, m.cols, m.data);
    }
  });
});

 
def("G_LThetas_Config", "S", async (c) => {
  const n = await c.r.int();
  const list: { q: number[]; h: number }[] = [];
  for (let i = 0; i < n; i++) list.push({ q: await c.r.array(), h: await c.r.handle() });
  await c.exec(() => {
    for (const e of list) {
      const r = listRobot(e.h);
      c.w.array(r ? jointsConfig(r.robot!.model, padJoints(r, e.q)) : []);
    }
  });
});

 






function filterTarget(r: Item, pose: Mat, approx: number[]): number[] | null {
  const seed = approx.length ? padJoints(r, approx) : r.robot!.joints;
  return ikClosest(r.robot!.model, flangeInBase(ws(), r, pose), seed);
}

def("FilterTarget", "HAS", async (c) => {
  const pose = await c.r.pose();
  const approx = await c.r.array();
  const h = await c.r.handle();
  await c.exec(() => {
    const invalid = (w: WireWriter) => w.pose(eye()).array([]);
    const r = robotOrFirst(h);
    if (!r) throw new ApiError(1, "", invalid);
    const q = filterTarget(r, pose, approx);
    if (!q) throw new ApiError(10, "Target can not be reached", invalid);
    c.w.pose(pose);
    c.w.array(q);
  });
});







def("FilterListTarget", "S", async (c) => {
  const h = await c.r.handle();
  const robot = await c.exec(() => robotOrFirst(h));
  if (!robot) {
    c.w.pose(eye()).array([]).status(1);
    return "raw";
  }
  const withJoints = await c.r.int();
  const n = await c.r.int();
  const list: { pose: Mat; approx: number[] }[] = [];
  for (let i = 0; i < n; i++) list.push({ pose: await c.r.pose(), approx: withJoints > 0 ? await c.r.array() : [] });
  await c.exec(() => {
    c.w.int(n);
    for (let i = 0; i < list.length; i++) {
      const r = ws().items[robot.id];
      const q = r?.robot ? filterTarget(r, list[i].pose, list[i].approx) : null;
      if (!q) {
        c.w.int(-2).status(10, `Target can not be reached. Index: ${i}`);
        return;
      }
      c.w.int(1).pose(list[i].pose).array(q);
    }
    c.w.status(0);
  });
  return "raw";
});

 

 
def("S_Htool", "S", async (c) => {
  const h = await c.r.handle();
  const pose = await c.r.pose();
  await c.exec(async () => {
    const it = need(h);
    if (it.type === "robot" && it.robot) await setRobotTool(it, pose);
    else if (it.type === "tool") await mutate((w, tx) => tx.set(it.id, { pose }));
    else throw new ApiError(1);
  });
});

def("G_Htool", "HS", async (c) => {
  const h = await c.r.handle();
  await c.exec(() => {
    const it = need(h, (w) => w.pose(eye()));
    c.w.pose(it.type === "robot" ? toolPose(ws(), it.id) : it.type === "tool" ? it.pose : eye());
  });
});

 
def("S_Frame_ptr", "S", (c) => COMMANDS.get("S_Link_ptr")!.run(c));





def("G_LinkObjId", "TS", async (c) => {
  const h = await c.r.handle();
  await c.r.int();
  await c.exec(() => {
    const r = robotOrFirst(h);
    if (!r) throw new ApiError(1, "", (w) => w.nullItem());
    writeItem(c.w, null);
  });
});

 

 
export function headerOf(rd: NonNullable<Item["robot"]>): number[] {
  if (rd.header && rd.header.length >= 4000) return rd.header.slice();
  const h = new Array<number>(4000).fill(0);
  h[0] = 1;
  h[1] = 4000;
  h[2] = 20;
  h[3] = 200;
  return h;
}





def("S_ParamCalibTool", "S", async (c) => {
  const h = await c.r.handle();
  const v = await c.r.array();
  await c.exec(async () => {
    const r = robotOrFirst(h);
    if (!r?.robot) throw new ApiError(1);
    await mutate((w, tx) => {
      const rd = w.items[r.id].robot!;
      const hd = headerOf(rd);
      if (v.length > 0) hd[151 * 20 + 5] = v[0];
      if (v.length > 3) for (let k = 0; k < 3; k++) hd[153 * 20 + k] = v[1 + k];
      if (v.length > 6) for (let k = 0; k < 3; k++) hd[154 * 20 + k] = v[4 + k];
      tx.set(r.id, { robot: { ...rd, header: hd } });
    });
  });
});

 

const SEQUENCE_DISPLAY_ROBOT_POSES = 256;
const SEQUENCE_DISPLAY_ROBOT_JOINTS = 2048;

 
def("Show_Seq", "S", async (c) => {
  const m = await c.r.matrix();
  const h = await c.r.handle();
  await c.exec(async () => {
    const r = needRobot(h);
    const joints: number[][] = [];
    for (let k = 0; k < m.cols; k++) joints.push(m.data.slice(k * m.rows, (k + 1) * m.rows));
    await cmd("robot.showSequence", { robot: r.id, joints });
  });
});

 
def("Show_SeqPoses", "S", async (c) => {
  const h = await c.r.handle();
  const [displayType = -1, timeout = -1] = await c.r.array();
  const n = await c.r.int();
  const joints = displayType > 0 && (displayType & SEQUENCE_DISPLAY_ROBOT_JOINTS) !== 0;
  const list: (number[] | Mat)[] = [];
  for (let i = 0; i < n; i++) list.push(joints ? await c.r.array() : await c.r.pose());
  await c.exec(async () => {
    const r = needRobot(h);
    if (joints) {
      await cmd("robot.showSequence", { robot: r.id, joints: list, timeoutMs: timeout });
      return;
    }
     
    const w = ws();
    const poses = (list as Mat[]).map((p) =>
      displayType > 0 && (displayType & SEQUENCE_DISPLAY_ROBOT_POSES) !== 0 ? mul(mul(inv(robotRefAbs(w, r)), mul(absPose(w, r.id), p)), toolPose(w, r.id)) : p,
    );
    await cmd("robot.showSequence", { robot: r.id, poses, timeoutMs: timeout });
  });
});

export { waitStarted };
