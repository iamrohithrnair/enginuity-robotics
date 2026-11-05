// Verifies MoveL segmentation and generated move ordering under split-distance settings.
 
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildIntermediate, generationSettings } from "@/engine/commands/generate";
import { tcpIn } from "@/engine/commands/targets";
import { mul, transl } from "@/engine/math";
import { engine, ROOT } from "../helpers";

type Id = { id: string };
const J0 = [0, 0, 0, 0, 30, 0];

async function splitProgram() {
  const e = await engine();
  const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as Id;
  const frame = (await e.run("item.addFrame", { name: "F1" })) as unknown as Id;
  const tool = (await e.run("robot.addTool", { robot: robot.id, name: "T1", xyzrpw: [0, 0, 100, 0, 0, 0] })) as unknown as Id;
  await e.run("robot.setActiveFrame", { robot: robot.id, frame: frame.id });
  await e.run("robot.setJoints", { robot: robot.id, joints: J0 });
  const P0 = tcpIn(e.ws, e.ws.items[robot.id], frame.id, J0);
   
  const ct = async (name: string, pose: number[]) => {
    const t = (await e.run("target.add", { name, parent: frame.id, robot: robot.id, joints: J0 })) as unknown as Id;
    await e.run("item.setPose", { item: t.id, pose }, "api");
    await e.run("target.setJoint", { target: t.id, isJoint: false });
    return t.id;
  };
  const S0 = await ct("S0", P0);
  const S1 = await ct("S1", mul(P0, transl(0, 100, 0)));
  const C1 = await ct("C1", mul(P0, transl(50, 150, 0)));
  const C2 = await ct("C2", mul(P0, transl(0, 200, 0)));
  const p = (await e.run("program.add", { name: "SplitP", robot: robot.id })) as unknown as Id;
  await e.run("program.addInstruction", { program: p.id, kind: "frame", frame: frame.id });
  await e.run("program.addInstruction", { program: p.id, kind: "tool", tool: tool.id });
  await e.run("program.addMoveJ", { program: p.id, target: S0 });
  await e.run("program.addMoveL", { program: p.id, target: S1 });
  await e.run("program.addMoveC", { program: p.id, via: C1, target: C2 });
  return { e, p };
}

function abbMoves(intermediate: string): string[] {
  const out = spawnSync("python3", ["-I", path.join(ROOT, "python/robocraft_post/cli.py"), "--post", "ABB_RAPID_IRC5"], { input: JSON.stringify({ intermediate }), encoding: "utf8" });
  const res = JSON.parse(out.stdout) as { files: { name: string; content: string }[] };
  const mod = res.files.find((f) => f.name.endsWith(".mod"))!.content;
  return mod.split("\n").map((l) => l.trim()).filter((l) => /^(Move|! Splitting)/.test(l));
}

const reference = (tag: string) =>
  readFileSync(path.join(ROOT, "research/evidence/programs/probe7-gen", tag, "SplitP.mod"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(Move|! Splitting)/.test(l));






const strip = (l: string) => l.replace(/-0\.0+(?=[,\]])/g, (m) => m.slice(1)).replace(/\],\[-?\d,-?\d,-?\d,-?\d\]/g, "],[cf]");

describe("probe7: MoveL splitting in generated programs (R-PROG-46)", () => {
  it("default: one MoveL", async () => {
    const { e, p } = await splitProgram();
    const ours = abbMoves(buildIntermediate(e.ws, p.id, { settings: generationSettings(e.services.settings) }).text);
    expect(ours.map(strip)).toEqual(reference("default").map(strip));
  });
  it("MoveLSplitMM = 30: a 100 mm MoveL becomes 4 × 25 mm with RoboDK's comment", async () => {
    const { e, p } = await splitProgram();
    const s = { ...generationSettings(e.services.settings), splitMM: 30 };
    const ours = abbMoves(buildIntermediate(e.ws, p.id, { settings: s }).text);
    const ref = reference("split30");
    expect(ours.length).toBe(ref.length);
    expect(ours[1]).toBe(ref[1]);
     
     
    expect(ours.map(strip)).toEqual(ref.map(strip));
  });
});
