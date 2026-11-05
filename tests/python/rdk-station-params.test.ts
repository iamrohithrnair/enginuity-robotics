// Verifies Python getParam reads parameters restored from imported station files.
 
 
 
 
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { LIBRARY_KIND_DIR } from "../library";

const ROOT = path.resolve(__dirname, "../..");
const LAUNCHER = path.join(ROOT, "python/enginuity/src/enginuity/launch.py");
const LIB = LIBRARY_KIND_DIR("stations");
const FILES = ["Conveying-with-UR10.rdk", "Conveying-and-Material-Handling-with-ABB.rdk", "Mixed-Applications-with-RoboDK-RDK-1440-02.rdk"].map((f) => path.join(LIB, f));
const available = FILES.every((f) => existsSync(f));

let server: RdkApiServer;
let work: string;

function python(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", "-u", ...args], { cwd: work, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`python timed out\n${out}\n${err}`));
    }, 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

beforeAll(async () => {
  if (!available) return;
  work = mkdtempSync(path.join(os.tmpdir(), "mb-params-"));
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-params-data-"));
  const { getServer } = await import("@/server/store");
  const srv = getServer();
  await srv.ready;
  srv.flags.Popups = "0";
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], log: () => undefined });
}, 60_000);

afterAll(async () => {
  await server?.close();
});

describe.skipIf(!available)("RDK.getParam after opening example stations (enginuity package)", () => {
  it("returns the parameters stored in each station file", async () => {
    const script = path.join(work, "params.py");
    writeFileSync(
      script,
      [
        "import json, os, sys",
        "from enginuity import robolink",
        "RDK = robolink.Robolink()",
        "keys = {",
        "    'Conveying-with-UR10': ['SizeBox', 'SizePallet', 'ConvSpeed', 'SENSOR'],",
        "    'Conveying-and-Material-Handling-with-ABB': ['ConvSpeed_MMS', 'PartCycles'],",
        "    'Mixed-Applications-with-RoboDK-RDK-1440-02': ['Box_Num', 'Conveyor_Travel', 'TestVar', 'Box_X'],",
        "}",
        "out = {}",
        "stations = {}",
        "for f in sys.argv[1:]:",
        "    station = RDK.AddFile(f)",
        "    assert station.Valid() and station.Type() == robolink.ITEM_TYPE_STATION",
        "    name = os.path.basename(f)[:-4]",
        "    stations[name] = station",
        "    out[name] = {k: RDK.getParam(k) for k in keys[name] + ['NoSuchParameter']}",
        "# the last opened station is active: names of the other stations are unknown",
        "out['leak'] = [RDK.getParam('ConvSpeed_MMS'), RDK.getParam('SizeBox')]",
        "# an empty value removes a parameter (Reset_Conveyor style)",
        "RDK.setParam('Box_Num', '')",
        "out['removed'] = RDK.getParam('Box_Num')",
        "# back to the ABB station: its own values, as its scripts use them",
        "RDK.setActiveStation(stations['Conveying-and-Material-Handling-with-ABB'])",
        "out['cycles'] = int(RDK.getParam('PartCycles'))",
        "print(json.dumps(out))",
      ].join("\n") + "\n",
    );
    const r = await python([LAUNCHER, script, ...FILES], { ENGINUITY_API_PORT: String(server.port), ENGINUITY_HOST: "127.0.0.1" });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out.trim().split("\n").at(-1)!);
    expect(out["Conveying-with-UR10"]).toEqual({ SizeBox: "150, 200, 150", SizePallet: "3,2,3", ConvSpeed: 25, SENSOR: 0, NoSuchParameter: null });
    expect(out["Conveying-and-Material-Handling-with-ABB"]).toEqual({ ConvSpeed_MMS: 10, PartCycles: 20, NoSuchParameter: null });
    expect(out["Mixed-Applications-with-RoboDK-RDK-1440-02"]).toEqual({ Box_Num: 0, Conveyor_Travel: 400, TestVar: "red", Box_X: "", NoSuchParameter: null });
    expect(out.leak).toEqual([null, null]);
    expect(out.removed).toBeNull();
    expect(out.cycles).toBe(20);
  }, 180_000);
});
