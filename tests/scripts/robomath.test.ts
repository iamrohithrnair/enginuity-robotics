// Compares script robomath outputs with reference pose and matrix calculations.
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../helpers";
import { scripted } from "./harness";

type Golden = Record<string, { ok?: unknown; error?: string }>;
const golden = JSON.parse(readFileSync(path.join(ROOT, "research/evidence/scripts/robomath-golden.json"), "utf8")) as Golden;

 
const PROBE = `
const out = {};
const M = (m) => ({ mat: m.tolist() });
function rec(name, fn) { try { const v = fn(); out[name] = { ok: v instanceof Mat ? M(v) : v }; } catch (e) { out[name] = { error: String(e) }; } }
const A = transl(100, -50, 300).mul(rotz(0.3)).mul(roty(-0.7)).mul(rotx(1.1));
const B = transl(-20, 40, 10).mul(rotx(pi)).mul(rotz(0.25));
const G1 = transl(5, 6, 7).mul(roty(pi / 2)).mul(rotz(0.4));
const G2 = transl(5, 6, 7).mul(roty(-pi / 2)).mul(rotx(0.4));
rec("transl", () => transl(1, 2, 3));
rec("transl_list", () => transl([4, 5, 6]));
rec("rotx", () => rotx(0.5));
rec("roty", () => roty(0.5));
rec("rotz", () => rotz(0.5));
rec("eye4", () => eye(4));
rec("eye3", () => eye(3));
rec("mul_AB", () => A.mul(B));
rec("invH_A", () => invH(A));
rec("inv_A", () => A.inv());
rec("tr_A", () => A.tr());
rec("A_Pos", () => A.Pos());
rec("A_VX", () => A.VX());
rec("A_VY", () => A.VY());
rec("A_VZ", () => A.VZ());
rec("A_list", () => A.list());
rec("A_list2", () => A.list2());
rec("A_isHomogeneous", () => [A.isHomogeneous() ? 1 : 0]);
rec("A_mul_point", () => A.mul([1, 2, 3]));
rec("A_Offset", () => A.Offset(10, 20, 30, 5, 10, 15));
rec("A_RelTool", () => A.RelTool(10, 20, 30, 5, 10, 15));
rec("Offset_fn", () => Offset(A, 10, 20, 30, 5, 10, 15));
rec("RelTool_fn", () => RelTool(A, 10, 20, 30, 5, 10, 15));
rec("A_setPos", () => new Mat(A).setPos([7, 8, 9]));
for (const [nm, P] of [["A", A], ["B", B], ["G1", G1], ["G2", G2]]) {
  rec("pose_2_xyzrpw_" + nm, () => pose_2_xyzrpw(P));
  rec("Pose_2_TxyzRxyz_" + nm, () => Pose_2_TxyzRxyz(P));
  rec("Pose_2_KUKA_" + nm, () => Pose_2_KUKA(P));
  rec("Pose_2_ABB_" + nm, () => Pose_2_ABB(P));
  rec("Pose_2_UR_" + nm, () => Pose_2_UR(P));
  rec("Pose_2_Staubli_" + nm, () => Pose_2_Staubli(P));
  rec("Pose_2_Fanuc_" + nm, () => Pose_2_Fanuc(P));
  rec("Pose_2_Motoman_" + nm, () => Pose_2_Motoman(P));
  rec("pose_2_quaternion_" + nm, () => pose_2_quaternion(P));
}
const v6 = [100, -50, 300, 20, -30, 45];
rec("xyzrpw_2_pose", () => xyzrpw_2_pose(v6));
rec("TxyzRxyz_2_Pose", () => TxyzRxyz_2_Pose([100, -50, 300, 0.2, -0.3, 0.45]));
rec("KUKA_2_Pose", () => KUKA_2_Pose(v6));
rec("UR_2_Pose", () => UR_2_Pose([100, -50, 300, 0.2, -0.3, 0.45]));
rec("quaternion_2_pose", () => quaternion_2_pose([0.7071067811865476, 0, 0.7071067811865476, 0]));
rec("cross", () => cross([1, 2, 3], [-4, 5, 0.5]));
rec("dot", () => [dot([1, 2, 3], [-4, 5, 0.5])]);
rec("norm", () => [norm([3, 4, 12])]);
rec("normalize3", () => normalize3([3, 4, 12]));
rec("add3", () => add3([1, 2, 3], [4, 5, 6]));
rec("subs3", () => subs3([1, 2, 3], [4, 5, 6]));
rec("mult3", () => mult3([1, 2, 3], 2.5));
rec("distance", () => [distance([1, 2, 3], [4, 6, 15])]);
rec("angle3", () => [angle3([1, 0, 0], [1, 1, 0])]);
rec("point_Zaxis_2_pose", () => point_Zaxis_2_pose([10, 20, 30], [0, 0, -1]));
rec("point_Zaxis_2_pose_hint", () => point_Zaxis_2_pose([10, 20, 30], [1, 0, 0], [0, 0, 1], [0, 1, 1]));
rec("Mat_2x2_list", () => new Mat([[1, 2], [3, 4]]).list());
rec("Mat_col_list", () => new Mat([[1], [2], [3]]).list());
rec("Mat_vec_from_list", () => new Mat([1, 2, 3]));
rec("Mat_zeros", () => new Mat(2, 3));
rec("pi", () => [pi]);
out.inputs = { A: A.tolist(), B: B.tolist(), G1: G1.tolist(), G2: G2.tolist() };
out;
`;

function close(actual: unknown, expected: unknown, where: string): string[] {
  if (typeof expected === "number") {
    const ok = typeof actual === "number" && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
    return ok ? [] : [`${where}: ${String(actual)} != ${expected}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [`${where}: shape ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`];
    return expected.flatMap((e, i) => close(actual[i], e, `${where}[${i}]`));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return [`${where}: ${JSON.stringify(actual)} is not an object`];
    return Object.keys(expected).flatMap((k) => close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${where}.${k}`));
  }
  return actual === expected ? [] : [`${where}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`];
}

describe("Enginuity script robomath", () => {
  it("matches the reference robomath outputs (82 cases, 1e-9)", async () => {
    const { run } = await scripted();
    const r = await run(PROBE, "robomath");
    expect(r.error).toBeUndefined();
    const got = r.result as Golden & { inputs: unknown };
    expect(Object.keys(got).sort()).toEqual(Object.keys(golden).sort());
    const diffs = Object.keys(golden).flatMap((k) => (k === "inputs" ? close(got.inputs, golden.inputs, k) : close(got[k], golden[k], k)));
    expect(diffs).toEqual([]);
  });
});
