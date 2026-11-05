// Searches SimReady assets and loads prepared geometry into station workspaces.
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { inv, mul } from "../math";
import { CommandError, defineCommand, ItemRef, XYZRPW, type CmdCtx } from "../registry";
import type { ItemPhysics } from "../physics/types";
import { absPose, listItems } from "../workspace";
import { addObjectFromParts, defaultObjectParent } from "./library";

const SOURCE = "NVIDIA SimReady Assets (CC BY 4.0)";
const ATTRIBUTION = "NVIDIA SimReady Assets · CC BY 4.0";

function service(ctx: Pick<CmdCtx, "services">) {
  const s = ctx.services.simready;
  if (!s) throw new CommandError("SimReady assets are only available on the server");
  return s;
}

 
type Rect = [number, number, number, number];

 
function footprints(ctx: CmdCtx, parent: string): { rects: Rect[]; robots: number } {
  const { ws, services } = ctx;
  const rects: Rect[] = [];
  let robots = 0;
  const toParent = inv(absPose(ws, parent));
  for (const it of [...listItems(ws, { type: "robot" }), ...listItems(ws, { type: "object" })]) {
    if (it.visible === false) continue;
    const pose = mul(toParent, absPose(ws, it.id));
    if (it.type === "robot") {
      robots++;
      rects.push([pose[3] - 300, pose[7] - 300, pose[3] + 300, pose[7] + 300]);
    } else if (it.object?.meshes.length) {
      const m = it.object.geometryPose ? mul(pose, it.object.geometryPose) : pose;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const mesh of it.object.meshes) {
        const t = services.geometry.get(mesh.geometry);
        if (!t) continue;
        for (let i = 0; i + 2 < t.length; i += 3) {
          const x = m[0] * t[i] + m[1] * t[i + 1] + m[2] * t[i + 2] + m[3];
          const y = m[4] * t[i] + m[5] * t[i + 1] + m[6] * t[i + 2] + m[7];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x0 <= x1) rects.push([x0, y0, x1, y1]);
    }
  }
  return { rects, robots };
}






function freeSpot(ctx: CmdCtx, parent: string, b: { min: number[]; max: number[] }): [number, number] {
  const { rects, robots } = footprints(ctx, parent);
  if (!rects.length) return [0, 0];
  const gap = 100;
  const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
  const free = (x: number, y: number) => rects.every((r) => x + b.max[0] + gap <= r[0] || x + b.min[0] - gap >= r[2] || y + b.max[1] + gap <= r[1] || y + b.min[1] - gap >= r[3]);
  const x0 = (robots ? 500 : 0) - b.min[0];
  const yc = -(b.min[1] + b.max[1]) / 2;
   
  const sideSteps = 2 * Math.ceil((3000 + d) / gap);
  for (let row = 0; row < 8; row++)
    for (let k = 0; k <= sideSteps; k++) {
      const x = x0 + row * (w + gap), y = yc + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * gap;
      if (free(x, y)) return [x, y];
    }
  return [x0, yc];
}

defineCommand({
  name: "simready.search",
  title: "Search SimReady Assets",
  description:
    "Search NVIDIA's SimReady 3D asset library (about 2,700 physically accurate industrial and everyday objects from the Hugging Face dataset nvidia/simready-assets, CC BY 4.0): boxes, pallets, crates, racks, carts, trolleys, conveyors, containers, warehouse and factory equipment, hand tools, engine components, kitchenware, food, consumables, paint cans, medical equipment. Matches every word of `query` against the asset id, name, category and tags (exact and prefix matches first); `category` filters by the id prefix (e.g. 'box', 'pallet', 'warehouse', 'conveyor', 'handTool'). Returns asset ids for simready.load and category counts. Searching downloads nothing.",
  category: "library",
  readonly: true,
  undoable: false,
  schema: z.object({
    query: z.string().optional().describe("words to match, e.g. 'cardboard box', 'pallet', 'conveyor belt'"),
    category: z.string().optional().describe("category (id prefix), e.g. 'box', 'pallet', 'crate', 'rack', 'warehouse'"),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  async run(ctx, p) {
    const res = await service(ctx).search(p);
    return {
      total: res.total,
      items: res.items.map((e) => ({ id: e.id, name: e.name, category: e.category })),
      categories: res.categories.slice(0, 40),
      source: SOURCE,
      ...(res.error ? { warning: res.error } : {}),
    };
  },
});

defineCommand({
  name: "simready.load",
  title: "Add SimReady Asset",
  description:
    "Add an NVIDIA SimReady asset (an id from simready.search, e.g. 'box_corrugated_brown_b20') to the station as one object, in real-world size (mm, Z up) with the asset's colours and, when the asset defines a mass, its physics mass and friction. The first use downloads only that asset's files (usually a few MB, sometimes 50 MB or more) and converts them, which can take a while; after that it is cached and adding it again is instant. The object goes under `parent` (default: the current robot's active frame, else the station) at `xyzrpw`; without `xyzrpw` it is placed at a free spot, in front of the robot (+X of the parent frame, from 500 mm) and 100 mm clear of the robots and objects already in the station. By default (`rest`) its bottom rests on the parent's XY plane, so the z of `xyzrpw` is the height of the object's bottom. It is selected and is one undo step. The result gives the size and bounding box in mm.",
  category: "library",
  schema: z.object({
    asset: z.string().min(1).optional().describe("SimReady asset id from simready.search, e.g. 'box_corrugated_brown_b20' (required)"),
     
    file: z.string().min(1).optional().describe("same as asset"),
    id: z.string().min(1).optional().describe("same as asset"),
    name: z.string().optional().describe("item name (default: the asset's name)"),
    parent: ItemRef.optional(),
    xyzrpw: XYZRPW.optional(),
    rest: z.boolean().default(true).describe("true (default): lift or lower the object so its bottom is at the given z (assets whose origin is not at their bottom); false: xyzrpw places the asset's own origin"),
    textures: z.boolean().optional().describe("colour parts from the asset's base-colour textures (default true; downloads the textures)"),
  }),
  async run(ctx, p) {
    const asset = p.asset ?? p.file ?? p.id;
    if (!asset) throw new CommandError("simready.load needs `asset`: an id from simready.search, e.g. 'box_corrugated_brown_b20'");
    const prep = await service(ctx).prepare(asset, p.textures !== undefined ? { textures: p.textures } : {});
     
    const ph = prep.physics;
    const physics: ItemPhysics = {};
    if (ph?.mass !== undefined && ph.mass > 0) physics.mass = ph.mass;
    else if (ph?.density !== undefined && ph.density > 0) physics.density = ph.density;
    const friction = ph?.dynamicFriction ?? ph?.staticFriction;
    if (friction !== undefined && friction >= 0) physics.friction = friction;
    if (ph?.restitution !== undefined && ph.restitution >= 0 && ph.restitution <= 1) physics.restitution = ph.restitution;
    const parent = p.parent !== undefined ? requireRef(ctx.ws, p.parent).id : defaultObjectParent(ctx.ws);
     
    let place = p.xyzrpw;
    if (!place) {
      const [x, y] = freeSpot(ctx, parent, prep.bbox);
      if (x || y) place = [x, y, 0, 0, 0, 0];
    }
     
    const lift = p.rest && Math.abs(prep.bbox.min[2]) > 0.01 ? -prep.bbox.min[2] : 0;
    const xyzrpw = lift ? (([x, y, z, rx, ry, rz]) => [x, y, z + lift, rx, ry, rz])(place ?? [0, 0, 0, 0, 0, 0]) : place;
    const obj = addObjectFromParts(ctx, prep.parts, p.name ?? prep.name, { parent, xyzrpw, source: `simready/${prep.id}`, physics });
    return {
      id: obj.id,
      name: obj.name,
      handle: obj.handle,
      asset: prep.id,
      triangles: obj.triangles,
      xyzrpw: xyzrpw ?? [0, 0, 0, 0, 0, 0],
      size: prep.size,
      bbox: prep.bbox,
      cached: prep.cached,
      downloadedBytes: prep.downloadedBytes,
      ...(Object.keys(physics).length ? { physics } : {}),
      ...(prep.warnings.length ? { warnings: prep.warnings.slice(0, 10) } : {}),
      attribution: ATTRIBUTION,
    };
  },
});

defineCommand({
  name: "simready.status",
  title: "SimReady Download Status",
  description:
    "Progress of SimReady asset downloads and conversions in progress (asset, phase, current file, files and bytes downloaded) and the local SimReady cache (assets, converted assets, thumbnails, bytes, folder).",
  category: "library",
  readonly: true,
  undoable: false,
  schema: z.object({}),
  run(ctx) {
    return service(ctx).status();
  },
});
