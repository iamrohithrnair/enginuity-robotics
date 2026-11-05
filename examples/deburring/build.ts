// Builds a curve-follow deburring cell with spindle-control program events.
 
 

import { box, C, cyl, rbox, extrusion, type ExampleBuilder, type Part } from "../lib/builder";
import { roundedRectProfile } from "@/engine/shapes";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 720;
const AT: [number, number] = [500, 0];
const PLATE = { w: 260, d: 180, r: 30, t: 20 };
const FIXTURE_H = 40;
const BOSS = { r: 45, h: 15 };

 
function edgeRows(pts: number[][], z: number, ox: number, oy: number): number[][] {
  const n = pts.length;
  return [...pts, pts[0]].map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    const nx = ty / l;
    const ny = -tx / l;
    return [ox + p[0], oy + p[1], z, nx * 0.5, ny * 0.5, Math.sqrt(3) / 2];
  });
}

const spec: ExampleSpec = {
  name: "Deburring",
  description:
    "An ABB IRB 1200 with an electric deburring tool runs along the top edges of a machined plate: its rounded outline and the edge of a round boss. A curve-follow project makes the path from the two edge curves, and its program events switch the spindle on and off.",
  features: ["Curve follow project", "Program events", "MoveJ", "MoveL", "Program calls", "Digital I/O"],
  mainProgram: "Main",
  view: { azimuth: -130, elevation: 30, zoom: 1.2 },
  async build(b: ExampleBuilder) {
    await b.shape("Cell Floor", rbox([1800, 1400, 6], 3, [250, 0, 0], C.light));
    await b.assembly("Robot Pedestal", [rbox([420, 420, 20], 6, [0, 0, 0], C.dark), rbox([260, 260, 460], 16, [0, 0, 20], C.white), rbox([320, 320, 20], 6, [0, 0, 480], C.dark)]);
    const home = [0, -10, 20, 0, 80, 0];
    const robot = await b.robot("ABB-IRB-1200-5-0-9.robot", [0, 0, 500], { home });
    const tool = await b.tool("ATI-RCE-230-Deburring-Tool-Electric.tool", robot, { name: "Deburring Tool" });

     
    const table: Part[] = [rbox([700, 560, 30], 6, [0, 0, TABLE_Z - 30], C.light)];
    for (const x of [-300, 300]) for (const y of [-230, 230]) table.push(box([50, 50, TABLE_Z - 30], [x, y, 0], C.steel));
    table.push(rbox([340, 260, FIXTURE_H], 6, [0, 0, TABLE_Z], C.base));
    for (const [x, y] of [
      [-PLATE.w / 2 - 8, -40],
      [-PLATE.w / 2 - 8, 40],
      [0, -PLATE.d / 2 - 8],
    ])
      table.push(cyl(6, 26, [x, y, TABLE_Z + FIXTURE_H], C.steel));
    for (const x of [-90, 90]) table.push(box([40, 30, 34], [x, PLATE.d / 2 + 22, TABLE_Z + FIXTURE_H], C.accent), box([30, 60, 10], [x, PLATE.d / 2 + 2, TABLE_Z + FIXTURE_H + 24], C.accent));
    await b.assembly("Fixture Table", table, [AT[0], AT[1], 0]);

     
    const top = TABLE_Z + FIXTURE_H;
    const outline = roundedRectProfile(PLATE.w, PLATE.d, PLATE.r, 8);
    const plate = await b.assembly("Plate", [extrusion(outline, PLATE.t, [0, 0, 0], C.frame), cyl(BOSS.r, BOSS.h, [0, 0, PLATE.t], C.frame)], [AT[0], AT[1], top]);
     
    await b.cmd("object.addCurve", { object: plate, points: edgeRows(outline, top + PLATE.t, AT[0], AT[1]), addToRef: true, projection: 0, name: "Outline edge" });
    const circle: number[][] = [];
    for (let k = 0; k < 36; k++) circle.push([BOSS.r * Math.cos((k * Math.PI) / 18), BOSS.r * Math.sin((k * Math.PI) / 18)]);
    await b.cmd("object.addCurve", { object: plate, points: edgeRows(circle, top + PLATE.t + BOSS.h, AT[0], AT[1]), addToRef: true, projection: 0, name: "Boss edge" });

    const frame = await b.frame("Fixture", [AT[0], AT[1], top]);
    const spindleOn = await b.program("SpindleOn", robot);
    await spindleOn.setDO("SPINDLE_ON", 1);
    await spindleOn.pause(500);
    const spindleOff = await b.program("SpindleOff", robot);
    await spindleOff.setDO("SPINDLE_ON", 0);

    await b.cmd("robot.setJoints", { robot, joints: [0, 20, 10, 0, 60, 0] });
    const project = await b.cmd<{ id: string }>("machining.add", { kind: "curve", name: "DeburrEdges settings", robot, object: plate });
    await b.cmd("machining.setParams", {
      project: project.id,
      frame,
      tool,
      approach: "Normal 40",
      retract: "Normal 40",
      machining: { SpeedOperation: 40, SpeedRapid: 500, RotZ_Range: 180, RotZ_Step: 10, ApproachRetractAll: 1 },
      progEvents: { CallProgStart: "SpindleOn", CallProgStartOn: 1, CallProgFinish: "SpindleOff", CallProgFinishOn: 1 },
      update: true,
    });
    const upd = await b.cmd<{ ok: boolean; message: string; ratio: number }>("machining.update", { project: project.id });
    if (!upd.ok) throw new Error(`Deburring project: ${upd.message} (${upd.ratio})`);

    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const main = await b.program("Main", robot);
    await main.setTool(tool);
    await main.setDO("SPINDLE_ON", 0);
    await main.speed(500, 120);
    await main.moveJ(homeT);
    await main.call("DeburrEdges");
    await main.moveJ(homeT);
    await main.message("Plate deburred");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Deburring</b> — run <b>Main</b>.</p><p><b>DeburrEdges settings</b> is a curve-follow project on the plate's two edge curves (outline and boss). It writes the program <b>DeburrEdges</b>, whose program events call <b>SpindleOn</b> at the start and <b>SpindleOff</b> at the end. Change the speed or the tool angle in the project and update it (Ctrl+U).</p>",
    );
  },
};

export default spec;
