// Verifies path-error decoding, motion-planning state, and station collision rules.
 
 
import { beforeAll, describe, expect, it } from "vitest";
import { fk } from "@/engine/kinematics";
import { inv, mul } from "@/engine/math";
import { describePathError, isPathWarning, planProgram } from "@/engine/sim/planner";
import { absPose, toolPose } from "@/engine/workspace";
import { engine, hasLibraryFile } from "../helpers";

const near = (a: number[], b: number[], tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

type E = Awaited<ReturnType<typeof engine>>;
type Id = { id: string };
const J0 = [0, 0, 0, 0, 30, 0];
const SUFFIX = "<br><br>You can avoid this warning by changing motion tolerances in Tools-Options-Motion. ";

describe("path error decoder (FUN_1002ff018)", () => {
  it("decodes each decimal digit like RoboDK", () => {
    expect(describePathError(1)).toBe("There is no solution available to complete the path. ");
    expect(describePathError(2)).toBe("One or more targets are not reachable. ");
    expect(describePathError(10)).toBe("The robot can't make a linear movement because of joint limits or the target is out of reach. Consider a Joint move instead. ");
    expect(describePathError(100)).toBe("Joint 5 crosses 0 degrees. This is a singularity and it is not allowed for a linear move. ");
    expect(describePathError(1000)).toBe(`Joint 5 is too close to a singularity (0 degrees). ${SUFFIX}`);
    expect(describePathError(2000)).toBe(`Joint 3 is too close the elbow singularity. ${SUFFIX}`);
    expect(describePathError(4000)).toBe(`The robot is too close to the front/back singularity (wrist close to axis 1). ${SUFFIX}`);
    expect(describePathError(100000)).toBe("Collision detected. ");
    expect(describePathError(1000000)).toBe(`The robot can't make a rotation so close to 180 deg. (the rotation axis is not properly defined). ${SUFFIX}`);
    expect(describePathError(10000000)).toBe("Target not reachable. ");
    expect(describePathError(100000000)).toBe("Invalid circular move, make sure to select 2 different targets defining an arc from the last robot movement. ");
    expect(describePathError(0)).toBe("The target is too close to the axis limits. ");
  });

  it("combines digits (a linear move blocked by the wrist singularity) and tells warnings apart", () => {
    expect(describePathError(1010)).toBe(
      `Joint 5 is too close to a singularity (0 degrees). The robot can't make a linear movement because of joint limits or the target is out of reach. Consider a Joint move instead. ${SUFFIX}`,
    );
    expect([1000, 2000, 100, 1000000].map(isPathWarning)).toEqual([true, true, true, true]);
    expect([1, 2, 10, 100000, 10000000].map(isPathWarning)).toEqual([false, false, false, false, false]);
  });
});

 
describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("engine rules", () => {
  let e: E;
  let robot: Id;

  beforeAll(async () => {
    e = await engine();
    robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
    await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
  });

  it("'set position (relative)' events put objects back under the recorded parent and pose", async () => {
    const box = (await e.run("object.addShape", { shape: "box", name: "Part", xyzrpw: [400, 0, 100, 0, 0, 0] })) as unknown as Id;
    const frame = (await e.run("item.addFrame", { name: "Fixture" })) as unknown as Id;
    const prog = (await e.run("program.add", { name: "Reset", robot: robot.id })) as unknown as Id;
    const ev = (await e.run("program.addInstruction", { program: prog.id, kind: "event", eventAction: "show" })) as unknown as Id;
    await e.run("event.recordAllObjects", { instruction: ev.id });
    const recorded = e.ws.items[box.id].pose.slice();
    const parent = e.ws.items[box.id].parent;
     
    await e.run("item.setParent", { item: box.id, parent: frame.id });
    await e.run("item.setPose", { item: box.id, xyzrpw: [0, 300, 0, 0, 0, 90] });
    await e.run("sim.event", { robot: null, instruction: ev.id });
    expect(e.ws.items[box.id].parent).toBe(parent);
    expect(near(e.ws.items[box.id].pose, recorded)).toBe(true);
  });

  it("'set position (absolute)' events give objects the recorded absolute pose and keep their parent", async () => {
    const frame = (await e.run("item.addFrame", { name: "Shifted", xyzrpw: [100, 200, 0, 0, 0, 30] })) as unknown as Id;
    const box = (await e.run("object.addShape", { shape: "box", name: "Loose", parent: frame.id })) as unknown as Id;
    const prog = (await e.run("program.add", { name: "Place", robot: robot.id })) as unknown as Id;
    const ev = (await e.run("program.addInstruction", { program: prog.id, kind: "event", eventAction: "show" })) as unknown as Id;
    const target = [1, 0, 0, 300, 0, 1, 0, -100, 0, 0, 1, 50, 0, 0, 0, 1];
     
    e.ws.items[ev.id].instruction!.event = { action: "move", positions: [{ item: box.id, parent: null, pose: target }], relative: false };
    await e.run("sim.event", { robot: null, instruction: ev.id });
    expect(e.ws.items[box.id].parent).toBe(frame.id);
    expect(near(absPose(e.ws, box.id), target)).toBe(true);
  });

  it("InstructionListJoints messages: no robot, unreachable targets (probe3 captures)", async () => {
    const lonely = (await e.run("program.add", { name: "NoRobot" })) as unknown as Id;
     
    e.ws.items[lonely.id].program = { ...(e.ws.items[lonely.id].program ?? {}), robot: null };
    const none = (await e.run("program.jointList", { program: lonely.id })) as unknown as { status: number; message: string };
    expect(none.message).toBe("Unknow robot to run the program. ");
    await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
    const far = (await e.run("target.add", { name: "Far", parent: e.ws.activeStation!, robot: robot.id, pose: [1, 0, 0, 5000, 0, 1, 0, 0, 0, 0, 1, 5000, 0, 0, 0, 1] })) as unknown as Id;
    const near0 = (await e.run("target.add", { name: "Home0", robot: robot.id, joints: J0, isJoint: true })) as unknown as Id;
    const prog = (await e.run("program.add", { name: "Unreachable", robot: robot.id })) as unknown as Id;
    await e.run("program.addMoveJ", { program: prog.id, target: near0.id });
    await e.run("program.addMoveJ", { program: prog.id, target: far.id });
    const res = (await e.run("program.jointList", { program: prog.id })) as unknown as { status: number; message: string; points: { error: number }[] };
    expect(res.status).toBe(-2);
    expect(res.message).toBe("One or more targets are not reachable or missing. ");
    expect(res.points.map((p) => p.error)).toEqual([0, 10000000]);
  });

  it("a forced Set Tool pose is used for planning even after the tool moved (R-PROG-7)", async () => {
    const tool = (await e.run("robot.addTool", { robot: robot.id, name: "T1", xyzrpw: [0, 0, 100, 0, 0, 0] })) as unknown as Id;
    await e.run("robot.setActiveTool", { robot: robot.id, tool: tool.id });
    await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
    const r = e.ws.items[robot.id];
    const tcp = mul(mul(absPose(e.ws, robot.id), fk(r.robot!.model, J0)), toolPose(e.ws, robot.id));
     
    const ref = r.robot!.activeFrame ?? e.ws.activeStation!;
    const target = (await e.run("target.add", { name: "T", parent: ref, robot: robot.id, pose: mul(inv(absPose(e.ws, ref)), tcp) })) as unknown as Id;
    const prog = (await e.run("program.add", { name: "Forced", robot: robot.id })) as unknown as Id;
    const setTool = (await e.run("program.addInstruction", { program: prog.id, kind: "tool", tool: tool.id })) as unknown as Id;
    await e.run("program.addMoveL", { program: prog.id, target: target.id });
    await e.run("instruction.forceOriginalPose", { instruction: setTool.id, force: true });
    await e.run("item.setPose", { item: tool.id, xyzrpw: [0, 0, 200, 0, 0, 0] });
    await e.run("robot.setJoints", { robot: robot.id, joints: [10, 10, 10, 0, 30, 0] });
    const forced = planProgram(e.ws, prog.id);
    expect(forced.ok).toBe(true);
    expect(near(forced.final!, J0, 1e-3)).toBe(true);
     
    await e.run("instruction.forceOriginalPose", { instruction: setTool.id, force: false });
    const linked = planProgram(e.ws, prog.id);
    expect(near(linked.final!, J0, 1e-3)).toBe(false);
  });

  it("collision maps belong to stations: a pair override and the map mode are kept per station", async () => {
    const st = e.ws.activeStation!;
    const box = (await e.run("object.addShape", { shape: "box", name: "Wall", xyzrpw: [0, 800, 0, 0, 0, 0] })) as unknown as Id;
    await e.run("collision.setPair", { item1: robot.id, item2: box.id, link1: 0, link2: 0, active: false });
    const map = (await e.run("collision.map", {})) as unknown as { mode: string; overrides: unknown[] };
    expect(map.overrides.length).toBe(1);
    expect(e.ws.items[st].collisionMap?.pairs.length).toBe(1);
    await e.run("collision.setMap", { mode: "none" });
    expect(e.ws.items[st].collisionMap?.mode).toBe("none");
    await e.run("collision.setMap", { mode: "default" });
  });

  it("robot.info reports the robot file facts (R-KIN-33)", async () => {
    const info = (await e.run("robot.info", { robot: robot.id, value: 0 })) as unknown as Record<string, unknown>;
    expect(info).toMatchObject({ nativeName: "ABB IRB 120-3/0.6", mechType: 1, axes: 6, isCalibrated: false, value: "1" });
  });
});
