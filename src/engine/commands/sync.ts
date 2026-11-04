 
 
 
 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { bindAction } from "../actions";
import { requireRef } from "../dispatch";
import { CommandError, defineCommand, ItemRef } from "../registry";
import { MAX_SYNC_JOINTS, syncAxes } from "../sync/axes";
import type { Item, Workspace } from "../types";
import { descendants, stationOf } from "../workspace";
import { requireRobot } from "./robot";

 
function isAncestor(ws: Workspace, ancestorId: string, id: string): boolean {
  let cur = ws.items[id]?.parent ? ws.items[ws.items[id].parent!] : undefined;
  for (let guard = 0; cur && guard < 10_000; guard++) {
    if (cur.id === ancestorId) return true;
    cur = cur.parent ? ws.items[cur.parent] : undefined;
  }
  return false;
}





export function syncCandidates(ws: Workspace, robot: Item): { robotSide: Item[]; partSide: Item[] } {
  const station = stationOf(ws, robot.id)?.id;
  const mechs = (station ? descendants(ws, station) : Object.values(ws.items)).filter((i) => i.type === "robot" && i.robot && i.id !== robot.id);
  return {
    robotSide: mechs.filter((m) => isAncestor(ws, m.id, robot.id)),
    partSide: mechs.filter((m) => !isAncestor(ws, m.id, robot.id) && !isAncestor(ws, robot.id, m.id)),
  };
}

 
export function syncLabel(robot: Item, axes: Item[], pending: boolean): string {
  if (!axes.length) return pending ? `No axes will be synchronized with ${robot.name}` : `No axes currently synchronized with ${robot.name}`;
  let id = robot.robot!.model.nq;
  const parts = axes.map((a) => {
    const from = id + 1;
    id += a.robot!.model.nq;
    return `${a.name} (id ${from}-${id})`;
  });
  return `${pending ? `${robot.name} will be synchronized with: ` : `${robot.name} is synchronized with: `}${parts.join(", ")}`;
}

defineCommand({
  name: "robot.syncAxes",
  title: "Synchronize External Axes",
  description:
    "Synchronize a robot with external axes (Utilities > Synchronize External Axes): rails or gantries that carry the robot and turntables or positioners that carry the part. The axes' joints follow the robot's own in its joint vector, in the order given, so targets, programs (MoveJ/MoveL move the axes too), joint lists, Joints()/setJoints and generated programs carry them. Give no axes to remove the synchronization ('Remove Sync'). At most 12 joints in all; a mechanism mounted on the robot cannot be synchronized.",
  category: "robot",
  spec: "B-UTIL-03 (FUN_1005af300, FUN_100483e38)",
  schema: z.object({
    robot: ItemRef.optional(),
    axes: z.array(ItemRef).default([]).describe("mechanisms in joint order; empty removes the synchronization"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const robot = requireRobot(ws, p.robot);
    const { robotSide, partSide } = syncCandidates(ws, robot);
    const axes: Item[] = [];
    let total = robot.robot!.model.nq;
    for (const ref of p.axes) {
      const it = requireRef(ws, ref);
      if (it.type !== "robot" || !it.robot || it.id === robot.id) throw new CommandError(`${it.name} is not an external axis`);
      if (!robotSide.includes(it) && !partSide.includes(it)) throw new CommandError("External axis not detected as linear track or rotative table!");
      if (axes.includes(it)) continue;
      if (total + it.robot.model.nq > MAX_SYNC_JOINTS) throw new CommandError(`${robot.name} and its external axes can have at most ${MAX_SYNC_JOINTS} joints`);
      total += it.robot.model.nq;
      axes.push(it);
    }
    const rd = robot.robot!;
     
    tx.set(robot.id, { robot: { ...rd, sync: axes.length ? axes.map((a) => a.id) : undefined, framePose: null } });
    ctx.undoLabel = `Synchronize External Axes: ${robot.name}`;
    const now = ws.items[robot.id];
    return { robot: robot.name, axes: syncAxes(ws, now).map((a) => ({ name: a.item.name, side: a.side, ids: `${a.at + 1}-${a.at + a.nq}` })), message: syncLabel(now, axes, false) };
  },
});

defineCommand({
  name: "robot.syncInfo",
  title: "External Axes Synchronization",
  description:
    "The external axes synchronized with a robot ('<robot> is synchronized with: <axis> (id 7-7), …') and the mechanisms that can be: rails carrying it ('Linear track') and turntables, positioners or tracks beside it ('Turntable or Linear track').",
  category: "robot",
  undoable: false,
  schema: z.object({ robot: ItemRef.optional() }),
  run({ ws }, p) {
    const robot = requireRobot(ws, p.robot);
    const axes = syncAxes(ws, robot);
    const { robotSide, partSide } = syncCandidates(ws, robot);
    return {
      robot: robot.name,
      joints: robot.robot!.model.nq + axes.reduce((n, a) => n + a.nq, 0),
      axes: axes.map((a) => ({ id: a.item.id, name: a.item.name, side: a.side, ids: `${a.at + 1}-${a.at + a.nq}` })),
      message: syncLabel(robot, axes.map((a) => a.item), false),
      candidates: { linearTrack: robotSide.map((m) => ({ id: m.id, name: m.name, joints: m.robot!.model.nq })), turntableOrTrack: partSide.map((m) => ({ id: m.id, name: m.name, joints: m.robot!.model.nq })) },
    };
  },
});

 
bindAction("actionSyncExternalAxis", { ui: true });
