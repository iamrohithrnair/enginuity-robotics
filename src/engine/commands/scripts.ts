 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { fk } from "../kinematics";
import { inv, mul } from "../math";
import { CommandError, defineCommand, ItemRef } from "../registry";
import { SCRIPT_EXAMPLES, SCRIPT_REFERENCE } from "../scripts";
import { getStationParam } from "../stationParams";
import { paramStationRef } from "./query";

const EXAMPLE = SCRIPT_EXAMPLES[0];
import { ITEM_TYPE_CODES, type Item, type Workspace } from "../types";
import { absPose, listItems, makeItem, toolPose } from "../workspace";

const refOf = (ws: Workspace, id: string | null | undefined) => {
  const it = id ? ws.items[id] : undefined;
  return it ? { id: it.id, name: it.name, type: it.type, typeCode: ITEM_TYPE_CODES[it.type] ?? 20 } : null;
};

function requireScript(ws: Workspace, ref: string | number): Item {
  const it = requireRef(ws, ref, "script");
  if (it.type !== "script") throw new CommandError(`${it.name} is not an Enginuity script`, "invalid_item");
  return it;
}

 
function uniqueName(ws: Workspace, station: string, base: string): string {
  const taken = new Set(listItems(ws, { station }).map((i) => i.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

defineCommand({
  name: "script.run",
  title: "Run Script",
  description: `Run an Enginuity script: JavaScript using a robolink-style object model and robomath, executed for real on this station (every call is an Enginuity command; program generation uses the real post processors). Use it for repetitive or batch work: target grids, palletizing, several programs or robots, collision sweeps, generating many programs. Give \`code\` (and a \`name\`), or \`item\` to run a saved script. Returns the printed log, errors with line numbers, the items created/changed/deleted, the generated program files, and the single undo step the run recorded; a failed run is undone completely.\n\n${SCRIPT_REFERENCE}\n\nExample (${EXAMPLE.name}):\n${EXAMPLE.code}`,
  category: "program",
  undoable: false,
  detached: true,
  schema: z.object({
    code: z.string().optional().describe("JavaScript source"),
    name: z.string().optional().describe("name shown in the undo step and the log"),
    item: ItemRef.optional().describe("saved script item to run instead of `code`"),
    run: z
      .string()
      .regex(/^[\w-]{1,40}$/)
      .optional()
      .describe("id for script.stop (generated when omitted)"),
    keepOnError: z.boolean().optional().describe("keep the changes of a run that fails or is stopped (default: undo them)"),
  }),
  async run(ctx, p) {
    if (!ctx.services.scripts) throw new CommandError("Enginuity scripts run on the Enginuity server");
    let code = p.code;
    let name = p.name;
    let itemId: string | undefined;
    if (p.item !== undefined) {
      const it = requireScript(ctx.ws, p.item);
      code = it.script?.code ?? "";
      name = name ?? it.name;
      itemId = it.id;
    }
    if (!code?.trim()) throw new CommandError("Nothing to run: give the script code or a saved script item");
    return ctx.services.scripts.run({ code, name: name?.trim() || "Script", origin: ctx.origin, itemId, run: p.run, keepOnError: p.keepOnError });
  },
});

defineCommand({
  name: "script.stop",
  title: "Stop Script",
  description: "Stop a running Enginuity script by its run id (from script.run or the editor); its changes are undone unless it was started with keepOnError.",
  category: "program",
  undoable: false,
  readonly: true,
  schema: z.object({ run: z.string() }),
  run(ctx, p) {
    if (!ctx.services.scripts) throw new CommandError("Enginuity scripts run on the Enginuity server");
    return { stopped: ctx.services.scripts.stop(p.run) };
  },
});

defineCommand({
  name: "script.save",
  title: "Save Script",
  description: "Save an Enginuity script as a station item (saved with the station; double-click runs it), or overwrite a saved one given by `item`.",
  category: "program",
  schema: z.object({
    code: z.string(),
    name: z.string().optional(),
    item: ItemRef.optional().describe("existing script item to overwrite"),
  }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    if (p.item !== undefined) {
      const it = requireScript(ws, p.item);
      const name = p.name?.trim() || it.name;
      tx.set(it.id, { script: { code: p.code }, ...(name !== it.name ? { name } : {}) });
      ctx.undoLabel = `Edit: ${name}`;
      return { id: it.id, name, saved: true };
    }
    const station = ws.activeStation;
    if (!station) throw new CommandError("Open a station first");
    const name = uniqueName(ws, station, p.name?.trim() || "Script");
    const item = makeItem(ws, "script", name, { script: { code: p.code } });
    tx.add(item, station);
    tx.split(`Add: ${name}`);
    return { id: item.id, name, handle: item.handle, saved: true };
  },
});

defineCommand({
  name: "script.list",
  title: "List Scripts",
  description: "Saved Enginuity scripts of the active station.",
  category: "query",
  undoable: false,
  readonly: true,
  schema: z.object({}),
  run({ ws }) {
    return listItems(ws, { type: "script" }).map((it) => ({ id: it.id, name: it.name, lines: (it.script?.code ?? "").split("\n").length }));
  },
});

defineCommand({
  name: "script.get",
  title: "Get Script",
  description: "Source code of a saved Enginuity script.",
  category: "query",
  undoable: false,
  readonly: true,
  schema: z.object({ item: ItemRef }),
  run({ ws }, p) {
    const it = requireScript(ws, p.item);
    return { id: it.id, name: it.name, code: it.script?.code ?? "" };
  },
});

defineCommand({
  name: "script.delete",
  title: "Delete Script",
  description: "Delete a saved Enginuity script item.",
  category: "program",
  schema: z.object({ item: ItemRef }),
  run(ctx, p) {
    const it = requireScript(ctx.ws, p.item);
    ctx.tx.remove(it.id);
    ctx.tx.split(`Delete: ${it.name}`);
    return { deleted: it.name };
  },
});

defineCommand({
  name: "script.reference",
  title: "Script API Reference",
  description: "The Enginuity script API reference and example scripts.",
  category: "query",
  undoable: false,
  readonly: true,
  schema: z.object({}),
  run() {
    return { reference: SCRIPT_REFERENCE, examples: SCRIPT_EXAMPLES };
  },
});

defineCommand({
  name: "item.data",
  title: "Item Data",
  description:
    "Raw data of an item for scripts: parent and children ids, 4x4 poses (row-major, relative to the parent and absolute), parameters; robots add joints, home, the active tool and reference frame, and the TCP pose relative to the robot's reference frame; targets add joints and robot.",
  category: "query",
  undoable: false,
  readonly: true,
  schema: z.object({ item: ItemRef }),
  run({ ws, services }, p) {
    const it = requireRef(ws, p.item);
    const out: Record<string, unknown> = {
      ...refOf(ws, it.id),
      parent: refOf(ws, it.parent),
      children: it.children.map((c) => refOf(ws, c)).filter(Boolean),
      visible: it.visible,
      pose: it.pose,
      absPose: absPose(ws, it.id),
      params: it.params ?? {},
    };
    if (it.robot) {
      const r = it.robot;
      const base = absPose(ws, it.id);
      const tool = toolPose(ws, it.id);
      const frame = r.activeFrame && ws.items[r.activeFrame] ? r.activeFrame : null;
      const refAbs = frame ? absPose(ws, frame) : base;
       
      const joints = services.runner?.liveJoints?.(it.id)?.slice(0, r.model.nq) ?? r.joints;
      const tcpAbs = mul(mul(base, fk(r.model, joints)), tool);
      out.robot = {
        joints,
        home: r.home,
        dof: r.joints.length,
        activeTool: refOf(ws, r.activeTool),
        activeFrame: refOf(ws, frame),
        baseAbs: base,
        refAbs,
        toolPose: tool,
        frameInBase: mul(inv(base), refAbs),
        tcpPose: mul(inv(refAbs), tcpAbs),
        tcpAbs,
        postProcessor: r.postProcessor,
      };
    }
    if (it.target) out.target = { joints: it.target.joints, isJoint: !!it.target.isJoint, robot: refOf(ws, it.target.robot) };
    if (it.program) out.program = { robot: refOf(ws, it.program.robot), instructions: it.children.length };
    if (it.script) out.script = { lines: it.script.code.split("\n").length };
    return out;
  },
});

defineCommand({
  name: "station.getParam",
  title: "Get Station Parameter",
  description:
    "Value of a station parameter of the active station, or of `station` (set with station.setParam, Decision results, IOs such as IO_1, or stored in an opened station file), or null.",
  category: "query",
  undoable: false,
  readonly: true,
  spec: "G_Param FUN_100338f50 → NodeStation_getParam FUN_1004ad0fc",
  schema: z.object({ key: z.string(), station: ItemRef.optional() }),
  run({ ws }, p) {
    return { key: p.key, value: getStationParam(ws, p.key, paramStationRef(ws, p.station)) ?? null };
  },
});
