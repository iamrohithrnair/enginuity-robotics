 
 
 

import { along, box, C, cyl, down, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 800;
const BLANK = { r: 28, h: 60 };
const GRIP = 32;
const SLOTS = [-110, 0, 110];

const spec: ExampleSpec = {
  name: "CNC Machine Tending",
  description:
    "A Fanuc M-10iD/12 loads three raw blanks, one after the other, into the vise of a machining centre, waits for the machining cycle and moves each finished part to an output tray. The machine's sliding door is a one-axis mechanism with its own Open and Close programs, called from the robot's program.",
  features: ["MoveJ", "MoveL", "Program calls", "Door mechanism", "Digital I/O", "Attach / detach events", "Machine cycle wait"],
  mainProgram: "Main",
  view: { azimuth: -105, elevation: 24 },
  async build(b: ExampleBuilder) {
    await b.shape("Cell Floor", rbox([2700, 2600, 6], 3, [80, 200, 0], C.light));

     
    const W = 1700;
    const D = 1300;
    const machine: Part[] = [
      rbox([W, D, 950], 24, [0, D / 2, 0], C.white),
      box([W, 40, 800], [0, D - 20, 950], C.white),
      box([40, D, 800], [-W / 2 + 20, D / 2, 950], C.white),
      box([40, D, 800], [W / 2 - 20, D / 2, 950], C.white),
      rbox([W + 20, D + 20, 40], 10, [0, D / 2, 1750], C.light),
      box([500, 40, 800], [-600, 20, 950], C.light),
      box([500, 40, 800], [600, 20, 950], C.light),
      box([700, 40, 120], [0, 20, 1630], C.light),
      box([1500, 980, 30], [0, 620, 950], C.dark),
      box([220, 160, 40], [0, 330, 980], C.steel),
      box([40, 160, 50], [-72, 330, 1020], C.accent),
      box([40, 160, 50], [72, 330, 1020], C.accent),
      rbox([300, 300, 260], 16, [0, 900, 1490], C.frame),
      cyl(70, 160, [0, 900, 1330], C.steel),
      cyl(14, 90, [0, 900, 1240], C.dark),
       
      rbox([260, 70, 460], 14, [990, 40, 1100], C.dark),
      rbox([200, 12, 150], 4, [990, 0, 1380], C.accent),
      cyl(14, 12, [945, 4, 1200, 90, 0, 0], C.good),
      cyl(14, 12, [990, 4, 1200, 90, 0, 0], C.amber),
      cyl(14, 12, [1035, 4, 1200, 90, 0, 0], C.bad),
      box([1500, 50, 30], [350, -30, 1640], C.steel),
    ];
    await b.assembly("Machining Centre", machine, [0, 0, 0]);

     
    const rail = await b.shape("Door Rail", box([1500, 30, 20], [350, -60, 1660], C.steel));
    const door = await b.assembly("Door Panel", [box([720, 24, 700], [0, -44, 945], C.light), box([420, 8, 300], [0, -58, 1240], C.glass), cyl(10, 160, [280, -70, 1100], C.accent)]);
    const { robot: doorAxis } = await b.linearAxis("Machine Door", rail, -10, 760, door);

     
    await b.assembly("Robot Pedestal", [rbox([480, 480, 20], 6, [0, 0, 0], C.dark), rbox([320, 320, 310], 16, [0, 0, 20], C.white), rbox([380, 380, 20], 6, [0, 0, 330], C.dark)], [0, -450, 0]);
    const home = [0, -10, -10, 0, -80, 0];
    const robot = await b.robot("Fanuc-M-10iD-12.robot", [0, -450, 350, 0, 0, 90], { home });
    const gripper = await b.tool("Generic-2-Finger-Gripper.tool", robot, { name: "Gripper" });

     
    const fixture = (x: number): Part[] => [
      rbox([420, 260, 30], 6, [0, 0, TABLE_Z - 50], C.light),
      ...[-170, 170].flatMap((dx) => [-90, 90].map((dy) => box([40, 40, TABLE_Z - 50], [dx, dy, 0], C.steel))),
      rbox([380, 160, 20], 6, [0, 0, TABLE_Z - 20], x < 0 ? C.frame : C.white),
      ...SLOTS.map((sx) => cyl(BLANK.r + 8, 2, [sx, 0, TABLE_Z], C.steel)),
    ];
    await b.assembly("Raw Parts Table", fixture(-1), [-560, -380, 0]);
    await b.assembly("Finished Parts Table", fixture(1), [560, -380, 0]);
    const blanks: string[] = [];
    for (const [k, x] of SLOTS.entries()) blanks.push(await b.shape(`Blank ${k + 1}`, cyl(BLANK.r, BLANK.h, [-560 + x, -380, TABLE_Z + 2], C.steel)));
    void blanks;

    const raw = await b.frame("Raw Parts", [-560, -380, TABLE_Z + 2]);
    const done = await b.frame("Finished Parts", [560, -380, TABLE_Z + 2]);
    const vise = await b.frame("Vise", [0, 330, 1020]);
    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);

     
    const pickT: [string, string][] = [];
    for (const [k, x] of SLOTS.entries()) {
      const p = down(x, 0, GRIP, 180);
      pickT.push([await b.target(`Raw ${k + 1} Approach`, raw, robot, along(p, -150), [83, -17, -37, 0, -53, 7]), await b.target(`Raw ${k + 1}`, raw, robot, p)]);
    }
    const placeT: [string, string][] = [];
    for (const [k, x] of SLOTS.entries()) {
      const p = down(x, 0, GRIP, 0);
      placeT.push([await b.target(`Finished ${k + 1} Approach`, done, robot, along(p, -150), [-83, -17, -37, 0, -53, -7]), await b.target(`Finished ${k + 1}`, done, robot, p)]);
    }
    const viseT = await b.target("Vise", vise, robot, down(0, 0, GRIP, 90), [0, -2, -22, 0, -68, 0]);
    const viseUp = await b.target("Vise Approach", vise, robot, along(down(0, 0, GRIP, 90), -150));
    const doorT = await b.target("Door Approach", vise, robot, down(0, -380, 300, 90));

     
    const doorBase = b.item(doorAxis).parent!;
    const closedT = await b.jointTarget("Door Closed", doorBase, doorAxis, [0]);
    const openT = await b.jointTarget("Door Open", doorBase, doorAxis, [740]);
    const openProg = await b.program("OpenDoor", doorAxis);
    await openProg.speed(400, 400);
    await openProg.moveJ(openT);
    await openProg.setDO("DOOR_OPEN", 1);
    const closeProg = await b.program("CloseDoor", doorAxis);
    await closeProg.speed(400, 400);
    await closeProg.setDO("DOOR_OPEN", 0);
    await closeProg.moveJ(closedT);

     
    const cycle = await b.program("MachineCycle", doorAxis);
    await cycle.setDO("SPINDLE_ON", 1);
    await cycle.message("Machining…");
    await cycle.pause(4000);
    await cycle.setDO("SPINDLE_ON", 0);
    await cycle.setDO("CYCLE_DONE", 1);

    const load = await b.program("LoadMachine", robot);
    await load.setFrame(vise);
    await load.setTool(gripper);
    await load.moveJ(doorT);
    await load.moveL(viseUp);
    await load.speed(200);
    await load.moveL(viseT);
    await load.setDO("GRIPPER", 0);
    await load.pause(300);
    await load.detach(gripper, vise);
    await load.moveL(viseUp);
    await load.speed(1000);
    await load.moveL(doorT);

    const unload = await b.program("UnloadMachine", robot);
    await unload.setFrame(vise);
    await unload.setTool(gripper);
    await unload.moveJ(doorT);
    await unload.moveL(viseUp);
    await unload.speed(200);
    await unload.moveL(viseT);
    await unload.setDO("GRIPPER", 1);
    await unload.pause(300);
    await unload.attach(gripper);
    await unload.moveL(viseUp);
    await unload.speed(1000);
    await unload.moveL(doorT);

    for (let k = 0; k < SLOTS.length; k++) {
      const pick = await b.program(`Pick${k + 1}`, robot);
      await pick.setFrame(raw);
      await pick.setTool(gripper);
      await pick.moveJ(pickT[k][0]);
      await pick.moveL(pickT[k][1]);
      await pick.setDO("GRIPPER", 1);
      await pick.pause(300);
      await pick.attach(gripper);
      await pick.moveL(pickT[k][0]);
      const place = await b.program(`Place${k + 1}`, robot);
      await place.setFrame(done);
      await place.setTool(gripper);
      await place.moveJ(placeT[k][0]);
      await place.moveL(placeT[k][1]);
      await place.setDO("GRIPPER", 0);
      await place.pause(300);
      await place.detach(gripper, done);
      await place.moveL(placeT[k][0]);
    }

    const main = await b.program("Main", robot);
    await main.comment("Reset: door closed, blanks back on the input table, outputs off");
    await main.home([doorAxis]);
    await main.resetObjects();
    for (const io of ["GRIPPER", "DOOR_OPEN", "SPINDLE_ON", "CYCLE_DONE"]) await main.setDO(io, 0);
    await main.setTool(gripper);
    await main.speed(1000, 120);
    await main.moveJ(homeT);
    for (let k = 0; k < SLOTS.length; k++) {
      await main.call(`Pick${k + 1}`);
      await main.call("OpenDoor");
      await main.call("LoadMachine");
      await main.moveJ(homeT);
      await main.call("CloseDoor");
      await main.setDO("CYCLE_DONE", 0);
      await main.call("MachineCycle");
      await main.waitDI("CYCLE_DONE", 1);
      await main.call("OpenDoor");
      await main.call("UnloadMachine");
      await main.call(`Place${k + 1}`);
    }
    await main.call("CloseDoor");
    await main.moveJ(homeT);
    await main.message("All parts machined");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>CNC Machine Tending</b> — run <b>Main</b>.</p><p>For each blank Main calls <b>Pick1…3</b>, opens the door (<b>OpenDoor</b>, a program of the door mechanism), loads the vise (<b>LoadMachine</b>), closes the door and runs <b>MachineCycle</b>, which switches the spindle and sets <b>CYCLE_DONE</b>. Then it opens the door again, unloads the part and puts it on the output table.</p>",
    );
  },
};

export default spec;
