// Verifies Python quick-check, generation, and display-path run modes over the API.
 
 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { TestClient } from "./client";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

 
const ABB = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");

type Ev = { type: string; [k: string]: unknown };
type Srv = Awaited<ReturnType<typeof import("@/server/store").getServer>>;
let server: RdkApiServer;
let srv: Srv;
let run: typeof import("@/server/store").run;
let robotName = "";
let robotId = "";

 
const script = (moves: number[][]) => `import os, socket, struct
s = socket.create_connection(("127.0.0.1", int(os.environ["ENGINUITY_API_PORT"])))
f = s.makefile("rb")
def line(t): s.sendall(t.encode("utf8") + b"\\n")
def i32(v): s.sendall(struct.pack(">i", v))
def h64(v): s.sendall(struct.pack(">Q", v))
def arr(v):
    i32(len(v))
    s.sendall(struct.pack(">%dd" % len(v), *v))
def r_line(): return f.readline().decode("utf8").rstrip("\\n")
def r_i32(): return struct.unpack(">i", f.read(4))[0]
def r_h64(): return struct.unpack(">Q", f.read(8))[0]
def status():
    c = r_i32()
    if c in (2, 3) or 10 <= c < 100:
        r_line()
    return c
line("RDK_API"); arr([1, 0, 0]); r_line(); r_i32(); r_i32(); r_i32()
line("G_RunMode"); mode = r_i32(); status()
line("G_Item"); line(${JSON.stringify(robotName)}); robot = r_h64(); r_i32(); status()
codes = []
for q in ${JSON.stringify(moves)}:
    line("MoveX"); i32(1); i32(1); arr(q); h64(0); h64(robot)
    codes.append(status())
s.close()
print("mode=%d moves=%s" % (mode, ",".join(str(c) for c in codes)))
`;

 
async function collect(act: () => Promise<{ ok: boolean; error?: string | null }>, until: (evs: Ev[]) => boolean, ms = 20_000): Promise<Ev[]> {
  const evs: Ev[] = [];
  const fn = (e: Ev) => void evs.push(e);
  srv.listeners.add(fn);
  try {
    const r = await act();
    if (!r.ok) throw new Error(`command failed: ${r.error}`);
    const t0 = Date.now();
    while (!until(evs)) {
      if (Date.now() - t0 > ms) throw new Error(`timed out; got ${evs.map((e) => (e.type === "status" ? `status:${e.text}` : e.type)).join(" | ")}`);
      await new Promise((r) => setTimeout(r, 25));
    }
    return evs;
  } finally {
    srv.listeners.delete(fn);
  }
}

const statuses = (evs: Ev[]) => evs.filter((e) => e.type === "status").map((e) => String(e.text));
const finished = (evs: Ev[]) => statuses(evs).some((t) => t.startsWith("Python script finished") || t.startsWith("Python script failed"));

async function pyItem(code: string, origin: "ui" | "agent" = "ui") {
  const r = await run("python.add", { code }, origin);
  expect(r.ok).toBe(true);
  return (r.result as { id: string; name: string });
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-a2-runmodes-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], unknownCommandDelayMs: 400, log: () => undefined });
  srv.services.settings.RC_API_PORT = server.port;
   
  const { setPendingRunMode, clearPath } = await import("@/server/rdkapi/runmode");
  srv.services.api = { setPendingRunMode, clearPath };
  srv.services.settings.RC_PYTHON_OUTPUT = "Never";
  const c = await TestClient.connect(server.port);
  await c.handshake();
  await c.itemCmd("NewStation", (w) => w.line("A2 run modes"));
  await c.itemCmd("Add", (w) => w.line(ABB).handle(0));
  c.close();
  const robot = Object.values(srv.ws.items).find((i) => i.type === "robot" && i.robot)!;
  robotId = robot.id;
  robotName = robot.name;
}, 60_000);

afterAll(async () => {
  await server?.close();
});

describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("Python program run modes", () => {
  it("Quick Program Check: moves are validated and the robot jumps; errors reach the script as status 10", async () => {
    const py = await pyItem(script([
      [15, 5, 0, 0, 30, 0],
      [0, 0, 0, 0, 0, 999],
    ]));
    const evs = await collect(() => run("python.runMode", { item: py.id, mode: "check" }, "ui"), finished);
    expect(statuses(evs)).toContain("Python output: mode=2 moves=0,10");
    expect(statuses(evs)).toContain("Python script finished successfully");
    expect(srv.ws.items[robotId].robot!.joints.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([15, 5, 0, 0, 30, 0]);
     
    expect(evs.some((e) => e.type === "program-generated")).toBe(false);
  });

  it("Generate Robot Program: the robot commands become a program generated when the script disconnects", async () => {
    const py = await pyItem(script([
      [0, 0, 0, 0, 30, 0],
      [20, 10, -10, 0, 40, 0],
    ]));
    const evs = await collect(
      () => run("python.runMode", { item: py.id, mode: "generate" }, "ui"),
      (e) => finished(e) && e.some((x) => x.type === "program-generated"),
    );
    expect(statuses(evs)).toContain("Python output: mode=3 moves=0,0");
    const gen = evs.find((e) => e.type === "program-generated")!;
    expect(gen.program).toBe(py.name);
    const text = (gen.files as { content: string }[]).map((f) => f.content).join("\n");
    expect(text).toMatch(/MoveAbsJ|MoveJ/);
     
    expect(Object.values(srv.ws.items).some((i) => i.type === "program" && i.name === py.name)).toBe(false);
  });

  it("Display Path keeps the TCP path of a quick check; show=false removes it", async () => {
    const py = await pyItem(script([
      [0, 0, 0, 0, 30, 0],
      [25, 0, 0, 0, 30, 0],
    ]));
    const evs = await collect(() => run("python.runMode", { item: py.id, mode: "path" }, "ui"), finished);
    const paths = evs.filter((e) => e.type === "python-path" && e.item === py.id);
    const last = paths.at(-1)!;
    expect((last.points as number[][]).length).toBeGreaterThan(1);
    expect((last.points as number[][])[0]).toHaveLength(12);
    const off = await collect(
      () => run("python.runMode", { item: py.id, mode: "path", show: false }, "ui"),
      (e) => e.some((x) => x.type === "python-path" && x.item === py.id),
    );
    expect(off.find((x) => x.type === "python-path")!.points).toEqual([]);
  });

  it("F6 with a Python program selected generates it through the same run mode", async () => {
    const py = await pyItem(script([[5, 0, 0, 0, 30, 0]]));
    const evs = await collect(
      () => run("program.generateMany", { programs: [py.id] }, "ui"),
      (e) => finished(e) && e.some((x) => x.type === "program-generated"),
    );
    expect(statuses(evs)).toContain("Done generating programs (1/1 generated)");
    expect(evs.find((e) => e.type === "program-generated")!.program).toBe(py.name);
  });

  it("Copilot-written code still waits for the user's confirmation", async () => {
    const py = await pyItem(script([[0, 0, 0, 0, 30, 0]]), "agent");
    const r = await run("python.runMode", { item: py.id, mode: "check" }, "agent");
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ started: false, pending: true });
    expect(srv.services.python!.isRunning(py.id)).toBe(false);
  });
});
