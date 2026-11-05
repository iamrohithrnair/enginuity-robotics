// Defines sandbox script contracts, limits and robotics API examples.
 
 
 
 
 

import type { Origin } from "./registry";

 
export interface ScriptData {
  code: string;
}

export interface ScriptRunRequest {
  code: string;
  name: string;
   
  origin: Origin;
   
  itemId?: string;
   
  run?: string;
   
  keepOnError?: boolean;
}

export interface ScriptItemRef {
  id: string;
  name: string;
  type: string;
}

export interface ScriptGenerated {
  program: string;
  post: string;
  files: { name: string; path?: string; bytes: number; content?: string }[];
}

export interface ScriptRunResult {
  ok: boolean;
   
  run: string;
  name: string;
  logs: string[];
   
  truncated?: boolean;
  error?: { message: string; line?: number; column?: number; source?: string; stack?: string };
   
  result?: unknown;
   
  calls: number;
  ms: number;
  created: ScriptItemRef[];
  changed: ScriptItemRef[];
  deleted: ScriptItemRef[];
  generated: ScriptGenerated[];
   
  undo: string | null;
   
  reverted?: boolean;
}

 
export interface ScriptRunView {
  name: string;
   
  code: string | null;
  ok: boolean;
  error: { message: string; line: number | null } | null;
  logs: string[];
  truncated: boolean;
  calls: number;
  ms: number;
   
  created: string[];
  changed: string[];
  deleted: string[];
  counts: { created: number; changed: number; deleted: number };
  generated: ScriptGenerated[];
  undo: string | null;
  reverted: boolean;
}

export function scriptRunView(r: ScriptRunResult, code: string | null, max = 40): ScriptRunView {
  const names = (list: ScriptItemRef[]) => {
    const out = list.slice(0, max).map((i) => `${i.name} (${i.type})`);
    return list.length > max ? [...out, `… ${list.length - max} more`] : out;
  };
  return {
    name: r.name,
    code,
    ok: r.ok,
    error: r.error ? { message: r.error.message, line: r.error.line ?? null } : null,
    logs: r.logs.length > 300 ? r.logs.slice(-300) : r.logs,
    truncated: Boolean(r.truncated) || r.logs.length > 300,
    calls: r.calls,
    ms: r.ms,
    created: names(r.created),
    changed: names(r.changed),
    deleted: names(r.deleted),
    counts: { created: r.created.length, changed: r.changed.length, deleted: r.deleted.length },
    generated: r.generated,
    undo: r.undo,
    reverted: Boolean(r.reverted),
  };
}

export interface ScriptServices {
  run(req: ScriptRunRequest): Promise<ScriptRunResult>;
   
  stop(run: string): boolean;
   
  running(): { run: string; name: string; since: number }[];
}

 
export const SCRIPT_LIMITS = {
   
  timeMs: 180_000,
   
  calls: 20_000,
  memoryBytes: 128 * 1024 * 1024,
  stackBytes: 1024 * 1024,
   
  logBytes: 200_000,
} as const;

 
export const SCRIPT_REFERENCE = `Enginuity script API (JavaScript, runs on Enginuity's own engine; every call is a real command).
Globals: RDK (also Robolink() returns it), print()/console.log(), sleep(ms), call(command, params) for any Enginuity command.
Units: mm and degrees for joints; poses are 4x4 Mat (mm). Python robolink code ports with these changes:
  A*B -> A.mul(B) or mult(A, B, ...); M[i,j] -> M.get(i,j); True/False/None -> true/false/null; list comprehension -> loops/map.

Robolink (RDK):
  Item(name, type?) -> Item (invalid if not found; check .Valid())      ItemList(type?, names?) -> Item[] | string[]
  AddFrame(name, parent?, pose?) AddTarget(name, parent?, robot?, pose?) AddProgram(name, robot?) -> Item
    pose (Enginuity extension): a Mat or [x, y, z] relative to the parent; without it new frames are placed 1 m apart along Y
    like in the UI, so give a pose or call setPose. Robots and items can also be given by name ("UR5e").
  AddFile(libraryFile, parent?) loads from the robot library (e.g. "UR5e.robot", "RobotiQ-2F-85-Gripper-Open.tool")
  AddStation(name) ActiveStation() setActiveStation(st) Copy(item) Paste(parent?, times?) -> Item | Item[]
  Collisions() -> number of colliding pairs   setCollisionActive(COLLISION_ON|COLLISION_OFF)
  setSimulationSpeed(x) SimulationSpeed() RunProgram(name, wait?) ShowMessage(msg) getParam(k) setParam(k, v)
  Selection() setSelection(items) Version() Call(command, params)
  setRunMode(RUNMODE_SIMULATE | RUNMODE_QUICKVALIDATE | RUNMODE_MAKE_ROBOTPROG) RunMode()
  ProgramStart(name, folder?, post?, robot?): in RUNMODE_MAKE_ROBOTPROG, robot moves/speeds/IO/pauses that follow are
    recorded into program "name" and generated with the real post processor at the next ProgramStart or Finish().
  Finish(): flush pending generation (also done automatically when the script ends).

Item (any):
  Name() setName(n) Type() Valid() Parent() Childs() Visible() setVisible(v) setColor([r,g,b,a]) Delete() Copy()
  Pose() setPose(M): relative to the parent; robots: TCP relative to the robot's reference frame (setPose moves the joints)
  PoseAbs() setPoseAbs(M)   setParent(p) setParentStatic(p)   setParam(k, v) getParam(k)
Robot:
  Joints() -> Mat column (use .list())  setJoints(j)  JointsHome() setJointsHome(j) Home() JointLimits() -> [lower, upper]
  SolveFK(j) -> Mat (flange in robot base)  SolveIK(M, seed?) -> Mat (empty when unreachable)  SolveIK_All(M) -> Mat (one column per solution)
  JointsConfig(j) -> [rear, lower, flip, turns]   PoseTool() PoseFrame() setPoseTool(tool) setPoseFrame(frame) AddTool(M, name)
  MoveJ(target|joints|M) MoveL(...) MoveC(via, end): animate (RUNMODE_SIMULATE, waits until done), jump (QUICKVALIDATE), or record (MAKE_ROBOTPROG)
  setSpeed(lin, joint?, accLin?, accJoint?) setRounding(mm) Pause(ms) setDO(io, v) setAO(io, v) waitDI(io, v, timeoutMs?) RunInstruction(text, type?)
  Busy() WaitMove()
Program:
  MoveJ/MoveL(target|joints|M) MoveC(via, end) add instructions (M is relative to the program's setPoseFrame frame, else the robot's frame)
  setSpeed setRounding setPoseFrame setPoseTool Pause setDO setAO waitDI RunInstruction(text, INSTRUCTION_CALL_PROGRAM|INSERT_CODE|START_THREAD|COMMENT|SHOW_MESSAGE)
  Update(checkCollisions?) -> [validInstructions, timeS, distanceMm, ratioOk, message]  RunProgram() Busy() WaitFinished()
  MakeProgram(folder?) -> {post, files: [{name, path, bytes}]} (real post processor)  InstructionCount() Instruction(i) setRobot(robot)
Target: Joints() setJoints(j) isJointTarget() setAsJointTarget() setAsCartesianTarget() setRobot(robot)

robomath: Mat (new Mat(rows) | new Mat(m, n) zeros | new Mat([v...]) column) with mul add sub tr inv invH Pos setPos VX VY VZ setVX/VY/VZ
  Rot33 list() (first column) list2() (columns) tolist() (rows) get set size isHomogeneous Offset RelTool copy;
  eye(n) transl(x,y,z|[x,y,z]) rotx/roty/rotz(rad) invH mult pi
  pose_2_xyzrpw / xyzrpw_2_pose ([x,y,z,r,p,w] deg, H = transl*rotz(w)*roty(p)*rotx(r))  Pose_2_TxyzRxyz / TxyzRxyz_2_Pose (rad)
  Pose_2_KUKA KUKA_2_Pose Pose_2_ABB (xyz + quaternion) Pose_2_UR UR_2_Pose (rotation vector) Pose_2_Staubli Pose_2_Fanuc Pose_2_Motoman
  pose_2_quaternion quaternion_2_pose  Offset(H,x,y,z,rx,ry,rz) = transl*rotx*roty*rotz*H  RelTool(H,...) = H*transl*rotx*roty*rotz (deg)
  point_Zaxis_2_pose(p, z, hint1?, hint2?) cross dot norm normalize3 add3 subs3 mult3 distance angle3
Not in the API (common slips): RDK.getItem (use RDK.Item), indexing a Mat like an array (use M.get(row, col), M.Pos(),
  pose_2_xyzrpw(M)), Python's A*B (use A.mul(B)). robomath functions are globals (RDK.transl etc. also work).
Constants: ITEM_TYPE_STATION/ROBOT/FRAME/TOOL/OBJECT/TARGET/CURVE/PROGRAM/INSTRUCTION/PROGRAM_PYTHON/MACHINING/FOLDER/CAMERA/NOTES/SCRIPT/ANY,
  RUNMODE_*, INSTRUCTION_*, COLLISION_ON/OFF.
Limits: ${SCRIPT_LIMITS.timeMs / 1000} s, ${SCRIPT_LIMITS.calls} engine calls, ${SCRIPT_LIMITS.memoryBytes / 1048576} MB, ${SCRIPT_LIMITS.logBytes / 1000} kB of output. No file system or network access.
The whole run is one undo step ("Script: <name>"). A run that fails or is stopped is undone completely (reverted: true;
generated files stay), so fix the script and run it again; pass keepOnError: true to keep its changes instead.`;

export const SCRIPT_EXAMPLES: { name: string; code: string }[] = [
  {
    name: "Pallet grid program",
    code: `// 3 x 4 pallet of approach + place targets, then a program that visits them
const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
if (!robot) throw new Error("Add a robot first (Library)");
const pallet = RDK.AddFrame("Pallet");
pallet.setPose(transl(450, -150, 0));
const prog = RDK.AddProgram("Palletize", robot);
prog.setPoseFrame(pallet);
prog.setSpeed(500);
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 4; j++) {
    const place = transl(i * 100, j * 80, 100).mul(rotx(pi));
    const t = RDK.AddTarget("Place " + (i * 4 + j + 1), pallet, robot);
    t.setPose(place);
    prog.MoveJ(Offset(place, 0, 0, 100));
    prog.MoveL(t);
    prog.setDO(1, 0);
    prog.MoveL(Offset(place, 0, 0, 100));
  }
}
print("Program:", prog.Update());`,
  },
  {
    name: "Generate a program from robot moves",
    code: `// Record robot moves straight into a generated controller program
const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
RDK.setRunMode(RUNMODE_MAKE_ROBOTPROG);
RDK.ProgramStart("Square", "", "", robot);
const home = robot.Pose();
robot.setSpeed(200);
for (const [x, y] of [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]) robot.MoveL(Offset(home, x, y, 0));
RDK.Finish();`,
  },
  {
    name: "Collision sweep of joint 1",
    code: `// Rotate joint 1 in 10 degree steps and report the poses that collide
const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
const start = robot.Joints().list();
const hits = [];
for (let a = -180; a <= 180; a += 10) {
  const q = start.slice(); q[0] = a;
  robot.setJoints(q);
  if (RDK.Collisions() > 0) hits.push(a);
}
robot.setJoints(start);
print("Colliding J1 angles:", hits.length ? hits.join(", ") : "none");`,
  },
  {
    name: "Generate every program",
    code: `// Check and generate every program of the station with its robot's post processor
for (const p of RDK.ItemList(ITEM_TYPE_PROGRAM)) {
  const [valid, time, dist, ok, msg] = p.Update();
  const out = p.MakeProgram();
  print(p.Name(), ok === 1 ? "OK" : msg, "-", out.files.map((f) => f.name).join(", "));
}`,
  },
];
