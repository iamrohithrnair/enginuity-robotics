// Builds a physics-enabled cell that drops, stacks, and pushes gripped parts.
 
 
 

import { box, C, cyl, down, extrusion, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import { poseToXYZRPW } from "@/engine/math";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 750;
const TABLE: [number, number] = [800, 0];
const BOX = 60;
 
const GRID: [number, number][] = [
  [350, -140],
  [450, -140],
  [550, -140],
  [350, -240],
  [450, -240],
  [550, -240],
  [350, -340],
  [450, -340],
  [550, -340],
];
const STACK: [number, number] = [500, 220];
const CYL_A: [number, number] = [330, 60];
const CYL_B: [number, number] = [600, 300];
 
const BIN = { x: 550, y: -750, size: 360, h: 360, wall: 16, floor: 30 };
const DROPS: [number, number][] = [
  [480, -690],
  [560, -690],
  [480, -750],
  [560, -750],
];
const RELEASE_ABOVE = 150;

 
function chute(): { profile: number[][]; length: number; xyzrpw: number[] } {
  const a = { y: TABLE[1] - 405, z: TABLE_Z - 15 };
  const b = { y: BIN.y + BIN.size / 2 - BIN.wall / 2, z: BIN.h + 1 };
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = Math.hypot(dy, dz);
  const dir = [0, dy / length, dz / length];
   
  const n = [0, -dir[2], dir[1]];
  if (n[2] < 0) n.splice(0, 3, 0, dir[2], -dir[1]);
  const pose = [1, n[0], dir[0], 550, 0, n[1], dir[1], a.y, 0, n[2], dir[2], a.z, 0, 0, 0, 1];
   
  const profile = [
    [-110, 0],
    [110, 0],
    [110, 40],
    [100, 40],
    [100, 10],
    [-100, 10],
    [-100, 40],
    [-110, 40],
  ];
  return { profile, length, xyzrpw: poseToXYZRPW(pose) };
}

const spec: ExampleSpec = {
  name: "Physics: Drop, Stack and Push",
  description:
    "A UR5e drops a grid of boxes into a bin, slides the last box off the table down a chute and knocks over a stack. Switch physics on (top-bar Physics toggle) and the parts fall, pile up, bounce, slide and topple; with physics off they stay where the robot lets them go.",
  features: ["Physics", "Object physics settings", "Attach / detach events", "MoveJ", "MoveL", "Program calls", "Digital I/O"],
  mainProgram: "Main",
  view: { azimuth: -55, elevation: 34 },
  async build(b: ExampleBuilder) {
     
    await b.assembly("Robot Pedestal", [rbox([420, 420, 20], 6, [0, 0, 0], C.dark), rbox([260, 260, 680], 16, [0, 0, 20], C.white), rbox([320, 320, 20], 6, [0, 0, 700], C.dark)], [0, -250, 0]);
    const table: Part[] = [rbox([1200, 800, 40], 8, [0, 0, TABLE_Z - 40], C.light)];
    for (const x of [-560, 560]) for (const y of [-360, 360]) table.push(box([50, 50, TABLE_Z - 40], [x, y, 0], C.steel));
    for (const y of [-360, 360]) table.push(box([1070, 30, 30], [0, y, 180], C.steel));
    const tableId = await b.assembly("Table", table, [TABLE[0], TABLE[1], 0]);
    const s = BIN.size;
    const w = BIN.wall;
    const bin = await b.assembly(
      "Bin",
      [
        box([s, s, BIN.floor], [0, 0, 0], C.base),
        box([s, w, BIN.h - BIN.floor], [0, -s / 2 + w / 2, BIN.floor], C.accent),
        box([s, w, BIN.h - BIN.floor], [0, s / 2 - w / 2, BIN.floor], C.accent),
        box([w, s - 2 * w, BIN.h - BIN.floor], [-s / 2 + w / 2, 0, BIN.floor], C.accent),
        box([w, s - 2 * w, BIN.h - BIN.floor], [s / 2 - w / 2, 0, BIN.floor], C.accent),
      ],
      [BIN.x, BIN.y, 0],
    );
     
    const c = chute();
    const lipY = BIN.y + BIN.size / 2 - BIN.wall / 2;
    const chuteId = await b.assembly("Chute", [extrusion(c.profile, c.length, c.xyzrpw as [number, number, number, number, number, number], C.steel), box([220, 44, 6], [550, lipY, BIN.h + 1], C.steel)]);

     
    const home = [0, -90, -90, -90, 90, 0];
    const robot = await b.robot("UR5e.robot", [0, -250, 720], { home });
    const gripper = await b.tool("RobotiQ-2F-85-Gripper-Open.tool", robot, { name: "Gripper" });

     
    const parts: string[] = [];
     
    for (const [k, [x, y]] of GRID.entries()) parts.push(await b.shape(`Part ${k + 1}`, box([BOX, BOX, BOX], [x, y, TABLE_Z], C.accent)));
    for (let k = 0; k < 3; k++) await b.shape(`Stack ${k + 1}`, box([BOX, BOX, BOX], [STACK[0], STACK[1], TABLE_Z + k * BOX], k === 1 ? C.white : C.frame));
    const cylA = await b.shape("Bouncy Cylinder", cyl(30, 80, [CYL_A[0], CYL_A[1], TABLE_Z], C.amber));
    await b.shape("Cylinder", cyl(30, 120, [CYL_B[0], CYL_B[1], TABLE_Z], C.frame));

     
     
    await b.cmd("object.setPhysics", { items: [cylA], body: "dynamic", mass: 2, restitution: 0.4 });
    await b.cmd("object.setPhysics", { items: [chuteId], body: "static", friction: 0.15 });
    void tableId;
    void bin;

     
    const cell = await b.frame("Cell", [0, 0, 0]);
    const tableFrame = await b.frame("Table Top", [0, 0, TABLE_Z]);
    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
     
    const grip = BOX / 2;
    const HIGH = 250;
    const pickT: [string, string][] = [];
    for (const [k, [x, y]] of GRID.slice(0, 8).entries()) {
      const p = down(x, y, grip, -90);
      pickT.push([await b.target(`Part ${k + 1} Above`, tableFrame, robot, down(x, y, HIGH, -90), home), await b.target(`Part ${k + 1} Pick`, tableFrame, robot, p)]);
    }
    const cylPick = down(CYL_A[0], CYL_A[1], 40, -90);
    const cylT: [string, string] = [await b.target("Cylinder Above", tableFrame, robot, down(CYL_A[0], CYL_A[1], HIGH, -90), home), await b.target("Cylinder Pick", tableFrame, robot, cylPick)];
     
    const drops: [string, string][] = [];
    const binSeed = [-40, -90, -90, -90, 90, 0];
    for (const [k, [x, y]] of DROPS.entries()) {
      drops.push([await b.target(`Drop ${k + 1} High`, cell, robot, down(x, y, TABLE_Z + HIGH, -130), binSeed), await b.target(`Drop ${k + 1}`, cell, robot, down(x, y, BIN.h + RELEASE_ABOVE + grip, -130))]);
    }
    const cylDrop: [string, string] = [await b.target("Drop Cylinder High", cell, robot, down(520, -720, TABLE_Z + HIGH, -130), binSeed), await b.target("Drop Cylinder", cell, robot, down(520, -720, BIN.h + RELEASE_ABOVE + 40, -130))];
     
    const [lx, ly] = GRID[8];
    const pushAbove = await b.target("Push Above", tableFrame, robot, down(lx, ly + 90, 150, -90), home);
    const pushStart = await b.target("Push Start", tableFrame, robot, down(lx, ly + 90, 25, -90));
    const pushEnd = await b.target("Push End", tableFrame, robot, down(lx, ly - 130, 25, -90));
    const pushLift = await b.target("Push Lift", tableFrame, robot, down(lx, ly - 130, 150, -90));
     
    const stackAbove = await b.target("Stack Above", tableFrame, robot, down(STACK[0], STACK[1] + 120, 260, -40), [50, -90, -90, -90, 90, 0]);
    const stackBefore = await b.target("Stack Before", tableFrame, robot, down(STACK[0], STACK[1] + 120, 90, -40));
    const stackAfter = await b.target("Stack After", tableFrame, robot, down(STACK[0], STACK[1] - 110, 90, -40));
    const stackLift = await b.target("Stack Lift", tableFrame, robot, down(STACK[0], STACK[1] - 110, 260, -40));

     
    const gripProg = await b.program("Grip", robot);
    await gripProg.setDO("GRIPPER", 1);
    await gripProg.pause(200);
    await gripProg.attach(gripper);
    const release = await b.program("Release", robot);
    await release.setDO("GRIPPER", 0);
    await release.detach(gripper, cell);
    await release.pause(300);

    const push = await b.program("PushOff", robot);
    await push.setFrame(tableFrame);
    await push.moveJ(pushAbove);
    await push.moveL(pushStart);
    await push.speed(150);
    await push.moveL(pushEnd);
    await push.speed(800);
    await push.moveL(pushLift);

    const knock = await b.program("KnockStack", robot);
    await knock.setFrame(tableFrame);
    await knock.moveJ(stackAbove);
    await knock.moveL(stackBefore);
    await knock.speed(150);
    await knock.moveL(stackAfter);
    await knock.speed(800);
    await knock.moveL(stackLift);

    const main = await b.program("Main", robot);
    await main.comment("Physics is off by default: switch it on (top-bar Physics) to see the parts fall, pile up and topple");
    await main.resetObjects();
    await main.setDO("GRIPPER", 0);
    await main.setTool(gripper);
    await main.speed(800, 150);
    await main.moveJ(homeT);
    const dropAt = async (above: string, at: string, [high, drop]: [string, string]) => {
      await main.setFrame(tableFrame);
      await main.moveL(above);
      await main.moveL(at);
      await main.call("Grip");
      await main.moveL(above);
      await main.setFrame(cell);
      await main.moveL(high);
      await main.moveL(drop);
      await main.call("Release");
      await main.moveL(high);
    };
     
    await dropAt(cylT[0], cylT[1], cylDrop);
    for (const [k, [above, at]] of pickT.entries()) await dropAt(above, at, drops[k % drops.length]);
    await main.call("PushOff");
    await main.call("KnockStack");
    await main.moveJ(homeT);
    await main.message("Done: 8 parts dropped, the last one pushed down the chute, the stack knocked over");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Physics: Drop, Stack and Push</b> — physics is <b>off</b> by default. Switch it on with the <b>Physics</b> toggle in the top bar (or the command <code>physics.enable</code>), then run <b>Main</b>.</p><p>The robot drops eight boxes and a bouncy cylinder into the bin from 150 mm above it, pushes the last box off the table down the chute (<b>PushOff</b>, a plain linear move through the box) and drives through the stack of three (<b>KnockStack</b>). With physics on the parts fall, pile up, bounce, slide and topple; with physics off they stay where the robot let them go.</p><p>Physics settings (object properties): the bouncy cylinder is Dynamic, 2 kg, bounciness 0.4; the chute is Static. Table, pedestal and bin are Auto and come out Static because they carry the robot or other parts.</p>",
    );
  },
};

export default spec;
