// Verifies KUKA assembly Python routines reset mechanisms, transfer parts, and run through calls.
 
 
 
 
 
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item } from "@/engine/types";
import { absPose } from "@/engine/workspace";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { LIBRARY_KIND_DIR } from "../library";

const LIB = LIBRARY_KIND_DIR("stations");
const STATIONS = ["Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk", "Assembly-and-Material-Handling-with-KUKA-KR5-scara-R550-Z200.rdk"];
const available = STATIONS.every((f) => existsSync(path.join(LIB, f)));

type Srv = ReturnType<typeof import("@/server/store").getServer>;
let srv: Srv;
let api: RdkApiServer;
let run: typeof import("@/server/store").run;

type Ev = { type: string; [k: string]: unknown };

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-kuka-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  api = await startRdkApiServer({ ports: [0], log: () => undefined });
  srv.services.settings.RC_API_PORT = api.port;
  srv.flags.Popups = "1";
}, 60_000);

afterAll(async () => {
  await api?.close();
});

const byName = (name: string, type?: Item["type"]) => Object.values(srv.ws.items).find((it) => it.name === name && (!type || it.type === type) && inActive(it));

function inActive(it: Item): boolean {
  for (let cur: Item | undefined = it; cur; cur = cur.parent ? srv.ws.items[cur.parent] : undefined) if (cur.id === srv.ws.activeStation) return true;
  return false;
}

async function openStation(file: string) {
  const bytes = readFileSync(path.join(LIB, file));
  const r = await run("station.openRdk", { base64: bytes.toString("base64"), name: file.replace(/\.rdk$/, "") }, "ui");
  expect(r.ok, r.error ?? "").toBe(true);
}

 
async function runPython(name: string): Promise<{ statuses: string[]; dialogs: Ev[] }> {
  const py = byName(name, "python");
  expect(py, `Python program ${name}`).toBeTruthy();
  const evs: Ev[] = [];
  const fn = (e: Ev) => void evs.push(e);
  srv.listeners.add(fn);
  try {
    const r = await run("python.run", { item: py!.id }, "ui");
    expect(r.ok, r.error ?? "").toBe(true);
    const svc = srv.services.python!;
    const t0 = Date.now();
    for (let i = 0; i < 100 && !svc.isRunning(py!.id); i++) await new Promise((res) => setTimeout(res, 10));
    while (svc.isRunning(py!.id)) {
      if (Date.now() - t0 > 60_000) throw new Error(`${name} did not finish`);
      await new Promise((res) => setTimeout(res, 20));
    }
    await new Promise((res) => setTimeout(res, 50));
  } finally {
    srv.listeners.delete(fn);
  }
  return { statuses: evs.filter((e) => e.type === "status").map((e) => String(e.text)), dialogs: evs.filter((e) => e.type === "dialog") };
}

function absPos(it: Item): number[] {
  const m = absPose(srv.ws, it.id);
  return [m[3], m[7], m[11]];
}

describe.skipIf(!available)("KUKA assembly example stations: Python programs run unmodified", () => {
  for (const file of STATIONS) {
    it(`${file}: Reset_Mechanisms, Next_O-Ring, PickUp_Assembly and Place_Assembly do their work`, async () => {
      await openStation(file);
      const mech = byName("O-RingDistributor_Mech", "robot");
      expect(mech?.robot).toBeTruthy();

       
      await run("robot.setJoints", { robot: mech!.id, joints: [7] }, "ui");
      const reset = await runPython("Reset_Mechanisms");
      expect(reset.dialogs, JSON.stringify(reset.dialogs)).toEqual([]);
      expect(reset.statuses).toContain("Python script finished successfully");
      expect(srv.ws.items[mech!.id].robot!.joints[0]).toBeCloseTo(0, 6);

      const next = await runPython("Next_O-Ring");
      expect(next.dialogs, JSON.stringify(next.dialogs)).toEqual([]);
      expect(next.statuses).toContain("Python script finished successfully");
      expect(srv.ws.items[mech!.id].robot!.joints[0]).toBeCloseTo(3, 6);

       
       
      const frame = byName("Assembly_Ref", "frame");
      const gripper = byName("GripperTCP", "tool");
      const tube = byName("TubeType1-1", "object");
      expect(frame && gripper && tube).toBeTruthy();
      await run("item.setParent", { item: tube!.id, parent: frame!.id, keepAbsolute: true }, "ui");
      const before = absPos(srv.ws.items[tube!.id]);
      const pick = await runPython("PickUp_Assembly");
      expect(pick.dialogs, JSON.stringify(pick.dialogs)).toEqual([]);
      expect(pick.statuses).toContain("Python script finished successfully");
      expect(srv.ws.items[tube!.id].parent).toBe(gripper!.id);
      const after = absPos(srv.ws.items[tube!.id]);
      before.forEach((v, i) => expect(after[i]).toBeCloseTo(v, 6));

       
       
       
       
      const place = await runPython("Place_Assembly");
      expect(place.statuses).toContain("Python script failed returning 1");
      const out = place.dialogs.map((d) => String(d.html)).join("\n");
      expect(out).toContain("InvalidItemError");
      expect(out).not.toContain("pip install");
      expect(out).not.toContain("No module named");
      await run("station.close", { station: srv.ws.activeStation, ifUnsaved: "discard" }, "ui");
    }, 180_000);
  }

  it("Tube1 (one cycle of Main) runs Reset_Mechanisms/Next_O-Ring/PickUp_Assembly through Program Calls without Python errors", async () => {
    await openStation(STATIONS[0]);
    const mech = byName("O-RingDistributor_Mech", "robot")!;
    const tube1 = byName("Tube1", "program")!;
    const reset = byName("Reset", "program")!;
    await run("sim.setSpeed", { factor: 1000 }, "ui");
    const evs: Ev[] = [];
    const fn = (e: Ev) => void evs.push(e);
    srv.listeners.add(fn);
    try {
      for (const prog of [reset, tube1]) {
        const r = await run("program.run", { program: prog.id }, "ui");
        expect(r.ok, r.error ?? "").toBe(true);
        const t0 = Date.now();
        while (!(srv.ws.busy ?? []).includes(prog.id) && Date.now() - t0 < 2000) await new Promise((res) => setTimeout(res, 10));
        while ((srv.ws.busy ?? []).length && Date.now() - t0 < 150_000) await new Promise((res) => setTimeout(res, 50));
        while (srv.services.python && Object.values(srv.ws.items).some((it) => it.type === "python" && srv.services.python!.isRunning(it.id))) await new Promise((res) => setTimeout(res, 20));
      }
    } finally {
      srv.listeners.delete(fn);
    }
    const statuses = evs.filter((e) => e.type === "status").map((e) => String(e.text));
    const dialogs = evs.filter((e) => e.type === "dialog");
    const pythonDialogs = dialogs.filter((d) => String(d.title) === "Python script output");
    expect(pythonDialogs, JSON.stringify(pythonDialogs)).toEqual([]);
    expect(statuses.filter((t) => t === "Python script finished successfully").length).toBeGreaterThanOrEqual(3);
    expect(statuses.some((t) => /No module named|pip install/.test(t))).toBe(false);
     
    expect(srv.ws.items[mech.id].robot!.joints[0]).toBeCloseTo(3, 6);
    if (dialogs.length) console.warn("non-Python dialogs during Tube1:", dialogs.map((d) => `${d.title}: ${String(d.html).slice(0, 160)}`));
    await run("station.close", { station: srv.ws.activeStation, ifUnsaved: "discard" }, "ui");
  }, 200_000);
});
