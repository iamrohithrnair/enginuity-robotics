 
 
 
 

import { addInstruction } from "@/engine/commands/programs";
import { eye, type Mat } from "@/engine/math";
import { instructionName, instructionTreeLabel } from "@/engine/naming";
import type { InstructionData, Item, Workspace } from "@/engine/types";
import { ApiError, cmd, mutate, ws } from "./bridge";
import { apiState } from "./context";

const TYPE_OF: Record<InstructionData["kind"], number> = {
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

const EVENT_BEHAVIOR: Record<string, number> = { attach: 0, detach: 1, "detach-all": 1, show: 2, hide: 3, move: 4, home: 6, conveyor: 7, create: 8, remove: 9, wait: 10 };

 
function short(v: number, d = 3): string {
  const r = Number(v.toFixed(d));
  return Object.is(r, -0) ? "0" : String(r);
}

 
export function poseString(m: Mat | undefined): string {
  if (!m) return "rotz(0)";
  const b = Math.asin(Math.max(-1, Math.min(1, m[2])));
  let a: number;
  let c: number;
  if (Math.abs(Math.cos(b)) > 1e-9) {
    a = Math.atan2(-m[6], m[10]);
    c = Math.atan2(-m[1], m[0]);
  } else {
    a = 0;
    c = Math.atan2(m[4], m[5]);
  }
  const deg = (r: number) => (r * 180) / Math.PI;
  const parts: string[] = [];
  if ([m[3], m[7], m[11]].some((v) => Math.abs(v) > 5e-4)) parts.push(`transl(${short(m[3])},${short(m[7])},${short(m[11])})`);
  if (Math.abs(deg(a)) > 5e-4) parts.push(`rotx(${short(deg(a))})`);
  if (Math.abs(deg(b)) > 5e-4) parts.push(`roty(${short(deg(b))})`);
  if (Math.abs(deg(c)) > 5e-4) parts.push(`rotz(${short(deg(c))})`);
  return parts.length ? parts.join("*") : "rotz(0)";
}

const jointsString = (q: number[] | undefined) => (q?.length ? q : [0]).map((v) => v.toFixed(6)).join(",");
const ptr = (w: Workspace, id: string | null | undefined) => (id && w.items[id] ? String(w.items[id].handle) : "0");

 
export function instructionRecord(w: Workspace, it: Item): Record<string, unknown> {
  const ins = it.instruction!;
  const type = TYPE_OF[ins.kind] ?? 12;
  const future = Number(it.params?.FutureType ?? 0);
  if (future) return { Name: it.name, Type: future };
  const rec: Record<string, unknown> = { Type: type, Name: instructionTreeLabel(w, it) };
  switch (ins.kind) {
    case "move": {
      const t = ins.target ? w.items[ins.target] : undefined;
      rec.MoveType = ins.moveType === "linear" ? 2 : ins.moveType === "search" ? 5 : 1;
      rec.Joints = jointsString(t?.target?.joints ?? ins.joints);
      rec.Pose = poseString(t?.pose ?? ins.pose);
      rec.TargetPtr = ptr(w, ins.target);
      break;
    }
    case "movec": {
      const a = ins.target ? w.items[ins.target] : undefined;
      const b = ins.target2 ? w.items[ins.target2] : undefined;
      Object.assign(rec, { MoveType: 3, Joints: jointsString(a?.target?.joints), Joints2: jointsString(b?.target?.joints), Pose: poseString(a?.pose), Pose2: poseString(b?.pose) });
      break;
    }
    case "speed": {
      const s = ins.speed ?? { linear: -1, joint: -1, linearAccel: -1, jointAccel: -1 };
       
      Object.assign(rec, {
        Speed: s.linear >= 0 ? s.linear : 500,
        SpeedSet: s.linear >= 0 ? 1 : 0,
        Accel: s.linearAccel >= 0 ? s.linearAccel : 3000,
        AccelSet: s.linearAccel >= 0 ? 1 : 0,
        JointSpeed: s.joint >= 0 ? s.joint : 500,
        JointSpeedSet: s.joint >= 0 ? 1 : 0,
        JointAccel: s.jointAccel >= 0 ? s.jointAccel : 800,
        JointAccelSet: s.jointAccel >= 0 ? 1 : 0,
      });
      break;
    }
    case "frame": {
      const f = ins.frame ? w.items[ins.frame] : undefined;
      Object.assign(rec, { FrameName: f?.name ?? "Change Frame", FramePtr: ptr(w, ins.frame), Pose: poseString(f?.pose ?? ins.pose), ForcePose: 0 });
      break;
    }
    case "tool": {
      const t = ins.tool ? w.items[ins.tool] : undefined;
      Object.assign(rec, { ToolName: t?.name ?? "Set Tool", ToolPtr: ptr(w, ins.tool), Pose: poseString(t?.pose ?? ins.pose), ForcePose: 0 });
      break;
    }
    case "pause":
      rec.Pause = ins.pauseMs ?? -1;
      break;
    case "print":
      rec.Message = ins.text ?? "";
      break;
    case "code":
      Object.assign(rec, { Behavior: ins.codeType ?? 1, Code: ins.text ?? "" });
      break;
    case "rounding":
      rec.Rounding = ins.rounding ?? -1;
      break;
    case "io": {
      const io = ins.io ?? { mode: "set", name: "5", value: "1" };
      Object.assign(rec, { Behavior: io.mode === "wait" ? 1 : io.analog ? 2 : 0, IO_Name: io.name, IO_Value: io.value, IO_Timeout: io.mode === "wait" ? io.timeoutMs ?? -1 : -1 });
      break;
    }
    case "event": {
      const e = ins.event;
      const p = it.params ?? {};
      Object.assign(rec, {
        Behavior: p.Behavior !== undefined ? Number(p.Behavior) : e ? EVENT_BEHAVIOR[e.action] ?? 0 : 0,
        ToolPtr: ptr(w, e?.tool),
        FramePtr: ptr(w, e?.frame),
         
        ObjectList: (e?.objects ?? (e?.object ? [e.object] : [])).map((o) => ptr(w, o)).join(","),
         
         
         
        ParentList: e?.listParents?.length ? e.listParents.map((id) => ptr(w, id)).join(",") : "0",
        PoseList: e?.listPoses?.length ? e.listPoses.map((m) => poseString(m)).join(";") : "",
        AttachDistance: Number(p.AttachDistance ?? e?.distance ?? 200),
         
        AttachStrategy: Number(p.AttachStrategy ?? e?.option ?? 0),
      });
      break;
    }
    case "custom": {
      const p = it.params ?? {};
      Object.assign(rec, {
        Blocking: Number(p.Blocking ?? 0),
        CustomData: p.CustomData ?? "",
        EditCommand: p.EditCommand ?? "",
        LinePost: p.LinePost ?? "",
        PathIcon: p.PathIcon ?? "",
        PathRunRobot: p.PathRunRobot ?? "",
        PathRunSim: p.PathRunSim ?? "",
      });
      break;
    }
    default:
      break;
  }
  return Object.fromEntries(Object.entries(rec).sort(([a], [b]) => a.localeCompare(b)));
}

 
function defaultInstruction(type: number): { data: InstructionData; name: string; future?: number } {
  switch (type) {
    case 0:
      return { data: { kind: "move", moveType: "linear", joints: [0] }, name: "MoveL" };
    case 1:
      return { data: { kind: "movec", moveType: "circular" }, name: "MoveC" };
    case 2:
      return { data: { kind: "speed", speed: { linear: 500, joint: -1, linearAccel: 10, jointAccel: -1 } }, name: "Set speed (500.0 mm/s)" };
    case 3:
      return { data: { kind: "frame", frame: null }, name: "Change Frame" };
    case 4:
      return { data: { kind: "tool", tool: null }, name: "Set Tool" };
    case 5:
      return { data: { kind: "robot", robot: null }, name: "Select Robot" };
    case 6:
      return { data: { kind: "pause", pauseMs: 500 }, name: "Pause 500 ms" };
    case 7:
      return { data: { kind: "event" }, name: "Unset" };
    case 8:
      return { data: { kind: "code", codeType: 1, text: "" }, name: "" };
    case 9:
      return { data: { kind: "print", text: "set message" }, name: "set message" };
    case 10:
      return { data: { kind: "rounding", rounding: 5 }, name: "Smooth(5)" };
    case 11:
      return { data: { kind: "io", io: { mode: "set", name: "5", value: "1" } }, name: "Set IO_5=1" };
    case 12:
      return { data: { kind: "custom", text: "" }, name: "" };
    default:
       
      if (type >= 13) return { data: { kind: "custom", text: "" }, name: "", future: type };
      throw new ApiError(3, `Invalid instruction type ${type}`);
  }
}

 
 
function byPtr(w: Workspace, v: unknown): string | null {
  const h = Number(v);
  if (!(h > 0)) return null;
  for (const id in w.items) if (w.items[id].handle === h) return id;
  return null;
}

const EVENT_ACTION: Record<number, NonNullable<InstructionData["event"]>["action"]> = { 0: "attach", 1: "detach", 2: "show", 3: "hide", 4: "move", 5: "move", 6: "home", 7: "conveyor", 8: "create", 9: "remove", 10: "wait" };

 
function mergeEvent(w: Workspace, ins: InstructionData, f: Record<string, unknown>, params: Record<string, string>): boolean {
  const e = { ...(ins.event ?? { action: "attach" as const }) };
  let changed = false;
  if (f.Behavior !== undefined) {
    params.Behavior = String(f.Behavior);
    e.action = EVENT_ACTION[Number(f.Behavior)] ?? e.action;
    changed = true;
  }
  if (f.ToolPtr !== undefined) {
    e.tool = byPtr(w, f.ToolPtr);
    changed = true;
  }
  if (f.FramePtr !== undefined) {
    e.frame = byPtr(w, f.FramePtr);
    changed = true;
  }
  if (f.ObjectList !== undefined) {
    e.objects = String(f.ObjectList)
      .split(",")
      .map((x) => byPtr(w, x))
      .filter((x): x is string => !!x);
    e.listParents = e.objects.map((id) => w.items[id]?.parent ?? null);
    e.listPoses = e.objects.map((id) => w.items[id]?.pose ?? eye());
    changed = true;
  }
  if (f.AttachStrategy !== undefined) {
    params.AttachStrategy = String(f.AttachStrategy);
     
    if (e.action === "wait") {
      e.option = Number(f.AttachStrategy);
      changed = true;
    }
  }
  if (f.AttachDistance !== undefined) {
    params.AttachDistance = String(f.AttachDistance);
     
    if (Number(params.AttachStrategy ?? 0) >= 3) e.distance = Number(f.AttachDistance);
     
    if (e.action === "conveyor") {
      e.distance = Number(f.AttachDistance);
      changed = true;
    }
  }
  if (changed) ins.event = e;
  return changed || f.AttachStrategy !== undefined || f.AttachDistance !== undefined;
}

function mergeFields(ins: InstructionData, f: Record<string, unknown>): boolean {
  const num = (k: string) => (f[k] === undefined ? undefined : Number(f[k]));
  const str = (k: string) => (f[k] === undefined ? undefined : String(f[k]));
  let changed = false;
  const set = <K extends keyof InstructionData>(k: K, v: InstructionData[K] | undefined) => {
    if (v === undefined) return;
    ins[k] = v;
    changed = true;
  };
  switch (ins.kind) {
    case "pause":
      set("pauseMs", num("Pause"));
      break;
    case "rounding":
      set("rounding", num("Rounding"));
      break;
    case "print":
      set("text", str("Message"));
      break;
    case "code":
      set("text", str("Code"));
      set("codeType", num("Behavior"));
      break;
    case "speed": {
      const s = { ...(ins.speed ?? { linear: -1, joint: -1, linearAccel: -1, jointAccel: -1 }) };
      const pick = (val: string, flag: string, cur: number) => {
        const isSet = f[flag] !== undefined ? Number(f[flag]) !== 0 : cur >= 0 || f[val] !== undefined;
        const v = num(val) ?? (cur >= 0 ? cur : undefined);
        return isSet && v !== undefined ? v : -1;
      };
      const next = {
        linear: pick("Speed", "SpeedSet", s.linear),
        linearAccel: pick("Accel", "AccelSet", s.linearAccel),
        joint: pick("JointSpeed", "JointSpeedSet", s.joint),
        jointAccel: pick("JointAccel", "JointAccelSet", s.jointAccel),
      };
      if (JSON.stringify(next) !== JSON.stringify(s)) set("speed", next);
      break;
    }
    case "io": {
      const io = { ...(ins.io ?? { mode: "set" as const, name: "5", value: "1" }) };
      const b = num("Behavior");
      if (b !== undefined) {
        io.mode = b === 1 ? "wait" : "set";
        io.analog = b === 2;
      }
      if (f.IO_Name !== undefined) io.name = String(f.IO_Name);
      if (f.IO_Value !== undefined) io.value = String(f.IO_Value);
      if (f.IO_Timeout !== undefined) io.timeoutMs = Number(f.IO_Timeout);
      if (JSON.stringify(io) !== JSON.stringify(ins.io)) set("io", io);
      break;
    }
    case "move":
      if (f.MoveType !== undefined) set("moveType", Number(f.MoveType) === 2 ? "linear" : Number(f.MoveType) === 5 ? "search" : "joint");
      break;
    default:
      break;
  }
  return changed;
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const v = JSON.parse(value);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
     
  }
  throw new ApiError(3, "Invalid JSON instruction record");
}

 
export async function programInstructionCommand(prog: Item, name: string, value: string): Promise<string> {
  if (name === "Add") {
    const rec = parseRecord(value);
    const { data, name: insName, future } = defaultInstruction(Number(rec.Type ?? 6));
    await mutate((w, tx) => {
       
      const params: Record<string, string> = future ? { FutureType: String(future) } : {};
      if (data.kind === "event") mergeEvent(w, data, rec, params);
      else mergeFields(data, rec);
      const p = w.items[prog.id];
      const ref = apiState().insRef.get(p.id);
      const ins = addInstruction(w, tx, p, data, ref && p.children.includes(ref) ? ref : p.children.at(-1) ?? null);
      tx.set(ins.id, { name: typeof rec.Name === "string" ? rec.Name : insName, params });
    });
    return "OK";
  }
  const index = Number(name);
  const insId = prog.children[index];
  const it = insId ? ws().items[insId] : undefined;
  if (!it?.instruction) throw new ApiError(3, "Invalid instruction id");
  if (value === "") return JSON.stringify(instructionRecord(ws(), it));
  const rec = parseRecord(value);
  if (Number(rec.Type) === -1) {
    await cmd("item.delete", { items: [it.id] });
    return "OK";
  }
  await mutate((w, tx) => {
    const cur = w.items[it.id];
    const ins = structuredClone(cur.instruction!);
    const params = { ...(cur.params ?? {}) };
    const changed = ins.kind === "event" ? mergeEvent(w, ins, rec, params) : mergeFields(ins, rec);
     
     
    const regen = changed && ins.kind !== "event";
    const nextName = typeof rec.Name === "string" ? rec.Name : regen ? instructionName(w, ins) : cur.name;
    tx.set(cur.id, { instruction: ins, name: nextName, params });
  });
  return "OK";
}
