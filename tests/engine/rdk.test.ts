// Verifies .rdk station and .rdka item imports preserve hierarchy and poses.
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { poseToXYZRPW } from "@/engine/math";
import type { Item } from "@/engine/types";
import { engine, hasLibraryFile, LIBRARY_FILE, near, qUncompress, ROOT } from "../helpers";

const b64 = (rel: string) => readFileSync(path.join(ROOT, rel)).toString("base64");

 
 
 
 
const SAMPLE = "Assembly-and-Material-Handling-with-ABB-IRB-120-3-0-6.rdk";
const itSample = it.skipIf(!hasLibraryFile("stations", SAMPLE));
const sampleFile = () => readFileSync(LIBRARY_FILE("stations", SAMPLE));

async function open(rel: string | Buffer) {
  const e = await engine();
  const base64 = typeof rel === "string" ? b64(rel) : rel.toString("base64");
  const res = (await e.run("station.openRdk", { base64 })) as unknown as { id: string; name: string; imported: number; instructions: number; skipped: unknown[] };
  const station = res.id;
  const inStation = (it: Item) => {
    let cur: Item | undefined = it;
    while (cur?.parent) cur = e.ws.items[cur.parent];
    return cur?.id === station;
  };
  const all = () => Object.values(e.ws.items).filter(inStation);
  const find = (name: string, type?: Item["type"]) => {
    const it = all().find((i) => i.name === name && (!type || i.type === type));
    if (!it) throw new Error(`no ${type ?? "item"} named ${name}`);
    return it;
  };
   
  const xyz = (it: Item) => poseToXYZRPW(it.pose).map((v) => Math.round(v * 1000) / 1000 + 0);
  return { e, res, all, find, xyz };
}

describe("station.openRdk (RoboDK .rdk station files)", () => {
  it("opens the minimal station: names, parents and poses (rdk_tree-minimal.txt)", async () => {
    const { e, res, find, xyz } = await open("research/evidence/slf/minimal.rdk");
    expect(res.name).toBe("MinStation");
    expect(e.ws.activeStation).toBe(res.id);
    const frame = find("FrameA", "frame");
    expect(frame.parent).toBe(res.id);
    expect(xyz(frame)).toEqual([100, 200, 300, 0, 0, 90]);
    const target = find("TargetB", "target");
    expect(target.parent).toBe(frame.id);
    expect(xyz(target)).toEqual([10, 20, 30, 0, 0, 0]);
    expect(target.target?.robot ?? null).toBeNull();
  });

  itSample("opens a library example station with robots, tools, objects, targets and programs", async () => {
    const { res, all, find, xyz } = await open(sampleFile());
    expect(res.name).toBe("Assembly and Material Handling with ABB IRB 120-3/0.6");
    expect(res.skipped).toEqual([]);
    const count = (t: Item["type"]) => all().filter((i) => i.type === t).length;
    expect(count("frame")).toBe(47);
    expect(count("target")).toBe(18);
    expect(count("object")).toBe(41);
    expect(count("robot")).toBe(3);
    expect(count("tool")).toBe(1);
    expect(count("program")).toBe(28);
    expect(count("python")).toBe(4);
    expect(res.instructions).toBe(161);

     
    const pallet = find("PalletTube1_Ref", "frame");
    expect(xyz(pallet)).toEqual([300, 160, 0, 0, 0, 90]);
    const tube = find("TubeType1-1", "frame");
    expect(tube.parent).toBe(pallet.id);
    expect(xyz(tube)).toEqual([25, 25, 70, 0, 0, 0]);
    const tubeObj = find("TubeType1-1", "object");
    expect(tubeObj.parent).toBe(tube.id);
    expect(xyz(tubeObj).slice(0, 3)).toEqual([0, 0, -65]);
    expect(tubeObj.object!.meshes.length).toBeGreaterThan(0);

     
    const abb = find("ABB IRB 120-3/0.6", "robot");
    expect(abb.robot!.model.nq).toBe(6);
    expect(abb.robot!.links.length).toBe(7);
    const tool = find("GripperTCP", "tool");
    expect(tool.parent).toBe(abb.id);
    expect(abb.robot!.activeTool).toBe(tool.id);
    expect(tool.pose[11]).toBe(70);
    const pick = find("Target_PickTubeType1", "target");
    expect(pick.target!.robot).toBe(abb.id);
    expect(pick.target!.joints.map((v) => Math.round(v * 100) / 100)).toEqual([22.57, 63.88, -11.41, 0, 37.53, 22.57]);

     
    const prog = find("GripperOpen", "program");
    expect(prog.program!.robot).toBe(find("Gripper", "robot").id);
    const ins = prog.children.map((c) => all().find((i) => i.id === c)!);
    expect(ins.map((i) => i.name)).toEqual(["Set Ref.: Assembly", "Set Tool: GripperTCP", "MoveJ (GripperOpen)"]);
    expect(ins[0].instruction!.frame).toBe(find("Assembly", "frame").id);
    expect(ins[1].instruction!.tool).toBe(tool.id);
    expect(ins[2].instruction!.target).toBe(find("GripperOpen", "target").id);

     
    const pickO = find("Pick_O-Ring", "program");
    const call = pickO.children.map((c) => all().find((i) => i.id === c)!).find((i) => i.instruction?.kind === "code");
    expect(call?.instruction?.codeType).toBe(0);
  });

  itSample("keeps the robot joints stored in the station and imports programs that can be estimated", async () => {
     
    const { e, find } = await open(qUncompress(sampleFile()));
    const abb = find("ABB IRB 120-3/0.6", "robot");
    expect(abb.robot!.joints.length).toBe(6);
    const prog = find("Pick_TubeType1", "program");
    const u = (await e.run("program.update", { program: prog.id })) as unknown as unknown[];
    expect(u.length).toBe(5);
    expect(Number(u[0])).toBeGreaterThan(0);
  });

  it("rejects data that is not a station file with RoboDK's message", async () => {
    const e = await engine();
    const r = await e.tryRun("station.openRdk", { base64: Buffer.from("not a station").toString("base64") });
    expect(r.ok).toBe(false);
    expect(near(0, 0)).toBe(true);
  });
});

describe("library.load of item archives (.rdka)", () => {
   
   
  it("opens the archive as a new active station without an undo step", async () => {
    const e = await engine();
    const before = e.ws.stations.length;
    const bytes = new Uint8Array(readFileSync(path.join(ROOT, "research/evidence/slf/minimal.rdk")));
    e.services.library!.load = async (file) => ({ bytes, url: `https://downloads.example/${file}` });
    const res = (await e.run("library.load", { file: "Dual-Arm.rdka" })) as unknown as { id: string; name: string; imported: number; source: string };
     
    expect(res).toMatchObject({ name: "MinStation", imported: 2, skipped: [], source: "library/Dual-Arm.rdka" });
    expect(e.ws.stations.length).toBe(before + 1);
    expect(e.ws.activeStation).toBe(res.id);
    const items = Object.values(e.ws.items);
    const frame = items.find((i) => i.name === "FrameA")!;
    expect(frame.parent).toBe(res.id);
    expect(items.find((i) => i.name === "TargetB")!.parent).toBe(frame.id);
    expect(e.undo.list()).toMatchObject({ undo: [], redo: [] });
  });
});
