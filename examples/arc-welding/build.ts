// Builds a welding cell with curve-follow seams, circular welds, and arc-control programs.
 
 

import { along, box, C, rbox, tube, type ExampleBuilder, type Part } from "../lib/builder";
import { mul, rotx, rotz, DEG, transl } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 800;
const TABLE: [number, number] = [820, 0];
 
const PLATE: [number, number, number] = [420, 260, 12];
const WEB: [number, number, number] = [420, 12, 150];
const T_AT: [number, number] = [-180, -150];
const FLANGE_AT: [number, number] = [180, 170];
const PIPE = { r: 60, h: 130 };

const spec: ExampleSpec = {
  name: "Arc Welding",
  description:
    "A Motoman AR1440 with a 45° torch welds a T-joint and a pipe flange on a welding table. The fillet seams are a welding project that follows the seam curves and calls ArcOn / ArcOff at the start and end of every seam; the round seam around the pipe is two circular moves.",
  features: ["Welding project (curve follow)", "MoveC", "MoveJ", "MoveL", "Program events", "Program calls", "Digital I/O"],
  mainProgram: "Main",
  view: { azimuth: -140, elevation: 28 },
  async build(b: ExampleBuilder) {
    await b.shape("Cell Floor", rbox([2500, 2000, 6], 3, [450, 0, 0], C.light));

     
    const table: Part[] = [];
    for (let y = -360; y <= 360; y += 120) table.push(box([1300, 100, 40], [0, y, TABLE_Z - 40], C.base));
    for (const x of [-560, 560]) for (const y of [-330, 330]) table.push(box([80, 80, TABLE_Z - 40], [x, y, 0], C.steel));
    for (const y of [-330, 330]) table.push(box([1120, 50, 50], [0, y, 180], C.steel));
    table.push(rbox([1340, 840, 20], 6, [0, 0, TABLE_Z - 60], C.dark));
    await b.assembly("Welding Table", table, [TABLE[0], TABLE[1], 0]);

     
    const tx = TABLE[0] + T_AT[0];
    const ty = TABLE[1] + T_AT[1];
    const tjoint = await b.assembly("T-Joint", [box(PLATE, [0, 0, 0], C.steel), box(WEB, [0, 0, PLATE[2]], C.frame)], [tx, ty, TABLE_Z]);
    const fx = TABLE[0] + FLANGE_AT[0];
    const fy = TABLE[1] + FLANGE_AT[1];
    await b.assembly("Pipe Flange", [rbox([240, 240, 14], 6, [0, 0, 0], C.steel), tube(PIPE.r, PIPE.r - 6, PIPE.h, [0, 0, 14], C.frame)], [fx, fy, TABLE_Z]);
     
    for (const [x, y] of [
      [tx - 230, ty - 80],
      [tx + 230, ty + 80],
      [fx - 150, fy],
    ])
      await b.assembly("Clamp", [box([60, 40, 50], [0, 0, 0], C.accent), box([90, 30, 14], [10, 0, 50], C.accent)], [x, y, TABLE_Z]);

     
    const half = PLATE[0] / 2 - 20;
    for (const side of [-1, 1]) {
      const pts: number[][] = [];
      for (let x = -half; x <= half + 1e-9; x += 20) pts.push([tx + x, ty + side * (WEB[1] / 2), TABLE_Z + PLATE[2], 0, side * Math.SQRT1_2, Math.SQRT1_2]);
      await b.cmd("object.addCurve", { object: tjoint, points: pts, addToRef: true, projection: 0, name: side < 0 ? "Seam A" : "Seam B" });
    }

     
    const home = [0, 10, -20, 0, -60, 0];
    const robot = await b.robot("Yaskawa-Motoman-AR1440.robot", [0, 0, 0], { home });
    const torch = await b.tool("Abicor-Binzel-45deg-Welding-Gun.tool", robot, { name: "Torch" });
    const tableFrame = await b.frame("Welding Table", [TABLE[0], TABLE[1], TABLE_Z]);
    const flangeFrame = await b.frame("Flange", [fx, fy, TABLE_Z + 14]);

     
    const arcOn = await b.program("ArcOn", robot);
    await arcOn.setDO("ARC_ON", 1);
    await arcOn.pause(300);
    const arcOff = await b.program("ArcOff", robot);
    await arcOff.setDO("ARC_ON", 0);
    await arcOff.pause(200);

    await b.cmd("robot.setJoints", { robot, joints: [-10, 30, -10, 0, -70, 0] });
    const project = await b.cmd<{ id: string; ok: boolean; message: string; program: string }>("machining.add", { kind: "weld", name: "FilletWelds settings", robot, object: tjoint });
    const params = await b.cmd<{ ok?: boolean; message?: string; program?: string }>("machining.setParams", {
      project: project.id,
      frame: tableFrame,
      tool: torch,
      approach: "Normal 50",
      retract: "Normal 60",
      machining: { SpeedOperation: 25, SpeedRapid: 400, RotZ_Range: 180, RotZ_Step: 10 },
      progEvents: { CallPathStart: "ArcOn", CallPathStartOn: 1, CallPathFinish: "ArcOff", CallPathFinishOn: 1 },
      update: true,
    });
    const upd = await b.cmd<{ ok: boolean; message: string; ratio: number }>("machining.update", { project: project.id });
    if (!upd.ok) throw new Error(`Welding project: ${upd.message} (${upd.ratio}) ${JSON.stringify(params).slice(0, 300)}`);

     
    const R = PIPE.r + 4;
    const seed = [10, 35, -10, 0, -65, 0];
     
    const turn = b.bestTurn(robot, flangeFrame, (deg) => mul(mul(transl(R, 0, 82), rotz(deg * DEG)), rotx(Math.PI)), seed);
    if (!turn) throw new Error("The flange seam is out of reach");
    const at = (deg: number, z = 2) => mul(mul(transl(R * Math.cos(deg * DEG), R * Math.sin(deg * DEG), z), rotz(turn.deg * DEG)), rotx(Math.PI));
    const start = await b.target("Flange Start", flangeFrame, robot, at(0), seed);
    const up = await b.target("Flange Approach", flangeFrame, robot, along(at(0), -80));
    const via1 = await b.target("Flange Via 1", flangeFrame, robot, at(90), seed);
    const mid = await b.target("Flange Mid", flangeFrame, robot, at(180), seed);
    const via2 = await b.target("Flange Via 2", flangeFrame, robot, at(270), seed);
    const end = await b.target("Flange End", flangeFrame, robot, at(359), seed);
    const flange = await b.program("WeldFlange", robot);
    await flange.setFrame(flangeFrame);
    await flange.setTool(torch);
    await flange.speed(400);
    await flange.moveJ(up);
    await flange.moveL(start);
    await flange.call("ArcOn");
    await flange.speed(25);
    await flange.moveC(via1, mid);
    await flange.moveC(via2, end);
    await flange.call("ArcOff");
    await flange.speed(400);
    await flange.moveL(up);

    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const main = await b.program("Main", robot);
    await main.setTool(torch);
    await main.setDO("ARC_ON", 0);
    await main.speed(400, 90);
    await main.moveJ(homeT);
    await main.call("FilletWelds");
    await main.moveJ(homeT);
    await main.call("WeldFlange");
    await main.moveJ(homeT);
    await main.message("Welding done: 2 fillet seams and the flange");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Arc Welding</b> — run <b>Main</b>.</p><p><b>FilletWelds settings</b> is a welding project: it follows the two seam curves of the T-joint and writes the program <b>FilletWelds</b>; its program events call <b>ArcOn</b> and <b>ArcOff</b> at the start and end of every seam. <b>WeldFlange</b> welds around the pipe with two circular moves (MoveC).</p>",
    );
  },
};

export default spec;
