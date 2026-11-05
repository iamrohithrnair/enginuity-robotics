// Lists example cells and opens their station payloads.
 
 
 
 

import { z } from "zod";
import { decodeTriangles, EXAMPLE_SLUG, hasLibraryRefs, robotState, type StationFile } from "../examples";
import { parseRobotFile } from "../kinematics";
import { CommandError, defineCommand, status, type CmdCtx } from "../registry";
import type { Item, MeshRef, RobotData } from "../types";
import { stationIdOf } from "../treeRules";
import { meshesFromParsed } from "./library";
import { robotDataFromParsed } from "./robot";
import { openStationData } from "./station";

function libraryError(what: string, file: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/offline/i.test(msg))
    return `${what} needs ${file} from the robot library, but ${file} is not in the offline library on this computer. Download the library for offline use (Robot Library ▸ Download all for offline use) or allow online access, then open it again.`;
  return `${what} needs ${file} from the robot library, which could not be loaded: ${msg}`;
}






export async function resolveStationFile(ctx: Pick<CmdCtx, "services">, data: StationFile, what: string): Promise<{ items: Item[]; root: string }> {
  const { services } = ctx;
  const refs = data.library ?? [];
  const files = new Map<string, Uint8Array>();
  const key = (r: { file: string; kind: string }) => `${r.kind}:${r.file}`;
  for (const ref of refs) {
    if (files.has(key(ref))) continue;
    if (!services.library) throw new CommandError("The robot library is only available on the server");
    try {
      files.set(key(ref), (await services.library.load(ref.file, ref.kind)).bytes);
    } catch (err) {
      throw new CommandError(libraryError(what, ref.file, err), "library_missing");
    }
  }
  const items: Item[] = structuredClone(data.items ?? []);
  const geo = new Map<string, string>();
  for (const [id, text] of Object.entries(data.geometry ?? {})) geo.set(id, services.geometry.put(await decodeTriangles(text)));
  const fix = (m: MeshRef): MeshRef => ({ ...m, geometry: geo.get(m.geometry) ?? m.geometry, ...(m.normals ? { normals: geo.get(m.normals) ?? m.normals } : {}) });
  const fromLibrary = new Map(refs.map((r) => [r.item, r]));
  for (const it of items) {
    const ref = fromLibrary.get(it.id);
    if (!ref) {
      if (it.object) it.object.meshes = it.object.meshes.map(fix);
      if (it.tool) it.tool.meshes = it.tool.meshes.map(fix);
      if (it.robot?.links) it.robot.links = it.robot.links.map((l) => l.map(fix));
      continue;
    }
    let parsed: ReturnType<typeof parseRobotFile>;
    try {
      parsed = parseRobotFile(files.get(key(ref))!);
    } catch {
      throw new CommandError(`${what} needs ${ref.file} from the robot library, but that file is not a valid robot or tool file`, "invalid_file");
    }
    const links = meshesFromParsed(parsed.json, parsed.floats, (t) => services.geometry.put(t));
    if (it.robot) it.robot = { ...robotDataFromParsed(parsed.json, links), ...robotState(it.robot as Partial<RobotData>), libraryFile: ref.file };
    else if (it.tool) it.tool = { ...it.tool, meshes: links.flat() };
  }
  return { items, root: data.root };
}

 
export async function openStationFileData(ctx: CmdCtx, data: unknown, what: string, file?: string) {
  if (!hasLibraryRefs(data)) return openStationData(ctx, data as { items: Item[]; root: string }, file);
   
   
  return openStationData(ctx, await resolveStationFile(ctx, data, what));
}

defineCommand({
  name: "examples.list",
  title: "Example Cells",
  description:
    "List Enginuity's example cells (File ▸ Open Sample Stations): slug, name, description, the features each shows (MoveJ / MoveL / MoveC, I/O, simulation events, program calls, threads, curve and point follow, decisions, cameras, scripts…), the robots and tools it loads from the robot library, its programs and main program, the simulated cycle time and `missing`: library files not on this computer yet. Open one with examples.open.",
  category: "station",
  readonly: true,
  undoable: false,
  schema: z.object({ query: z.string().optional().describe("only examples whose name, description, features or robots contain every word") }),
  async run({ services }, p) {
    if (!services.examples) throw new CommandError("Example cells are only available on the server");
    const words = (p.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const all = await services.examples.list();
    return all
      .filter((e) => {
        const hay = [e.name, e.description, e.slug, ...e.features, ...e.robots, ...e.tools].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .map((e) => ({ ...e, thumbnail: `/api/examples/${e.slug}/thumbnail` }));
  },
});

defineCommand({
  name: "examples.open",
  title: "Open Example Cell",
  description:
    "Open one of Enginuity's example cells (see examples.list) as a new active station, by slug or name. Its robots and tools are loaded from the robot library (the offline library when present); the cell's geometry, frames, targets, programs, I/O, events and projects come from the example. Run its main program with program.run. Fails, without changing anything, when a library file it needs cannot be loaded (for example a file missing from the offline library).",
  category: "station",
  undoable: false,
  schema: z.object({ example: z.string().describe("example slug (e.g. 'conveyor-pick-place') or its name") }),
  async run(ctx, p) {
    const { services } = ctx;
    if (!services.examples) throw new CommandError("Example cells are only available on the server");
    const want = p.example.trim().toLowerCase();
    const entry = (await services.examples.list()).find((e) => e.slug === want || e.name.toLowerCase() === want);
    if (!entry || !EXAMPLE_SLUG.test(entry.slug)) throw new CommandError(`No example named "${p.example}". See examples.list.`);
    status(ctx, `Loading: ${entry.name}`);
    let data: unknown;
    try {
      data = await services.examples.load(entry.slug);
    } catch (err) {
      throw new CommandError(`Problems reading the example ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const res = await openStationFileData(ctx, data, `The example "${entry.name}"`);
     
    const st = ctx.ws.items[res.id];
    if (st) ctx.tx.set(st.id, { params: { ...(st.params ?? {}), Example: entry.slug } });
     
    const main = Object.values(ctx.ws.items).find((it) => it.type === "program" && it.name === entry.mainProgram && stationIdOf(ctx.ws, it.id) === res.id);
    if (main) ctx.tx.setMeta("selection", [main.id]);
    status(ctx, "Loading finished.");
    return { ...res, example: entry.slug, mainProgram: entry.mainProgram, programs: entry.programs, robots: entry.robots, tools: entry.tools };
  },
});
