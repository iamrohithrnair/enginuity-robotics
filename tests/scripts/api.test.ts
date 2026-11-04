 
 
import { describe, expect, it } from "vitest";
import { dispatch } from "@/engine/dispatch";
import { getCommand } from "@/engine/registry";
import { PRELUDE } from "@/server/scripts/prelude";
import { engine } from "../helpers";
import { scripted } from "./harness";

const names = (e: { ws: { items: Record<string, { name: string; type: string }> } }, type: string) =>
  Object.values(e.ws.items)
    .filter((i) => i.type === type)
    .map((i) => i.name);

describe("Enginuity script API", () => {
  it("only calls commands that exist and are open to the Copilot", () => {
    const used = new Set([...PRELUDE.matchAll(/call\("([a-zA-Z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]));
    used.add("program.addMoveJ").add("program.addMoveL");
    expect(used.size).toBeGreaterThan(40);
    for (const n of used) {
      const def = getCommand(n);
      expect(def, n).toBeDefined();
      expect(def?.internal, n).toBeFalsy();
    }
  });

  it("maps items, poses, kinematics and motion onto the station", async () => {
    const { e, run } = await scripted();
    const r = await run(`
      const robot = RDK.AddFile("UR5e.robot");
      RDK.setRunMode(RUNMODE_QUICKVALIDATE);
      const frame = RDK.AddFrame("Pallet");
      frame.setPose(transl(400, -100, 50));
      const t = RDK.AddTarget("T1", frame, robot);
      t.setPose(transl(0, 0, 200).mul(rotx(pi)));
      const j0 = robot.Joints().list();
      const ik = robot.SolveIK(robot.SolveFK(j0)).list();
      robot.MoveJ(t);
      // the new frame became the robot's reference frame, so Pose() is relative to it like the target's
      const err = distance(robot.Pose().Pos(), t.Pose().Pos());
      const refFrame = robot.PoseFrame().Pos();
      const before = robot.Pose();
      robot.setPose(Offset(before, 0, 0, 50));
      const dz = robot.Pose().Pos()[2] - before.Pos()[2];
      ({
        type: robot.Type(), isRobot: robot.Type() === ITEM_TYPE_ROBOT, name: robot.Name(),
        found: RDK.Item("Pallet", ITEM_TYPE_FRAME).Valid(), missing: RDK.Item("Nope").Valid(),
        targets: RDK.ItemList(ITEM_TYPE_TARGET, true), parent: t.Parent().Name(), children: frame.Childs().map((c) => c.Name()),
        j0, ik, err, dz, dof: robot.Joints().size(0), limits: robot.JointLimits().map((m) => m.size(0)),
        framePos: frame.Pose().Pos(), refFrame, config: robot.JointsConfig(robot.Joints()).list().length,
      });
    `);
    expect(r.error).toBeUndefined();
    const v = r.result as Record<string, unknown>;
    expect(v.isRobot).toBe(true);
    expect(v.type).toBe(2);
    expect(v.name).toMatch(/UR5e/);
    expect(v.found).toBe(true);
    expect(v.missing).toBe(false);
    expect(v.targets).toEqual(["T1"]);
    expect(v.parent).toBe("Pallet");
    expect(v.children).toEqual(["T1"]);
    (v.ik as number[]).forEach((q, i) => expect(q).toBeCloseTo((v.j0 as number[])[i], 6));
    expect(v.err as number).toBeLessThan(0.01);  
    expect(v.dz as number).toBeCloseTo(50, 2);
    expect(v.dof).toBe(6);
    expect(v.limits).toEqual([6, 6]);
    expect(v.framePos).toEqual([400, -100, 50]);
    expect(v.refFrame).toEqual([400, -100, 50]);
    expect(v.config).toBe(4);  
     
    const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
    expect(robot.robot!.joints).not.toEqual(v.j0);
  });

  it("builds programs with instructions and reports its changes", async () => {
    const { e, run } = await scripted();
    await e.run("library.load", { file: "UR5e.robot" });
    const r = await run(`
      const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
      const frame = RDK.AddFrame("Pallet");
      frame.setPose(transl(400, -150, 0));
      const prog = RDK.AddProgram("Palletize", robot);
      prog.setPoseFrame(frame);
      prog.setSpeed(300);
      for (let i = 0; i < 2; i++) {
        const t = RDK.AddTarget("Place " + (i + 1), frame, robot);
        t.setPose(transl(i * 100, 0, 100).mul(rotx(pi)));
        prog.MoveJ(Offset(t.Pose(), 0, 0, 100));
        prog.MoveL(t);
        prog.setDO(1, 1);
      }
      prog.Pause(500);
      prog.RunInstruction("pallet done", INSTRUCTION_COMMENT);
      print("instructions", prog.InstructionCount());
      prog.Update();
    `, "Pallet");
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.logs).toEqual(["instructions 10"]);
    const [valid, time, dist, ratio] = r.result as number[];
    expect(valid).toBeGreaterThan(0);
    expect(time).toBeGreaterThan(0);
    expect(dist).toBeGreaterThan(0);
    expect(ratio).toBe(1);
    const prog = Object.values(e.ws.items).find((i) => i.name === "Palletize")!;
    const list = (await e.run("program.instructions", { program: prog.id })) as unknown as { kind?: string; moveType?: string }[];
    const kinds = list.map((x) => x.moveType ?? x.kind);
    expect(kinds).toEqual(["frame", "speed", "joint", "linear", "io", "joint", "linear", "io", "pause", "code"]);
    expect(r.created.map((c) => c.name)).toEqual(expect.arrayContaining(["Pallet", "Palletize", "Place 1", "Place 2"]));
    expect(r.deleted).toEqual([]);
    expect(r.undo).toBe("Script: Pallet");
  });

  it("records the whole run as one undo step that reverts everything", async () => {
    const { e, run } = await scripted();
    await e.run("library.load", { file: "UR5e.robot" });
    e.undo.clear();
    const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
    const j0 = robot.robot!.joints.slice();
    const r = await run(`
      const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
      RDK.setRunMode(RUNMODE_QUICKVALIDATE);
      const f = RDK.AddFrame("Grid");
      f.setPose(eye(4));
      for (let i = 0; i < 5; i++) RDK.AddTarget("G" + i, f, robot).setPose(transl(300 + i * 20, 0, 300).mul(rotx(pi)));
      robot.MoveJ(RDK.Item("G4"));
      f.setName("Grid frame");
    `, "Grid");
    expect(r.error).toBeUndefined();
    expect(e.undo.list().undo).toEqual(["Script: Grid"]);
    expect(names(e, "target")).toHaveLength(5);
    expect(robot.robot!.joints).not.toEqual(j0);
    e.undo.undo();
    expect(names(e, "target")).toEqual([]);
    expect(names(e, "frame")).toEqual(["UR5e Base"]);
    expect(robot.robot!.joints).toEqual(j0);
    e.undo.redo();
    expect(names(e, "target")).toHaveLength(5);
    expect(names(e, "frame")).toEqual(["UR5e Base", "Grid frame"]);
     
    const q = await run(`RDK.ItemList().length`, "Query");
    expect(q.undo).toBeNull();
    expect(e.undo.list().undo).toEqual(["Script: Grid"]);
    expect(q.created).toEqual([]);
  });

  it("saves scripts as station items that run by reference", async () => {
    const { e } = await scripted();
    const saved = await e.run("script.save", { code: `RDK.AddFrame("From saved"); print("ran");`, name: "Make frame" });
    const item = e.ws.items[saved.id as unknown as string];
    expect(item.type).toBe("script");
    expect(item.parent).toBe(e.ws.activeStation);
    expect(await e.run("script.list")).toEqual([{ id: item.id, name: "Make frame", lines: 1 }]);
    const r = (await e.run("script.run", { item: "Make frame" }, "ui")) as unknown as { ok: boolean; logs: string[]; name: string; undo: string };
    expect(r.ok).toBe(true);
    expect(r.logs).toEqual(["ran"]);
    expect(r.undo).toBe("Script: Make frame");
    expect(names(e, "frame")).toEqual(["From saved"]);
    await e.run("script.save", { item: item.id, code: "1 + 1" });
    expect((await e.run("script.get", { item: item.id })).code).toBe("1 + 1");
    const again = await e.run("script.save", { code: "2", name: "Make frame" });
    expect(again.name).toBe("Make frame 2");
    await e.run("script.delete", { item: item.id });
    expect(names(e, "script")).toEqual(["Make frame 2"]);
    const bad = await e.tryRun("script.run", { item: "From saved" });
    expect(bad.ok).toBe(false);
  });
});

describe("failed script runs", () => {
  it("are undone completely, or kept as one undo step with keepOnError", async () => {
    const { e, run } = await scripted();
    e.undo.clear();
    const code = `RDK.AddFrame("Half done", 0, [0, 0, 0]); RDK.AddFrame("Also", 0, [0, 0, 0]);\nthrow new Error("boom");`;
    const r = await run(code, "Fails");
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ message: "boom", line: 2 });
    expect(r.reverted).toBe(true);
    expect(r.undo).toBeNull();
    expect(r.created.map((c) => c.name)).toEqual(["Half done", "Also"]);
    expect(names(e, "frame")).toEqual([]);
    expect(e.undo.list().undo).toEqual([]);
    const k = await run(code, "Keeps", { keepOnError: true });
    expect(k.reverted).toBeUndefined();
    expect(k.undo).toBe("Script: Keeps");
    expect(names(e, "frame")).toEqual(["Half done", "Also"]);
    expect(e.undo.list().undo).toEqual(["Script: Keeps"]);
  });
});

describe("station switches during a run", () => {
  it("stop and undo the run when someone else switches stations, but follow the script's own switches", async () => {
    const e = await engine();
    const first = e.ws.activeStation!;
    await e.run("station.new", { name: "Other" });
    const other = e.ws.activeStation!;
    await e.run("station.setActive", { station: first });
    let n = 0;
    const { createScriptService } = await import("@/server/scripts");
    const scripts = createScriptService({
      call: async (name, params, macro, station) => {
         
        if (++n === 3) await e.run("station.setActive", { station: other });
        return dispatch(e.ws, e.undo.group.active(e.ws), e.services, name, params, "agent", { macro, station });
      },
      workspace: () => e.ws,
    });
    const r = await scripts.run({ code: `RDK.AddFrame("A", 0, [0, 0, 0]);\nRDK.AddFrame("B", 0, [0, 0, 0]);\nRDK.AddFrame("C", 0, [0, 0, 0]);`, name: "Switch", origin: "ui" });
    expect(r.error).toMatchObject({ message: `The active station changed from "${e.ws.items[first].name}" to "Other" (someone switched stations) during the run, so the script stopped`, line: 3 });
    expect(r.reverted).toBe(true);
    expect(Object.values(e.ws.items).filter((i) => i.type === "frame").map((i) => i.name)).toEqual([]);
    n = -100;
    const own = await scripts.run({ code: `RDK.AddStation("Mine");\nRDK.AddFrame("In mine", 0, [0, 0, 0]);\nRDK.ActiveStation().Name();`, name: "Own", origin: "ui" });
    expect(own.error).toBeUndefined();
    expect(own.result).toBe("Mine");
    expect(e.ws.items[e.ws.items[Object.values(e.ws.items).find((i) => i.name === "In mine")!.id].parent!].name).toBe("Mine");
  });
});
