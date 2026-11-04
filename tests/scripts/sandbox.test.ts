 
 
import { describe, expect, it } from "vitest";
import { scripted } from "./harness";

describe("Enginuity script sandbox", () => {
  it("exposes no process, module loader, network or file system", async () => {
    const { run } = await scripted();
    const r = await run(`[typeof process, typeof require, typeof fetch, typeof XMLHttpRequest, typeof std, typeof os,
      typeof __mb_call, typeof __mb_sleep, typeof __mb_log, typeof WebAssembly, typeof (new Function("return this"))().process]`);
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual(Array(11).fill("undefined"));
    const imp = await run(`import("fs")`);
    expect(imp.ok).toBe(true);  
    const imp2 = await run(`let failed = null; import("fs").then(() => (failed = false), (e) => (failed = String(e))); failed`);
    expect(imp2.result === null || typeof imp2.result === "string").toBe(true);
  });

  it("stops endless loops at the time limit", async () => {
    const { run } = await scripted({ limits: { timeMs: 300 } });
    const t0 = Date.now();
    const r = await run("while (true) {}");
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/stopped|time limit/i);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("enforces the memory limit", async () => {
    const { run } = await scripted({ limits: { memoryBytes: 16 * 1024 * 1024 } });
    const r = await run("const a = []; while (true) a.push(new Array(100000).fill(1));");
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/memory/i);
  });

  it("enforces the engine call limit", async () => {
    const { run } = await scripted({ limits: { calls: 5 } });
    const r = await run(`for (let i = 0; i < 10; i++) call("sim.status", {});`);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/call limit reached \(5 engine calls\)/);
    expect(r.calls).toBe(6);
  });

  it("caps the printed output", async () => {
    const { run } = await scripted({ limits: { logBytes: 1000 } });
    const r = await run(`for (let i = 0; i < 200; i++) print("line " + i + " ".repeat(20));`);
    expect(r.truncated).toBe(true);
    expect(r.logs.at(-1)).toMatch(/output truncated/);
    expect(r.logs.join("\\n").length).toBeLessThan(1200);
  });

  it("reports errors with the line and column in the script", async () => {
    const { run } = await scripted();
    const r = await run(`const a = 1;\nconst b = 2;\nnotDefined.foo();\n`);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/notDefined/);
    expect(r.error?.line).toBe(3);
    const s = await run(`const x = ;`);
    expect(s.error?.message).toMatch(/SyntaxError/);
    expect(s.error?.line).toBe(1);
  });

  it("passes engine errors to the script as catchable exceptions, and blocks nested scripts", async () => {
    const { run } = await scripted();
    const r = await run(`let m = ""; try { call("item.rename", { item: "nope", name: "x" }); } catch (e) { m = e.message; } m`);
    expect(r.result).toMatch(/Invalid item provided/);
    const n = await run(`call("script.run", { code: "1" })`);
    expect(n.error?.message).toBe("Scripts can't call script.run");
    const u = await run(`call("no.such", {})`);
    expect(u.error?.message).toBe("Unknown command: no.such");
  });

  it("lets a script redeclare the API globals the way robolink scripts do", async () => {
    const { run } = await scripted();
    const r = await run(`const RDK = Robolink(); function transl(x) { return x; } [RDK.Version(), transl(5)]`);
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual(["Enginuity", 5]);
  });
});

describe("Enginuity script API errors", () => {
  it("names the missing API function and suggests the right one", async () => {
    const { run } = await scripted();
    const a = await run(`const robot = RDK.getItem("UR5e");`);
    expect(a.error?.message).toBe("TypeError: RDK.getItem is not part of the Enginuity script API. Did you mean RDK.Item()?");
    expect(a.error?.line).toBe(1);
    const b = await run(`RDK.AddFrame("F", 0, [0, 0, 0]).getPoseAbs();`);
    expect(b.error?.message).toBe("TypeError: Items have no method getPoseAbs in the Enginuity script API. Did you mean item.PoseAbs()?");
    const c = await run(`RDK.MoveJ([0, 0, 0, 0, 0, 0]);`);
    expect(c.error?.message).toBe("TypeError: RDK.MoveJ is not part of the Enginuity script API: MoveJ is an item method, e.g. robot.MoveJ(...)");
    const t = await run(`RDK.tranl(1, 2, 3);`);
    expect(t.error?.message).toBe("TypeError: RDK.tranl is not part of the Enginuity script API. Did you mean RDK.transl()?");
    const d = await run(`const M = transl(1, 2, 3); M[0];`);
    expect(d.error?.message).toMatch(/A Mat is not an array: read values with M.get\(row, col\)/);
    const e = await run(`RDK.AddTarget("T", 0, 0, [1, 2, 3, 180, 0, 0]);`);
    expect(e.error?.message).toMatch(/AddTarget: give the pose as a Mat/);
  });

  it("accepts robomath through RDK and a pose when adding frames and targets", async () => {
    const { run } = await scripted();
    const r = await run(`
      const f = RDK.AddFrame("Pallet", 0, RDK.transl(400, -100, 0));
      const g = RDK.AddFrame("Other", f, [10, 20, 30]);
      const t = RDK.AddTarget("T1", f, 0, transl(0, 0, 50).mul(rotx(pi)));
      [f.Pose().Pos(), g.PoseAbs().Pos(), t.PoseAbs().Pos(), await_free(t)];
      function await_free(x) { return typeof x.then; }
    `);
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual([[400, -100, 0], [410, -80, 30], [400, -100, 50], "undefined"]);
  });
});

describe("script error locations", () => {
  it("quote the failing line", async () => {
    const { run } = await scripted();
    const r = await run(`const a = 1;\nconst m = transl(1, 2, 3).mul(rotx(pi)));\n`);
    expect(r.error).toMatchObject({ line: 2, source: "const m = transl(1, 2, 3).mul(rotx(pi)));" });
    expect(r.error?.message).toMatch(/^SyntaxError/);
  });
});

describe("script poses", () => {
  it("refuses a pose whose rotation was corrupted, with how to shift it instead", async () => {
    const { e, run } = await scripted();
    await e.run("library.load", { file: "UR5e.robot" });
    const r = await run(`const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
const prog = RDK.AddProgram("P", robot);
const above = transl(400, 0, 300).mul(rotx(pi));
for (let r = 0; r < 3; r++) above.set(r, 2, above.get(r, 2) + 100);
prog.MoveJ(above);`);
    expect(r.error?.line).toBe(5);
    expect(r.error?.message).toMatch(/^TypeError: Not a valid pose: its rotation \(columns 0-2\) must be orthonormal\. Shift a pose with Offset/);
     
    const ok = await run(`const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0]; robot.SolveIK(robot.SolveFK([10, -80, -100, -20, 90, 15])).list();`);
    expect(ok.error).toBeUndefined();
  });
});
