// Verifies simulation recording, standalone playback exports, and demo-station archives.
 
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSimRecorder, decodePoses, recordingName, SIM_TEXTS, SimRecording, simHtml, simPayload, stationBodies, type SimPayload } from "@/engine/simExport";
import { absPose } from "@/engine/workspace";
import { engine, ROOT } from "../helpers";

const id = (r: unknown) => (r as { id: string }).id;
const VIEWER = readFileSync(path.join(ROOT, "public", "sim-viewer", "sim-viewer.js"), "utf8");

 
async function cell() {
  const e = await engine();
  let clock = 1000;
  const rec = createSimRecorder(() => e.ws, () => clock);
  e.services.simRecorder = rec;
  e.services.simViewerScript = () => VIEWER;
  const written = new Map<string, Uint8Array>();
  e.services.files = {
    saveStation: async () => "",
    loadStation: async () => ({}),
    listStations: async () => [],
    writeExport: (name, bytes) => (written.set(name, bytes), `/exports/${name}`),
  };
  const box = id(await e.run("object.addShape", { shape: "box", name: "Box", sizeX: 100, sizeY: 100, sizeZ: 100 }));
  const advance = (ms: number) => {
    clock += ms;
    rec.tick();
  };
  return { e, rec, box, written, advance };
}

 
function unzipStored(zip: Uint8Array): Record<string, Uint8Array> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: Record<string, Uint8Array> = {};
  let o = 0;
  while (o + 30 <= zip.length && dv.getUint32(o, true) === 0x04034b50) {
    const size = dv.getUint32(o + 18, true);
    const nameLen = dv.getUint16(o + 26, true);
    const extra = dv.getUint16(o + 28, true);
    const name = new TextDecoder().decode(zip.subarray(o + 30, o + 30 + nameLen));
    const start = o + 30 + nameLen + extra;
    out[name] = zip.subarray(start, start + size);
    o = start + size;
  }
  return out;
}

const payloadOf = (html: string): SimPayload => JSON.parse(html.match(/<script id="mb-sim" type="application\/json">([\s\S]*?)<\/script>/)![1]);

describe("Export Simulation window texts (FormMakeWebGL FUN_1005cece4)", () => {
  it("label follows the recorder: Press START → Recording... → Simulation of N seconds recorded.", async () => {
    const { e, advance } = await cell();
    expect(await e.run("sim.exportState")).toMatchObject({ recording: false, text: "Press START to record", programs: [] });
    await e.run("sim.exportStart", { mode: "custom" });
    expect((await e.run("sim.exportState")).text).toBe("Recording...");
    advance(1250);
    advance(1250);
    expect(await e.run("sim.exportStop")).toMatchObject({ recording: false, seconds: 2.5, text: "Simulation of 2.5 seconds recorded." });
    expect(SIM_TEXTS.recorded(12.345)).toBe("Simulation of 12.3 seconds recorded.");
  });

  it("Save without a recording: Record a simulation first", async () => {
    const { e } = await cell();
    expect((await e.tryRun("sim.exportSave")).error).toBe("Record a simulation first");
  });

  it("Existing program without programs: No available program. Add a new program.", async () => {
    const { e } = await cell();
    expect((await e.tryRun("sim.exportStart", { mode: "program" })).error).toBe("No available program. Add a new program.");
  });
});

describe("recording (MakeWebGL FUN_1005d04f0 / FUN_1005d06d0)", () => {
  it("is named after the station with spaces replaced by '-'", async () => {
    const { e, rec } = await cell();
    await e.run("sim.exportStart", {});
    expect(rec.recording()!.name).toBe(recordingName(e.ws.items[e.ws.activeStation!].name));
    expect(recordingName("My Cell 2")).toBe("My-Cell-2");
  });

  it("samples [real, sim] times (sim = real × speed ratio) and one pose per object per sample", async () => {
    const { e, rec, box, advance } = await cell();
    e.ws.simulationSpeed = 5;
    await e.run("sim.exportStart", {});
    await e.run("item.setPose", { item: box, xyzrpw: [100, 0, 0, 0, 0, 0], relativeTo: "station" });
    advance(100);
    await e.run("item.setPose", { item: box, xyzrpw: [200, 50, 0, 0, 0, 0], relativeTo: "station" });
    advance(100);
    await e.run("sim.exportStop");
    const r = rec.recording()!;
    expect(r.times.slice(0, 3).map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)])).toEqual([
      [0, 0],
      [0.1, 0.5],
      [0.2, 1],
    ]);
    const k = r.bodies.findIndex((b) => b.item === box);
    expect(Array.from(r.samples[1].slice(k * 12, k * 12 + 12)).filter((_, i) => i % 4 === 3)).toEqual([100, 0, 0]);
    expect(Array.from(r.samples[2].slice(k * 12, k * 12 + 12)).filter((_, i) => i % 4 === 3)).toEqual([200, 50, 0]);
  });

  it("hidden objects have no pose; objects added later get the next index", async () => {
    const { e, rec, box, advance } = await cell();
    await e.run("sim.exportStart", {});
    await e.run("item.setVisible", { items: [box], visible: false });
    advance(40);
    const ball = id(await e.run("object.addShape", { shape: "sphere", name: "Ball", radius: 20 }));
    advance(40);
    await e.run("sim.exportStop");
    const r = rec.recording()!;
    const p = decodePoses(simPayload(r, e.services.geometry, "t"));
    const kb = r.bodies.findIndex((b) => b.item === box);
    const kball = r.bodies.findIndex((b) => b.item === ball);
    expect(kball).toBe(r.bodies.length - 1);
    expect(p[0][kb]).not.toBeNull();
    expect(p[1][kb]).toBeNull();
    expect(p[0][kball]).toBeNull();
    expect(p[2][kball]!.filter((_, i) => i % 4 === 3)).toEqual(Array.from(absPose(e.ws, ball)).filter((_, i) => i % 4 === 3 && i < 12));
  });

  it("records robot links at their joints, following the joints a running motion streams", async () => {
    const { e, rec, advance } = await cell();
    const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
    const before = stationBodies(e.ws, e.ws.activeStation!).filter((b) => b.body.item === robot);
    expect(before.length).toBe(e.ws.items[robot].robot!.links.filter((l) => l.length).length);
    await e.run("sim.exportStart", {});
    rec.onEvent({ type: "live", robot, joints: [90, 0, 0, 0, 0, 0] });
    advance(40);
    rec.onEvent({ type: "live-end", robot });
    advance(40);
    await e.run("sim.exportStop");
    const r = rec.recording()!;
    const flangeLink = r.bodies.filter((b) => b.item === robot).at(-1)!;
    const k = r.bodies.indexOf(flangeLink);
    const [bx, by] = [absPose(e.ws, robot)[3], absPose(e.ws, robot)[7]];
    const at = (s: number) => [r.samples[s][k * 12 + 3] - bx, r.samples[s][k * 12 + 7] - by];
     
    expect(at(1)[0]).toBeCloseTo(-at(0)[1], 0);
    expect(at(1)[1]).toBeCloseTo(at(0)[0], 0);
    expect(at(2)).toEqual(at(0));
  });
});

describe("saved file (MakeWebGL FUN_1005d0a24)", () => {
  it("writes <recording name>.html with the player and the data inline, nothing from the network", async () => {
    const { e, written, advance } = await cell();
     
    await e.run("sim.setSpeed", { factor: 5 });
    await e.run("sim.exportStart", {});
    advance(500);
    const r = await e.run("sim.exportSave");
    const name = `${recordingName(e.ws.items[e.ws.activeStation!].name)}.html`;
    expect(r).toMatchObject({ path: `/exports/${name}`, fileName: name, samples: 2 });
    expect(e.events.some((ev) => ev.type === "status" && ev.text === `Simulation saved successfully: /exports/${name}`)).toBe(true);
    const html = new TextDecoder().decode(written.get(name)!);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|fetch\(|XMLHttpRequest|import\(/);
    expect(html).not.toMatch(/RoboDK/i);
    const p = payloadOf(html);
    expect(p).toMatchObject({ format: "enginuity-sim", version: 1, generator: "Enginuity" });
    expect(p.times).toEqual([
      [0, 0],
      [0.5, 2.5],
    ]);
    expect(p.geometries.length).toBe(1);
  });

  it("a custom file name keeps its .html extension once", async () => {
    const { e, advance } = await cell();
    await e.run("sim.exportStart", {});
    advance(100);
    expect((await e.run("sim.exportSave", { fileName: "demo run.html" })).fileName).toBe("demo run.html");
  });

  it("escapes '</' inside the inline scripts", () => {
    const rec = new SimRecording("s", "x");
    const p = { format: "enginuity-sim", version: 1, title: "</script><b>", station: "x", program: null, generator: "Enginuity", geometries: [], bodies: [], times: [[0, 0]], poses: "" } as SimPayload;
    const html = simHtml(p, "var a='</script>'");
    expect(html.match(/<\/script>/g)!.length).toBe(2);
    expect(rec.seconds).toBe(0);
  });
});

describe("Make a Demo Station (FormMakeDemo)", () => {
  it("zips the station as the startup file (geometry included) and an offline player", async () => {
    const { e, written, box } = await cell();
    const r = await e.run("station.makeDemo");
    expect(r).toMatchObject({ fileName: "Enginuity demo.zip", path: "/exports/Enginuity demo.zip", animated: false });
    expect(String(r.html)).toBe('Demo file generated successfully:<br><a href="file:///exports/Enginuity%20demo.zip">/exports/Enginuity demo.zip</a>');
    const files = unzipStored(written.get("Enginuity demo.zip")!);
    expect(Object.keys(files)).toEqual(["Enginuity demo/startup.mech", "Enginuity demo/index.html"]);
    expect(payloadOf(new TextDecoder().decode(files["Enginuity demo/index.html"])).times).toEqual([[0, 0]]);
     
    const json = JSON.parse(new TextDecoder().decode(files["Enginuity demo/startup.mech"]));
    expect(Object.keys(json.geometries)).toContain(e.ws.items[box].object!.meshes[0].geometry);
    const f = await engine();
    f.services.geometry = { m: new Map<string, Float32Array>(), put(t: Float32Array, i?: string) { (this as unknown as { m: Map<string, Float32Array> }).m.set(i ?? "x", t); return i ?? "x"; }, get(i: string) { return (this as unknown as { m: Map<string, Float32Array> }).m.get(i); } } as never;
    const b64 = Buffer.from(JSON.stringify(json)).toString("base64");
    await f.run("file.open", { fileName: "startup.mech", base64: b64 });
    const opened = Object.values(f.ws.items).find((i) => i.name === "Box")!;
    expect(f.services.geometry.get(opened.object!.meshes[0].geometry)?.length).toBe(e.services.geometry.get(e.ws.items[box].object!.meshes[0].geometry)!.length);
  });

  it("plays the station's last recording when there is one", async () => {
    const { e, advance } = await cell();
    await e.run("sim.exportStart", {});
    advance(300);
    await e.run("sim.exportStop");
    expect((await e.run("station.makeDemo", { fileName: "cell" })).animated).toBe(true);
  });
});
