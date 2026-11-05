// Verifies machining project creation, generated paths, NC parsing, and program events.
 
 
 
 
 
 
 
 
 
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inv, mul } from "@/engine/math";
import type { Item } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import { engine } from "../helpers";

type Id = { id: string; name: string };

async function cell() {
  const e = await engine();
  await e.run("station.new", {});
  const robot = (await e.run("library.load", { file: "UR5e.robot" })) as unknown as Id;
  const tool = (await e.run("robot.addTool", { robot: robot.id, name: "T1", xyzrpw: [0, 0, 100, 0, 0, 0] })) as unknown as Id;
  const frame = (await e.run("item.addFrame", { name: "Part Frame" })) as unknown as Id;
  await e.run("item.setPose", { item: frame.id, pose: [1, 0, 0, 450, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
  await e.run("robot.setActiveFrame", { robot: robot.id, frame: frame.id });
  const part = (await e.run("object.addShape", { shape: "box", sizeX: 200, sizeY: 150, sizeZ: 50, parent: frame.id, name: "Part" })) as unknown as Id;
  return { e, robot, tool, frame, part };
}

function program(e: Awaited<ReturnType<typeof engine>>, name: string): Item[] {
  const p = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === name);
  if (!p) throw new Error(`no program ${name}`);
  return p.children.map((c) => e.ws.items[c]);
}

 
const rel = (e: Awaited<ReturnType<typeof engine>>, frameId: string, it: Item) => mul(inv(absPose(e.ws, frameId)), it.instruction!.pose!);
const pos = (m: number[]) => [m[3], m[7], m[11]].map((v) => Math.round(v * 1000) / 1000 + 0);
const zAxis = (m: number[]) => [m[2], m[6], m[10]].map((v) => Math.round(v * 1000) / 1000 + 0);

const TOP = [[-80, -30, 50, 0, 0, 1], [0, -30, 50, 0, 0, 1], [80, -30, 50, 0, 0, 1]];

describe("project naming (FUN_1003d6a6c and the per-kind creators)", () => {
  it("counts every type-11 item including the new one; point and 3D printing names have no number", async () => {
    const { e } = await cell();
    const names: string[] = [];
    for (const kind of ["curve", "curve", "point", "machining", "print3d", "weld"]) names.push(((await e.run("machining.add", { kind })) as unknown as Id).name);
    expect(names).toEqual(["Path1 settings", "Path2 settings", "Point settings", "Machining4 settings", "Print3D settings", "Weld6 settings"]);
    const proj = Object.values(e.ws.items).find((i) => i.name === "Path1 settings")!;
    expect(proj.type).toBe("machining");
    expect(e.ws.items[proj.parent!].type).toBe("station");
  });
});

describe("curve follow program", () => {
  it("has RoboDK's shape: header, MoveJ to the approach, approach, path, retract", async () => {
    const { e, robot, frame, part } = await cell();
    const curve = (await e.run("object.addCurve", { object: part.id, points: TOP })) as unknown as Id;
    const r = (await e.run("machining.add", { kind: "curve", robot: robot.id, object: curve.id })) as unknown as { name: string; program: string; ok: boolean; ratio: number; message: string };
    expect(r).toMatchObject({ name: "Path1 settings", program: "Path1", ok: true, ratio: 1, message: "Path solved successfully." });
    const ins = program(e, "Path1");
    expect(ins.map((i) => i.name)).toEqual([
      "Set speed (1000.0 mm/s)",
      "Set Ref.: Part Frame",
      "Set Tool: T1",
      "Show T1",
      "MoveJ 1",
      "MoveL 2",
      "MoveL 3",
      "MoveL 4",
      "Set speed (50.0 mm/s)",
      "MoveL 5",
      "MoveL 6",
      "Set speed (1000.0 mm/s)",
      "MoveL 7",
      "MoveL 8",
    ]);
    const moves = ins.filter((i) => i.instruction!.kind === "move");
     
    expect(moves.map((m) => pos(rel(e, frame.id, m)))).toEqual([
      [-80, -30, 150],
      [-80, -30, 150],
      [-80, -30, 50],
      [-80, -30, 50],
      [0, -30, 50],
      [80, -30, 50],
      [80, -30, 50],
      [80, -30, 150],
    ]);
     
    for (const m of moves) expect(zAxis(rel(e, frame.id, m))).toEqual([0, 0, -1]);
     
    const x0 = [moves[0].instruction!.pose![0], moves[0].instruction!.pose![4], moves[0].instruction!.pose![8]];
    for (const m of moves) expect(Math.hypot(m.instruction!.pose![0] - x0[0], m.instruction!.pose![4] - x0[1], m.instruction!.pose![8] - x0[2])).toBeLessThan(1e-9);
     
    expect(moves.every((m) => (m.instruction!.joints?.length ?? 0) === 6)).toBe(true);
     
    const upd = (await e.run("program.update", { program: "Path1" })) as unknown as [number, number, number, number, string];
    expect(upd[3]).toBe(1);
    expect(upd[0]).toBe(ins.length);
  });

  it("program events: path start after the approach, path finish after the rapid speed (Curve_Propeller)", async () => {
    const { e, robot, part } = await cell();
    const curve = (await e.run("object.addCurve", { object: part.id, points: TOP })) as unknown as Id;
    const p = (await e.run("machining.add", { kind: "curve", robot: robot.id })) as unknown as Id;
    await e.run("machining.setParams", {
      project: p.id,
      progEvents: { CallPathStart: "GrindStart", CallPathStartOn: 1, CallPathFinish: "GrindEnd", CallPathFinishOn: 1, RoundingOn: 1, Rounding: 1, CallProgStart: "GoHome", CallProgStartOn: 1 },
      approach: "Normal 10",
      retract: "Normal 10",
      machining: { SpeedRapid: 100, SpeedOperation: 20 },
    });
    await e.run("machining.setInput", { project: p.id, object: curve.id });
    const names = program(e, "Path1").map((i) => i.name);
    expect(names.slice(0, 11)).toEqual(["GoHome", "Smooth(1)", "Set speed (100.0 mm/s)", "Set Ref.: Part Frame", "Set Tool: T1", "Show T1", "MoveJ 1", "MoveL 2", "MoveL 3", "GrindStart", "MoveL 4"]);
    expect(names.slice(-5)).toEqual(["MoveL 6", "Set speed (100.0 mm/s)", "GrindEnd", "MoveL 7", "MoveL 8"]);
  });

  it("tangent approach and retract run along the path direction (Painting Path1)", async () => {
    const { e, robot, frame, part } = await cell();
    const curve = (await e.run("object.addCurve", { object: part.id, points: TOP })) as unknown as Id;
    const p = (await e.run("machining.add", { kind: "curve", robot: robot.id })) as unknown as Id;
    await e.run("machining.setParams", { project: p.id, approachRetract: "Tangent 30" });
    await e.run("machining.setInput", { project: p.id, object: curve.id });
    const moves = program(e, "Path1").filter((i) => i.instruction!.kind === "move");
    expect(pos(rel(e, frame.id, moves[0]))).toEqual([-110, -30, 50]);
    expect(pos(rel(e, frame.id, moves[moves.length - 1]))).toEqual([110, -30, 50]);
  });

  it("an unreachable path reports RoboDK's message and a ratio below 1", async () => {
    const { e, robot, part } = await cell();
    const far = TOP.map((r) => [r[0] + 3000, r[1], r[2], 0, 0, 1]);
    const curve = (await e.run("object.addCurve", { object: part.id, points: far, projection: 0 })) as unknown as Id;
    const r = (await e.run("machining.add", { kind: "curve", robot: robot.id, object: curve.id })) as unknown as { ok: boolean; ratio: number; message: string };
    expect(r.ok).toBe(false);
    expect(r.ratio).toBeLessThan(1);
    expect(["Can't find a start point", "The robot can't reach all targets in the path.<br>Try changing the preferred orientation or the position of the part.."]).toContain(r.message);
  });
});

describe("point follow program (Drilling-with-UR10e 407408_S1)", () => {
  it("visits each point approach → point → approach, rapid between points, last approach repeated", async () => {
    const { e, robot, frame, part } = await cell();
    const pts = (await e.run("object.addPoints", { object: part.id, points: [[-40, 0, 50, 0, 0, 1], [40, 0, 50, 0, 0, 1]] })) as unknown as Id;
    const r = (await e.run("machining.add", { kind: "point", robot: robot.id, object: pts.id })) as unknown as { name: string; program: string; ok: boolean };
    expect(r).toMatchObject({ name: "Point settings", program: "Point", ok: true });
    const ins = program(e, "Point");
    expect(ins.map((i) => i.name)).toEqual([
      "Set speed (1000.0 mm/s)",
      "Set Ref.: Part Frame",
      "Set Tool: T1",
      "Show T1",
      "MoveJ 1",
      "MoveL 2",
      "MoveL 3",
      "MoveL 4",
      "Set speed (50.0 mm/s)",
      "MoveL 5",
      "MoveL 6",
      "Set speed (1000.0 mm/s)",
      "MoveL 7",
      "Set speed (50.0 mm/s)",
      "MoveL 8",
      "MoveL 9",
      "MoveL 10",
      "Set speed (1000.0 mm/s)",
      "MoveL 11",
      "MoveL 12",
    ]);
    const z = ins.filter((i) => i.instruction!.kind === "move").map((m) => pos(rel(e, frame.id, m))[2]);
     
    expect(z).toEqual([170, 170, 70, 70, 50, 70, 70, 50, 70, 70, 70, 170]);
  });
});

describe("NC programs (G-code / APT)", () => {
  it("names the project and program after the file; feeds become speeds; G0 runs at the rapid speed", async () => {
    const { e, robot } = await cell();
    const text = "G21 G90\nG0 X0 Y0 Z10\nG1 Z0 F300\nG1 X50 Y0\nG1 X50 Y30 F600\nG0 Z10\n";
    const r = (await e.run("machining.openNc", { fileName: "probe-square 1.nc", text, robot: robot.id })) as unknown as { project: string; program: string };
    expect(r).toMatchObject({ project: "probe_square_1 Settings", program: "probe_square_1" });
    const names = program(e, "probe_square_1").map((i) => i.name);
    expect(names).toContain("Set speed (5.0 mm/s)");
    expect(names).toContain("Set speed (10.0 mm/s)");
    expect(names.indexOf("Set speed (5.0 mm/s)")).toBeLessThan(names.indexOf("Set speed (10.0 mm/s)"));
  });

  it("arcs are tessellated and helices rejected with RoboDK's message", async () => {
    const { e, robot } = await cell();
    const arc = "G21 G90 G17\nG0 X0 Y0 Z0\nG2 X20 Y0 I10 J0 F600\n";
    await e.run("machining.openNc", { fileName: "arc.nc", text: arc, robot: robot.id });
    expect(program(e, "arc").filter((i) => i.instruction!.kind === "move").length).toBeGreaterThan(30);
    const helix = "G21 G90\nG0 X0 Y0 Z10\nG1 Z0 F300\nG2 X10 Y0 Z-5 I5 J0\n";
    const res = await e.tryRun("machining.openNc", { fileName: "helix.nc", text: helix, robot: robot.id });
    expect(res.error).toBe("Helix movements are not supported. Use small circular or linear movements instead.");
  });

  it("APT: GOTO with a tool axis, FEDRAT, UNITS errors", async () => {
    const { e, robot } = await cell();
    await e.run("machining.openNc", { fileName: "probe-apt.apt", text: "UNITS/MM\nFEDRAT/MMPM,300\nGOTO/0,0,10,0,0,1\nGOTO/50,0,0,0,0,1\nGOTO/50,30,0,0,0,1\n", robot: robot.id });
    expect(program(e, "probe_apt").some((i) => i.name === "Set speed (5.0 mm/s)")).toBe(true);
    expect((await e.tryRun("machining.openNc", { fileName: "bad.apt", text: "UNITS/FEET\nGOTO/0,0,0\n", robot: robot.id })).error).toBe("Units must be set as UNITS/ MM|INCH");
    expect((await e.tryRun("machining.openNc", { fileName: "bad2.apt", text: "UNITS/MM\nGOTO/0,0\n", robot: robot.id })).error).toBe("APT movement instruction must have format GOTO/x,y,z,i,j,k");
  });

  it("spindle, tool change and extruder words become program calls (3D printing)", async () => {
    const { e, robot } = await cell();
    const g = "G21 G90\nT2 M6\nS12000 M3\nG0 X0 Y0 Z5\nG1 Z0 F600 E1.5\nG1 X10 E2.5\nM106\n";
    await e.run("machining.openNc", { fileName: "print.gcode", text: g, robot: robot.id, kind: "print3d" });
    const names = program(e, "print").map((i) => i.name);
     
     
     
    for (const c of ["SetTool(2)", "SetRPM(12000.0)", "Extruder(1.50000)", "Extruder(2.50000)"]) expect(names).toContain(c);
    const proj = Object.values(e.ws.items).find((i) => i.name === "print Settings")!;
    expect(proj.machining!.kind).toBe("print3d");
  });

  it("program event templates: M code parameters, M62…M65 outputs, %TOOL% / %REF% / %ROBOT% (DialogRPATHCallOpts)", async () => {
    const { e, robot } = await cell();
    const g = "G21 G90\nG0 X0 Y0 Z5\nM106 P1 S0.8\nG1 Z0 F600\nM64 P3\nM62 P1\nG1 X10\nM65 P3\nG1 X20\n";
    const r = (await e.run("machining.openNc", { fileName: "events.nc", text: g, robot: robot.id })) as unknown as { project: string };
    const proj = Object.values(e.ws.items).find((i) => i.name === r.project)!;
    await e.run("machining.setParams", { project: proj.id, progEvents: { Mcode: "RunCode_M(%1,%P,%S,%E) '%2'", CallProgStart: "Start(%TOOL%,%REF%,%ROBOT%)", CallProgStartOn: 1 }, update: true });
    const ins = program(e, "events").map((i) => i.instruction!);
    const calls = ins.filter((d) => d.kind === "code").map((d) => d.text);
    expect(calls).toEqual(["Start(T1,Part Frame,UR5e)", "RunCode_M(106,1,0.8,0) '106 P1 S0.8'", "OutOnMov(1)"]);
     
    expect(calls.some((c) => c?.startsWith("SetRPM"))).toBe(false);
    expect(ins.filter((d) => d.kind === "io").map((d) => [d.io!.name, d.io!.value])).toEqual([["3", "1"], ["3", "0"]]);
  });
});

describe("Update Robot Machining projects (FUN_1003da094)", () => {
  it("reports 'No machining projects found.' when there are none", async () => {
    const { e } = await cell();
    const r = (await e.run("machining.updateAll", {})) as unknown as { results: unknown[] };
    expect(r.results).toEqual([]);
    expect(e.events.some((ev) => ev.type === "status" && ev.text === "No machining projects found.")).toBe(true);
  });
  it("recomputes every project with a Success / FAILED line per program", async () => {
    const { e, robot, part } = await cell();
    const curve = (await e.run("object.addCurve", { object: part.id, points: TOP })) as unknown as Id;
    await e.run("machining.add", { kind: "curve", robot: robot.id, object: curve.id });
    await e.run("machining.add", { kind: "curve", robot: robot.id });
    await e.run("edit.select", { items: [] });
    const r = (await e.run("machining.updateAll", {})) as unknown as { report: string; title: string };
    expect(r.report).toBe("Program: Path1 -> Success<br>Program: Path2 -> FAILED<br>");
    expect(r.title).toBe("Warning");
  });
});

describe("Teach Target(s) on Surface", () => {
  it("creates a target on the surface with the tool Z into the surface", async () => {
    const { e, robot, part } = await cell();
    const t = (await e.run("target.teachOnSurface", { robot: robot.id, object: part.id, point: [450, 0, 80], normal: [0, 0, 1] })) as unknown as { id: string; reachable: boolean };
    const abs = absPose(e.ws, t.id);
    expect(pos(abs)).toEqual([450, 0, 50]);
    expect(zAxis(abs)).toEqual([0, 0, -1]);
    expect(t.reachable).toBe(true);
  });
  it("moves the robot to the target and teaches it in the active frame; an unreachable point creates nothing (FUN_10049bb90)", async () => {
    const { e, robot, frame, part } = await cell();
    const t = (await e.run("target.teachOnSurface", { robot: robot.id, object: part.id, point: [420, 30, 80], normal: [0, 0, 1] })) as unknown as { id: string; name: string; joints: number[] };
    const target = e.ws.items[t.id];
    expect([t.name, target.parent]).toEqual(["Target 1", frame.id]);
    expect(e.ws.items[robot.id].robot!.joints.map((v) => +v.toFixed(6))).toEqual(t.joints.map((v) => +v.toFixed(6)));
    expect(e.undo.list().undo.slice(-2)).toEqual(["Move robot: UR5e", "Add: Target 1"]);
    const before = [...e.ws.items[robot.id].robot!.joints];
    const count = Object.values(e.ws.items).filter((i) => i.type === "target").length;
    const far = (await e.run("target.teachOnSurface", { robot: robot.id, point: [5000, 0, 0], normal: [0, 0, 1] })) as unknown as { reachable: boolean; id?: string };
    expect(far).toEqual({ reachable: false });
    expect(Object.values(e.ws.items).filter((i) => i.type === "target").length).toBe(count);
    expect(e.ws.items[robot.id].robot!.joints).toEqual(before);
  });
});

describe("generated robot program", () => {
  it("curve follow programs go through the real post processor in the project's reference frame (Universal_Robots)", async () => {
    process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "rc-wpc-gen-"));
    const { generateProgram } = await import("@/server/post");
    const { e, robot, part } = await cell();
    e.services.post = generateProgram;
    const curve = (await e.run("object.addCurve", { object: part.id, points: TOP })) as unknown as Id;
    await e.run("machining.add", { kind: "curve", robot: robot.id, object: curve.id });
    const res = (await e.run("program.generate", { program: "Path1", post: "Universal_Robots" })) as unknown as { intermediate: string; files: { name: string; content: string }[] };
     
    expect(res.intermediate).toContain('r.setFrame(p(450,0,0,0,0,0),-1,r"""Part Frame""")');
    const moves = res.intermediate.split(/\r?\n/).filter((l) => /^r\.Move[JL]\(p\(/.test(l)).map((l) => l.slice(l.indexOf("p(") + 2).split(",").slice(0, 3).map(Number));
    expect(moves.slice(0, 4)).toEqual([[-80, -30, 150], [-80, -30, 150], [-80, -30, 50], [-80, -30, 50]]);
     
    const script = res.files.find((f) => f.name.endsWith(".script"))!.content;
    const frame = /p\[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+), 0\.000000, 0\.000000, 0\.000000\]/.exec(script.slice(script.indexOf("ref_frame")));
    const first = /movel\(pose_trans\(ref_frame,p\[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/.exec(script)!;
    const base = [1, 2, 3].map((k) => Math.round((Number(frame![k]) + Number(first[k])) * 1000));
    expect(base).toEqual([370, -30, 150]);
  });

  it("point follow and NC programs generate their calls and outputs through the post (Universal_Robots)", async () => {
    process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "rc-wpc-gen-"));
    const { generateProgram } = await import("@/server/post");
    const { e, robot, part } = await cell();
    e.services.post = generateProgram;
    const pts = (await e.run("object.addPoints", { object: part.id, points: [[-50, 0, 60, 0, 0, 1], [50, 0, 60, 0, 0, 1]], addToRef: true })) as unknown as Id;
    const pp = (await e.run("machining.add", { kind: "point", robot: robot.id, object: pts.id })) as unknown as Id;
    await e.run("machining.setParams", { project: pp.id, progEvents: { CallAction: "Drill", CallActionOn: 1 }, update: true });
    const point = (await e.run("program.generate", { program: "Point", post: "Universal_Robots" })) as unknown as { intermediate: string; files: { name: string }[] };
    const lines = point.intermediate.split(/\r?\n/);
     
    expect(lines[lines.findIndex((l) => l.startsWith("r.MoveL(p(-50,0,50,")) + 1]).toBe('r.RunCode(r"""Drill""", True)');
    expect(point.files.map((f) => f.name)).toEqual(["Point.script", "Point.urp"]);
    const g = "G21 G90\nG0 X0 Y0 Z5\nM106 P1 S0.8\nG1 Z0 F600\nM64 P3\nG1 X10\nM65 P3\nG1 X20\n";
    await e.run("machining.openNc", { fileName: "events.nc", text: g, robot: robot.id });
    const nc = (await e.run("program.generate", { program: "events", post: "Universal_Robots" })) as unknown as { intermediate: string };
    const calls = nc.intermediate.split(/\r?\n/).filter((l) => /^r\.(RunCode|setDO)/.test(l));
    expect(calls).toEqual(['r.RunCode(r"""M_RunCode(106)""", True)', "r.setDO(3,1)", "r.setDO(3,0)"]);
  });
});

describe("undo", () => {
  it("creating a project with its program is one undo step, and undo removes both", async () => {
    const { e, robot, part } = await cell();
    const curve = (await e.run("object.addCurve", { object: part.id, points: TOP })) as unknown as Id;
    const before = e.undo.list().undo.length;
    await e.run("machining.add", { kind: "curve", robot: robot.id, object: curve.id });
    expect(e.undo.list().undo.slice(before)).toEqual(["Add: Path1 settings"]);
    await e.undo.undo();
    expect(Object.values(e.ws.items).filter((i) => i.type === "machining" || i.type === "program")).toEqual([]);
  });
});

describe("Set Defaults (project menu ▸ More options)", () => {
  it("new projects start from the saved settings until the defaults are reset", async () => {
    const { e, robot } = await cell();
    const a = (await e.run("machining.add", { kind: "curve", robot: robot.id })) as unknown as Id;
    await e.run("machining.setParams", { project: a.id, machining: { SpeedOperation: 12 }, progEvents: { RoundingOn: 1, Rounding: 3 }, approach: "Tangent 40" });
    await e.run("machining.setDefaults", { project: a.id });
    const b0 = (await e.run("machining.add", { kind: "point", robot: robot.id })) as unknown as Id;
     
    expect([e.ws.items[b0.id].machining!.settings.SpeedOperation, e.ws.items[b0.id].machining!.events.RoundingOn]).toEqual([12, 0]);
    await e.run("machining.setDefaults", { project: a.id, what: "events" });
    const b = (await e.run("machining.add", { kind: "point", robot: robot.id })) as unknown as Id;
    const mb = e.ws.items[b.id].machining!;
    expect([mb.settings.SpeedOperation, mb.events.RoundingOn, mb.events.Rounding, mb.approach, mb.retract]).toEqual([12, 1, 3, "Tangent 40", "Normal 100"]);
     
    const w = (await e.run("machining.add", { kind: "weld", robot: robot.id })) as unknown as Id;
    expect([e.ws.items[w.id].machining!.events.CallPathStart, e.ws.items[w.id].machining!.events.CallPathStartOn]).toEqual(["ArcStart", 1]);
    await e.run("machining.setDefaults", { reset: true });
    const c = (await e.run("machining.add", { kind: "curve", robot: robot.id })) as unknown as Id;
    const mc = e.ws.items[c.id].machining!;
    expect([mc.settings.SpeedOperation, mc.events.RoundingOn, mc.approach]).toEqual([50, 0, "Normal 100"]);
  });
});
