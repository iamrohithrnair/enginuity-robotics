 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunContext } from "@openai/agents";
import { beforeAll, describe, expect, it } from "vitest";
import type { ScriptRunView } from "@/engine/scripts";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-script-agent-"));

type Tool = { name: string; description: string; invoke: (ctx: RunContext, input: string) => Promise<string> };

 
const HAS_ABB = hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot");

beforeAll(async () => {
  const { getServer, run } = await import("@/server/store");
  await getServer().ready;
  const r = await run("file.open", { path: LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot") }, "system");
  expect(r.ok).toBe(true);
}, 60_000);

const PALLET = `const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
const pallet = RDK.AddFrame("Pallet");
pallet.setPose(transl(350, -100, 0));
const prog = RDK.AddProgram("PalletABB", robot);
prog.setPoseFrame(pallet);
for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
  const t = RDK.AddTarget("P" + (i * 2 + j + 1), pallet, robot);
  t.setPose(transl(i * 60, j * 60, 80).mul(roty(pi)));
  prog.MoveJ(Offset(t.Pose(), 0, 0, 60));
  prog.MoveL(t);
}
print("check", prog.Update());
prog.MakeProgram();`;

describe.skipIf(!HAS_ABB)("Copilot script tool", () => {
  it("runs a script that generates real ABB RAPID, shows it in the chat and summarizes it for the model", { timeout: 120_000 }, async () => {
    const { buildTools } = await import("@/server/agent");
    const { activeUndo } = await import("@/server/store");
    const events: Record<string, unknown>[] = [];
    const tool = (buildTools((e) => events.push(e)) as unknown as Tool[]).find((t) => t.name === "script_run")!;
    expect(tool.description).toContain("Enginuity script API");
    expect(tool.description).not.toMatch(/RoboDK|RoboCraft/);
    const out = JSON.parse(await tool.invoke(new RunContext(), JSON.stringify({ code: PALLET, name: "Pallet 2x2" })));
    expect(out.error).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(out.logs[0]).toMatch(/^check \[/);
    expect(out.created).toEqual(expect.arrayContaining(["Pallet (frame)", "PalletABB (program)", "P4 (target)"]));
    expect(out.generated[0].post).toMatch(/ABB/);
    expect(out.generated[0].files[0].preview).toMatch(/MODULE/);
    expect(out.undo).toBe("Script: Pallet 2x2");
    expect(activeUndo().list().undo.at(-1)).toBe("Script: Pallet 2x2");
    const ev = events.at(-1)!;
    expect(ev).toMatchObject({ type: "tool_result", tool: "script.run", ok: true, error: null });
    const view = ev.script as ScriptRunView;
    expect(view.code).toBe(PALLET);
    expect(view.counts.created).toBeGreaterThanOrEqual(7);
    expect((view.generated[0].files[0].content!.match(/MoveL /g) ?? []).length).toBe(4);
  });

  it("returns the failing line to the model and marks the chat step failed", { timeout: 60_000 }, async () => {
    const { buildTools } = await import("@/server/agent");
    const events: Record<string, unknown>[] = [];
    const tool = (buildTools((e) => events.push(e)) as unknown as Tool[]).find((t) => t.name === "script_run")!;
    expect(Object.keys((tool as unknown as { parameters: { properties: object } }).parameters.properties)).toEqual(["code", "name", "item"]);
     
    const out = JSON.parse(await tool.invoke(new RunContext(), JSON.stringify({ code: `print("start");\nRDK.AddFrame("Leftover", 0, [0, 0, 0]);\nRDK.Item("Nope").MoveJ([0, 0, 0, 0, 0, 0]);`, name: "Broken", keepOnError: true })));
    expect(out.ok).toBe(false);
    expect(out.error).toMatchObject({ message: "Invalid item: Nope was not found", line: 3 });
    expect(out.logs).toEqual(["start"]);
    expect(out.undo).toBeNull();
    expect(out.created).toEqual(["Leftover (frame)"]);
    expect(out.reverted).toBe(true);
    const { getServer } = await import("@/server/store");
    expect(Object.values(getServer().ws.items).some((i) => i.name === "Leftover")).toBe(false);
    expect(events.at(-1)).toMatchObject({ tool: "script.run", ok: false, error: "Invalid item: Nope was not found" });
  });

  it("sends the views merged changes instead of one patch per script call", { timeout: 60_000 }, async () => {
    const { getServer, run } = await import("@/server/store");
    const server = getServer();
    const patches: { upserts: { name: string }[] }[] = [];
    const listen = (e: { type: string; patch?: unknown }) => {
      if (e.type === "patch") patches.push(e.patch as { upserts: { name: string }[] });
    };
    server.listeners.add(listen);
    try {
      const r = await run("script.run", { code: `const f = RDK.AddFrame("Grid", 0, [0, 0, 0]);\nfor (let i = 0; i < 40; i++) RDK.AddTarget("G" + i, f).setPose(transl(i * 10, 0, 0));`, name: "Grid" }, "agent");
      expect(r.ok).toBe(true);
      expect((r.result as { calls: number }).calls).toBe(121);  
    } finally {
      server.listeners.delete(listen);
    }
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.length).toBeLessThan(10);
    const names = new Set(patches.flatMap((p) => p.upserts.map((u) => u.name)));
    for (let i = 0; i < 40; i++) expect(names.has(`G${i}`)).toBe(true);
  });

  it("refuses tool calls after someone else switches stations mid-turn, and follows its own switches", { timeout: 60_000 }, async () => {
    const { buildTools } = await import("@/server/agent");
    const { getServer, run } = await import("@/server/store");
    const start = getServer().ws.activeStation ?? null;
    const guard = { station: start };
    const tools = buildTools(() => undefined, guard) as unknown as Tool[];
    const describe = tools.find((t) => t.name === "workspace_describe")!;
    expect(await describe.invoke(new RunContext(), "{}")).not.toMatch(/^ERROR/);
     
    const own = await tools.find((t) => t.name === "station_new")!.invoke(new RunContext(), JSON.stringify({ name: "Copilot station" }));
    expect(own).not.toMatch(/^ERROR/);
    expect(await describe.invoke(new RunContext(), "{}")).not.toMatch(/^ERROR/);
     
    expect((await run("station.setActive", { station: start }, "ui")).ok).toBe(true);
    expect(await describe.invoke(new RunContext(), "{}")).toMatch(/^ERROR: The active station changed from "Copilot station" to ".+" \(someone switched stations\) while you were working\. Stop and ask the user/);
    await run("station.close", { station: "Copilot station", ifUnsaved: "discard" }, "ui");
  });
});
