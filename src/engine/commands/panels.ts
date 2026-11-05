// Registers active-frame clearing and simulation-event instruction editing.
import { z } from "zod";
import { requireRef } from "../dispatch";
import { eventName } from "../naming";
import { CommandError, defineCommand, ItemRef } from "../registry";
import { EVENT_BEHAVIOR } from "../sim/events";
import { requireRobot } from "./robot";

 

defineCommand({
  name: "robot.clearActiveFrame",
  title: "Active Reference Frame (off)",
  description: "Make the robot use its base frame again (unchecks 'Active Reference Frame').",
  category: "robot",
  undoable: false,
  spec: "R-TREE-11, R-TREE-39",
  schema: z.object({ robot: ItemRef.optional() }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
    tx.set(r.id, { robot: { ...r.robot!, activeFrame: null } });
    return { robot: r.name };
  },
});





defineCommand({
  name: "instruction.setEvent",
  title: "Edit Simulation Event",
  description:
    "Change a simulation event instruction: action (attach/detach/show/hide/home; conveyor = move the listed mechanism's joints by `distance`; create = copy the listed objects under `frame`; remove = delete the unlocked objects named and shaped like the listed ones; wait = wait until a listed sensor object touches an unlocked object, then `option` 0 nothing, 1 delete it, 2 move it under `frame`, 3 stop the robot given as `frame`), tool, frame (detach destination, create parent, wait destination or robot), objects, distance and option.",
  category: "program",
  undoable: false,
  spec: "R-PROG-13, R-PROG-14, R-PROG-40",
  schema: z.object({
    instruction: ItemRef,
    action: z.enum(["attach", "detach", "show", "hide", "home", "conveyor", "create", "remove", "wait"]).optional(),
    tool: ItemRef.nullable().optional(),
    frame: ItemRef.nullable().optional(),
    objects: z.array(ItemRef).optional(),
    distance: z.number().optional().describe("attach: maximum distance (mm); conveyor: movement added to every joint (mm or deg)"),
    option: z.number().int().optional().describe("attach: measure distance as (0 station default … 4); wait: 0 wait, 1 remove, 2 move, 3 stop"),
  }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.instruction, "instruction");
    const ins = it.instruction;
    if (!ins || ins.kind !== "event") throw new CommandError(`${it.name} is not a simulation event`);
    const ev = { ...(ins.event ?? { action: "attach" as const }) };
    if (p.action) ev.action = p.action;
    if (p.tool !== undefined) ev.tool = p.tool === null ? null : requireRef(ws, p.tool, "tool").id;
     
    if (p.frame !== undefined) ev.frame = p.frame === null ? null : requireRef(ws, p.frame, "frame").id;
    if (p.objects) ev.objects = p.objects.map((o) => requireRef(ws, o).id);
    if (p.distance !== undefined) ev.distance = p.distance;
    if (p.option !== undefined) ev.option = p.option;
    const next = { ...ins, event: ev };
    const name = eventName(ws, ev);
     
    const params = p.action && it.params?.Behavior !== undefined ? { params: { ...it.params, Behavior: String(ev.action === "move" && ev.relative ? 5 : EVENT_BEHAVIOR[ev.action] ?? it.params.Behavior) } } : {};
    tx.set(it.id, { instruction: next, name, ...params });
    return { id: it.id, name };
  },
});
