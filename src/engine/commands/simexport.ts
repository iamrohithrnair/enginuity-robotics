// Registers simulation recording, portable playback exports and demo-station creation.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { zipStore } from "../exporters";
import { bindAction } from "../actions";
import { CommandError, defineCommand, getCommand, ItemRef, status, type CmdCtx } from "../registry";
import { SIM_TEXTS, SimRecording, simHtml, simPayload, toBase64 } from "../simExport";
import type { Item } from "../types";
import { descendants } from "../workspace";
import { snapshotStation } from "./station";
import { stationFileName } from "../stationFile";

const activeStation = (ctx: CmdCtx): Item => {
  const st = ctx.ws.activeStation ? ctx.ws.items[ctx.ws.activeStation] : undefined;
  if (!st) throw new CommandError("No station is open");
  return st;
};

const recorder = (ctx: CmdCtx) => {
  if (!ctx.services.simRecorder) throw new CommandError("Export Simulation records on the Enginuity server");
  return ctx.services.simRecorder;
};

 
export function exportablePrograms(ctx: Pick<CmdCtx, "ws">, stationId: string) {
  return descendants(ctx.ws, stationId).filter((it) => it.type === "program" || it.type === "python");
}

 
function forActive<T extends { recording: boolean; seconds: number; samples: number; station: string | null }>(ctx: CmdCtx, s: T): T {
  return !s.recording && s.station && s.station !== ctx.ws.activeStation ? { ...s, seconds: 0, samples: 0 } : s;
}

function stateText(s: { recording: boolean; seconds: number; samples: number }) {
  if (s.recording) return SIM_TEXTS.recording;
  return s.samples ? SIM_TEXTS.recorded(s.seconds) : SIM_TEXTS.pressStart;
}

defineCommand({
  name: "sim.exportState",
  title: "Export Simulation State",
  description:
    "State of the Export Simulation recorder: whether it is recording, the seconds and samples recorded, the window's label (\"Press START to record\", \"Recording...\", \"Simulation of N seconds recorded.\") and the programs the 'Existing program' mode can run.",
  category: "simulation",
  readonly: true,
  undoable: false,
  spec: "B-FILE-08, D-34",
  schema: z.object({}),
  run(ctx) {
    const s = forActive(ctx, recorder(ctx).state());
    const st = ctx.ws.activeStation;
    return { ...s, text: stateText(s), programs: st ? exportablePrograms(ctx, st).map((p) => ({ id: p.id, name: p.name, type: p.type })) : [] };
  },
});

defineCommand({
  name: "sim.exportStart",
  title: "Record Simulation",
  description:
    "Start recording the active station for File ▸ Export Simulation (Start). mode 'custom' records everything that moves (programs, jogging, scripts) until sim.exportStop; mode 'program' runs the given program (or Python program) and stops recording when it finishes. Starting clears the previous recording.",
  category: "simulation",
  undoable: false,
  spec: "B-FILE-08, D-34",
  schema: z.object({ mode: z.enum(["custom", "program"]).default("custom"), program: ItemRef.optional() }),
  async run(ctx, p) {
    const st = activeStation(ctx);
    const rec = recorder(ctx);
    if (p.mode === "program") {
      const progs = exportablePrograms(ctx, st.id);
      const prog = p.program !== undefined ? requireRef(ctx.ws, p.program, "program") : progs[0];
      if (!prog || !progs.some((x) => x.id === prog.id)) throw new CommandError(SIM_TEXTS.noProgram);
      rec.start({ station: st.id, name: st.name, program: prog.id, programName: prog.name });
      const def = getCommand(prog.type === "python" ? "python.run" : "program.run");
      if (!def) throw new CommandError(`${prog.name} can't be run`);
      try {
        await def.run(ctx, def.schema.parse(prog.type === "python" ? { item: prog.id } : { program: prog.id }));
      } catch (e) {
        rec.stop();
        throw e;
      }
    } else rec.start({ station: st.id, name: st.name });
    const s = rec.state();
    return { ...s, text: stateText(s) };
  },
});

defineCommand({
  name: "sim.exportStop",
  title: "Stop Recording",
  description: "Stop the Export Simulation recording (Stop). Returns the seconds recorded.",
  category: "simulation",
  undoable: false,
  spec: "B-FILE-08, D-34",
  schema: z.object({}),
  run(ctx) {
    const rec = recorder(ctx);
    rec.stop();
    const s = rec.state();
    return { ...s, text: stateText(s) };
  },
});

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Enginuity-simulation";

function writeOut(ctx: CmdCtx, fileName: string, bytes: Uint8Array) {
  if (!ctx.services.files?.writeExport) throw new CommandError("Exports are saved by the Enginuity server");
  return ctx.services.files.writeExport(fileName, bytes);
}

function viewerScript(ctx: CmdCtx) {
  const js = ctx.services.simViewerScript?.();
  if (!js) throw new CommandError("The simulation player is missing (node scripts/build-sim-viewer.mjs)");
  return js;
}

defineCommand({
  name: "sim.exportSave",
  title: "Export Simulation",
  description:
    "Save the recorded simulation as one self-contained HTML file (File ▸ Export Simulation ▸ Save): a 3D player that runs offline in any browser. Stops a running recording first. Fails with \"Record a simulation first\" when nothing was recorded. fileName defaults to the recording name (station or program, spaces → '-'). Returns the saved path and the file (base64).",
  category: "simulation",
  undoable: false,
  spec: "B-FILE-08, D-34, R-SLF-36",
  schema: z.object({ fileName: z.string().optional(), format: z.enum(["html"]).default("html") }),
  run(ctx, p) {
    const rec = recorder(ctx);
    rec.stop();
    const r = rec.recording();
    if (!r || !r.samples.length || r.station !== ctx.ws.activeStation) throw new CommandError(SIM_TEXTS.recordFirst);
    const name = safeName((p.fileName ?? r.name).replace(/\.html?$/i, ""));
    const fileName = `${name}.html`;
    const st = ctx.ws.items[r.station];
    const html = simHtml(simPayload(r, ctx.services.geometry, r.program ? `${r.program} (${st?.name ?? r.name})` : st?.name ?? r.name), viewerScript(ctx));
    const bytes = new TextEncoder().encode(html);
    const path = writeOut(ctx, fileName, bytes);
    status(ctx, `${SIM_TEXTS.saved}${path}`);
    return { path, fileName, bytes: bytes.length, seconds: r.seconds, samples: r.samples.length, bodies: r.bodies.length, base64: toBase64(bytes) };
  },
});

 

let demoBusy = false;

 
export function portableStation(ctx: CmdCtx, stationId: string) {
  const snap = snapshotStation(ctx.ws, stationId) as ReturnType<typeof snapshotStation> & { geometries?: Record<string, string> };
  const ids = new Set<string>();
  for (const it of snap.items) {
    for (const m of [...(it.object?.meshes ?? []), ...(it.tool?.meshes ?? []), ...(it.robot?.links.flat() ?? [])]) {
      ids.add(m.geometry);
      if (m.normals) ids.add(m.normals);
    }
  }
  const geometries: Record<string, string> = {};
  for (const id of ids) {
    const t = ctx.services.geometry.get(id);
    if (t) geometries[id] = toBase64(new Uint8Array(t.buffer, t.byteOffset, t.byteLength));
  }
  snap.geometries = geometries;
  return snap;
}

defineCommand({
  name: "station.makeDemo",
  title: "Make a Demo Station",
  description:
    "Make a demo package of the active station that is easy to share (File ▸ Make a Demo Station): a zip holding the station file (geometry included, opens in Enginuity) and an offline 3D player (index.html) that shows the station, or plays its last Export Simulation recording when there is one. Default name 'Enginuity demo.zip'. Returns the saved path and the file (base64).",
  category: "station",
  undoable: false,
  spec: "B-FILE-09, R-SLF-36",
  schema: z.object({ fileName: z.string().optional(), format: z.enum(["zip"]).default("zip") }),
  run(ctx, p) {
    if (demoBusy) throw new CommandError("Currently busy, wait until the current compression is done");
    const st = activeStation(ctx);
    demoBusy = true;
    try {
      const last = ctx.services.simRecorder?.recording();
      let rec: SimRecording;
      if (last && last.station === st.id && last.samples.length && !ctx.services.simRecorder?.state().recording) rec = last;
      else {
        rec = new SimRecording(st.id, st.name);
        rec.add(ctx.ws, 0, 0);
      }
      const name = safeName((p.fileName ?? "Enginuity demo").replace(/\.zip$/i, ""));
      const html = simHtml(simPayload(rec, ctx.services.geometry, st.name), viewerScript(ctx));
      const enc = new TextEncoder();
      const zip = zipStore([
        { name: `${name}/${stationFileName("startup")}`, data: enc.encode(JSON.stringify(portableStation(ctx, st.id))) },
        { name: `${name}/index.html`, data: enc.encode(html) },
      ]);
      const path = writeOut(ctx, `${name}.zip`, zip);
      status(ctx, `Demo file generated successfully: ${path}`);
      return { path, fileName: `${name}.zip`, bytes: zip.length, animated: rec.samples.length > 1, html: `Demo file generated successfully:<br><a href="file://${encodeURI(path)}">${path}</a>`, base64: toBase64(zip) };
    } catch (e) {
      if (e instanceof CommandError) throw e;
      throw new CommandError("Cannot make a demo package");
    } finally {
      demoBusy = false;
    }
  },
});


 
bindAction("actionExport_3D_Simulation", { ui: true });
bindAction("actionMake_demo_station", { ui: true });
 
 
bindAction("actionSensor_View", { noop: true });
 
 
bindAction("actionDraw_curve_on_part", { ui: true });
