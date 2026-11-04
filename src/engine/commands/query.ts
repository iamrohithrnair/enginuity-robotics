import { z } from "zod";
import { requireRef } from "../dispatch";
import { poseToXYZRPW, round } from "../math";
import { CommandError, defineCommand, ItemRef } from "../registry";
import { setStationParam } from "../stationParams";
import { ITEM_TYPE_CODES, type Item, type ItemType, type Workspace } from "../types";
import { absPose, descendants, listItems } from "../workspace";

export function describeItem(ws: Workspace, it: Item, depth = 0): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: it.id,
    name: it.name,
    type: it.type,
    parent: it.parent ? ws.items[it.parent]?.name : null,
    visible: it.visible,
  };
  if (it.type !== "station" && it.type !== "instruction" && it.type !== "program") {
    base.xyzrpw = poseToXYZRPW(it.pose).map((v) => round(v, 3));
    base.absXyzrpw = poseToXYZRPW(absPose(ws, it.id)).map((v) => round(v, 3));
  }
  if (it.robot) {
    base.joints = it.robot.joints.map((v) => round(v, 3));
    base.dof = it.robot.model.joints.length;
    base.jointLimits = it.robot.model.joints.map((j) => [j.lower, j.upper]);
    base.activeTool = it.robot.activeTool ? ws.items[it.robot.activeTool]?.name : null;
    base.activeFrame = it.robot.activeFrame ? ws.items[it.robot.activeFrame]?.name : null;
    base.postProcessor = it.robot.postProcessor;
    base.speeds = it.robot.speeds;
    base.rounding = it.robot.rounding ?? -1;
  }
  if (it.target) {
    base.isJoint = it.target.isJoint;
    base.joints = it.target.joints.map((v) => round(v, 3));
  }
  if (it.program) {
    base.robot = it.program.robot ? ws.items[it.program.robot]?.name : null;
    base.instructions = it.children.map((c) => ws.items[c]?.name);
  }
  if (it.instruction) base.instruction = it.instruction;
  if (depth > 0) base.children = it.children.map((c) => describeItem(ws, ws.items[c], depth - 1));
  return base;
}

defineCommand({
  name: "workspace.describe",
  title: "Describe Station",
  description:
    "Summarise the active station: tree (names, types, parents), robots with joints and tools, targets, programs with instructions, selection and simulation state. Call this first to understand the scene.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ station: ItemRef.optional() }),
  run({ ws }, p) {
    const stId = p.station !== undefined ? requireRef(ws, p.station).id : ws.activeStation;
    if (!stId) return { stations: [] };
    const st = ws.items[stId];
    const all = descendants(ws, stId);
    return {
      station: st.name,
      openStations: ws.stations.map((s) => ws.items[s]?.name),
      selection: ws.selection.map((s) => ws.items[s]?.name),
      collisionsActive: ws.collisionsActive,
      simulationSpeed: ws.simulationSpeed,
      running: ws.running ? ws.items[ws.running.program]?.name : null,
      tree: all.filter((i) => i.type !== "instruction").map((i) => `${"  ".repeat(depthOf(ws, i.id, stId) - 1)}${i.name} [${i.type}]`),
      robots: all.filter((i) => i.type === "robot").map((i) => describeItem(ws, i)),
      programs: all.filter((i) => i.type === "program").map((i) => describeItem(ws, i)),
      targets: all.filter((i) => i.type === "target").map((i) => describeItem(ws, i)),
    };
  },
});

function depthOf(ws: Workspace, id: string, stationId: string) {
  let d = 0;
  let cur = ws.items[id];
  while (cur && cur.id !== stationId) {
    d++;
    cur = cur.parent ? ws.items[cur.parent] : (undefined as unknown as Item);
  }
  return d;
}

defineCommand({
  name: "item.list",
  title: "List Items",
  description: "List items of the active station, optionally filtered by type (robot, frame, tool, object, target, program, instruction…).",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ type: z.enum(Object.keys(ITEM_TYPE_CODES) as [ItemType, ...ItemType[]]).optional(), allStations: z.boolean().default(false) }),
  run({ ws }, p) {
    return listItems(ws, { type: p.type, station: p.allStations ? "all" : undefined }).map((i) => ({ id: i.id, name: i.name, type: i.type, parent: i.parent ? ws.items[i.parent]?.name : null }));
  },
});

defineCommand({
  name: "item.info",
  title: "Item Info",
  description: "Details of one item: pose (relative and absolute xyzrpw), joints, children, type-specific data.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ item: ItemRef, depth: z.number().int().min(0).max(4).default(1) }),
  run({ ws }, p) {
    return describeItem(ws, requireRef(ws, p.item), p.depth);
  },
});

defineCommand({
  name: "station.setParam",
  title: "Set Station Parameter",
  description:
    "Set a station parameter (RDK.setParam) of the active station, or of `station`: a new name is added (even with an empty value), an existing name gets the value, and an empty value removes an existing name. Each station keeps its own parameters and saves them.",
  category: "settings",
  undoable: false,
  spec: "S_Param FUN_100339194 → NodeStation_setParam FUN_1004acac8",
  schema: z.object({ key: z.string(), value: z.string(), station: ItemRef.optional() }),
  run({ ws, tx }, p) {
    const result = setStationParam({ ws, tx }, p.key, p.value, paramStationRef(ws, p.station));
    if (!result) throw new CommandError("No station");
    return { ok: true, result };
  },
});

 
export function paramStationRef(ws: Workspace, ref: string | number | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const st = requireRef(ws, ref, "station");
  if (st.type !== "station") throw new CommandError(`${st.name} is not a station`);
  return st.id;
}
