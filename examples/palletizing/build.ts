 
 
 
 

import { box, C, cyl, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const BELT_Z = 700;
const BOX: [number, number, number] = [300, 200, 150];
const CONV_X = -550;
const CONV_Y = 1100;
const LENGTH = 2900;
const STOP_X = 700;
const FIRST_GAP = 350;
const PITCH = 310;
const COUNT = 8;
const PALLET: [number, number] = [950, -900];

 
export const PATTERN_SCRIPT = `// Pallet pattern: ${COUNT} boxes in 2 layers of 2 x 2, every second layer turned 90° (interlocked).
// Makes the infeed conveyor's index targets and program, the pick and place targets, and the
// programs PickBox and Palletize (main). Running it again replaces what an earlier run made.
const BOX = [${BOX.join(", ")}];      // box length (along the conveyor), width, height (mm)
const LAYERS = 2;
const PITCH = ${PITCH}, FIRST = ${FIRST_GAP};  // box spacing on the conveyor, first box to the stop
const APPROACH = 250;                // approach height above a place position (mm)

const robot = RDK.Item("KUKA KR 40 PA", ITEM_TYPE_ROBOT);
const infeed = RDK.Item("Infeed", ITEM_TYPE_ROBOT);
const tool = RDK.Item("Vacuum Gripper", ITEM_TYPE_TOOL);
const pallet = RDK.Item("Pallet", ITEM_TYPE_FRAME);
const pickFrame = RDK.Item("Infeed Pick", ITEM_TYPE_FRAME);

for (const name of ["Palletize", "PickBox", "InfeedRun"]) {
  const p = RDK.Item(name, ITEM_TYPE_PROGRAM);
  if (p.Valid()) p.Delete();
}
for (const t of RDK.ItemList(ITEM_TYPE_TARGET)) if (/^(Place|Index|Pick) /.test(t.Name()) || t.Name() === "Pick") t.Delete();

// tool pointing down, turned a about the vertical
const down = (x, y, z, a) => transl(x, y, z).mul(rotz(a * pi / 180)).mul(rotx(pi));

// infeed: index box k to the stop, tell the robot, wait until it took the box
const feed = RDK.AddProgram("InfeedRun", infeed);
feed.setSpeed(400, 400);
const n = LAYERS * 4;
for (let k = 0; k < n; k++) {
  const t = RDK.AddTarget("Index " + (k + 1), infeed.Parent(), infeed);
  t.setAsJointTarget();
  t.setJoints([FIRST + k * PITCH]);
  feed.MoveJ(t);
  feed.setDO("BOX_READY", 1);
  if (k < n - 1) feed.waitDI("BOX_READY", 0);
}

// pick at the conveyor stop
robot.setJoints([60, -90, 90, 60]);
const pick = RDK.AddTarget("Pick", pickFrame, robot, down(0, 0, BOX[2], 0));
const pickUp = RDK.AddTarget("Pick Approach", pickFrame, robot, down(0, 0, BOX[2] + APPROACH, 0));
const pickBox = RDK.AddProgram("PickBox", robot);
pickBox.setPoseFrame(pickFrame);
pickBox.setPoseTool(tool);
pickBox.waitDI("BOX_READY", 1);
pickBox.MoveJ(pickUp);
pickBox.setSpeed(600);
pickBox.MoveL(pick);
pickBox.setDO("VACUUM", 1);
call("program.addInstruction", { program: pickBox.item, kind: "event", eventAction: "attach", tool: tool.item });
pickBox.MoveL(pickUp);
pickBox.setSpeed(2000);
pickBox.setDO("BOX_READY", 0);

// main program
const main = RDK.AddProgram("Palletize", robot);
call("program.addInstruction", { program: main.item, kind: "comment", text: "Reset: infeed home, boxes back on the conveyor, outputs off" });
call("program.addInstruction", { program: main.item, kind: "event", eventAction: "home", objects: [infeed.item] });
const reset = call("program.addInstruction", { program: main.item, kind: "event", eventAction: "show", objects: [] });
call("event.recordAllObjects", { instruction: reset.id });
main.setDO("VACUUM", 0);
main.setDO("BOX_READY", 0);
main.RunInstruction("InfeedRun", INSTRUCTION_START_THREAD);
main.setPoseTool(tool);
main.setSpeed(2000, 150);
main.MoveJ([0, -90, 90, 0]);
robot.setJoints([-45, -90, 90, -45]);
let k = 0;
for (let layer = 0; layer < LAYERS; layer++) {
  const turned = layer % 2 === 1;
  const [dx, dy] = turned ? [BOX[1], BOX[0]] : [BOX[0], BOX[1]];
  for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k++;
    const x = (i * dx) / 2, y = (j * dy) / 2, z = (layer + 1) * BOX[2];
    const place = RDK.AddTarget("Place " + k, pallet, robot, down(x, y, z, turned ? 90 : 0));
    const above = RDK.AddTarget("Place " + k + " Approach", pallet, robot, down(x, y, z + APPROACH, turned ? 90 : 0));
    main.RunInstruction("PickBox", INSTRUCTION_CALL_PROGRAM);
    main.setPoseFrame(pallet);
    main.MoveJ(above);
    main.setSpeed(600);
    main.MoveL(place);
    main.setDO("VACUUM", 0);
    call("program.addInstruction", { program: main.item, kind: "event", eventAction: "detach", tool: tool.item, frame: pallet.item });
    main.MoveL(above);
    main.setSpeed(2000);
  }
}
main.MoveJ([0, -90, 90, 0]);
main.RunInstruction("Pallet complete: " + k + " boxes", INSTRUCTION_SHOW_MESSAGE);
robot.setJoints([0, -90, 90, 0]);
print("Palletize:", main.Update());`;

const spec: ExampleSpec = {
  name: "Palletizing",
  description:
    "A four-axis palletizing robot with a vacuum gripper stacks eight boxes from a roller conveyor onto a pallet in two interlocked layers. The pallet pattern, the conveyor indexing and the programs are made by an Enginuity script saved in the station: change the pattern and run it again.",
  features: ["Enginuity script", "Pallet pattern", "MoveJ", "MoveL", "Program calls", "Threads", "Digital I/O handshake", "Attach / detach events"],
  mainProgram: "Palletize",
  view: { azimuth: -140, elevation: 32 },
  async build(b: ExampleBuilder) {
    await b.shape("Cell Floor", rbox([3900, 3000, 6], 3, [-200, 50, 0], C.light));
    await b.shape("Robot Base Plate", rbox([1000, 1000, 24], 6, [0, 0, 0], C.dark));
    const home = [0, -90, 90, 0];
    const robot = await b.robot("KUKA-KR-40-PA.robot", [0, 0, 24], { home });
    await b.tool("OnRobot-VGP20-Vacuum-Gripper.tool", robot, { name: "Vacuum Gripper" });

     
    const half = LENGTH / 2;
    const stop = STOP_X - CONV_X;
    const parts: Part[] = [rbox([LENGTH, 40, 120], 4, [0, 300, BELT_Z - 110], C.frame), rbox([LENGTH, 40, 120], 4, [0, -300, BELT_Z - 110], C.frame)];
    for (let x = -half + 60; x <= half - 60; x += 100) parts.push(cyl(24, 560, [x, 280, BELT_Z - 24, 90, 0, 0], C.steel));
    for (const x of [-half + 120, -half / 3, half / 3, half - 120])
      for (const y of [-280, 280]) {
        parts.push(box([60, 60, BELT_Z - 110], [x, y, 0], C.steel));
        parts.push(rbox([100, 100, 10], 3, [x, y, 0], C.dark));
      }
    parts.push(rbox([30, 520, 70], 4, [stop + BOX[0] / 2 + 18, 0, BELT_Z], C.accent));
    parts.push(rbox([30, 24, 40], 4, [stop - 20, -330, BELT_Z + 30], C.dark));
    parts.push(cyl(6, 10, [stop - 20, -318, BELT_Z + 50, 90, 0, 0], C.amber));
    const body = await b.assembly("Infeed Body", parts, [CONV_X, CONV_Y, 0]);
    const { robot: infeed, carrier } = await b.linearAxis("Infeed", body, -10, 3000);
    const boxes: string[] = [];
    for (let k = 0; k < COUNT; k++) boxes.push(await b.shape(`Box ${k + 1}`, rbox(BOX, 8, [STOP_X - FIRST_GAP - k * PITCH, CONV_Y, BELT_Z], C.accent)));
    await b.carry(boxes, carrier);

     
    const pallet: Part[] = [];
    for (const y of [-350, 0, 350]) pallet.push(box([1200, 100, 22], [0, y, 0], C.frame));
    for (const x of [-527, 0, 527]) for (const y of [-350, 0, 350]) pallet.push(box([145, 100, 78], [x, y, 22], C.steel));
    for (const y of [-350, 0, 350]) pallet.push(box([1200, 100, 22], [0, y, 100], C.frame));
    for (const y of [-345, -230, -115, 0, 115, 230, 345]) pallet.push(box([1200, 90, 22], [0, y, 122], C.light));
    await b.assembly("Pallet Stack", pallet, [PALLET[0], PALLET[1], 0]);

    await b.frame("Infeed Pick", [STOP_X, CONV_Y, BELT_Z]);
    await b.frame("Pallet", [PALLET[0], PALLET[1], 144]);

     
    const script = await b.cmd<{ id: string }>("script.save", { name: "Pallet Pattern", code: PATTERN_SCRIPT });
    const run = await b.cmd<{ ok: boolean; error?: string; errors?: unknown; logs?: string[] }>("script.run", { item: script.id });
    if (!run.ok) throw new Error(`Pallet Pattern script failed: ${JSON.stringify(run).slice(0, 2000)}`);
    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.cmd("robot.setJoints", { robot: infeed, joints: [0] });
    await b.notes(
      "About this cell",
      "<p><b>Palletizing</b> — run <b>Palletize</b>.</p><p>The targets and programs were made by the <b>Pallet Pattern</b> script: double-click it to see the code, change the pattern (box size, layers) and run it again. Palletize starts <b>InfeedRun</b> as a thread; the conveyor indexes each box to the stop and sets <b>BOX_READY</b>, <b>PickBox</b> takes it with the vacuum gripper (simulation event: attach) and the main program sets it on the pallet.</p>",
    );
  },
};

export default spec;
