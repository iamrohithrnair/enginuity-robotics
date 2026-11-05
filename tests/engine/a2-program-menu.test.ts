// Verifies program-menu toggles, path checks, target recalculation, and generation.
 
 
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { instructionEditor, registerInstructionEditor } from "@/components/inspector/instructionEditors";
import { alignedRotation } from "@/engine/commands/targets";
import { mul, poseToXYZRPW, rotz, roty, transl, xyzrpwToPose, DEG } from "@/engine/math";
import { engine } from "../helpers";

const id = (r: unknown) => (r as { id: string }).id;
const HINT = "(one or more targets are not reachable, a linear move is not possible or the robot tool and reference frames are not properly set).";

async function cell() {
  const e = await engine();
  const asks: { html: string; title?: string }[] = [];
  e.services.ask = async (html, _b, title) => {
    asks.push({ html, title });
    return "OK";
  };
  const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
  await e.run("robot.setJoints", { robot, joints: [0, 0, 0, 0, 30, 0] });
  const t1 = id(await e.run("target.teach", { robot, name: "Home" }));
  await e.run("robot.setJoints", { robot, joints: [30, 10, -10, 0, 40, 0] });
  const t2 = id(await e.run("target.teach", { robot, name: "Pick" }));
  const prog = id(await e.run("program.add", { name: "Main", robot }));
  await e.run("program.addMoveJ", { program: prog, target: t1 });
  await e.run("program.addMoveL", { program: prog, target: t2 });
  const statuses = () => e.events.filter((x) => x.type === "status").map((x) => String(x.text));
  return { e, asks, robot, t1, t2, prog, statuses };
}


describe("program menu check boxes", () => {
  it("Show Instructions, Display Path and Locked for one or several programs", async () => {
    const { e, prog, robot } = await cell();
    const other = id(await e.run("program.add", { name: "Other", robot }));
    const r = (await e.run("program.setFlags", { programs: [prog, other], displayPath: true, showInstructions: false })) as unknown as { program: string; showInstructions: boolean; displayPath: boolean; locked: boolean }[];
    expect(r).toEqual([
      { program: "Main", showInstructions: false, displayPath: true, locked: false },
      { program: "Other", showInstructions: false, displayPath: true, locked: false },
    ]);
    await e.run("program.setFlags", { programs: [prog], locked: true });
    expect(e.ws.items[prog].program?.locked).toBe(true);
    expect(e.ws.items[other].program?.locked).toBeFalsy();
  });
});

describe("several programs ▸ Make Main Program", () => {
  it("creates MainProgram calling the programs in order with the first program's robot", async () => {
    const { e, prog, robot } = await cell();
    const b = id(await e.run("program.add", { name: "Second", robot }));
    const r = (await e.run("program.makeMain", { programs: [b, prog] })) as unknown as { id: string; name: string; calls: string[] };
    expect(r.name).toBe("MainProgram");
    expect(r.calls).toEqual(["Second", "Main"]);
    expect(e.ws.items[r.id].program?.robot).toBe(robot);
    const calls = e.ws.items[r.id].children.map((c) => e.ws.items[c].instruction);
    expect(calls.map((c) => [c?.kind, c?.codeType, c?.text])).toEqual([
      ["code", 0, "Second"],
      ["code", 0, "Main"],
    ]);
    expect(e.ws.selection).toEqual([r.id]);
  });
});

describe("Check Path (F5) and Check Path and Collisions (Shift+F5)", () => {
  it("success texts; with collisions the title also goes to the status bar", async () => {
    const { e, prog, asks, statuses } = await cell();
    const ok = (await e.run("program.check", { program: prog }, "ui")) as unknown as { ok: boolean; title: string; message: string };
    expect(ok).toMatchObject({ ok: true, title: "Main program check success", message: "No problems found for this path" });
    expect(asks.at(-1)).toEqual({ html: "No problems found for this path", title: "Main program check success" });
    const col = (await e.run("program.check", { program: prog, collisions: true }, "ui")) as unknown as { ok: boolean; message: string };
    expect(col).toMatchObject({ ok: true, message: "No problems found for this path<br>No collisions detected." });
    expect(statuses()).toContain("Main program check success");
     
    const n = asks.length;
    await e.run("program.check", { program: prog }, "agent");
    expect(asks).toHaveLength(n);
  });

  it("names the first instruction that fails", async () => {
    const { e, prog, robot } = await cell();
    const far = id(await e.run("target.add", { name: "Far", robot, xyzrpw: [5000, 0, 300, 180, 0, 180], joints: [0, 0, 0, 0, 30, 0], isJoint: false }));
    await e.run("program.addMoveL", { program: prog, target: far });
    const r = (await e.run("program.check", { program: prog })) as unknown as { ok: boolean; title: string; message: string; validInstructions: number };
    expect(r.ok).toBe(false);
    expect(r.title).toBe("Main program check failed");
    expect(r.message).toBe(`Path failed at instruction 3: <strong>MoveL (Far)</strong><br>${HINT}`);
    expect(r.validInstructions).toBe(2);
  });

  it("a program without robot", async () => {
    const { e } = await cell();
    const p = id(await e.run("program.add", { name: "Lonely" }));
    await e.run("program.setRobot", { program: p, robot: null });
    const r = (await e.run("program.check", { program: p })) as unknown as { ok: boolean; title: string; message: string };
    expect(r).toMatchObject({ ok: false, title: "Lonely program check failed", message: "Select a robot for this program" });
  });
});

describe("Recalculate Targets", () => {
  it("re-solves the joints of Cartesian targets after their frame moved", async () => {
    const { e, robot } = await cell();
    const work = id(await e.run("item.addFrame", { name: "Work" }));
    await e.run("robot.setActiveFrame", { robot, frame: work });
    const t2 = id(await e.run("target.teach", { robot, name: "Place" }));
    const prog = id(await e.run("program.add", { name: "Main2", robot }));
    await e.run("program.addMoveL", { program: prog, target: t2 });
    const before = e.ws.items[t2].target!.joints.slice();
    await e.run("item.setPose", { item: work, pose: mul(e.ws.items[work].pose, transl(20, 0, 0)) });
    const r = (await e.run("program.recalculateTargets", { program: prog })) as unknown as { target: string; ok: boolean }[];
    expect(r).toEqual([{ target: "Place", ok: true }]);
    expect(e.ws.items[t2].target!.joints).not.toEqual(before);
    expect(e.undo.list().undo.at(-1)).toBe("Recalculate Targets: Main2");
  });
});

describe("Generate Program(s) (F6)", () => {
  async function withPost() {
    process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "rc-a2-gen-"));
    const { generateProgram } = await import("@/server/post");
    const c = await cell();
    c.e.services.post = generateProgram;
    return c;
  }

  it("generates the programs in order: 'Generating X ...' then 'Done generating programs (n/n generated)'", async () => {
    const { e, prog, robot, statuses } = await withPost();
    const b = id(await e.run("program.add", { name: "Second", robot }));
    await e.run("program.addMoveJ", { program: b, joints: [0, -10, 20, 0, 30, 0] });
    const r = (await e.run("program.generateMany", { programs: [prog, b] }, "ui")) as unknown as { generated: number; tried: number; programs: { program: string; ok: boolean; files?: string[] }[] };
    expect(r.generated).toBe(2);
    expect(r.programs.map((x) => [x.program, x.ok, x.files])).toEqual([
      ["Main", true, ["Main.mod"]],
      ["Second", true, ["Second.mod"]],
    ]);
    expect(statuses()).toEqual(expect.arrayContaining(["Generating Main ...", "Generating Second ...", "Done generating programs (2/2 generated)"]));
  });

  it("stops at the first failure and shows RoboDK's 'Failed to generate pogram(s)' window", async () => {
    const { e, prog, asks, statuses } = await withPost();
    const bad = id(await e.run("program.add", { name: "NoRobot" }));
    await e.run("program.setRobot", { program: bad, robot: null });
    const later = id(await e.run("program.add", { name: "Later" }));
    const r = (await e.run("program.generateMany", { programs: [prog, bad, later] }, "ui")) as unknown as { generated: number; tried: number };
    expect([r.generated, r.tried]).toEqual([1, 2]);
    expect(statuses()).toContain("Done generating programs (1/2 generated)");
    expect(statuses()).not.toContain("Generating Later ...");
    const w = asks.at(-1)!;
    expect(w.title).toBe("Failed to generate pogram(s)");
    expect(w.html.startsWith("Warning.<br>Problems occurred generating the following programs:<br><br>NoRobot<br>---------------------------------<br>Log for program Main:<br>")).toBe(true);
    expect(w.html).toContain("<br>---------------------------------<br>Log for program NoRobot:<br>Invalid robot for program");
  });

  it("without programs: 'No available programs to generate.'", async () => {
    const { e, statuses } = await withPost();
    await e.run("item.select", { items: [] }).catch(() => undefined);
    e.ws.selection = [];
    const r = (await e.run("program.generateMany", {})) as unknown as { tried: number };
    expect(r.tried).toBe(0);
    expect(statuses()).toContain("No available programs to generate.");
  });

  it("one program: progress and done statuses", async () => {
    const { e, prog, statuses } = await withPost();
    await e.run("program.generate", { program: prog });
    expect(statuses()).toEqual(expect.arrayContaining(["Generating program. Please wait... (0%) Main", "Done generating Main"]));
  });
});

describe("target menu", () => {
  it("Robot Configurations (F4) lists the configurations; one is stored without moving the target", async () => {
    const { e, robot } = await cell();
     
    await e.run("robot.setJoints", { robot, joints: [30, 10, -10, 40, 40, 0] });
    const t2 = id(await e.run("target.teach", { robot, name: "Pick" }));
    const pose = e.ws.items[t2].pose.slice();
    const r = (await e.run("target.configurations", { target: t2, recommended: true })) as unknown as { configurations: { id: number; frontRear: string; elbow: string; wrist: string; joints: number[] }[] };
    const labels = r.configurations.map((c) => `${c.frontRear}, ${c.elbow}, ${c.wrist}`);
    expect(labels).toContain("Front, Elbow Up, Non-Flip");
    expect(new Set(labels).size).toBe(labels.length);
    const current = r.configurations.find((c) => c.joints.every((v, k) => Math.abs(v - [30, 10, -10, 40, 40, 0][k]) < 1e-3));
    expect(current).toBeDefined();
    const other = r.configurations.find((c) => c !== current)!;
    const set = (await e.run("target.setConfiguration", { target: t2, config: `${other.frontRear}, ${other.elbow}, ${other.wrist}` })) as unknown as { joints: number[] };
    expect(set.joints).toEqual(other.joints);
    expect(e.ws.items[t2].pose).toEqual(pose);
    expect(e.ws.items[t2].target?.robot).toBe(robot);
    expect(e.undo.list().undo.at(-1)).toBe("Move target: Pick");
    const all = (await e.run("target.configurations", { target: t2, showAll: true })) as unknown as { configurations: unknown[] };
    expect(all.configurations.length).toBeGreaterThan(r.configurations.length);
    expect((await e.tryRun("target.setConfiguration", { target: t2 })).error).toBe("Give the joints or the configuration to use");
  });

  it("Preview Targets (F5) sends the robot joints of each target to the views", async () => {
    const { e, t1, t2, robot } = await cell();
    await e.run("target.preview", { targets: [t1, t2] });
    const ev = e.events.filter((x) => x.type === "preview-targets").at(-1)!;
    expect(ev.robot).toBe(robot);
    expect((ev.joints as number[][]).map((q) => q.map((v) => Math.round(v * 1000) / 1000))).toEqual([
      [0, 0, 0, 0, 30, 0],
      [30, 10, -10, 0, 40, 0],
    ]);
  });

  it("Align Target Orientation snaps to the closest frame-aligned orientation and keeps the position", async () => {
    const tilted = mul(transl(10, 20, 30), mul(rotz(7 * DEG), roty(178 * DEG)));
    const a = alignedRotation(tilted);
    const r6 = (m: number[]) => poseToXYZRPW(m).map((v) => Math.round(v * 1e6) / 1e6 || 0);
    expect(r6(a)).toEqual(r6(mul(transl(10, 20, 30), roty(180 * DEG))));
    const { e, t2 } = await cell();
    const p = e.ws.items[t2].pose;
    const r = (await e.run("target.alignOrientation", { target: t2 })) as unknown as { changed: boolean };
    expect(r.changed).toBe(true);
    const q = e.ws.items[t2].pose;
    expect([q[3], q[7], q[11]]).toEqual([p[3], p[7], p[11]]);
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect([0, 1, -1]).toContain(Math.round(q[k] * 1e9) / 1e9);
    expect(((await e.run("target.alignOrientation", { target: t2 })) as unknown as { changed: boolean }).changed).toBe(false);
    expect(xyzrpwToPose(poseToXYZRPW(q)).every((v, k) => Math.abs(v - q[k]) < 1e-9)).toBe(true);
  });

  it("Select toggles the target in the selection", async () => {
    const { e, t1 } = await cell();
    e.ws.selection = [];
    expect(((await e.run("target.toggleSelect", { target: t1 })) as unknown as { selected: boolean }).selected).toBe(true);
    expect(e.ws.selection).toEqual([t1]);
    expect(((await e.run("target.toggleSelect", { target: t1 })) as unknown as { selected: boolean }).selected).toBe(false);
  });
});

describe("contributed instruction editors", () => {
  it("a feature registers the editor of its instruction kind", () => {
    const Editor = () => null;
    expect(instructionEditor("a2-test-kind")).toBeUndefined();
    registerInstructionEditor("a2-test-kind", Editor);
    expect(instructionEditor("a2-test-kind")).toBe(Editor);
  });
});

describe("Reveal in the Tree (F8)", () => {
  it("selects the item and asks the views to show it; 'Nothing selected' without one", async () => {
    const { e, t1, statuses } = await cell();
    expect(await e.run("view.reveal", { item: t1 })).toEqual({ revealed: true, item: "Home" });
    expect(e.ws.selection).toEqual([t1]);
    expect(e.events.filter((x) => x.type === "reveal").at(-1)).toMatchObject({ item: t1 });
    e.ws.selection = [];
    expect(await e.run("view.reveal", {})).toEqual({ revealed: false });
    expect(statuses().at(-1)).toBe("Nothing selected");
  });
});
