 
 
 
 
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionForKeySequence, actionListing, findAction } from "@/engine/actions";
import { engine, ROOT } from "../helpers";

type E = Awaited<ReturnType<typeof engine>>;
const LISTING = readFileSync(path.join(ROOT, "research/evidence/interaction-model/trigger-action-list.txt"), "utf8");
const id = (r: unknown) => (r as { id: string }).id;
const statuses = (e: E) => e.events.filter((x) => x.type === "status").map((x) => String(x.text));

 
async function cell() {
  const e = await engine();
  const st = e.ws.activeStation!;
  const prog = id(await e.run("program.add", { name: "Prog" }));
  await e.run("program.addInstruction", { program: prog, kind: "pause" });
  const frame = id(await e.run("item.addFrame", { name: "Frame1", parent: st }));
  const part = id(await e.run("object.addShape", { shape: "box", sizeX: 10, sizeY: 10, sizeZ: 10, name: "Part", parent: st }));
  const ins = e.ws.items[prog].children[0];
  const names = () => e.ws.items[st].children.map((c) => e.ws.items[c].name);
  expect(names()).toEqual(["Prog", "Frame1", "Part"]);
  e.events.length = 0;
  return { e, st, prog, frame, part, ins, names };
}

describe("Reorder actions in the action registry (B-TOOL-16/17, R-TREE-35)", () => {
  it("keep RoboDK's names, texts and Shift+R, and are bound instead of 'not available'", () => {
    expect(LISTING).toContain("actionReorder_item_after|Reorder Selected Items...||");
    expect(LISTING).toContain("actionReorder_items_automatically|Reorder Selected Items Automatically|Shift+R||");
    expect(actionListing()).toContain("actionReorder_item_after|Reorder Selected Items...||");
    expect(actionListing()).toContain("actionReorder_items_automatically|Reorder Selected Items Automatically|Shift+R||");
    const auto = findAction("actionReorder_items_automatically")!;
    expect(auto).toMatchObject({ command: "item.reorderAuto" });
    expect(auto.unavailable).toBeUndefined();
     
    expect(actionForKeySequence("⇧R")?.name).toBe("actionReorder_items_automatically");
    const specify = findAction("actionReorder_item_after")!;
    expect(specify).toMatchObject({ ui: true });
    expect(specify.unavailable).toBeUndefined();
  });

  it("Shift+R places the selected items by type priority; stations and instructions in the selection are skipped without a message", async () => {
    const { e, st, prog, part, ins, names } = await cell();
    await e.run("edit.select", { items: [st, part, ins] });
    await e.run("view.action", { name: "actionReorder_items_automatically" });
     
    expect(names()).toEqual(["Part", "Prog", "Frame1"]);
    expect(e.ws.items[prog].children).toEqual([ins]);
    expect(statuses(e)).toEqual([]);
     
    expect((await e.tryRun("item.reorderAuto", { items: [st] })).error).toBe("A station can not be reordered");
  });

  it("Shift+R with nothing selected does nothing", async () => {
    const { e, names } = await cell();
    await e.run("edit.select", { items: [] });
    const r = await e.tryRun("view.action", { name: "actionReorder_items_automatically" });
    expect(r.ok).toBe(true);
    expect(names()).toEqual(["Prog", "Frame1", "Part"]);
    expect(statuses(e)).toEqual([]);
  });

  it("Reorder Selected Items... opens the Specify picker in the user's window", async () => {
    const { e } = await cell();
    expect((await e.tryRun("view.action", { name: "actionReorder_item_after" })).error).toBe("Reorder Selected Items... needs an open Enginuity window");
    e.services.view = { clients: () => 1, screenshot: async () => ({ path: "", width: 0, height: 0 }) };
    await e.run("view.action", { name: "actionReorder_item_after" });
    expect(e.events.filter((x) => x.type === "ui-action")).toEqual([{ type: "ui-action", name: "actionReorder_item_after" }]);
    expect(statuses(e)).toEqual([]);
  });
});

describe("Reorder actions in the browser (menus, shortcuts, palette)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Reorder Selected Items... checks the selection with RoboDK's messages, then opens the picker; Shift+R sends item.reorderAuto", async () => {
    const sent: { name: string; params: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (url === "/api/command") sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, result: {} }), { headers: { "content-type": "application/json" } });
      }),
    );
    const { useRC } = await import("@/client/store");
    const { useFileDialogs } = await import("@/client/fileActions");
    const { runAction } = await import("@/client/uiActions");
    const { e, st, part, frame, ins } = await cell();
    useRC.setState({ ws: e.ws });

    await e.run("edit.select", { items: [part, frame] });
    await runAction("actionReorder_item_after");
    expect(useFileDialogs.getState().reorder).toEqual([part, frame]);
    useFileDialogs.setState({ reorder: null });

    await e.run("edit.select", { items: [st] });
    await runAction("actionReorder_item_after");
    expect(useFileDialogs.getState().question?.html).toBe("A station can not be reordered");
    useFileDialogs.getState().question?.resolve("OK");
    await e.run("edit.select", { items: [] });
    await runAction("actionReorder_item_after");
    expect(useFileDialogs.getState().question?.html).toBe("Select an item first");
    useFileDialogs.getState().question?.resolve("OK");
    expect(useFileDialogs.getState().reorder).toBeNull();

    await e.run("edit.select", { items: [ins, part] });
    await runAction("actionReorder_items_automatically");
    expect(sent).toEqual([{ name: "item.reorderAuto", params: { items: [part] } }]);
  });
});
