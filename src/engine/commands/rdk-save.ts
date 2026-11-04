import { z } from "zod";
import { writeRdkFile } from "../kinematics";
import { CommandError, defineCommand, status } from "../registry";
import { buildRdkExport } from "../rdkExport";
import { requireRef } from "../dispatch";

 
 
 
 
 
 

 
export const julianDay = (d: Date) => Math.floor(d.getTime() / 86_400_000) + 2_440_588;

defineCommand({
  name: "station.saveRdk",
  title: "Save Station As .rdk",
  description:
    "Save a station (default: active) as an .rdk station file that other robot simulators using that format can open. `name` is a file name in the Enginuity stations folder or an absolute path ('.rdk' is added when missing; default: the station name). An existing file is never replaced unless overwrite is true. Frames, robots loaded from robot files, tools, objects (meshes, curves, points), targets, programs and their instructions, folders, notes, Python programs and the station parameters are stored; machining projects, cameras and scripts are not (they are listed in `skipped`). Enginuity's own format stays the station's file (station.save).",
  category: "station",
  spec: "R-SLF-22…28, R-FMT-3",
  undoable: false,
  schema: z.object({
    name: z.string().optional().describe("file name or absolute path of the .rdk file"),
    station: z.union([z.string(), z.number()]).optional(),
    overwrite: z.boolean().optional().describe("replace an existing file (ask the user first)"),
  }),
  async run(ctx, p) {
    const { ws, services } = ctx;
    const st = p.station !== undefined ? requireRef(ws, p.station) : ws.activeStation ? ws.items[ws.activeStation] : undefined;
    if (!st || st.type !== "station") throw new CommandError("No active station");
    const files = services.files;
    if (!files?.writeStationFile) throw new CommandError("Saving is only available on the server");
    let name = (p.name ?? "").trim() || st.name.replace(/[^\w .()-]+/g, "_").trim() || "Station";
    if (!/\.rdk$/i.test(name)) name += ".rdk";
    const target = files.stationPath?.(name) ?? name;
    if (!p.overwrite && files.exists?.(target)) throw new CommandError(`“${target.replace(/^.*[\\/]/, "")}” already exists. Do you want to replace it?`, "file_exists");
    status(ctx, `Saving station to ${target}. Please wait...`);
    const view = services.view?.pose?.() ?? st.rdk?.view ?? null;
    const exp = buildRdkExport(ws, st.id, services.geometry, view);
    const { bytes, report } = writeRdkFile(exp.station, exp.payload, julianDay(new Date()));
    let path: string;
    try {
      path = files.writeStationFile(target, bytes, { overwrite: !!p.overwrite });
    } catch (e) {
      throw new CommandError(e instanceof Error ? e.message : String(e));
    }
    if (ctx.origin === "ui" || ctx.origin === "agent") files.pushRecent?.(path);
    status(ctx, `Station saved successfully (${path})`);
    return { path, records: report.records, bytes: bytes.byteLength, skipped: exp.skipped };
  },
});
