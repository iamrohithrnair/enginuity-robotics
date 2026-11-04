 
 
 
 
 
 
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotStation } from "@/engine/commands/station";
import { stationParamList } from "@/engine/stationParams";
import type { Item } from "@/engine/types";
import { createFileServices } from "@/server/fileStore";
import { engine } from "../helpers";

type E = Awaited<ReturnType<typeof engine>>;
const get = async (e: E, key: string, station?: string) => ((await e.run("station.getParam", { key, ...(station ? { station } : {}) })) as unknown as { value: string | null }).value;
const set = (e: E, key: string, value: string, station?: string) => e.run("station.setParam", { key, value, ...(station ? { station } : {}) });
const newStation = async (e: E) => ((await e.run("station.new", {})) as unknown as { id: string }).id;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mb-params-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("station parameters", () => {
  it("each station keeps its own: switching, adding or closing stations never shows another station's names", async () => {
    const e = await engine();
    const a = e.ws.activeStation!;
    await set(e, "SizeBox", "150, 200, 150");
    const b = await newStation(e);
    expect(e.ws.activeStation).toBe(b);
    expect(await get(e, "SizeBox")).toBeNull();
    await set(e, "ConvSpeed", "15");
    await e.run("station.setActive", { station: a });
    expect(await get(e, "SizeBox")).toBe("150, 200, 150");
    expect(await get(e, "ConvSpeed")).toBeNull();
     
    expect(await get(e, "ConvSpeed", b)).toBe("15");
    await set(e, "ConvSpeed", "25", b);
    expect(await get(e, "ConvSpeed")).toBeNull();
    expect(stationParamList(e.ws, b)).toEqual([["ConvSpeed", "25"]]);
     
    await e.run("station.close", { station: b, ifUnsaved: "discard" });
    expect(await get(e, "SizeBox")).toBe("150, 200, 150");
    await e.run("station.close", { station: a, ifUnsaved: "discard" });
    expect(await get(e, "SizeBox")).toBeNull();
    expect(stationParamList(e.ws)).toEqual([]);
  });

  it("an empty value removes an existing name; a new name is added even with an empty value", async () => {
    const e = await engine();
    await set(e, "Box_Num", "0");
    expect(await get(e, "Box_Num")).toBe("0");
    await set(e, "Box_Num", "");
    expect(await get(e, "Box_Num")).toBeNull();
     
    await set(e, "Box_X", "");
    expect(await get(e, "Box_X")).toBe("");
     
    await set(e, "Box_X", "");
    expect(await get(e, "Box_X")).toBeNull();
     
    await e.run("io.set", { name: "3", value: 1 });
    expect(await get(e, "IO_3")).toBe("1");
    expect(((await e.run("io.get", { name: "3" })) as unknown as { value: string }).value).toBe("1");
    expect(stationParamList(e.ws)).toEqual([["IO_3", "1"]]);
  });

  it("saved with the station and opened again, in order; files without parameters still open", async () => {
    const e = await engine();
    e.services.files = createFileServices(dir);
    const a = e.ws.activeStation!;
    await set(e, "SizeBox", "150, 200, 150");
    await set(e, "Box_X", "");
    await set(e, "1", "numeric names keep their place");
    const { path: file } = (await e.run("station.save", {}, "ui")) as unknown as { path: string };
    const saved = JSON.parse(readFileSync(file, "utf8")) as { format: string; root: string; items: Item[] };
    expect(saved.format).toBe("enginuity-station");
    expect(saved.items.find((i) => i.id === saved.root)?.stationParams).toEqual([
      ["SizeBox", "150, 200, 150"],
      ["Box_X", ""],
      ["1", "numeric names keep their place"],
    ]);
    await e.run("station.close", { station: a, ifUnsaved: "discard" });
    expect(await get(e, "SizeBox")).toBeNull();
    await e.run("station.open", { path: file });
    expect(stationParamList(e.ws)).toEqual([
      ["SizeBox", "150, 200, 150"],
      ["Box_X", ""],
      ["1", "numeric names keep their place"],
    ]);
    expect(await get(e, "Box_X")).toBe("");

     
    const old = snapshotStation(e.ws, e.ws.activeStation!);
    for (const it of old.items) delete it.stationParams;
    const oldFile = path.join(dir, "Old station.rcstation.json");
    writeFileSync(oldFile, JSON.stringify(old));
    await e.run("station.open", { path: oldFile });
    expect(stationParamList(e.ws)).toEqual([]);
    expect(await get(e, "SizeBox")).toBeNull();
  });

  it("a name stored twice (as station files may): the first answers, set changes it, an empty value removes it", async () => {
    const e = await engine();
    e.services.files = createFileServices(dir);
    const snap = snapshotStation(e.ws, e.ws.activeStation!);
    snap.items[0].stationParams = [
      ["TestVar", "red"],
      ["TestVar", "green"],
    ];
    const file = path.join(dir, "Twice.rcstation.json");
    writeFileSync(file, JSON.stringify(snap));
    await e.run("station.open", { path: file });
    expect(await get(e, "TestVar")).toBe("red");
    await set(e, "TestVar", "blue");
    expect(stationParamList(e.ws)).toEqual([
      ["TestVar", "blue"],
      ["TestVar", "green"],
    ]);
    await set(e, "TestVar", "");
    expect(await get(e, "TestVar")).toBe("green");
  });
});
