// Applies relative item moves while respecting locks and robot motion rules.
import { z } from "zod";
import { requireRef } from "../dispatch";
import { fk } from "../kinematics";
import { dragMotion, dragSubject, isLocked } from "../drag";
import { mul } from "../math";
import { CommandError, defineCommand, getCommand, ItemRef, type CmdCtx } from "../registry";
import type { Item } from "../types";
import { absPose, isAncestor, robotOfTool, toolPose } from "../workspace";

 
 
 
 

async function runInline(ctx: CmdCtx, name: string, params: Record<string, unknown>) {
  const def = getCommand(name);
  if (!def) throw new CommandError(`Missing command ${name}`);
  return def.run(ctx, def.schema.parse(params));
}

defineCommand({
  name: "item.moveBy",
  title: "Move",
  description:
    "Move items rigidly in station coordinates, which is what dragging them in the 3D view does: translate [dx, dy, dz] in mm and/or rotateZ degrees about the vertical axis through `pivot` (default: the first item's origin). Children follow. A robot moves with its base frame; dragging a tool moves its robot so the TCP follows (IK, closest configuration). Locked items are refused. One undo step.",
  category: "item",
  spec: "R-IM-21, R-IM-30",
  schema: z.object({
    items: z.array(ItemRef).min(1),
    translate: z.array(z.number()).length(3).optional(),
    rotateZ: z.number().optional(),
    pivot: z.array(z.number()).length(3).optional(),
    keepChildren: z.boolean().optional().describe("children keep their absolute pose (Move Tools mode on items that are not tools)"),
    toolMode: z.enum(["robot", "tcp"]).optional().describe("robot (default): the robot moves so its TCP follows; tcp: the tool's TCP moves relative to the flange (Move Tools mode)"),
  }),
  async run(ctx, p) {
    const { ws } = ctx;
    const picked = p.items.map((r) => requireRef(ws, r));
    const locked = picked.find(isLocked);
    if (locked) throw new CommandError(`${locked.name} is locked`);
     
    const subjects: Item[] = [];
    for (const it of picked) {
      const s = dragSubject(ws, it.id);
      if (!s) throw new CommandError(`${it.name} cannot be moved`);
      if (isLocked(s)) throw new CommandError(`${s.name} is locked`);
      if (!subjects.some((x) => x.id === s.id)) subjects.push(s);
    }
    const moving = subjects.filter((s) => {
      const holder = s.type === "tool" ? robotOfTool(ws, s.id) : undefined;
      return !subjects.some((o) => o.id !== s.id && (isAncestor(ws, o.id, s.id) || (holder && (o.id === holder.id || isAncestor(ws, o.id, holder.id)))));
    });
    const first = moving[0];
    const firstAbs = absPose(ws, first.id);
    const motion = dragMotion(p.translate, p.rotateZ ?? 0, p.pivot ?? [firstAbs[3], firstAbs[7], firstAbs[11]]);
    const moved: string[] = [];
    for (const s of moving) {
      if (s.type === "tool" && p.toolMode !== "tcp") {
        const robot = robotOfTool(ws, s.id);
        if (!robot?.robot) throw new CommandError(`${s.name} is not held by a robot`);
        const tcp = mul(mul(absPose(ws, robot.id), fk(robot.robot.model, robot.robot.joints)), toolPose(ws, robot.id));
        await runInline(ctx, "robot.moveTo", { robot: robot.id, pose: mul(motion, tcp), relativeTo: "station" });
        moved.push(robot.name);
      } else {
        await runInline(ctx, "item.setPose", { item: s.id, pose: mul(motion, absPose(ws, s.id)), relativeTo: "station", keepChildren: !!p.keepChildren && s.type !== "tool" });
        moved.push(s.name);
      }
    }
     
    if (ctx.undoLabel !== null && moving.length > 1) ctx.undoLabel = `Move: ${moved.join(", ")}`;
    return { moved, items: moving.map((s) => s.id) };
  },
});
