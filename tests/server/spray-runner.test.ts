// Verifies simulation ticks emit spray particles along the robot TCP path.
 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fk, ikClosest } from "@/engine/kinematics";
import { mul, transl } from "@/engine/math";
import { stationGuns } from "@/engine/spray";
import { findLibraryFile, hasLibraryFile } from "../library";

type Srv = ReturnType<typeof import("@/server/store").getServer>;
let srv: Srv;
let run: typeof import("@/server/store").run;

async function ok(name: string, params: Record<string, unknown> = {}, origin: "system" | "agent" | "ui" = "system") {
  const r = await run(name, params, origin);
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result as Record<string, unknown>;
}

async function idle(robot: string) {
  const until = Date.now() + 20_000;
  await new Promise((r) => setTimeout(r, 50));
  while ((srv.ws.busy ?? []).includes(robot) && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
}

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-spray-"));
  const store = await import("@/server/store");
  srv = store.getServer();
  run = store.run;
  await srv.ready;
  srv.services.library = {
    ...srv.services.library!,
     
    load: async (file: string, kind?: string) => {
      const { readFileSync } = await import("node:fs");
      const p = findLibraryFile(file, kind);
      if (!p) throw new Error(`${file} is not in the offline library mirror`);
      return { bytes: new Uint8Array(readFileSync(p)), url: `file://${file}` };
    },
  };
}, 60_000);

describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("spray guns with the simulation runner", () => {
  it("a 300 mm linear move emits once per tick reaching a new path point, the bead lies on the TCP path", async () => {
    await ok("station.new", {});
    await ok("library.load", { file: "ABB-IRB-120-3-0-6.robot", kind: "robot" });
    const robot = Object.values(srv.ws.items).find((it) => it.type === "robot")!;
    const tool = (await ok("robot.addTool", { robot: robot.id, name: "T1", pose: transl(0, 0, 100) })) as { id?: string };
    const toolId = tool.id ?? Object.values(srv.ws.items).find((it) => it.type === "tool" && it.parent === robot.id)!.id;
    await ok("object.addShape", { shape: "box", name: "Part", sizeX: 200, sizeY: 400, sizeZ: 10, xyzrpw: [400, 0, 0, 0, 0, 0] });
    const part = Object.values(srv.ws.items).find((it) => it.type === "object" && it.name === "Part")!;
     
    const q0 = [-21.09, 25.74, 2.24, 0, 62.02, -21.09];
    await ok("robot.setJoints", { robot: robot.id, joints: q0 });
    const T0 = mul(fk(robot.robot!.model, q0), transl(0, 0, 100));
    const T1 = T0.slice();
    T1[7] += 300;
    const q1 = ikClosest(robot.robot!.model, mul(T1, transl(0, 0, -100)), q0)!;
    expect(q1).not.toBeNull();
    await ok("robot.setSpeed", { robot: robot.id, linear: 100, joint: 30, linearAccel: 1000, jointAccel: 300 });
    const add = await ok("spray.add", { tool: toolId, object: part.id, options: "NO_PROJECT PARTICLE=SPHERE(3) COLOR=white STEP=1x0 RAND=0" });
    expect(add.id).toBe(0);
    await ok("spray.setState", { state: 1 });
    await ok("sim.setSpeed", { factor: 100 });
    await ok("robot.moveJ", { robot: robot.id, joints: q1, linear: true });
    await idle(robot.id);
    const gun = stationGuns(srv.ws.activeStation)[0];
     
    expect(gun.outCount).toBe(7);
    const pts = Array.from({ length: gun.particles.count }, (_, i) => gun.particles.get(i).pos);
    const partAbs = srv.ws.items[part.id].pose;
     
    for (const p of pts) {
      expect(p[0] + partAbs[3]).toBeCloseTo(T0[3], 0);
      expect(p[2] + partAbs[11]).toBeCloseTo(T0[11], 0);
    }
    expect(pts.at(-1)![1] + partAbs[7]).toBeCloseTo(T0[7] + 300, 0);
     
    await ok("robot.setJoints", { robot: robot.id, joints: q0 }, "agent");
    expect(gun.outCount).toBe(8);
     
    await ok("item.rename", { item: part.id, name: "Part 2" }, "agent").catch(() => undefined);
    expect(gun.outCount).toBe(8);
     
    await ok("item.delete", { items: [toolId] }, "ui");
    expect(stationGuns(srv.ws.activeStation)).toEqual([]);
  }, 60_000);
});
