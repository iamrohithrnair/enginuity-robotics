 
 
 
 
 
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { rewritePythonImports } from "@/engine/python-imports";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

const ROOT = path.resolve(__dirname, "../..");
const PKG = path.join(ROOT, "python/enginuity");
 
const ABB = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");
const HAS_ABB = hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot");
const LAUNCHER = path.join(PKG, "src/enginuity/launch.py");
 
const P = ["robo", "dk"].join("");

let server: RdkApiServer;
let work: string;

function python(args: string[], env: Record<string, string> = {}, ms = 240_000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", "-u", ...args], { cwd: work, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`python timed out\n${out}\n${err}`));
    }, ms);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), "mb-py-"));
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-py-data-"));
  const { getServer } = await import("@/server/store");
  const srv = getServer();
  await srv.ready;
  srv.flags.Popups = "0";
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
}, 60_000);

afterAll(async () => {
  await server?.close();
});

describe("enginuity Python package against the API server", () => {
  it.skipIf(!HAS_ABB)("api_tour.py: every check passes", async () => {
    const r = await python([path.join(PKG, "tests/integration/api_tour.py"), String(server.port), ABB, work]);
    const lines = r.out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { check?: string; ok?: boolean; detail?: string; summary?: { passed: number; failed: number } });
    const failures = lines.filter((l) => l.check && !l.ok).map((l) => `${l.check}: ${l.detail}`);
    const summary = lines.find((l) => l.summary)?.summary;
    expect(failures, `${failures.join("\n")}\n${r.err}`).toEqual([]);
    expect(summary?.passed ?? 0).toBeGreaterThan(90);
    expect(r.code).toBe(0);
     
    const { COMMANDS } = await import("@/server/rdkapi/context");
    const spray = lines.find((l) => l.check?.startsWith("Spray"));
    if (COMMANDS.has("Gun_Add")) expect(spray?.detail).toBe("True");
  }, 300_000);

  it.skipIf(!HAS_ABB)("example-style scripts run through the import rewrite and the launcher (robolink / robomath aliases)", async () => {
    const script = path.join(work, "legacy.py");
    const code =
      [
        `from ${P} import robolink    # API`,
        `from ${P} import robomath    # math`,
        "RDK = robolink.Robolink()",
        `from ${P} import *`,
        "from robolink import *",
        "import sys",
        "station = RDK.AddStation('Legacy')",
        "robot = RDK.AddFile(sys.argv[1])",
        "mech = RDK.Item(robot.Name(), itemtype=robolink.ITEM_TYPE_ROBOT)",
        "assert mech.Valid()",
        "mech.setJoints([0, 0, 0, 0, 30, 0])",
        "mech.MoveJ(mech.Joints() + 5)",
        "j = mech.Joints().tolist()",
        "print('joints', [round(v, 6) for v in j])",
        "frame = RDK.AddFrame('Assembly_Ref')",
        "part = RDK.AddFrame('Part', frame)",
        "for item in frame.Childs():",
        "    item.setParentStatic(station)",
        "print('parent', part.Parent().Name() == station.Name(), isinstance(part, Item), robolink.RUNMODE_SIMULATE, time.time() > 0)",
        "print('pose', pose_2_xyzrpw(transl(1, 2, 3) * rotz(pi / 2))[5])",
        "RDK.CloseStation()",
      ].join("\n") + "\n";
    const rewritten = rewritePythonImports(code);
    expect(rewritten.split("\n").slice(0, 4)).toEqual(["from enginuity import robolink    # API", "from enginuity import robomath    # math", "RDK = robolink.Robolink()", "from enginuity.prelude import *"]);
    writeFileSync(script, rewritten);
    const r = await python([LAUNCHER, script, ABB], { ENGINUITY_API_PORT: String(server.port), ENGINUITY_HOST: "127.0.0.1" });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("joints [5.0, 5.0, 5.0, 5.0, 35.0, 5.0]");
    expect(r.out).toContain("parent True True 1 True");
    expect(r.out).toContain("pose 90.0");
  }, 120_000);

  it("a clear error when Enginuity is not running", async () => {
    const r = await python(["-c", `import sys; sys.path.insert(0, ${JSON.stringify(path.join(PKG, "src"))}); import enginuity\ntry:\n    enginuity.Enginuity(port=1)\nexcept enginuity.EnginuityConnectionError as e:\n    print('ERR', e)`]);
    expect(r.out).toContain("ERR Enginuity is not running on localhost:1");
  });
});
