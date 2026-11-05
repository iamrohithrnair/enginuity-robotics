// Verifies .rdk imports restore stored station parameters and preserve empty tables.
 
 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stationParamList, stationParams } from "@/engine/stationParams";
import { engine, LIBRARY_FILE, ROOT } from "../helpers";

 
function station(name: string): string | null {
  for (const p of [LIBRARY_FILE("stations", name), path.join(ROOT, "research/evidence/slf/rdk", name)]) {
    if (existsSync(p)) return p;
  }
  return null;
}
const CONVEYING = station("Conveying-with-UR10.rdk");
const INSPECTION = station("Conveying-Inspection-and-Material-Handling-with-UR10.rdk");
const ABB = station("Conveying-and-Material-Handling-with-ABB.rdk");
const MIXED = station("Mixed-Applications-with-RoboDK-RDK-1440-02.rdk");

type E = Awaited<ReturnType<typeof engine>>;
const open = async (e: E, file: string) => ((await e.run("station.openRdk", { base64: readFileSync(file).toString("base64") })) as unknown as { id: string }).id;
const param = async (e: E, key: string) => ((await e.run("station.getParam", { key })) as unknown as { value: string | null }).value;

describe("station parameters from .rdk station files", () => {
  it("a station without parameters has none (minimal.rdk)", async () => {
    const e = await engine();
    await open(e, path.join(ROOT, "research/evidence/slf/minimal.rdk"));
    expect(stationParamList(e.ws)).toEqual([]);
  });

  it.skipIf(!CONVEYING)("Conveying with UR10: SizeBox, SizePallet, ConvSpeed and SENSOR as its scripts read them", async () => {
    const e = await engine();
    await open(e, CONVEYING!);
     
    expect(await param(e, "SizeBox")).toBe("150, 200, 150");
    expect(await param(e, "SizePallet")).toBe("3,2,3");
     
    expect(await param(e, "ConvSpeed")).toBe("25.0");
    expect(await param(e, "SENSOR")).toBe("0");
    expect(await param(e, "PartCycles")).toBeNull();
    expect(stationParamList(e.ws).map(([k]) => k)).toEqual(["SizeBox", "SizePallet", "ConvSpeed", "SENSOR"]);
     
    await e.run("station.setParam", { key: "SizeBox", value: "100, 100, 100" });
    expect(await param(e, "SizeBox")).toBe("100, 100, 100");
  });

  it.skipIf(!ABB)("Conveying and Material Handling with ABB: ConvSpeed_MMS and PartCycles", async () => {
    const e = await engine();
    await open(e, ABB!);
    expect(await param(e, "ConvSpeed_MMS")).toBe("10");
    expect(await param(e, "PartCycles")).toBe("20");
  });

  it.skipIf(!MIXED)("Mixed Applications: a name stored twice answers with the first; null values read as empty text", async () => {
    const e = await engine();
    await open(e, MIXED!);
    expect(await param(e, "Box_Num")).toBe("0");
    expect(await param(e, "Conveyor_Travel")).toBe("400");
    expect(await param(e, "TestVar")).toBe("red");
    expect(await param(e, "Box_X")).toBe("");
     
    expect(stationParamList(e.ws)).toHaveLength(29);
    expect(Object.keys(stationParams(e.ws))).toHaveLength(28);
  });

  it.skipIf(!CONVEYING || !INSPECTION)("each opened station answers with its own values (the active one)", async () => {
    const e = await engine();
    const conveying = await open(e, CONVEYING!);
    await open(e, INSPECTION!);
    expect(await param(e, "ConvSpeed")).toBe("15");
    expect(await param(e, "SizePallet")).toBe("2,3,2");
    expect(await param(e, "TAGS")).toBe("['Pick And Place', 'Pick and place', 'Vision']");
    await e.run("station.setActive", { station: conveying });
    expect(await param(e, "ConvSpeed")).toBe("25.0");
    expect(await param(e, "SizePallet")).toBe("3,2,3");
     
    expect(await param(e, "TAGS")).toBeNull();
  });
});
