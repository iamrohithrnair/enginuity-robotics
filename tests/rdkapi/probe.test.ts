 
 
 
 
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { hasLibraryFile, LIBRARY_FILE, LIBRARY_KIND_DIR } from "../library";

const ROOT = path.resolve(__dirname, "../..");
 
const PY_SRC = path.join(ROOT, "python/enginuity/src");
 
const LIB = "/workspace/src/RoboDK/RoboDK.app/Contents/Library";
 
const ROBOTS = LIBRARY_KIND_DIR("robots");
const ABB = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");
const enabled = process.env.RDKAPI_PROBE === "1" && existsSync(LIB) && hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot");
 
const OUT = process.env.RDKAPI_PROBE_OUT ?? path.join(ROOT, "research/evidence/api-probe");

let server: RdkApiServer;

function runPython(args: string[]): Promise<string> {
  const work = mkdtempSync(path.join(os.tmpdir(), "rc-probe-cwd-"));
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", ...args], { cwd: work });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("close", (code) => resolve(`${text}\n[exit] ${JSON.stringify({ code })}\n`));
  });
}

describe.skipIf(!enabled)("RoboDK API probes against RoboCraft", () => {
  beforeAll(async () => {
    process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-probe-"));
    const { getServer } = await import("@/server/store");
    await getServer().ready;
    const { startRdkApiServer } = await import("@/server/rdkapi/server");
    server = await startRdkApiServer({ ports: [Number(process.env.ROBOCRAFT_API_PORT ?? 0)], log: () => undefined });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

   
  beforeEach(async () => {
    const { getServer, run } = await import("@/server/store");
    await run("sim.stop", {}, "system");
    await run("sim.setSpeed", { factor: 5 }, "system");
    await run("collision.setActive", { active: false }, "system");
    getServer().flags.Popups = "1";
     
    for (const st of getServer().ws.stations) await run("collision.setMap", { mode: "default", station: st }, "system");
  });

  it("api_probe.py", async () => {
    const gen = path.join(OUT, "robocraft-gen");
    rmSync(gen, { recursive: true, force: true });
    mkdirSync(gen, { recursive: true });
    const out = await runPython([path.join(ROOT, "research/scenarios/api_probe.py"), String(server.port), ABB, gen, PY_SRC]);
    writeFileSync(path.join(OUT, "robocraft-capture.txt"), out);
    expect(out).toContain("done");
  }, 180_000);

  it.each([
    "programs_probe1_instructions",
    "programs_probe2_timing",
    "programs_probe3_validation",
    "programs_probe4_run",
    "programs_probe5_collision",
    "programs_probe6_events_targets",
    "programs_probe7_steps",
    "tree_probe",
  ])("%s.py", async (name) => {
    const parts = path.join(LIB, "02-Robot drilling x2 coordinate systems/Parts");
    const args =
      name === "tree_probe"
        ? [ABB, path.join(parts, "Table-1400x800x800mm.stl"), path.join(parts, "Spindle.tool"), PY_SRC]
        : name === "programs_probe6_events_targets"
          ?  
            [ROBOTS, PY_SRC, path.join(LIB, "06-Pick and Place/Assembly-and-Material-Handling-with-ABB-IRB-120-3-0-6.rdk")]
          : [ROBOTS, PY_SRC];
    const out = await runPython([path.join(ROOT, "research/scenarios", `${name}.py`), String(server.port), ...args]);
    writeFileSync(path.join(OUT, `robocraft-${name}.txt`), out);
    expect(out.length).toBeGreaterThan(0);
  }, 600_000);

  it("api_probe_extended.py", async () => {
    const tool = path.join(LIB, "10-Remote TCP-Robot machining/Parts/Wood_Holder.tool");
    const stl = path.join(LIB, "06-Pick and Place/Parts/Tube.stl");
    const out = await runPython([path.join(ROOT, "research/scenarios/api_probe_extended.py"), String(server.port), ABB, tool, stl, PY_SRC]);
    writeFileSync(path.join(OUT, "robocraft-extended-capture.txt"), out);
    expect(out).toContain("done");
  }, 180_000);
});
