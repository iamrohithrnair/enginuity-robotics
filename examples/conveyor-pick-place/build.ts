// Builds a conveyor-fed pick-and-place cell with threaded indexing and I/O handshakes.
 
 

import { along, box, C, cyl, down, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const BELT_Z = 760;
const PART: [number, number, number] = [60, 60, 40];
 
const CONV_X = -500;
const CONV_Y = -500;
const LENGTH = 1600;
const PITCH = 160;
const FIRST = -400;

const spec: ExampleSpec = {
  name: "Conveyor Pick and Place",
  description:
    "A UR5e with a two-finger gripper picks parts at the end of a belt conveyor and places them into a three-pocket tray. The conveyor is a one-axis mechanism with its own program running as a thread; a PART_AT_STOP signal hands each part over between the two programs.",
  features: ["MoveJ", "MoveL", "Program calls", "Threads", "Digital I/O handshake", "Attach / detach events", "Conveyor mechanism"],
  mainProgram: "Main",
  view: { azimuth: 50, elevation: 28 },
  async build(b: ExampleBuilder) {
    await b.shape("Cell Floor", rbox([2700, 1500, 6], 3, [-300, -280, 0], C.light));

     
    await b.assembly("Robot Pedestal", [rbox([420, 420, 20], 6, [0, 0, 0], C.dark), rbox([240, 240, 680], 16, [0, 0, 20], C.white), rbox([300, 300, 20], 6, [0, 0, 700], C.dark)]);
    const home = [-50, -90, -90, -90, 90, 0];
    const robot = await b.robot("UR5e.robot", [0, 0, 720], { home });
    const gripper = await b.tool("RobotiQ-2F-85-Gripper-Open.tool", robot, { name: "Gripper" });

     
    const half = LENGTH / 2;
    const stop = -CONV_X;  
    const conveyorParts: Part[] = [
      box([LENGTH, 260, 18], [0, 0, BELT_Z - 18], C.belt),
      rbox([LENGTH + 40, 28, 70], 4, [0, 144, BELT_Z - 45], C.frame),
      rbox([LENGTH + 40, 28, 70], 4, [0, -144, BELT_Z - 45], C.frame),
      cyl(32, 288, [half, 144, BELT_Z - 36, 90, 0, 0], C.steel),
      cyl(32, 288, [-half, 144, BELT_Z - 36, 90, 0, 0], C.steel),
       
      rbox([22, 230, 46], 4, [stop + PART[0] / 2 + 12, 0, BELT_Z], C.accent),
      rbox([26, 18, 36], 4, [stop - 8, -165, BELT_Z + 22], C.dark),
      cyl(5, 8, [stop - 8, -156, BELT_Z + 40, 90, 0, 0], C.amber),
    ];
    for (const x of [-half + 90, half - 90])
      for (const y of [-120, 120]) {
        conveyorParts.push(box([50, 50, BELT_Z - 70], [x, y, 0], C.steel));
        conveyorParts.push(rbox([90, 90, 10], 3, [x, y, 0], C.dark));
      }
    for (const y of [-120, 120]) conveyorParts.push(box([LENGTH - 180, 30, 30], [0, y, 240], C.steel));
    const body = await b.assembly("Conveyor Body", conveyorParts, [CONV_X, CONV_Y, 0]);
    const { robot: conveyor, carrier } = await b.linearAxis("Conveyor", body, -10, 1200);

     
    const parts: string[] = [];
    for (let k = 0; k < 3; k++) parts.push(await b.shape(`Part ${k + 1}`, rbox(PART, 6, [FIRST - k * PITCH, CONV_Y, BELT_Z], C.accent)));
    await b.carry(parts, carrier);

     
    const TRAY_X = 520;
    const TRAY_Y = -170;
    const slots = [-125, 0, 125];
    await b.assembly(
      "Tray Table",
      [
        rbox([460, 300, 30], 6, [0, 0, 710], C.light),
        ...[-190, 190].flatMap((x) => [-120, 120].map((y) => box([40, 40, 710], [x, y, 0], C.steel))),
        rbox([400, 160, 20], 8, [0, 0, 740], C.white),
        ...slots.map((x) => rbox([74, 74, 2], 2, [x, 0, 760], C.steel)),
      ],
      [TRAY_X, TRAY_Y, 0],
    );

     
    const pickFrame = await b.frame("Conveyor Pick", [0, CONV_Y, BELT_Z]);
    const trayFrame = await b.frame("Tray", [TRAY_X, TRAY_Y, 762]);
    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const grip = PART[2] / 2;
     
    const pick = await b.target("Pick", pickFrame, robot, down(0, 0, grip, 180), home);
    const pickUp = await b.target("Pick Approach", pickFrame, robot, along(down(0, 0, grip, 180), -120));
    const slotT: [string, string][] = [];
    for (const [k, x] of slots.entries()) {
      const p = down(x, 0, grip, -100);
      slotT.push([await b.target(`Slot ${k + 1} Approach`, trayFrame, robot, along(p, -120), home), await b.target(`Slot ${k + 1}`, trayFrame, robot, p)]);
    }

     
    const convBase = b.item(conveyor).parent!;
    const index = [];
    for (let k = 0; k < 3; k++) index.push(await b.jointTarget(`Index ${k + 1}`, convBase, conveyor, [-FIRST + k * PITCH]));

    const conv = await b.program("ConveyorIndex", conveyor);
    await conv.speed(250, 250);
    for (let k = 0; k < 3; k++) {
      await conv.moveJ(index[k]);
      await conv.setDO("PART_AT_STOP", 1);
      if (k < 2) await conv.waitDI("PART_AT_STOP", 0);
    }

    const pickProg = await b.program("PickPart", robot);
    await pickProg.setFrame(pickFrame);
    await pickProg.setTool(gripper);
    await pickProg.waitDI("PART_AT_STOP", 1);
    await pickProg.moveJ(pickUp);
    await pickProg.moveL(pick);
    await pickProg.setDO("GRIPPER", 1);
    await pickProg.pause(250);
    await pickProg.attach(gripper);
    await pickProg.moveL(pickUp);
    await pickProg.setDO("PART_AT_STOP", 0);

    for (const [k, [up, at]] of slotT.entries()) {
      const place = await b.program(`PlaceSlot${k + 1}`, robot);
      await place.setFrame(trayFrame);
      await place.setTool(gripper);
      await place.moveJ(up);
      await place.moveL(at);
      await place.setDO("GRIPPER", 0);
      await place.pause(200);
      await place.detach(gripper, trayFrame);
      await place.moveL(up);
    }

    const main = await b.program("Main", robot);
    await main.comment("Reset the cell: conveyor home, parts back on the belt, signals off");
    await main.home([conveyor]);
    await main.resetObjects();
    await main.setDO("GRIPPER", 0);
    await main.setDO("PART_AT_STOP", 0);
    await main.thread("ConveyorIndex");
    await main.setTool(gripper);
    await main.speed(600, 120);
    await main.moveJ(homeT);
    for (let k = 0; k < 3; k++) {
      await main.call("PickPart");
      await main.call(`PlaceSlot${k + 1}`);
    }
    await main.moveJ(homeT);
    await main.message("Tray complete: 3 parts placed");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Conveyor Pick and Place</b> — run <b>Main</b>.</p><p>Main resets the cell, starts the <b>ConveyorIndex</b> program as a thread and calls <b>PickPart</b> and <b>PlaceSlot1…3</b>. The conveyor indexes the next part to the stop and sets <b>PART_AT_STOP</b>; PickPart waits for it, grips the part (simulation event: attach) and clears the signal so the conveyor moves on.</p>",
    );
  },
};

export default spec;
