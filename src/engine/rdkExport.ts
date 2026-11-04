 
 
 
 
 
 

import { absPose } from "./workspace";
import { eye, inv, mul, type Mat } from "./math";
import type { GeometryStore } from "./registry";
import type { InstructionData, Item, MeshRef, Workspace } from "./types";

 
interface Shape {
  triangles: number;
  rgba: [number, number, number, number];
  positions: number;
  normals?: number;
}

export interface RdkExport {
   
  station: { name: string; view: Mat | null; items: Record<string, unknown>[] };
  payload: Float32Array;
   
  skipped: { name: string; type: string; reason: string }[];
}

const isEye = (m: Mat | undefined | null) => !m || m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12);

 
const EVENT_BEHAVIORS: Record<string, number> = { attach: 0, detach: 1, "detach-all": 1, show: 2, hide: 3, move: 4, home: 6, conveyor: 7, create: 8, remove: 9, wait: 10, replace: 4 };
const MOVE_TYPES: Record<string, number> = { joint: 1, linear: 2, circular: 3, search: 5 };

function base64ToBytes(b64: string): number[] {
  const bin = atob(b64);
  const out = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}





export function buildRdkExport(ws: Workspace, stationId: string, geometry: GeometryStore, view?: Mat | null): RdkExport {
  const st = ws.items[stationId];
  const floats: number[] = [];
  const skipped: RdkExport["skipped"] = [];
  const items: Record<string, unknown>[] = [];
  const index = new Map<string, number>();
  let next = 1;
  index.set(stationId, 0);

   
  const writable = (it: Item) => ["frame", "robot", "tool", "object", "target", "program", "folder", "notes", "python", "curve"].includes(it.type);
  const order: Item[] = [];
   
  const baseFrames = new Map<string, number>();
  const walk = (id: string) => {
    for (const cid of ws.items[id]?.children ?? []) {
      const c = ws.items[cid];
      if (!c) continue;
      if (c.type === "instruction") continue;
      if (!writable(c)) {
        skipped.push({ name: c.name, type: c.type, reason: `${c.type} items are not stored in .rdk station files by Enginuity` });
        walk(cid);
        continue;
      }
      if (c.type === "robot" && !(c.robot?.header && c.robot.header.length === 4000)) {
        skipped.push({ name: c.name, type: c.type, reason: "the robot has no robot file header (only robots loaded from robot files can be stored)" });
        walk(cid);
        continue;
      }
      if (c.type === "robot" && !isEye(c.pose)) baseFrames.set(cid, next++);
      index.set(cid, next++);
      order.push(c);
      walk(cid);
    }
  };
  walk(stationId);
  const ref = (id?: string | null) => (id && index.has(id) ? index.get(id)! : -1);

   
  const parentIndex = (it: Item): number => {
    let p = it.parent;
    while (p && p !== stationId) {
      if (index.has(p)) return baseFrames.has(p) ? index.get(p)! : index.get(p)!;
      p = ws.items[p]?.parent ?? null;
    }
    return 0;
  };

   
  const shapesOf = (meshes: MeshRef[], g: Mat | null): Shape[] => {
    const out: Shape[] = [];
    for (const m of meshes) {
      const pos = geometry.get(m.geometry);
      if (!pos || pos.length < 9) continue;
      const nor = m.normals ? geometry.get(m.normals) : undefined;
      const n = Math.floor(pos.length / 9) * 9;
      const at = floats.length;
      for (let i = 0; i < n; i += 3) {
        const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
        if (g) floats.push(g[0] * x + g[1] * y + g[2] * z + g[3], g[4] * x + g[5] * y + g[6] * z + g[7], g[8] * x + g[9] * y + g[10] * z + g[11]);
        else floats.push(x, y, z);
      }
      let nAt: number | undefined;
      if (nor && nor.length >= n) {
        nAt = floats.length;
        for (let i = 0; i < n; i += 3) {
          const [x, y, z] = [nor[i], nor[i + 1], nor[i + 2]];
          if (g) floats.push(g[0] * x + g[1] * y + g[2] * z, g[4] * x + g[5] * y + g[6] * z, g[8] * x + g[9] * y + g[10] * z);
          else floats.push(x, y, z);
        }
      }
      out.push({ triangles: n / 9, rgba: m.color, positions: at, ...(nAt !== undefined ? { normals: nAt } : {}) });
    }
    return out;
  };
   
  const rows = (rs: number[][], g: Mat | null) =>
    rs.map((r) => {
      const [x, y, z] = r;
      const [i = 0, j = 0, k = 0] = r.slice(3);
      if (!g) return [x, y, z, i, j, k];
      return [
        g[0] * x + g[1] * y + g[2] * z + g[3],
        g[4] * x + g[5] * y + g[6] * z + g[7],
        g[8] * x + g[9] * y + g[10] * z + g[11],
        g[0] * i + g[1] * j + g[2] * k,
        g[4] * i + g[5] * j + g[6] * k,
        g[8] * i + g[9] * j + g[10] * k,
      ];
    });

   
  const extra = st.rdk ?? {};
  items.push({
    index: 0,
    parent: -1,
    kind: "station",
    name: st.name,
    visible: st.visible,
    params: st.stationParams ?? [],
    ...(extra.attachDistance !== undefined ? { attach_distance: extra.attachDistance } : {}),
    ...(extra.dataParams?.length ? { data_params: extra.dataParams.map(([k, v]) => [k, base64ToBytes(v)]) } : {}),
  });

  for (const it of order) {
    const base = { index: index.get(it.id)!, parent: parentIndex(it), name: it.name, visible: it.visible };
    switch (it.type) {
      case "frame":
        items.push({ ...base, kind: "frame", pose: it.pose });
        break;
      case "robot": {
        const r = it.robot!;
        if (baseFrames.has(it.id)) {
          items.push({ index: baseFrames.get(it.id)!, parent: base.parent, kind: "frame", name: `${it.name} Base`, visible: true, pose: it.pose });
          base.parent = baseFrames.get(it.id)!;
        }
        const links = r.links.map((ms) => shapesOf(ms, null));
        items.push({
          ...base,
          kind: "robot",
          joints: r.joints,
          robot: { header: r.header, links },
          active_frame: ref(r.activeFrame),
          active_tool: ref(r.activeTool),
          ...(r.sync?.length ? { sync: r.sync.map(ref).filter((x) => x >= 0) } : {}),
          ...(r.connection ? { connection: { ip: r.connection.ip, port: r.connection.port, remotePath: r.connection.remotePath, ftpUser: r.connection.ftpUser, ftpPass: r.connection.ftpPass } } : {}),
          ...(it.rdk?.robotTail ? { record_tail: base64ToBytes(it.rdk.robotTail) } : {}),
        });
        break;
      }
      case "tool":
      case "object":
      case "curve": {
         
         
        const data = it.type === "tool" ? it.tool : it.type === "object" ? it.object : undefined;
        const g = data?.geometryPose && !isEye(data.geometryPose) ? data.geometryPose : null;
        const gi = g ? inv(g) : null;
        const o = it.object;
        const curves = it.type === "curve" ? [{ name: it.name, rgba: [0, 0, 1, 1], points: rows(it.curve?.points ?? [], null) }] : (o?.curves ?? []).map((c) => ({ name: c.name ?? "", rgba: c.color ?? [0, 0, 1, 1], points: rows(c.points, gi) }));
        const points = o?.points?.length ? rows(o.points, gi) : [];
        items.push({
          ...base,
          kind: it.type === "tool" ? "tool" : "object",
          pose: it.type === "tool" ? eye() : it.pose,
          tcp: it.type === "tool" ? it.pose : eye(),
          ...(g ? { geometry_pose: g } : {}),
          links: [shapesOf(data?.meshes ?? [], gi)],
          ...(points.length ? { points, point_names: points.map((_, i) => o?.pointNames?.[i] ?? "") } : {}),
          ...(curves.length ? { curves } : {}),
          locked: !!it.locked,
        });
        break;
      }
      case "target": {
        const t = it.target!;
        items.push({ ...base, kind: "target", robot: ref(t.robot), is_joint: t.isJoint, unreachable: false, joints: t.joints, pose: it.pose });
        break;
      }
      case "program": {
        const robot = it.program?.robot ? ws.items[it.program.robot] : undefined;
        items.push({
          ...base,
          kind: "program",
          robot: ref(robot?.id),
          loop: it.params?.Loop === "1",
          ...(it.rdk?.programFlags ? { flags: it.rdk.programFlags } : {}),
          instructions: programInstructions(ws, it, robot, ref),
        });
        break;
      }
      case "folder":
        items.push({ ...base, kind: "folder" });
        break;
      case "notes":
        items.push({ ...base, kind: "notes", html: it.notes?.html ?? "" });
        break;
      case "python":
        items.push({ ...base, kind: "python", code: it.python?.code ?? "" });
        break;
    }
  }
  return { station: { name: st.name, view: view ?? null, items }, payload: Float32Array.from(floats), skipped };
}






function programInstructions(ws: Workspace, prog: Item, robot: Item | undefined, ref: (id?: string | null) => number): Record<string, unknown>[] {
  const baseAbs = robot ? absPose(ws, robot.id) : eye();
  const active = robot?.robot?.activeFrame && ws.items[robot.robot.activeFrame] ? robot.robot.activeFrame : null;
  let frameAbs: Mat = active ? absPose(ws, active) : baseAbs;
  const out: Record<string, unknown>[] = [];
  const kids = prog.children.map((id) => ws.items[id]).filter((i): i is Item => !!i && i.type === "instruction" && !!i.instruction);
  kids.forEach((item, index) => {
    const d = item.instruction as InstructionData;
    const head = { index, name: item.name };
    const rel = (p: Mat) => mul(inv(frameAbs), p);
    switch (d.kind) {
      case "move": {
        const mt = MOVE_TYPES[d.moveType ?? "joint"] ?? 1;
        if (d.target && ws.items[d.target]) out.push({ ...head, type: 0, move_type: mt, target: ref(d.target) });
        else {
          const isJoint = !!d.joints?.length;
          out.push({ ...head, type: 0, move_type: mt, target: -1, is_joint: isJoint, unreachable: false, joints: d.joints ?? d.refJoints ?? [], pose: d.pose ? rel(d.pose) : eye() });
        }
        break;
      }
      case "movec": {
        const refs = [d.target && ws.items[d.target] ? ref(d.target) : -1, d.target2 && ws.items[d.target2] ? ref(d.target2) : -1];
        const poses = [refs[0] < 0 && d.pose ? rel(d.pose) : null, refs[1] < 0 && d.pose2 ? rel(d.pose2) : null];
        out.push({ ...head, type: 1, move_type: 3, refs, poses, joints: [null, null], unreachable: [false, false] });
        break;
      }
      case "speed": {
        const s = d.speed ?? { linear: -1, joint: -1, linearAccel: -1, jointAccel: -1 };
        const on = (v: number) => v >= 0;
        const flags = (on(s.linear) ? 1 : 0) | (on(s.linearAccel) ? 2 : 0) | (on(s.joint) ? 4 : 0) | (on(s.jointAccel) ? 8 : 0);
        out.push({ ...head, type: 2, speed: { flags, linear: Math.max(0, s.linear), linear_accel: Math.max(0, s.linearAccel), joint: Math.max(0, s.joint), joint_accel: Math.max(0, s.jointAccel) } });
        break;
      }
      case "frame": {
         
        const frame = d.frame && ws.items[d.frame] ? d.frame : null;
        const stored = d.pose ? d.pose : frame ? mul(inv(baseAbs), absPose(ws, frame)) : eye();
        frameAbs = d.forcePose || !frame ? mul(baseAbs, stored) : absPose(ws, frame);
        out.push({ ...head, type: 3, ref: ref(frame), flag: d.forcePose ? 1 : 0, pose: stored });
        break;
      }
      case "tool": {
        const tool = d.tool && ws.items[d.tool] ? ws.items[d.tool] : undefined;
        out.push({ ...head, type: 4, ref: ref(tool?.id), flag: d.forcePose ? 1 : 0, pose: d.pose ?? tool?.pose ?? eye() });
        break;
      }
      case "robot":
        out.push({ ...head, type: 5, ref: ref(d.robot) });
        break;
      case "pause":
        out.push({ ...head, type: 6, pause_ms: d.pauseMs ?? -1 });
        break;
      case "rounding":
        out.push({ ...head, type: 10, rounding: d.rounding ?? -1 });
        break;
      case "print":
        out.push({ ...head, name: `Print: ${d.text ?? ""}`, type: 9, text: d.text ?? "" });
        break;
      case "code": {
         
        const ct = d.codeType ?? 1;
        const text = d.text ?? item.name;
        out.push({ ...head, name: ct === 0 ? `Call ${text}` : ct === 2 ? `Run ${text}` : text, type: 8, code_type: ct, text });
        break;
      }
      case "io": {
        const io = d.io!;
        const name = /^\d+$/.test(io.name) ? `${io.analog ? "AO" : "IO"}_${io.name}` : io.name;
        out.push({ ...head, type: 11, io: { mode: io.mode, name, value: io.value, timeout_ms: io.timeoutMs ?? -1 } });
        break;
      }
      case "event": {
        const e = d.event!;
        const stored = Number(item.params?.Behavior);
        const behavior = Number.isFinite(stored) && item.params?.Behavior !== undefined ? stored : e.action === "move" && e.relative ? 5 : EVENT_BEHAVIORS[e.action] ?? 0;
        const positions = e.positions ?? [];
        const objects = positions.length ? positions.map((p) => ref(p.item)) : (e.objects ?? (e.object ? [e.object] : [])).map(ref);
        out.push({
          ...head,
          type: 7,
          event: { behavior, tool: ref(e.tool), frame: ref(e.frame), objects, poses: positions.map((p) => p.pose), parents: positions.map((p) => ref(p.parent)), option: e.option ?? 0, distance: e.distance ?? 200 },
        });
        break;
      }
      default:
         
        out.push({ ...head, type: 8, code_type: 1, text: d.text ?? item.name });
    }
  });
  return out;
}
