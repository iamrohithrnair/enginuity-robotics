// Verifies robot loading, joint limits, and forward/inverse kinematics for reachable poses.
 
import { describe, expect, it } from "vitest";
import { engine, near } from "../helpers";

describe("KIN: robot kinematics (ABB IRB 120-3/0.6 from the online library)", () => {
  it("KIN-FK: forward kinematics equals RoboDK SolveFK for [10,-20,30,-40,50,-60]", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const fk = (await e.run("robot.solveFK", { joints: [10, -20, 30, -40, 50, -60] })) as unknown as { pose: number[] };
    const expected = [-0.167, -0.776, 0.609, 257.738, -0.913, -0.111, -0.393, 9.446, 0.372, -0.621, -0.69, 510.566];
    expected.forEach((v, i) => expect(near(fk.pose[i], v, 2e-3)).toBe(true));
  });

  it("KIN-HOME: robot loads at home joints [0,0,0,0,0,0] with RoboDK joint limits", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const info = (await e.run("item.info", { item: "ABB IRB 120-3/0.6" })) as unknown as { joints: number[]; jointLimits: number[][] };
    expect(info.joints).toEqual([0, 0, 0, 0, 0, 0]);
    expect(info.jointLimits).toEqual([
      [-165, 165],
      [-110, 110],
      [-90, 70],
      [-160, 160],
      [-120, 120],
      [-400, 400],
    ]);
  });

  it("KIN-SETJOINTS: out-of-range joint values are clamped to the limit (9999 → 400)", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const r = (await e.run("robot.setJoints", { joints: [0, 0, 0, 0, 0, 9999] })) as unknown as { joints: number[] };
    expect(r.joints).toEqual([0, 0, 0, 0, 0, 400]);
  });

  it("KIN-IK: inverse kinematics returns the original joints for a reachable pose", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("robot.setJoints", { joints: [10, -20, 30, -40, 50, -60] });
    const fk = (await e.run("robot.solveFK", { joints: [10, -20, 30, -40, 50, -60] })) as unknown as { pose: number[] };
    const ik = (await e.run("robot.solveIK", { pose: fk.pose })) as unknown as { joints: number[] };
    [10, -20, 30, -40, 50, -60].forEach((v, i) => expect(near(ik.joints[i], v, 1e-2)).toBe(true));
  });

  it("KIN-IK-UNREACHABLE: a pose 5 m away has no solution", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const ik = (await e.run("robot.solveIK", { xyzrpw: [5000, 0, 0, 0, 0, 0] })) as unknown as { joints: number[] | null };
    expect(ik.joints).toBeNull();
  });

  it("KIN-IK-ALL: several configurations exist for the probe pose (RoboDK reported 4)", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const fk = (await e.run("robot.solveFK", { joints: [10, -20, 30, -40, 50, -60] })) as unknown as { pose: number[] };
    const all = (await e.run("robot.solveIK", { pose: fk.pose, all: true })) as unknown as { solutions: number[][] };
    expect(all.solutions.length).toBeGreaterThanOrEqual(2);
  });
});
