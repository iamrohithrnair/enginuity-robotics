 
 
 
 
 
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fk } from "@/engine/kinematics";
import { mul, poseDistance, transl } from "@/engine/math";
import { eventName } from "@/engine/naming";
import { conveyorGoal, conveyorOf, liveAbsPose, triangleCount, waitStep } from "@/engine/sim/events";
import { planProgram } from "@/engine/sim/planner";
import type { InstructionData } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import { engine, ROOT } from "../helpers";

type Id = { id: string };
type Ev = NonNullable<InstructionData["event"]>;
const xyz = (m: number[]) => [m[3], m[7], m[11]].map((v) => Math.round(v * 1e4) / 1e4 + 0);

 
async function station() {
  const e = await engine();
  const prog = (await e.run("program.add", { name: "Events" })) as unknown as Id;
  const ev = (await e.run("program.addInstruction", { program: prog.id, kind: "event", eventAction: "show" })) as unknown as Id;
  const box = async (name: string, at: number[], size = 100, parent?: string) =>
    ((await e.run("object.addShape", { shape: "box", name, sizeX: size, sizeY: size, sizeZ: size, xyzrpw: [...at, 0, 0, 0], ...(parent ? { parent } : {}) })) as unknown as Id).id;
  const frame = async (name: string, at: number[], parent?: string) => ((await e.run("item.addFrame", { name, xyzrpw: [...at, 0, 0, 0], ...(parent ? { parent } : {}) })) as unknown as Id).id;
  const setEvent = (event: Ev) => {
    e.ws.items[ev.id].instruction!.event = event;
  };
  const fire = async (live?: Record<string, number[]>) => (await e.run("sim.event", { robot: null, instruction: ev.id, ...(live ? { live } : {}) })) as unknown as Record<string, unknown>;
  return { e, prog: prog.id, ev: ev.id, box, frame, setEvent, fire };
}

describe("event names (FUN_1000c68fc)", () => {
  it("one object names it, several give the plural, none or a deleted one keeps 'Not defined'", async () => {
    const { e, box } = await station();
    const a = await box("RoboDK Box", [0, 0, 0]);
    const b = await box("Laser Sensor A", [500, 0, 0]);
    const name = (event: Ev) => eventName(e.ws, event);
    expect(name({ action: "conveyor", objects: [a] })).toBe("Move RoboDK Box");
    expect(name({ action: "conveyor", objects: [a, b] })).toBe("Move conveyors");
    expect(name({ action: "create", objects: [a] })).toBe("Create RoboDK Box");
    expect(name({ action: "create", objects: [a, b] })).toBe("Create objects");
    expect(name({ action: "remove", objects: [a] })).toBe("Remove all RoboDK Box");
    expect(name({ action: "remove", objects: [a, b] })).toBe("Remove objects");
     
    expect(name({ action: "wait", objects: [b], option: 1 })).toBe("Wait & Remove-Laser Sensor A");
    expect(name({ action: "wait", objects: [b], option: 0 })).toBe("Wait-Laser Sensor A");
    expect(name({ action: "wait", objects: [b], option: 2 })).toBe("Wait & Move-Laser Sensor A");
    expect(name({ action: "wait", objects: [b], option: 3 })).toBe("Wait & Stop-Laser Sensor A");
    expect(name({ action: "wait", objects: [a, b], option: 3 })).toBe("Wait & Stop");
     
    expect(name({ action: "wait", objects: [b], option: 7 })).toBe("-Laser Sensor A");
    for (const action of ["conveyor", "create", "remove", "wait"] as const) {
      expect(name({ action, objects: [] })).toBe("Not defined");
      expect(name({ action, objects: ["gone"] })).toBe("Not defined");
    }
  });
});

describe("create objects (FUN_1000c7d5c)", () => {
  it("copies each listed object under the event's frame: same name, unlocked, shown, at the original's absolute pose", async () => {
    const { e, box, frame, setEvent, fire } = await station();
    const store = await frame("Templates", [-2350, -125, 0]);
    const template = await box("RoboDK Box", [0, -400, 0], 300, store);
    e.ws.items[template].locked = true;
    e.ws.items[template].visible = false;
    const belt = await frame("Belt Frame", [100, 1000, 715]);
    setEvent({ action: "create", objects: [template], frame: belt });
    const before = absPose(e.ws, template);
    const r = await fire();
    expect(r.created).toEqual(["RoboDK Box"]);
    const copy = e.ws.items[(r.ids as string[])[0]];
    expect(copy.parent).toBe(belt);
    expect(e.ws.items[belt].children.at(-1)).toBe(copy.id);
    expect(copy.visible).toBe(true);
    expect(!!copy.locked).toBe(false);
    expect(poseDistance(absPose(e.ws, copy.id), before).mm).toBeLessThan(1e-9);
     
    expect(e.ws.items[template]).toMatchObject({ locked: true, visible: false, parent: store });
    expect(triangleCount(e.services.geometry, copy)).toBe(triangleCount(e.services.geometry, e.ws.items[template]));
  });

  it("does nothing when the event's frame is gone ('Parent for feeder was deleted')", async () => {
    const { e, box, setEvent, fire } = await station();
    const template = await box("Part", [0, 0, 0]);
    setEvent({ action: "create", objects: [template], frame: "deleted-frame" });
    const n = Object.keys(e.ws.items).length;
    expect((await fire()).created).toEqual([]);
    expect(Object.keys(e.ws.items).length).toBe(n);
  });

  it("places the copy with the joints of a conveyor still moving (it rides on the conveyor's flange)", async () => {
    const { e, box, setEvent, fire } = await station();
    const belt = await box("Belt", [0, 0, 0], 50);
    const carriage = await box("Carriage", [0, 0, 0], 10);
    const conv = (await e.run("mechanism.build", { type: 4, name: "Conveyor", objects: [belt, carriage], lower: [-5000], upper: [5000] })) as unknown as Id;
    const ref = ((await e.run("item.addFrame", { name: "Conveyor Move Ref", parent: conv.id })) as unknown as Id).id;
     
    const template = await box("Box", [60, 290, 366.5], 100, e.ws.activeStation!);
    setEvent({ action: "create", objects: [template], frame: ref });
     
    const live = { [conv.id]: [750] };
    const r = await fire(live);
    const copy = (r.ids as string[])[0];
    expect(poseDistance(liveAbsPose(e.ws, copy, live), absPose(e.ws, template)).mm).toBeLessThan(1e-9);
     
    const robot = e.ws.items[conv.id].robot!;
    const step = mul(absPose(e.ws, conv.id), fk(robot.model, [1000]));
    const back = mul(absPose(e.ws, conv.id), fk(robot.model, [750]));
    const moved = poseDistance(liveAbsPose(e.ws, copy, { [conv.id]: [1000] }), absPose(e.ws, template)).mm;
    expect(moved).toBeCloseTo(poseDistance(step, back).mm, 9);
    expect(moved).toBeCloseTo(250, 9);
  });
});

describe("remove objects (FUN_1000c8090)", () => {
  it("deletes the unlocked objects named and shaped like a listed one, never the listed ones", async () => {
    const { e, box, setEvent, fire } = await station();
    const template = await box("RoboDK Box", [0, 0, 0]);
    e.ws.items[template].locked = true;
    const copies = [await box("RoboDK Box", [400, 0, 0]), await box("RoboDK Box", [800, 0, 0])];
    const lockedTwin = await box("RoboDK Box", [1200, 0, 0]);
    e.ws.items[lockedTwin].locked = true;
     
    const sphere = ((await e.run("object.addShape", { shape: "sphere", name: "RoboDK Box", radius: 50 })) as unknown as Id).id;
    const other = await box("Crate", [0, 400, 0]);
    setEvent({ action: "remove", objects: [template] });
    expect((await fire()).removed).toEqual(["RoboDK Box", "RoboDK Box"]);
    for (const id of copies) expect(e.ws.items[id]).toBeUndefined();
    for (const id of [template, lockedTwin, sphere, other]) expect(e.ws.items[id]).toBeDefined();
  });
});

describe("attach and Locked (FUN_1003cdc94)", () => {
  it("never attaches a locked object, even the closest one", async () => {
    const { e, box, setEvent, fire } = await station();
    const belt = await box("Belt", [0, 0, 0], 50);
    const carriage = await box("Carriage", [0, 0, 0], 10);
    const mech = (await e.run("mechanism.build", { type: 4, name: "Lifter", objects: [belt, carriage] })) as unknown as Id;
    const tool = (await e.run("robot.addTool", { robot: mech.id, name: "Gripper" })) as unknown as Id;
    const tcp = absPose(e.ws, mech.id);
    const near = await box("Template", [tcp[3] + 20, tcp[7], tcp[11]], 10, e.ws.activeStation!);
    const far = await box("Part", [tcp[3] + 120, tcp[7], tcp[11]], 10, e.ws.activeStation!);
    setEvent({ action: "attach", tool: tool.id, objects: [], option: 1, distance: 200 });
     
    expect((await fire()).attached).toBe("Template");
    await e.run("item.setParent", { item: near, parent: e.ws.activeStation!, keepAbsolute: true });
    await e.run("item.lock", { items: [near], locked: true });
    expect((await fire()).attached).toBe("Part");
    expect(e.ws.items[far].parent).toBe(tool.id);
    expect(e.ws.items[near].parent).toBe(e.ws.activeStation);
  });
});

describe("wait for object (FUN_1000c6370, FUN_1004e6af4)", () => {
  async function sensorCell() {
    const s = await station();
    const sensor = await s.box("Laser Sensor A", [0, 0, 0], 40);
    s.e.ws.items[sensor].locked = true;
    return { ...s, sensor };
  }

  it("detects the first unlocked object whose triangles cross the sensor's, hidden ones included", async () => {
    const { e, box, sensor } = await sensorCell();
    const far = await box("Box", [500, 0, 0]);
    const ev: Ev = { action: "wait", objects: [sensor], option: 0 };
    expect(waitStep(e.ws, null, e.services.geometry, ev).done).toBe(false);
     
    const fence = await box("Fence", [30, 0, 0]);
    e.ws.items[fence].locked = true;
    expect(waitStep(e.ws, null, e.services.geometry, ev).done).toBe(false);
     
    e.ws.items[far].pose = transl(30, 10, 0);
    e.ws.items[far].visible = false;
    expect(waitStep(e.ws, null, e.services.geometry, ev)).toMatchObject({ done: true, sensor: "Laser Sensor A", detected: "Box" });
     
    e.ws.items[far].pose = transl(5000, 0, 0);
    const big = await box("Hall", [0, 0, -500], 2000);
    expect(waitStep(e.ws, null, e.services.geometry, ev).done).toBe(false);
    expect(e.ws.items[big]).toBeDefined();
  });

  it("Wait & Remove deletes the detected object; Wait & Move puts it under the frame where it is", async () => {
    const { e, box, frame, sensor, setEvent, fire } = await sensorCell();
    const a = await box("Box", [30, 0, 0]);
    setEvent({ action: "wait", objects: [sensor], option: 1 });
    expect(await fire()).toMatchObject({ done: true, removed: "Box" });
    expect(e.ws.items[a]).toBeUndefined();
    const b = await box("Box", [30, 0, 0]);
    const dest = await frame("ConveyorB Move Ref", [2170, 690, 0]);
    const where = absPose(e.ws, b);
    setEvent({ action: "wait", objects: [sensor], option: 2, frame: dest });
    expect(await fire()).toMatchObject({ done: true, moved: "Box" });
    expect(e.ws.items[b].parent).toBe(dest);
    expect(poseDistance(absPose(e.ws, b), where).mm).toBeLessThan(1e-9);
  });

  it("Wait & Move without its frame and Wait & Stop without a robot keep waiting", async () => {
    const { e, box, sensor, setEvent, fire } = await sensorCell();
    const a = await box("Box", [30, 0, 0]);
    setEvent({ action: "wait", objects: [sensor], option: 2, frame: null });
    expect((await fire()).done).toBe(false);
    setEvent({ action: "wait", objects: [sensor], option: 3, frame: a });
    expect((await fire()).done).toBe(false);
     
    const belt = await box("Belt", [0, 0, -3000], 50);
    const carriage = await box("Carriage", [0, 0, -3000], 10);
    const conv = (await e.run("mechanism.build", { type: 4, name: "Conveyor", objects: [belt, carriage] })) as unknown as Id;
    setEvent({ action: "wait", objects: [sensor], option: 3, frame: conv.id });
    expect(await fire()).toMatchObject({ done: true, stopRobot: conv.id });
  });
});

describe("move conveyor (FUN_1000c861c)", () => {
  it("moves the first listed mechanism, every joint by the event's movement", async () => {
    const { e, box } = await station();
    const part = await box("Part", [0, 0, 0]);
    const belt = await box("Belt", [0, 0, 0], 50);
    const carriage = await box("Carriage", [0, 0, 0], 10);
    const conv = (await e.run("mechanism.build", { type: 4, name: "Conveyor", objects: [belt, carriage] })) as unknown as Id;
    expect(conveyorOf(e.ws, { action: "conveyor", objects: [part, conv.id] })?.id).toBe(conv.id);
    expect(conveyorOf(e.ws, { action: "conveyor", objects: [part] })).toBeUndefined();
     
    expect(conveyorGoal([0], 400)).toEqual([400]);
    expect(conveyorGoal([10, -20], 3)).toEqual([13, -17]);
  });

  it("adds no time, no distance and no error to Check Path (live: Conveying-04 Main = [2, 0, 0, 1])", async () => {
    const { e, box } = await station();
    const belt = await box("Belt", [0, 0, 0], 50);
    const carriage = await box("Carriage", [0, 0, 0], 10);
    const conv = (await e.run("mechanism.build", { type: 4, name: "Box Conveyor", objects: [belt, carriage], lower: [-1e6], upper: [1e6] })) as unknown as Id;
    const template = await box("RoboDK Box", [0, 0, 0]);
    const main = (await e.run("program.add", { name: "Main", robot: conv.id })) as unknown as Id;
    const create = (await e.run("program.addInstruction", { program: main.id, kind: "event", eventAction: "create" })) as unknown as Id;
    const move = (await e.run("program.addInstruction", { program: main.id, kind: "event", eventAction: "conveyor" })) as unknown as Id;
    e.ws.items[create.id].instruction!.event = { action: "create", objects: [template], frame: conv.id };
    e.ws.items[move.id].instruction!.event = { action: "conveyor", objects: [conv.id], distance: 400 };
    const plan = planProgram(e.ws, main.id);
    expect([plan.validInstructions, plan.duration, plan.distance, plan.ratio]).toEqual([2, 0, 0, 1]);
  });
});

const STATIONS = path.join(ROOT, "data/library/files/library-stations");
const CONV04 = path.join(STATIONS, "Conveying-04.rdk");
const CRB = path.join(STATIONS, "Conveying-with-ABB-CRB-1300-7-1-4.rdk");

describe.skipIf(!existsSync(CONV04) || !existsSync(CRB))("library conveyor stations (library mirror)", () => {
  async function open(file: string) {
    const e = await engine();
    await e.run("station.openRdk", { base64: readFileSync(file).toString("base64") });
    return e;
  }

  it("imports the events, the Locked flags and the Loop flags as RoboDK stores them", async () => {
    const e = await open(CONV04);
    const objects = Object.values(e.ws.items).filter((i) => i.type === "object");
     
    expect(objects.map((o) => (o.locked ? 1 : 0)).join("")).toBe("0000001111111");
    const events = Object.values(e.ws.items).filter((i) => i.instruction?.kind === "event");
    expect(events.map((i) => [i.name, i.instruction!.event!.action, i.params?.Behavior])).toEqual([
      ["Create RoboDK Box copy", "create", "8"],
      ["Move Box Conveyor", "conveyor", "7"],
      ["Home Box Conveyor", "home", "6"],
      ["Remove all RoboDK Box", "remove", "9"],
      ["Create objects", "create", "8"],
    ]);
    expect(events[1].instruction!.event!.distance).toBe(400);
    const main = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === "Main")!;
    expect(await e.run("program.update", { program: main.id })).toEqual([2, 0, 0, 1, ""]);

    const crb = await open(CRB);
    const loops = Object.values(crb.ws.items)
      .filter((i) => i.type === "program" && i.params?.Loop === "1")
      .map((i) => i.name)
      .sort();
    expect(loops).toEqual(["BoxDeleterA", "BoxDeleterB", "BoxFeeder", "ConveyorSwap"]);
    const waits = Object.values(crb.ws.items).filter((i) => i.instruction?.event?.action === "wait");
    expect(waits.map((i) => [i.name, i.instruction!.event!.option])).toEqual([
      ["Wait & Remove-Laser Sensor A", 1],
      ["Wait & Remove-Laser Sensor B", 1],
      ["Wait & Move-Swap conveyor trigger", 2],
    ]);
     
    const deleter = Object.values(crb.ws.items).find((i) => i.name === "BoxDeleterA")!;
    expect(await crb.run("program.update", { program: deleter.id })).toEqual([-1, 0, 0, 0, ""]);
  });

  it("Conveying-04 Reset removes the unlocked boxes and creates the 6 belt boxes again (live probe)", async () => {
    const e = await open(CONV04);
    const before = Object.values(e.ws.items).filter((i) => i.type === "object").map((o) => o.id);
    const reset = Object.values(e.ws.items).find((i) => i.type === "program" && i.name === "Reset")!;
    for (const id of reset.children) await e.run("sim.event", { robot: null, instruction: id });
    const after = Object.values(e.ws.items).filter((i) => i.type === "object");
    expect(after).toHaveLength(13);
     
    expect(before.map((id, i) => (e.ws.items[id] ? i : -1)).filter((i) => i >= 0)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    const fresh = after.filter((o) => !before.includes(o.id));
    expect(fresh.map((o) => [o.name, e.ws.items[o.parent!].name, o.visible])).toEqual(Array(6).fill(["RoboDK Box", "Box Conveyor Frame", true]));
     
    expect(xyz(absPose(e.ws, fresh[0].id))).toEqual([-350, 875, 715]);
  });
});
