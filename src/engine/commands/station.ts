// Registers station lifecycle, persistence, recent-file and backup-recovery commands.
import { z } from "zod";
import { requireRef } from "../dispatch";
import { newStationName } from "../naming";
import { CommandError, defineCommand, status, type CmdCtx } from "../registry";
import type { Item, Workspace } from "../types";
import { descendants, makeItem } from "../workspace";
import { remapItemRefs } from "../itemRefs";
import { deleteStationParam } from "../stationParams";
import { paramStationRef } from "./query";
import { isStationFile, toStationFilePath } from "../stationFile";





export const STATION_FORMAT = "enginuity-station";
export const STATION_FORMATS = [STATION_FORMAT, "mechanobot-station", "robocraft-station"];

export function snapshotStation(ws: Workspace, stationId: string) {
  const st = ws.items[stationId];
  const items: Item[] = [st, ...descendants(ws, stationId)].map((i) => structuredClone(i));
  return { format: STATION_FORMAT, version: 1, name: st.name, root: st.id, items };
}

 
export function newStation(ctx: Pick<CmdCtx, "ws" | "tx">, name?: string): Item {
  const { ws, tx } = ctx;
  const st = makeItem(ws, "station", newStationName(ws));
  tx.setMeta("stationCounter", ws.stationCounter + 1);
  tx.add(st, null);
  tx.setMeta("stations", [...ws.stations, st.id]);
  tx.setMeta("activeStation", st.id);
  tx.setMeta("selection", []);
   
  if (name !== undefined) tx.set(st.id, { name });
  return st;
}






export function closeStation(ctx: Pick<CmdCtx, "ws" | "tx" | "services">, stationId: string) {
  const { ws, tx, services } = ctx;
  const wasActive = ws.activeStation === stationId;
  const name = ws.items[stationId]?.name;
  tx.remove(stationId);
  services.undo?.drop(stationId);
  if (name !== undefined) services.files?.deleteBackups?.(name);
  const rest = ws.stations.filter((s) => s !== stationId);
  tx.setMeta("stations", rest);
  tx.setMeta("selection", []);
  if (rest.length === 0) newStation(ctx);
  else if (wasActive) tx.setMeta("activeStation", rest[0]);
}

 
export function isModified(ctx: Pick<CmdCtx, "services">, stationId: string): boolean {
  return ctx.services.undo?.isClean ? !ctx.services.undo.isClean(stationId) : false;
}







export async function saveStation(ctx: CmdCtx, st: Item, name?: string): Promise<string> {
  const { tx, services } = ctx;
  const files = services.files;
  if (!files) throw new CommandError("Saving is only available on the server");
   
  const resolve = (n: string) => toStationFilePath(files.stationPath?.(n) ?? n);
   
   
   
  const target = name !== undefined && name.trim() !== "" ? resolve(name.trim()) : st.file && isStationFile(st.file) ? toStationFilePath(st.file) : resolve(st.name);
  status(ctx, `Saving station to ${target}. Please wait...`);
  const snap = snapshotStation(ctx.ws, st.id);
   
  const pose = services.view?.pose?.();
  if (pose?.length === 16) snap.items[0].params = { ...(snap.items[0].params ?? {}), ViewPose: pose.map((v) => Math.round(v * 1e6) / 1e6).join(",") };
  const path = await files.saveStation(target, snap);
  if (st.file !== path) tx.set(st.id, { file: path });
  services.undo?.setClean?.(st.id);
  files.deleteBackups?.(st.name);
  if (ctx.origin === "ui" || ctx.origin === "agent") files.pushRecent?.(path);
  status(ctx, `Station saved successfully (${path})`);
  return path;
}

async function askOrCancel(ctx: CmdCtx, html: string, buttons: string[]): Promise<string> {
  if (!ctx.services.ask) return buttons.at(-1) ?? "";
   
  const timeout = new Promise<string>((r) => setTimeout(() => r(buttons.at(-1) ?? ""), 15 * 60_000));
  return Promise.race([ctx.services.ask(html, buttons), timeout]);
}







export async function confirmClose(ctx: CmdCtx, st: Item, ifUnsaved?: "save" | "discard"): Promise<boolean> {
  if (!isModified(ctx, st.id) || ifUnsaved === "discard") return true;
  if (ifUnsaved === "save") {
    await saveStation(ctx, st);
    return true;
  }
  if (ctx.origin === "agent") throw new CommandError(`${st.name} has unsaved changes. Close it with ifUnsaved "save" or "discard".`, "unsaved_changes");
  if (ctx.origin !== "ui") return true;
  const answer = await askOrCancel(ctx, `Do you want to save <strong>${st.name}</strong>?`, ["Yes", "No", "Cancel"]);
  if (answer === "Yes") await saveStation(ctx, st);
  return answer === "Yes" || answer === "No";
}





export function openStationData(ctx: CmdCtx, data: { items?: Item[]; root?: string; geometries?: Record<string, string> }, file?: string) {
  const { ws, tx } = ctx;
  if (!data?.items?.length || !data.root) throw new CommandError("Problems reading file: The Enginuity Station file is corrupted or there's not enough available space. Errors will follow.");
   
  for (const [id, b64] of Object.entries(data.geometries ?? {})) {
    if (ctx.services.geometry.get(id)) continue;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    ctx.services.geometry.put(new Float32Array(bytes.buffer), id);
  }
  const map = new Map<string, string>();
  for (const it of data.items) map.set(it.id, `${it.id}_${Math.random().toString(36).slice(2, 7)}`);
  const remap = (id: string | null | undefined) => (id && map.has(id) ? map.get(id)! : id ?? null);
  for (const src of data.items) {
    const it: Item = structuredClone(src);
    it.id = map.get(src.id)!;
    it.handle = 0x6000_0000 + ws.nextHandle++ * 16;
    it.parent = src.id === data.root ? null : remap(src.parent);
    it.children = src.children.map((c) => map.get(c)!).filter(Boolean);
    if (it.robot) {
      it.robot.activeTool = remap(it.robot.activeTool);
      it.robot.activeFrame = remap(it.robot.activeFrame);
    }
    if (it.target) it.target.robot = remap(it.target.robot);
    if (it.program) it.program.robot = remap(it.program.robot);
    if (it.instruction) {
      const ins = it.instruction;
      ins.target = remap(ins.target);
      ins.target2 = remap(ins.target2);
      ins.frame = remap(ins.frame);
      ins.tool = remap(ins.tool);
      ins.robot = remap(ins.robot);
      if (ins.event) {
        ins.event.tool = remap(ins.event.tool);
        ins.event.object = remap(ins.event.object);
      }
    }
     
    remapItemRefs(it, remap);
    if (src.id === data.root) {
      if (file) it.file = file;
      else delete it.file;
    }
    ws.items[it.id] = it;
    tx.touched.add(it.id);
    tx.ops.push({ kind: "add", item: structuredClone(it), parent: it.parent, index: -1 });
  }
  const root = map.get(data.root)!;
  tx.setMeta("stations", [...ws.stations, root]);
  tx.setMeta("activeStation", root);
  tx.setMeta("selection", []);
  ctx.undoLabel = null;
   
  const vp = ws.items[root].params?.ViewPose?.split(",").map(Number);
  if (vp?.length === 16 && vp.every(Number.isFinite)) setTimeout(() => ctx.services.emit?.({ type: "view", action: "pose", pose: vp }), 600);
  return { id: root, name: ws.items[root].name };
}

defineCommand({
  name: "station.new",
  title: "New Station",
  description: "Create a new empty station named 'New Station (N)' (N = open stations including it), or the given name, and make it active.",
  category: "station",
  shortcut: "Ctrl+N",
  spec: "R-TREE-2",
  undoable: false,
  schema: z.object({ name: z.string().optional() }),
  run(ctx, p) {
    const st = newStation(ctx, p.name);
    return { id: st.id, name: ctx.ws.items[st.id].name, handle: st.handle };
  },
});

defineCommand({
  name: "station.setActive",
  title: "Set Active Station",
  description: "Make a station the active one (new items and API calls target it).",
  category: "station",
  undoable: false,
  schema: z.object({ station: z.union([z.string(), z.number()]) }),
  run({ ws, tx }, p) {
    const st = requireRef(ws, p.station, "station");
    if (st.type !== "station") throw new CommandError("Item is not a station");
    tx.setMeta("activeStation", st.id);
    return { id: st.id };
  },
});

defineCommand({
  name: "station.close",
  title: "Close Station",
  description:
    "Close a station (default: active). The first open station becomes active; closing the last one creates an empty 'New Station (1)'. A station with unsaved changes needs ifUnsaved: 'save' (save first) or 'discard'; from the UI Enginuity asks 'Do you want to save …?' (Yes / No / Cancel).",
  category: "station",
  shortcut: "Ctrl+F4",
  spec: "R-TREE-17, R-SLF-30",
  undoable: false,
  schema: z.object({ station: z.union([z.string(), z.number()]).optional(), ifUnsaved: z.enum(["save", "discard"]).optional() }),
  async run(ctx, p) {
    const { ws } = ctx;
    const st = p.station !== undefined ? requireRef(ws, p.station, "station") : ws.activeStation ? ws.items[ws.activeStation] : undefined;
    if (!st || st.type !== "station") throw new CommandError("No station to close");
    if (!(await confirmClose(ctx, st, p.ifUnsaved))) return { closed: null, cancelled: true };
    closeStation(ctx, st.id);
    return { closed: st.name };
  },
});

defineCommand({
  name: "station.save",
  title: "Save Station",
  description:
    "Save a station (default: active) as an Enginuity station file (<name>.mech): to the file it was opened from or last saved to, else its name in the Enginuity stations folder. `name` saves as a new file (Save Station As) that the station keeps using. To export an .rdk robot station file use station.saveRdk. Marks the station as saved and returns the file path.",
  category: "station",
  shortcut: "Ctrl+S",
  spec: "R-SLF-29",
  undoable: false,
  schema: z.object({ name: z.string().optional().describe("Save As: new file name (or absolute path) for the station"), station: z.union([z.string(), z.number()]).optional() }),
  async run(ctx, p) {
    const { ws } = ctx;
    const st = p.station !== undefined ? requireRef(ws, p.station) : ws.activeStation ? ws.items[ws.activeStation] : undefined;
    if (!st || st.type !== "station") throw new CommandError("No active station");
    return { path: await saveStation(ctx, st, p.name) };
  },
});

defineCommand({
  name: "station.open",
  title: "Open Station",
  description: "Open a saved Enginuity station (.mech) by file name (see station.listFiles) or absolute path, as a new active station. To open any other file (imported .rdk robot stations, robots, tools, meshes…) use file.open.",
  category: "station",
  spec: "R-SLF-31",
  undoable: false,
  schema: z.object({ path: z.string() }),
  async run(ctx, p) {
    const { services } = ctx;
    if (!services.files) throw new CommandError("Opening files is only available on the server");
    const file = services.files.stationPath?.(p.path) ?? p.path;
    status(ctx, `Loading: ${file}`);
    let data: { items: Item[]; root: string };
    try {
      data = (await services.files.loadStation(p.path)) as { items: Item[]; root: string };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new CommandError(/ENOENT/.test(msg) ? `File doesn't exist: ${file}` : "Problems reading file: The Enginuity Station file is corrupted or there's not enough available space. Errors will follow.");
    }
     
    const { openStationFileData } = await import("./examples");
    const res = await openStationFileData(ctx, data, file, file);
    if (ctx.origin === "ui" || ctx.origin === "agent") services.files.pushRecent?.(file);
    status(ctx, "Loading finished.");
    return { ...res, file };
  },
});

defineCommand({
  name: "station.listFiles",
  title: "List Saved Stations",
  description: "List Enginuity station files (.mech) saved in the Enginuity data folder.",
  category: "station",
  readonly: true,
  undoable: false,
  schema: z.object({}),
  async run({ services }) {
    return services.files ? await services.files.listStations() : [];
  },
});

defineCommand({
  name: "station.info",
  title: "Station Information",
  description: "Open stations in tree order with their file, whether they are active and whether they have unsaved changes.",
  category: "query",
  readonly: true,
  undoable: false,
  schema: z.object({}),
  run(ctx) {
    const { ws } = ctx;
    return ws.stations
      .filter((id) => ws.items[id])
      .map((id) => ({
        id,
        name: ws.items[id].name,
        file: ws.items[id].file ?? null,
        active: id === ws.activeStation,
        modified: isModified(ctx, id),
        items: descendants(ws, id).length,
      }));
  },
});

defineCommand({
  name: "station.showInFolder",
  title: "Show in Explorer",
  description: "Show a station's file in the computer's file browser (station context menu 'Show in Explorer'); a station that was never saved shows the stations folder.",
  category: "station",
  readonly: true,
  undoable: false,
  spec: "R-TREE-38",
  schema: z.object({ station: z.union([z.string(), z.number()]).optional() }),
  run({ ws, services }, p) {
    const st = p.station !== undefined ? requireRef(ws, p.station, "station") : ws.activeStation ? ws.items[ws.activeStation] : undefined;
    if (!st || st.type !== "station") throw new CommandError("No station");
    if (!services.files?.reveal) throw new CommandError("Showing files is only available on the server");
    return { shown: services.files.reveal(st.file ?? "") };
  },
});

defineCommand({
  name: "station.deleteParam",
  title: "Remove Station Parameter",
  description: "Remove a station parameter of the active station, or of `station` (Station Parameters dialog).",
  category: "settings",
  undoable: false,
  schema: z.object({ key: z.string(), station: z.union([z.string(), z.number()]).optional() }),
  run({ ws, tx }, p) {
    return { removed: deleteStationParam({ ws, tx }, p.key, paramStationRef(ws, p.station)) };
  },
});

defineCommand({
  name: "file.recent",
  title: "Open Recent",
  description:
    "Recently opened or saved files, newest first (File ▸ Open recent; at most 20, R-SLF-13). action 'list' (default), 'open' the entry at `index` (0 = newest), or 'clear' the list.",
  category: "station",
  undoable: false,
  spec: "R-SLF-13",
  schema: z.object({ action: z.enum(["list", "open", "clear"]).default("list"), index: z.number().int().min(0).optional() }),
  async run(ctx, p) {
    const files = ctx.services.files;
    if (!files?.recent) throw new CommandError("Recent files are only available on the server");
    if (p.action === "clear") {
      files.clearRecent?.();
      return { recent: [] };
    }
    const list = files.recent();
    if (p.action === "list") return { recent: list };
    const path = list[p.index ?? 0];
    if (!path) throw new CommandError("No recent file at this position");
    const { openPath } = await import("./files");
    return openPath(ctx, path, {});
  },
});

defineCommand({
  name: "station.recoverBackup",
  title: "Recover Auto Backup",
  description:
    "Auto backups of stations with unsaved changes (Options: AutoBackup_On / AutoBackup_Min, R-SLF-14). Without `file`, lists them (newest first); with `file`, opens that backup as a new station.",
  category: "station",
  undoable: false,
  spec: "R-SLF-14",
  schema: z.object({ file: z.string().optional() }),
  async run(ctx, p) {
    const files = ctx.services.files;
    if (!files?.listBackups || !files.loadBackup) throw new CommandError("Auto backups are only available on the server");
    if (!p.file) {
      const backups = files.listBackups();
      if (!backups.length) status(ctx, "No files available to recover. Files are saved automatically as *.mech in: data/backups");
      ctx.undoLabel = null;
      return { backups: backups.map((b) => ({ file: b.file, savedAt: new Date(b.mtime).toISOString() })) };
    }
    status(ctx, `Loading: ${p.file}`);
    const res = openStationData(ctx, (await files.loadBackup(p.file)) as { items: Item[]; root: string });
    status(ctx, "Loading finished.");
    return res;
  },
});
