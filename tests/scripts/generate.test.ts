// Verifies scripts generate UR/RAPID robot programs and flush unfinished recordings.
 
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCRIPT_EXAMPLES } from "@/engine/scripts";
import { scripted } from "./harness";

const PALLET = `
const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
const pallet = RDK.AddFrame("Pallet");
pallet.setPose(transl(400, -150, 0));
const prog = RDK.AddProgram("Palletize", robot);
prog.setPoseFrame(pallet);
prog.setSpeed(250);
for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
  const place = transl(i * 100, j * 80, 100).mul(rotx(pi));
  const t = RDK.AddTarget("Place " + (i * 3 + j + 1), pallet, robot);
  t.setPose(place);
  prog.MoveJ(Offset(place, 0, 0, 100));
  prog.MoveL(t);
  prog.setDO(1, 0);
  prog.MoveL(Offset(place, 0, 0, 100));
}
const out = prog.MakeProgram();
print("generated", out.files.map((f) => f.name).join(", "));
out;
`;

describe("program generation from scripts", () => {
  it("generates a UR program for a pallet built by the script (MakeProgram)", async () => {
    const { e, run } = await scripted({ posts: true });
    await e.run("library.load", { file: "UR5e.robot" });
    const r = await run(PALLET, "Pallet");
    expect(r.error).toBeUndefined();
    expect(r.generated).toHaveLength(1);
    const g = r.generated[0];
    expect(g.program).toBe("Palletize");
    expect(g.post).toMatch(/Universal_Robots/);
    const main = g.files.find((f) => /\.script$/i.test(f.name)) ?? g.files[0];
    expect(main.content).toMatch(/movej\(/);
    expect(main.content).toMatch(/movel\(/);
    expect((main.content!.match(/movel\(/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect(main.path && existsSync(main.path)).toBe(true);
    expect(readFileSync(main.path!, "utf8")).toBe(main.content);
    expect(r.logs[0]).toMatch(/^generated /);
    expect((r.result as { files: unknown[] }).files.length).toBe(g.files.length);
  });

  it("records robot moves into an ABB RAPID program (RUNMODE_MAKE_ROBOTPROG)", async () => {
    const { e, run } = await scripted({ posts: true });
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const r = await run(`
      const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
      RDK.setRunMode(RUNMODE_MAKE_ROBOTPROG);
      RDK.ProgramStart("Square", "", "", robot);
      const home = robot.Pose();
      robot.setSpeed(200);
      for (const [x, y] of [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]) robot.MoveL(Offset(home, x, y, -30));
      robot.setDO(2, 1);
      RDK.Finish();
      RDK.ItemList(ITEM_TYPE_PROGRAM, true);
    `, "Square");
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual([]);  
    expect(r.generated).toHaveLength(1);
    const g = r.generated[0];
    expect(g.program).toBe("Square");
    expect(g.post).toMatch(/ABB/);
    const mod = g.files.find((f) => /\.(mod|prg)$/i.test(f.name)) ?? g.files[0];
    expect(mod.content).toMatch(/MODULE/);
    expect((mod.content!.match(/MoveL /g) ?? []).length).toBe(5);
    expect(mod.content).toMatch(/SetDO/);
    expect(Object.values(e.ws.items).some((i) => i.type === "program")).toBe(false);
  });

  it("generates a program left open when the script ends", async () => {
    const { e, run } = await scripted({ posts: true });
    await e.run("library.load", { file: "UR5e.robot" });
    const r = await run(`
      const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
      RDK.setRunMode(RUNMODE_MAKE_ROBOTPROG);
      RDK.ProgramStart("Open");
      robot.MoveJ(robot.Joints());
      robot.MoveL(Offset(robot.Pose(), 0, 0, -20));
    `, "Open");
    expect(r.error).toBeUndefined();
    expect(r.generated.map((g) => g.program)).toEqual(["Open"]);
    expect(r.generated[0].files[0].content).toMatch(/movel\(/);
  });

  it("runs every example script shown in the editor and to the Copilot", async () => {
    const { e, run } = await scripted({ posts: true });
    await e.run("library.load", { file: "UR5e.robot" });
    for (const ex of SCRIPT_EXAMPLES) {
      const r = await run(ex.code, ex.name);
      expect(r.error, ex.name).toBeUndefined();
      expect(r.ok, ex.name).toBe(true);
      expect(r.logs.length + r.generated.length, ex.name).toBeGreaterThan(0);
    }
  });
});
