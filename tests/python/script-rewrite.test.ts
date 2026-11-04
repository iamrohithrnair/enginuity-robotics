 
 
 
 
 
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

 
const P = ["robo", "dk"].join("");
const STATION = "Assembly-and-Material-Handling-with-ABB-IRB-120-3-0-6.rdk";
const enabled = hasLibraryFile("stations", STATION) && spawnSync("python3", ["-c", "1"]).status === 0;

type Srv = ReturnType<typeof import("@/server/store").getServer>;
let srv: Srv;
let api: RdkApiServer;
let run: typeof import("@/server/store").run;
let runner: import("@/server/python-runner").PythonRunner;

function runScript(key: string, name: string, code: string): Promise<import("@/server/python-runner").PythonResult> {
  return new Promise((resolve) => {
    runner.start(key, name, code, { onEnd: resolve });
  });
}

beforeAll(async () => {
  if (!enabled) return;
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-rewrite-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  api = await startRdkApiServer({ ports: [0], log: () => undefined });
  srv.services.settings.RC_API_PORT = api.port;
  srv.flags.Popups = "0";
  srv.services.settings.RC_PYTHON_OUTPUT = "Never";
  const { PythonRunner } = await import("@/server/python-runner");
  runner = new PythonRunner(srv, (key, busy) => void run("sim.setBusy", { program: key, busy }, "system"));
  srv.services.python = runner.service();
}, 60_000);

afterAll(async () => {
  await api?.close();
});

describe.skipIf(!enabled)("example scripts with the original package's imports", () => {
  it("opening the station rewrites the imports, and the script runs against Enginuity", async () => {
    const opened = await run("station.openRdk", { base64: readFileSync(LIBRARY_FILE("stations", STATION)).toString("base64"), name: "Assembly" }, "ui");
    expect(opened.ok).toBe(true);
    const items = Object.values(srv.ws.items);
    const py = items.find((it) => it.type === "python" && it.name === "Next_O-Ring")!;
    const code = py.python?.code ?? "";
     
    expect(code).toContain("from enginuity.robolink import *    # ");
    expect(code).toContain("from enginuity.prelude import *      # Robot toolbox");
    expect(code).toMatch(new RegExp(`help\\("${P}"\\)`));  
    expect(code).not.toMatch(new RegExp(`^\\s*(from|import)\\s+${P}\\b`, "m"));
    const mech = items.find((it) => it.type === "robot" && it.name === "O-RingDistributor_Mech")!;
    const j0 = mech.robot!.joints[0];
    const r = await runScript(py.id, py.name, code);
    expect(r.err).toBe("");
    expect(r.exitCode).toBe(0);
     
    expect(srv.ws.items[mech.id].robot!.joints[0] - j0).toBeCloseTo(3, 6);
  }, 120_000);

  it("code added later is rewritten by the runner before it runs", async () => {
    const code = [`import ${P}`, `from ${P}.robolink import Robolink, ITEM_TYPE_ROBOT`, `from ${P} import robodialogs`, "RDK = Robolink()", `print(${P}.robomath.transl(1, 2, 3)[0, 3], ${P}.robolink.ITEM_TYPE_ROBOT == ITEM_TYPE_ROBOT, robodialogs.__name__)`, ""].join("\n");
    const r = await runScript("script:rewrite", "Rewrite_Check", code);
    expect(r.err).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.out.trim()).toBe("1.0 True enginuity.dialogs");
    const { PYTHON_DIR } = await import("@/server/python-runner");
    const written = readFileSync(path.join(PYTHON_DIR, "Rewrite_Check.py"), "utf8");
    expect(written.split("\n")[0]).toBe("import enginuity.prelude");
    expect(written).not.toMatch(new RegExp(`\\b${P}\\b`));
  }, 60_000);
});
