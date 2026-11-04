 
 
 
 
 
 
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRdkFile } from "@/engine/kinematics";
import { poseToXYZRPW } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { createFileServices } from "@/server/fileStore";
import { engine, hasLibraryFile, LIBRARY_FILE, qUncompress } from "../helpers";

type Engine = Awaited<ReturnType<typeof engine>>;
const id = (r: unknown) => (r as { id: string }).id;

async function withFiles() {
  const e = await engine();
  const dir = mkdtempSync(path.join(tmpdir(), "wpk2-"));
  e.services.files = createFileServices(dir);
  return { e, dir };
}

 
function describeStation(ws: Workspace, stationId: string) {
  const out: unknown[] = [];
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  const walk = (pid: string) => {
    for (const cid of ws.items[pid].children) {
      const it: Item = ws.items[cid];
      const row: Record<string, unknown> = { type: it.type, name: it.name, parent: ws.items[it.parent!].name, visible: it.visible };
      if (it.type !== "robot" && it.type !== "program" && it.type !== "instruction") row.pose = poseToXYZRPW(it.pose).map(r);
      if (it.target) row.target = { joints: it.target.joints.map(r), isJoint: it.target.isJoint, robot: it.target.robot ? ws.items[it.target.robot].name : null };
      if (it.robot) row.robot = { joints: it.robot.joints.map(r), links: it.robot.links.map((l) => l.length), activeTool: it.robot.activeTool ? ws.items[it.robot.activeTool].name : null };
      if (it.tool) row.meshes = it.tool.meshes.length;
      if (it.object) row.meshes = it.object.meshes.length;
      if (it.program) row.program = { robot: it.program.robot ? ws.items[it.program.robot].name : null, loop: it.params?.Loop ?? null };
      if (it.instruction) {
        const d = { ...it.instruction } as Record<string, unknown>;
         
         
        if ((d.kind === "frame" || d.kind === "tool") && !d.forcePose) delete d.pose;
        for (const k of ["target", "target2", "frame", "tool", "robot"]) if (typeof d[k] === "string") d[k] = ws.items[d[k] as string]?.name;
        for (const k of ["pose", "pose2"]) if (Array.isArray(d[k])) d[k] = poseToXYZRPW(d[k] as number[]).map(r);
        if (d.event) {
          const ev = { ...(d.event as Record<string, unknown>) };
          for (const k of ["tool", "frame"]) if (typeof ev[k] === "string") ev[k] = ws.items[ev[k] as string]?.name;
          if (Array.isArray(ev.objects)) ev.objects = (ev.objects as string[]).map((o) => ws.items[o]?.name);
          delete ev.positions;
          d.event = ev;
        }
        if (Array.isArray(d.joints)) d.joints = (d.joints as number[]).map(r);
        if (Array.isArray(d.refJoints)) d.refJoints = (d.refJoints as number[]).map(r);
        row.instruction = d;
      }
      if (it.notes) row.html = it.notes.html;
      if (it.python) row.code = it.python.code;
      out.push(row);
      walk(cid);
    }
  };
  walk(stationId);
  return out;
}

async function updates(e: Engine, stationId: string) {
  const res: Record<string, unknown> = {};
  for (const it of Object.values(e.ws.items)) {
    if (it.type !== "program") continue;
    let p: Item | undefined = it;
    while (p?.parent) p = e.ws.items[p.parent];
    if (p?.id !== stationId) continue;
    const u = (await e.run("program.update", { program: it.id })) as unknown as number[];
    res[it.name] = u.slice(0, 4).map((v) => Math.round(v * 1e4) / 1e4);
  }
  return res;
}

async function saveAndReopen(e: Engine, stationId: string, name: string) {
  const saved = (await e.run("station.saveRdk", { station: stationId, name })) as unknown as { path: string; records: number; skipped: unknown[] };
  const bytes = readFileSync(saved.path);
   
  if (process.env.WPK2_OUT) copyFileSync(saved.path, path.join(process.env.WPK2_OUT, path.basename(saved.path)));
  const res = (await e.run("station.openRdk", { base64: bytes.toString("base64") })) as unknown as { id: string; skipped: unknown[] };
  return { saved, bytes, reopened: res.id, res };
}

const UR5E = hasLibraryFile("robots", "UR5e.robot");

describe("station.saveRdk (.rdk station files written by Enginuity)", () => {
  it.skipIf(!UR5E)("a station built in Enginuity reads back with its frames, robot, tool, targets, programs and instructions", async () => {
    const { e } = await withFiles();
    const station = e.ws.activeStation!;
    await e.run("station.setParam", { key: "SizeBox", value: "150, 200, 150" });
    const robot = id(await e.run("library.load", { file: "UR5e.robot" }));
    const tool = id(await e.run("robot.addTool", { robot, name: "Gripper", xyzrpw: [0, 0, 120, 0, 0, 0] }));
    const frame = id(await e.run("item.addFrame", { name: "Table", xyzrpw: [400, -100, 0, 0, 0, 90] }));
    const home = id(await e.run("target.add", { name: "Home", parent: frame, robot, joints: [0, -90, 90, -90, -90, 0] }));
    const t1 = id(await e.run("target.add", { name: "T1", parent: frame, robot, joints: [20, -80, 100, -110, -90, 0] }));
    const t2 = id(await e.run("target.add", { name: "T2", parent: frame, robot, joints: [-30, -70, 80, -100, -90, 30] }));
    const prog = id(await e.run("program.add", { name: "Main", robot, targets: [home, t1, t2, home] }));
    await e.run("program.addInstruction", { program: prog, kind: "speed", linear: 250, joint: -1, linearAccel: -1, jointAccel: -1 });
    await e.run("program.addInstruction", { program: prog, kind: "rounding", rounding: 5 });
    await e.run("program.addInstruction", { program: prog, kind: "pause", pauseMs: 250 });
    await e.run("program.addInstruction", { program: prog, kind: "print", text: "cycle done" });
    await e.run("program.addInstruction", { program: prog, kind: "io", ioMode: "set", ioName: "5", ioValue: "1" });
    await e.run("program.addInstruction", { program: prog, kind: "io", ioMode: "wait", ioName: "Ready", ioValue: "1", timeoutMs: 1500 });
    await e.run("program.addInstruction", { program: prog, kind: "call", text: "Sub" });
    await e.run("program.addInstruction", { program: prog, kind: "frame", frame });
    await e.run("program.addInstruction", { program: prog, kind: "tool", tool });
    const folder = id(await e.run("item.addFolder", { name: "Docs" }));
    const notes = id(await e.run("item.addNotes", { name: "Readme", text: "<p>Enginuity cell</p>" }));
    await e.run("item.setParent", { item: notes, parent: folder });

    const before = describeStation(e.ws, station);
    const upBefore = await updates(e, station);
    const { saved, bytes, reopened, res } = await saveAndReopen(e, station, "Built cell");
    expect(saved.path.endsWith("Built cell.rdk")).toBe(true);
    expect(saved.skipped).toEqual([]);
    expect(res.skipped).toEqual([]);
    expect(describeStation(e.ws, reopened)).toEqual(before);
    expect(await updates(e, reopened)).toEqual(upBefore);
    expect(e.ws.items[reopened].stationParams).toEqual([["SizeBox", "150, 200, 150"]]);
     
     
    const live = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/programs/wpk2-rdk-probe-4.json"), "utf8")) as { cases: { file: string; items: number; update: Record<string, number[]> }[] };
    const cell = live.cases.find((c) => c.file === "Built cell.rdk")!;
    expect(cell.items).toBe(11);
    const [n, t, d, ok] = cell.update.Main;
    const mine = upBefore.Main as number[];
    expect([mine[0], mine[3]]).toEqual([n, ok]);
    expect(Math.abs(mine[1] - t)).toBeLessThan(1e-3);
    expect(Math.abs(mine[2] - d) / d).toBeLessThan(1e-6);
    expect(e.ws.items[reopened].name).toBe(e.ws.items[station].name);

     
     
    const raw = qUncompress(new Uint8Array(bytes));
    const u16 = (s: string) => Buffer.from(s, "utf16le");
    expect(raw.subarray(4, 4 + 36).equals(u16("Station File 01.01"))).toBe(true);
    const end = raw.lastIndexOf(u16("END TREE DATA"));
    expect(end).toBe(raw.length - 26 - 8);
    expect([...raw.subarray(raw.length - 8)]).toEqual([0xbd, 0, 0, 0, 0, 0, 0, 0]);
     
    const parsed = parseRdkFile(new Uint8Array(bytes)).json as { file_info: Record<string, unknown> };
    expect(parsed.file_info).toMatchObject({ flags: 0, min_build: 0, version: "Enginuity", platform: "Enginuity" });
  });

  it.skipIf(!UR5E)("never replaces an existing file without overwrite, and keeps Enginuity's format as the station's file", async () => {
    const { e } = await withFiles();
    await e.run("library.load", { file: "UR5e.robot" });
    const st = e.ws.activeStation!;
    const first = (await e.run("station.saveRdk", { name: "Cell" })) as unknown as { path: string };
    const again = await e.tryRun("station.saveRdk", { name: "Cell.rdk" });
    expect(again.ok).toBe(false);
    expect(again.error).toBe("“Cell.rdk” already exists. Do you want to replace it?");
    const forced = (await e.run("station.saveRdk", { name: "Cell", overwrite: true })) as unknown as { path: string };
    expect(forced.path).toBe(first.path);
    expect(e.ws.items[st].file).toBeUndefined();
    const own = (await e.run("station.save", {})) as unknown as { path: string };
    expect(own.path.endsWith(".mech")).toBe(true);
  });

  it("items without a model in the file are reported, not written", async () => {
    const { e } = await withFiles();
    await e.run("item.addFrame", { name: "F" });
     
    const st = e.ws.activeStation!;
    const r = (await e.run("station.saveRdk", { name: "Plain" })) as unknown as { skipped: unknown[]; records: number };
    expect(r.skipped).toEqual([]);
    expect(r.records).toBe(2);
    expect(e.ws.items[st].children.length).toBe(1);
  });
});

 
const STATIONS = ["Material-Handling-with-Motoman-HP20D.rdk", "Assembly-and-Material-Handling-with-Adept-Viper-s650.rdk", "Conveying-with-UR10.rdk"];

describe("library stations round trip through station.saveRdk", () => {
  for (const file of STATIONS) {
    it.skipIf(!hasLibraryFile("stations", file))(`${file}: every item, pose, link and instruction, and the same Update() numbers`, async () => {
      const { e } = await withFiles();
      const orig = (await e.run("station.openRdk", { base64: readFileSync(LIBRARY_FILE("stations", file)).toString("base64") })) as unknown as { id: string };
      const before = describeStation(e.ws, orig.id);
      const upBefore = await updates(e, orig.id);
      const { reopened, res, saved } = await saveAndReopen(e, orig.id, file);
      expect(saved.skipped).toEqual([]);
      expect(res.skipped).toEqual([]);
      expect(describeStation(e.ws, reopened)).toEqual(before);
      expect(await updates(e, reopened)).toEqual(upBefore);
      expect(e.ws.items[reopened].stationParams).toEqual(e.ws.items[orig.id].stationParams);
    });
  }

  it.skipIf(!hasLibraryFile("stations", "Material-Handling-with-Motoman-HP20D.rdk"))("the reference application updated the written copy exactly like the source file (live run, wpk2-rdk-probe-1)", () => {
    const probe = JSON.parse(readFileSync(path.join(__dirname, "../../research/evidence/programs/wpk2-rdk-probe-1.json"), "utf8")) as { cases: { file: string; update: Record<string, number[]>; names: string[] }[] };
    const [orig, written] = probe.cases;
    expect(written.file).toBe("Material-Handling-with-Motoman-HP20D-mb.rdk");
    expect(written.update).toEqual(orig.update);
    expect(written.update["Pick sequence"]).toEqual([15, 16.7324, 11141.0522, 1, ""]);
    expect(written.names).toEqual(orig.names);
  });

  it.skipIf(!hasLibraryFile("stations", "CAM-Contouring-Machining.rdk"))("binary station parameters are imported and written back", async () => {
    const { e } = await withFiles();
    const orig = (await e.run("station.openRdk", { base64: readFileSync(LIBRARY_FILE("stations", "CAM-Contouring-Machining.rdk")).toString("base64") })) as unknown as { id: string };
    const data = e.ws.items[orig.id].rdk?.dataParams ?? [];
    expect(data.map(([k, v]) => [k, Buffer.from(v, "base64").length])).toEqual([
      ["Scale-Object-Settings", 55],
      ["Scale-Object-Settings-Backup", 0],
    ]);
    expect(e.ws.items[orig.id].rdk?.attachDistance).toBe(200);
    const { reopened } = await saveAndReopen(e, orig.id, "cam.rdk");
    expect(e.ws.items[reopened].rdk?.dataParams).toEqual(data);
  });
});

describe("reader leftovers", () => {
  it.skipIf(!hasLibraryFile("stations", "Material-Handling-with-Mecademic-and-RoboDK.rdk"))("the textured Mecademic station opens completely (station flags 3: texture coordinates)", async () => {
    const { e } = await withFiles();
    const res = (await e.run("station.openRdk", { base64: readFileSync(LIBRARY_FILE("stations", "Material-Handling-with-Mecademic-and-RoboDK.rdk")).toString("base64") })) as unknown as {
      id: string;
      skipped: unknown[];
      fileInfo: { flags: number; version: string; build: number };
    };
    expect(res.skipped).toEqual([]);
    expect(res.fileInfo).toMatchObject({ flags: 3, version: "6.0.3", build: 26800 });
    const items = Object.values(e.ws.items);
    const robots = items.filter((i) => i.type === "robot" && i.name.startsWith("Mecademic"));
    expect(robots.length).toBeGreaterThan(0);
    expect(robots.every((r) => r.robot!.links.flat().length > 0)).toBe(true);
    const gripper = items.find((i) => i.type === "tool" && /EPick/i.test(i.name));
    expect(gripper?.tool?.geometryPose).toBeDefined();
  });
});
