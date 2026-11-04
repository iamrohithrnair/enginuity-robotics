 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { engine, LIBRARY_FILE } from "../helpers";

const FILE = LIBRARY_FILE("stations", "Additive-Manufacturing-and-Machining-with-ABB-IRB-120-3-0-6.rdk");

describe.skipIf(!existsSync(FILE))("large station import", () => {
  it("opens a 30,000-instruction station and deletes its biggest program node by node", { timeout: 180_000 }, async () => {
    const e = await engine();
    const t0 = Date.now();
    const res = (await e.run("station.openRdk", { base64: readFileSync(FILE).toString("base64") })) as unknown as { id: string; instructions: number };
    const seconds = (Date.now() - t0) / 1000;
    expect(res.instructions).toBeGreaterThan(30_000);
    expect(seconds).toBeLessThan(90);

     
    const programs = Object.values(e.ws.items).filter((i) => i.type === "program");
    const big = programs.reduce((a, b) => (b.children.length > a.children.length ? b : a));
    const order = big.children.slice();
    expect(order.length).toBeGreaterThan(5_000);
    expect(order.every((id) => e.ws.items[id]?.parent === big.id)).toBe(true);

     
     
    const t1 = Date.now();
    await e.run("item.delete", { items: [big.id] });
    expect((Date.now() - t1) / 1000).toBeLessThan(30);
    expect(e.ws.items[big.id]).toBeUndefined();
    expect(order.some((id) => e.ws.items[id])).toBe(false);
    await e.run("edit.undo", {});
    expect(e.ws.items[big.id]?.children).toEqual([]);
    await e.run("edit.undo", {});
    await e.run("edit.undo", {});
    expect(e.ws.items[big.id]?.children).toEqual(order.slice(0, 2));
    await e.run("edit.redo", {});
    expect(e.ws.items[big.id]?.children).toEqual(order.slice(0, 1));
  });
});
