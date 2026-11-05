// Builds a two-robot assembly cell coordinated by threaded programs and I/O handshakes.
 
 

import { along, box, C, cyl, down, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 750;
const BASE: [number, number, number] = [80, 80, 30];
const CAP = { r: 28, h: 20 };
const FIX_Z = TABLE_Z + 10;
const A_AT: [number, number] = [-380, 60];
const B_AT: [number, number] = [380, 60];
const FIXTURE: [number, number] = [0, -150];
const BASES: [number, number][] = [
  [-440, -260],
  [-320, -260],
];
const CAPS: [number, number][] = [
  [320, -250],
  [440, -250],
];
const OUT: [number, number][] = [
  [-90, 300],
  [60, 300],
];

const spec: ExampleSpec = {
  name: "Dual-Robot Assembly",
  description:
    "Two robots share one fixture: UR5e A puts a base part into it, UR5e B running in parallel presses a cap onto the part, and UR5e A moves the assembled part to the output tray. The programs hand over with BASE_READY and CAP_DONE, and Main can be run again and again.",
  features: ["Two robots", "Threads", "Digital I/O handshake", "Program calls", "Attach / detach events", "MoveJ", "MoveL"],
  mainProgram: "Main",
  view: { azimuth: -70, elevation: 34 },
  async build(b: ExampleBuilder) {
    const table: Part[] = [rbox([1500, 900, 40], 8, [0, 60, TABLE_Z - 40], C.light)];
    for (const x of [-680, 680]) for (const y of [-310, 430]) table.push(box([60, 60, TABLE_Z - 40], [x, y, 0], C.steel));
    for (const y of [-310, 430]) table.push(box([1300, 40, 40], [0, y, 200], C.steel));
    await b.assembly("Assembly Table", table);
    for (const [x, y] of [A_AT, B_AT]) await b.shape("Robot Riser", rbox([220, 220, 20], 6, [x, y, TABLE_Z], C.dark));

     
     
    const seedA = [0, -100, -100, -70, 90, 0];
    const homeA = [-90, -100, -100, -70, 90, 0];
    const homeB = [-90, -80, -110, -80, 90, 0];
    const robotA = await b.robot("UR5e.robot", [A_AT[0], A_AT[1], TABLE_Z + 20], { home: homeA });
    const gripA = await b.tool("RobotiQ-2F-85-Gripper-Open.tool", robotA, { name: "Gripper A" });
    const robotB = await b.robot("UR3e.robot", [B_AT[0], B_AT[1], TABLE_Z + 20], { home: homeB });
    const gripB = await b.tool("RobotiQ-2F-85-Gripper-Open.tool", robotB, { name: "Gripper B" });

     
    await b.assembly("Fixture", [rbox([150, 150, 10], 4, [0, 0, 0], C.base), ...[-1, 1].map((s) => box([90, 16, 26], [0, s * 52, 10], C.accent))], [FIXTURE[0], FIXTURE[1], TABLE_Z]);
    await b.assembly("Base Feeder", [rbox([260, 120, 10], 4, [0, 0, 0], C.frame)], [-380, -260, TABLE_Z]);
    await b.assembly("Cap Feeder", [rbox([260, 120, 10], 4, [0, 0, 0], C.frame)], [380, -250, TABLE_Z]);
    await b.assembly("Output Tray", [rbox([300, 130, 10], 4, [0, 0, 0], C.white), ...OUT.map(([x]) => rbox([94, 94, 2], 2, [x + 15, 0, 10], C.steel))], [-15, 300, TABLE_Z]);
    const bases: string[] = [];
    for (const [k, [x, y]] of BASES.entries()) bases.push(await b.shape(`Base ${k + 1}`, rbox(BASE, 6, [x, y, FIX_Z], C.frame)));
    for (const [k, [x, y]] of CAPS.entries()) await b.shape(`Cap ${k + 1}`, cyl(CAP.r, CAP.h, [x, y, FIX_Z], C.accent));

    const station = await b.frame("Table", [0, 0, 0]);
    const homeAT = await b.jointTarget("Home A", b.item(robotA).parent!, robotA, homeA);
    const homeBT = await b.jointTarget("Home B", b.item(robotB).parent!, robotB, homeB);
    const fixture = await b.frame("Fixture Frame", [FIXTURE[0], FIXTURE[1], FIX_Z]);

     
     
    const gripBase = 14;
    const pickBaseT: [string, string][] = [];
    for (const [k, [x, y]] of BASES.entries()) {
      const p = down(x, y, FIX_Z + gripBase, 180);
      pickBaseT.push([await b.target(`Base ${k + 1} Approach`, station, robotA, along(p, -100), seedA), await b.target(`Base ${k + 1} Pick`, station, robotA, p)]);
    }
    const fixA = down(0, 0, gripBase, 180);
    const fixUpA = await b.target("Fixture Approach A", fixture, robotA, along(fixA, -120), seedA);
    const fixAT = await b.target("Fixture A", fixture, robotA, fixA);
    const outT: [string, string][] = [];
    for (const [k, [x, y]] of OUT.entries()) {
      const p = down(x, y, FIX_Z + 2 + gripBase, 180);
      outT.push([await b.target(`Out ${k + 1} Approach`, station, robotA, along(p, -120), seedA), await b.target(`Out ${k + 1}`, station, robotA, p)]);
    }
     
     
    const gripCap = 14;
    const capT: [string, string][] = [];
    for (const [k, [x, y]] of CAPS.entries()) {
       
      const p = down(x, y, FIX_Z + gripCap, 180);
      capT.push([await b.target(`Cap ${k + 1} Approach`, station, robotB, along(p, -100), homeB), await b.target(`Cap ${k + 1} Pick`, station, robotB, p)]);
    }
    const fixB = down(0, 0, BASE[2] + gripCap, 180);
    const fixUpB = await b.target("Fixture Approach B", fixture, robotB, along(fixB, -120), homeB);
    const fixBT = await b.target("Fixture B", fixture, robotB, fixB);

     
    for (const [k, [up, at]] of pickBaseT.entries()) {
      const p = await b.program(`PickBase${k + 1}`, robotA);
      await p.setFrame(station);
      await p.moveJ(up);
      await p.moveL(at);
      await p.setDO("GRIP_A", 1);
      await p.attach(gripA);
      await p.moveL(up);
    }
    const load = await b.program("LoadFixture", robotA);
    await load.setFrame(fixture);
    await load.moveJ(fixUpA);
    await load.moveL(fixAT);
    await load.setDO("GRIP_A", 0);
    await load.detach(gripA, fixture);
    await load.moveL(fixUpA);
    const unload = await b.program("UnloadFixture", robotA);
    await unload.setFrame(fixture);
    await unload.moveJ(fixUpA);
    await unload.moveL(fixAT);
    await unload.setDO("GRIP_A", 1);
    await unload.attach(gripA);
    await unload.moveL(fixUpA);
    for (const [k, [up, at]] of outT.entries()) {
      const p = await b.program(`PlaceOut${k + 1}`, robotA);
      await p.setFrame(station);
       
      await p.moveJ(homeAT);
      await p.moveJ(up);
      await p.moveL(at);
      await p.setDO("GRIP_A", 0);
      await p.detach(gripA, station);
      await p.moveL(up);
    }
     
    for (const [k, [up, at]] of capT.entries()) {
      const p = await b.program(`PickCap${k + 1}`, robotB);
      await p.setFrame(station);
      await p.moveJ(up);
      await p.moveL(at);
      await p.setDO("GRIP_B", 1);
      await p.attach(gripB);
      await p.moveL(up);
      const q = await b.program(`PlaceCap${k + 1}`, robotB);
      await q.setFrame(fixture);
      await q.moveJ(fixUpB);
      await q.speed(100);
      await q.moveL(fixBT);
      await q.setDO("GRIP_B", 0);
      await q.detach(gripB, bases[k]);
      await q.speed(500);
      await q.moveL(fixUpB);
    }

    const robotBProg = await b.program("RobotB", robotB);
    await robotBProg.setTool(gripB);
    await robotBProg.speed(500, 120);
    await robotBProg.moveJ(homeBT);
    for (let k = 0; k < CAPS.length; k++) {
      await robotBProg.waitDI("BASE_READY", 1);
      await robotBProg.setDO("BASE_READY", 0);
      await robotBProg.call(`PickCap${k + 1}`);
      await robotBProg.call(`PlaceCap${k + 1}`);
      await robotBProg.moveJ(homeBT);
      await robotBProg.setDO("CAP_DONE", 1);
    }

    const main = await b.program("Main", robotA);
    await main.comment("Reset: parts back on the feeders, signals off");
    await main.resetObjects();
    for (const io of ["BASE_READY", "CAP_DONE", "GRIP_A", "GRIP_B"]) await main.setDO(io, 0);
    await main.thread("RobotB");
    await main.setTool(gripA);
    await main.speed(600, 120);
    await main.moveJ(homeAT);
    for (let k = 0; k < BASES.length; k++) {
      await main.call(`PickBase${k + 1}`);
      await main.call("LoadFixture");
      await main.moveJ(homeAT);
      await main.setDO("BASE_READY", 1);
      await main.waitDI("CAP_DONE", 1);
      await main.setDO("CAP_DONE", 0);
      await main.call("UnloadFixture");
      await main.call(`PlaceOut${k + 1}`);
    }
    await main.moveJ(homeAT);
    await main.message("2 parts assembled");

     
    for (const [robot, grip] of [[robotA, gripA], [robotB, gripB]]) for (const link of [5, 6]) await b.cmd("collision.setPair", { item1: robot, link1: link, item2: grip, link2: 0, active: false });
    await b.cmd("robot.setJoints", { robot: robotA, joints: homeA });
    await b.cmd("robot.setJoints", { robot: robotB, joints: homeB });
    await b.notes(
      "About this cell",
      "<p><b>Dual-Robot Assembly</b> — run <b>Main</b> (UR5e A); it starts <b>RobotB</b> (UR5e B) as a thread. Main puts the parts back on the feeders first, so it can be run again and again.</p><p>UR5e A loads a base into the fixture and sets <b>BASE_READY</b>. UR5e B waits for it, presses a cap onto the base (the cap is released onto the base, so it moves with it) and sets <b>CAP_DONE</b>; then UR5e A takes the assembled part to the output tray.</p>",
    );
  },
};

export default spec;
