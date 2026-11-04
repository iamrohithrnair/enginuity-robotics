 
 
 
import { describe, expect, it } from "vitest";
import { simpleModel } from "@/engine/kinematics";
import type { Item } from "@/engine/types";
import { matchesType } from "@/server/rdkapi/bridge";

const axis = { alpha: 0, a: 0, theta: 0, d: 0, lower: -1000, upper: 1000, kind: "linear" as const };
const robot = (name: string, nq: number) =>
  ({ id: name, handle: 0, type: "robot", name, parent: null, children: [], visible: true, pose: [], robot: { model: simpleModel(Array.from({ length: nq }, () => axis)) } }) as unknown as Item;

describe("ItemList robot types", () => {
  const conveyor = robot("Conveyor Belt", 1);
  const turntable = robot("Turntable", 2);
  const arm = robot("Arm", 6);
  const frame = { id: "f", handle: 0, type: "frame", name: "Frame", parent: null, children: [], visible: true, pose: [] } as unknown as Item;

  it("lists 1- and 2-axis mechanisms as robot axes (21) and 6-axis arms as robot arms (18)", () => {
    const pick = (type: number) => [conveyor, turntable, arm, frame].filter((i) => matchesType(i, type)).map((i) => i.name);
    expect(pick(21)).toEqual(["Conveyor Belt", "Turntable"]);
    expect(pick(18)).toEqual(["Arm"]);
    expect(pick(2)).toEqual(["Conveyor Belt", "Turntable", "Arm"]);
  });
});
