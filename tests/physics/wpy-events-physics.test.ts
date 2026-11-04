 
 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let S: typeof import("@/server/store");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = async (name: string, params: Record<string, unknown> = {}) => {
  const r = await S.run(name, params, "system");
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result as Record<string, unknown>;
};
const ws = () => S.getServer().ws;
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(20);
  return cond();
};

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-wpy-physics-"));
  S = await import("@/server/store");
  await S.getServer().ready;
}, 60_000);

afterAll(async () => {
  await S.run("physics.enable", { on: false }, "system");
});

describe("events with physics on", () => {
  it("a created copy falls; removing it leaves the template", async () => {
    await run("station.new", { name: "Feeder" });
    const st = ws().activeStation!;
    await run("object.addShape", { shape: "box", name: "Floor", sizeX: 3000, sizeY: 3000, sizeZ: 20, xyzrpw: [0, 0, -20, 0, 0, 0], parent: st });
    const template = (await run("object.addShape", { shape: "box", name: "Part", sizeX: 100, sizeY: 100, sizeZ: 100, xyzrpw: [0, 0, 500, 0, 0, 0], parent: st })).id as string;
     
    await run("item.lock", { items: [template], locked: true });
    await run("item.setVisible", { items: [template], visible: false });
    const prog = (await run("program.add", { name: "Feed" })).id as string;
    const create = (await run("program.addInstruction", { program: prog, kind: "event", eventAction: "create" })).id as string;
    await run("instruction.setEvent", { instruction: create, objects: [template], frame: st });
    await run("physics.enable", { on: true });
    await sleep(300);
     
    expect(ws().items[template].pose[11]).toBe(500);
    const made = (await run("sim.event", { robot: null, instruction: create })).ids as string[];
    expect(made).toHaveLength(1);
    expect(!!ws().items[made[0]].locked).toBe(false);
     
    expect(await until(() => (ws().items[made[0]]?.pose[11] ?? 500) < 50, 4000)).toBe(true);
    expect(ws().items[template].pose[11]).toBe(500);
    const remove = (await run("program.addInstruction", { program: prog, kind: "event", eventAction: "remove" })).id as string;
    await run("instruction.setEvent", { instruction: remove, objects: [template] });
    expect((await run("sim.event", { robot: null, instruction: remove })).removed).toEqual(["Part"]);
    await sleep(200);
    expect(ws().items[made[0]]).toBeUndefined();
    expect(ws().items[template]).toBeDefined();
  });
});
