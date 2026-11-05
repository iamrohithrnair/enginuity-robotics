// Registers rigid-body simulation configuration, stepping and object-state commands.
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { physicsRuntime } from "../physics/runtime";
import { PHYSICS_DEFAULTS, PHYSICS_KEYS, type BodyMode, type ItemPhysics } from "../physics/types";
import { CommandError, defineCommand, ItemRef, status, type CmdCtx } from "../registry";

const rt = (ctx: Pick<CmdCtx, "services" | "ws">) => physicsRuntime(ctx.services, ctx.ws);

function summary(ctx: CmdCtx) {
  const s = rt(ctx).state(false);
  return { enabled: s.enabled, floorZ: s.floorZ, gravity: s.gravity, substeps: s.substeps, bodies: s.counts, buildMs: s.buildMs };
}

defineCommand({
  name: "physics.enable",
  title: "Physics",
  description:
    "Switch Enginuity's optional rigid-body physics on or off (toggles when `on` is omitted; off by default). Off (default): objects stay wherever they are placed and only move when carried or set. On: released or dropped parts fall under gravity, settle on tables and the floor, stack, and are pushed by robots and tools, while fixtures (tables, fences, pedestals, conveyors, bins, pallets) stay put and parts already resting stay asleep. Objects follow their per-object setting (object.setPhysics: auto / dynamic / static). Physics moves are not undo steps.",
  category: "simulation",
  undoable: false,
  schema: z.object({ on: z.boolean().optional().describe("true = on, false = off; omitted = toggle") }),
  async run(ctx, p) {
    const r = rt(ctx);
    const on = p.on ?? !r.enabled;
    ctx.services.setSetting?.(PHYSICS_KEYS.enabled, on);
    if (!ctx.services.setSetting) ctx.services.settings[PHYSICS_KEYS.enabled] = on;
    await r.setEnabled(on);
    const s = summary(ctx);
    status(ctx, on ? `Physics on: ${s.bodies.dynamic} dynamic, ${s.bodies.static} static and ${s.bodies.kinematic} kinematic bodies` : "Physics off");
    return s;
  },
});

defineCommand({
  name: "physics.configure",
  title: "Physics Settings",
  description: "Set the physics gravity (m/s², default 9.81, pointing down the station's −Z) and the solver substeps per 1/60 s frame (1–16, default 2; more = stiffer stacks and robot pushes, slower). Applies at once and is saved with the options.",
  category: "settings",
  undoable: false,
  schema: z.object({
    gravity: z.number().min(0).max(100).optional().describe("m/s²"),
    substeps: z.number().int().min(1).max(16).optional(),
  }),
  run(ctx, p) {
    const set = (k: string, v: number) => {
      if (ctx.services.setSetting) ctx.services.setSetting(k, v);
      else ctx.services.settings[k] = v;
    };
    if (p.gravity !== undefined) set(PHYSICS_KEYS.gravity, p.gravity);
    if (p.substeps !== undefined) set(PHYSICS_KEYS.substeps, p.substeps);
    const r = rt(ctx);
    r.world?.configure({ gravity: r.gravity, substeps: r.substeps });
    r.wake();
    return { gravity: r.gravity, substeps: r.substeps };
  },
});

const Body = z.enum(["auto", "dynamic", "static"]);
const nullableNum = (d: string, min = 0) => z.number().min(min).nullable().optional().describe(d);

defineCommand({
  name: "object.setPhysics",
  title: "Object Physics",
  description:
    "Physics settings of objects (used when physics is on, saved with the station): body 'auto' (default: Enginuity decides — fixtures that carry parts, large or embedded objects stay Static, everything else is Dynamic), 'dynamic' (falls and can be pushed) or 'static' (never moves); mass in kg (wins over density), density in kg/m³ (default 1000), friction (default 0.6) and restitution/bounciness 0–1 (default 0). null resets a value to its default. Objects carried by a robot or tool always follow it.",
  category: "item",
  spec: "Enginuity physics",
  schema: z.object({
    items: z.array(ItemRef).min(1),
    body: Body.optional(),
    mass: nullableNum("kg", 0),
    density: nullableNum("kg/m³", 0),
    friction: nullableNum("Coulomb friction coefficient", 0),
    restitution: z.number().min(0).max(1).nullable().optional().describe("bounciness 0–1"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    const names: string[] = [];
    for (const ref of p.items) {
      const it = requireRef(ws, ref, "object");
      if (it.type !== "object") throw new CommandError(`${it.name} is not an object: only objects have physics settings (robot links and tools follow the kinematics)`);
      if ((p.mass ?? 1) === 0 || (p.density ?? 1) === 0) throw new CommandError("Mass and density must be greater than zero");
      const next: ItemPhysics = { ...(it.physics ?? {}) };
      const put = <K extends keyof ItemPhysics>(k: K, v: ItemPhysics[K] | undefined) => {
        if (v === undefined) return;
        if (v === null) delete next[k];
        else next[k] = v;
      };
      put("body", p.body as BodyMode | undefined);
      put("mass", p.mass);
      put("density", p.density);
      put("friction", p.friction);
      put("restitution", p.restitution);
      if (next.body === "auto") delete next.body;
      tx.set(it.id, { physics: Object.keys(next).length ? next : undefined });
      names.push(it.name);
    }
    ctx.undoLabel = `Physics: ${names.join(", ")}`;
    return { items: names, settings: p.items.length === 1 ? (requireRef(ws, p.items[0]).physics ?? {}) : undefined };
  },
});

defineCommand({
  name: "physics.step",
  title: "Step Physics",
  description: "Advance the physics simulation by exactly `seconds` of simulated time now, synchronously and deterministically (1/60 s frames), and return the objects that moved. Physics must be on. Useful to let things settle before reading poses.",
  category: "simulation",
  undoable: false,
  schema: z.object({ seconds: z.number().min(0).max(120) }),
  async run(ctx, p) {
    const r = await rt(ctx).step(p.seconds);
    return { seconds: r.seconds, steps: r.steps, moved: r.moved.map((id) => ctx.ws.items[id]?.name ?? id) };
  },
});

defineCommand({
  name: "physics.settle",
  title: "Settle Physics",
  description:
    "Run the physics simulation until every body is asleep (at rest) or `maxSeconds` of simulated time passed, then return what moved (distance in mm, rotation in degrees, and why each body is dynamic). Physics must be on.",
  category: "simulation",
  undoable: false,
  schema: z.object({ maxSeconds: z.number().min(0).max(120).default(5) }),
  async run(ctx, p) {
    const r = await rt(ctx).settle(p.maxSeconds);
    status(ctx, r.settled ? `Physics settled after ${r.seconds.toFixed(2)} s (${r.moved.length} objects moved)` : `Physics still moving after ${r.seconds.toFixed(2)} s`);
    return r;
  },
});

defineCommand({
  name: "physics.reset",
  title: "Reset Physics Poses",
  description: "Put every object that physics moved back where it was when physics was switched on (or at the last reset), including the parent it had, and judge the scene again. Like physics moves, this is not an undo step.",
  category: "simulation",
  undoable: false,
  schema: z.object({}),
  async run(ctx) {
    const ids = await rt(ctx).reset(ctx.tx);
    status(ctx, ids.length ? `Physics reset: ${ids.length} objects restored` : "Physics reset: nothing had moved");
    return { restored: ids.map((id) => ctx.ws.items[id]?.name ?? id) };
  },
});

defineCommand({
  name: "physics.status",
  title: "Physics Status",
  description:
    "Physics state: on/off, gravity, substeps, ground height (mm), body counts (dynamic / static / kinematic / awake), the world build time and step cost, and for every object, tool and robot its role with the reason — e.g. 'Auto: Static (supports 3 parts)', 'Auto: Dynamic (rests on Table)', 'Kinematic (attached to Gripper)'.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({ item: ItemRef.optional().describe("only this item's entry") }),
  async run(ctx, p) {
    await rt(ctx).current();
    const s = rt(ctx).state(true);
    if (p.item !== undefined) {
      const it = requireRef(ctx.ws, p.item);
      return { enabled: s.enabled, item: s.report[it.id] ?? null, settings: it.physics ?? {}, defaults: PHYSICS_DEFAULTS };
    }
    return { ...s, report: Object.values(s.report) };
  },
});

defineCommand({
  name: "physics.hold",
  title: "Hold Objects (drag)",
  description: "Internal: objects dragged in a 3D view are held still (kinematic) while the drag lasts and fall again when released.",
  category: "simulation",
  internal: true,
  undoable: false,
  readonly: true,
  schema: z.object({ items: z.array(z.string()), held: z.boolean() }),
  run(ctx, p) {
    const r = rt(ctx);
    if (!r.enabled) return { held: false };
    r.hold(
      p.items.filter((id) => ctx.ws.items[id]),
      p.held,
    );
    return { held: p.held };
  },
});
