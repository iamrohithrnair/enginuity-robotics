 
 
 
 

import { z } from "zod";
import { resolveRef } from "../dispatch";
import { CommandError, defineCommand, ItemRef, type CmdCtx } from "../registry";
import {
  addGun,
  clearGuns,
  gunStats,
  listGuns,
  setGunState,
  stationGuns,
  STATS_INFO,
  type SprayMatrix,
} from "../spray";

 
function matrixFromColumns(cols: number[][] | undefined): SprayMatrix | null {
  if (!cols || !cols.length) return null;
  const rows = Math.max(...cols.map((c) => c.length));
  const data: number[] = [];
  for (const c of cols) for (let r = 0; r < rows; r++) data.push(c[r] ?? 0);
  return { rows, cols: cols.length, data };
}

 
function refId(ctx: CmdCtx, ref: string | number | null | undefined, what: string): string | null {
  if (ref === null || ref === undefined || ref === "" || ref === 0) return null;
  const it = resolveRef(ctx.ws, ref);
  if (!it) throw new CommandError(`Invalid item provided: The item identifier provided is not valid or it does not exist. (${what}: ${String(ref)})`, "invalid_item");
  return it.id;
}

const Column = z.array(z.number());

defineCommand({
  name: "spray.add",
  title: "Add Spray Gun",
  description:
    "Add a simulated spray gun (API Spray_Add): while it is on, every time the station's positions update — each simulation step in which a robot reaches a new path point, and after API position changes — it shoots a grid of particles from the TCP of `tool` and deposits them on `object` (they move with it). Use it to simulate painting, dispensing, gluing, sanding, welding or 3D-printing traces. " +
    "`tool`: a tool (or object) item; omit to use the active tool of the station's first robot arm. `object`: the object to spray; omit to pick the first object with geometry in that robot's active reference frame (the last object of the station when it has none). " +
    "`options` (space separated, upper case keywords as written): ELLYPSE (default) or RECTANGLE volume; PROJECT (default: particles are cast onto the object, misses only count as 'out') or NO_PROJECT (particles stay at the TCP plane, e.g. a dispensed bead); STEP=AxB grid (ellipse: A angles × B+1 rings; rectangle: A × B+1; default 1x0 = one particle per update); RAND=n integer jitter factor (default 1, 0 = regular grid); PARTICLE=SPHERE(radius[,facets[,sx,sy,sz]]) or CUBE(x,y,z) (default sphere 10 mm, 8 facets); COLOR=name|#RRGGBB|#AARRGGBB. " +
    "`volume`: up to two columns [p0x,p0y,p0z, pAx,pAy,pAz, pBx,pBy,pBz, R,G,B,A] in TCP coordinates (mm, colour 0-1): column 1 = near ellipse/rectangle (centre p0, axis ends pA and pB), column 2 = far one; the ellipse is centred on the TCP Z axis. Default near (0,0,-10)/(50,0,-10)/(0,100,-10) blue 0.8 alpha, far (0,0,400)/(200,0,400)/(0,400,400) red 0.2 alpha. `geometry`: optional particle mesh as columns [x,y,z,nx,ny,nz], three per triangle. " +
    "Returns the gun id (index in the station's list) or -1 with a reason when no tool/robot/object is found. New guns are off: turn them on with spray.setState.",
  category: "simulation",
  undoable: false,
  spec: "API Gun_Add (registry 252), FUN_1004ad974 / FUN_10060cf9c",
  schema: z.object({
    tool: ItemRef.nullable().optional().describe("tool (TCP) or object item shooting the particles; omit for the robot's active tool"),
    object: ItemRef.nullable().optional().describe("object receiving the particles; omit to pick it automatically"),
    options: z.string().optional().describe("spray options, e.g. \"ELLYPSE PROJECT PARTICLE=SPHERE(4,8,1,1,0.5) STEP=8x8 RAND=2\""),
    volume: z.array(Column).max(2).optional().describe("near and far volume columns [p0, pA, pB (xyz mm, TCP frame), RGBA]"),
    geometry: z.array(Column).optional().describe("particle mesh: columns [x,y,z,nx,ny,nz], three per triangle"),
    seed: z.number().int().optional().describe("seed of the random jitter (reproducible runs)"),
  }),
  run(ctx, p) {
    const res = addGun(ctx.ws, ctx.services.geometry, {
      tool: refId(ctx, p.tool, "tool"),
      object: refId(ctx, p.object, "object"),
      options: p.options ?? "",
      volume: matrixFromColumns(p.volume),
      geometry: matrixFromColumns(p.geometry),
      seed: p.seed,
    });
    return {
      id: res.id,
      ...(res.reason ? { reason: res.reason } : {}),
      ...(res.tool ? { tool: ctx.ws.items[res.tool]?.name, object: ctx.ws.items[res.object!]?.name } : {}),
    };
  },
});

defineCommand({
  name: "spray.setState",
  title: "Spray Gun On/Off",
  description:
    "Turn simulated spray guns on or off (API Spray_SetState): state 1 = SPRAY_ON (emits particles), 0 = SPRAY_OFF (stops emitting, particles stay), 2 = emitting but particles hidden. `id` selects one gun of the active station (as returned by spray.add); -1 (default) or any id outside the list applies to every gun. Returns the state.",
  category: "simulation",
  undoable: false,
  spec: "API Gun_SetState (registry 253), FUN_1004ade80",
  schema: z.object({
    state: z.number().int().describe("1 on, 0 off, 2 on with particles hidden"),
    id: z.number().int().default(-1).describe("gun id, -1 = all"),
  }),
  run(ctx, p) {
    return { state: setGunState(ctx.ws, p.state, p.id) };
  },
});

defineCommand({
  name: "spray.stats",
  title: "Spray Gun Statistics",
  description:
    "Statistics of the simulated spray guns of the active station (API Spray_GetStats). For every gun: id, percentage of particles that landed on the object ('in'), percentage that missed or were not projected ('out') and the total emitted. `id` is ignored: all guns are always reported; `info` and `columns` are the API reply (description line and 4×N matrix columns [id, %in, %out, count]).",
  category: "simulation",
  undoable: false,
  readonly: true,
  spec: "API Gun_Stats (registry 254), FUN_1004adf40",
  schema: z.object({ id: z.number().int().default(-1).describe("ignored: every gun is reported") }),
  run(ctx) {
    const { info, columns } = gunStats(ctx.ws);
    return {
      info,
      columns,
      guns: columns.map(([id, percentIn, percentOut, count]) => ({ id, percentIn, percentOut, count })),
    };
  },
});

defineCommand({
  name: "spray.clear",
  title: "Clear Spray Guns",
  description:
    "Remove every simulated spray gun of the active station and all their particles (API Spray_Clear; `id` is ignored: every gun goes). Pressing Escape with nothing else to stop or deselect does the same ('Cleaned station'). Returns cleared = 1 when there were guns, else 0.",
  category: "simulation",
  undoable: false,
  spec: "API Gun_Clear (registry 255), FUN_1004a6b28",
  schema: z.object({ id: z.number().int().default(-1).describe("ignored: every gun is removed") }),
  run(ctx) {
    return { cleared: clearGuns(ctx.ws.activeStation) };
  },
});

defineCommand({
  name: "spray.list",
  title: "List Spray Guns",
  description:
    "List the simulated spray guns of the active station with their tool, object, state (1 on, 0 off, 2 hidden), parsed options (shape, projection, STEP grid, particles per update, jitter, particle shape, near/far colours) and counters (updates, in, out, total, percentages, particles stored for display).",
  category: "simulation",
  undoable: false,
  readonly: true,
  spec: "API Gun_* (registry 252–255)",
  schema: z.object({}),
  run(ctx) {
    return { station: ctx.ws.activeStation ? ctx.ws.items[ctx.ws.activeStation]?.name : null, guns: listGuns(ctx.ws), info: STATS_INFO, count: stationGuns(ctx.ws.activeStation).length };
  },
});
