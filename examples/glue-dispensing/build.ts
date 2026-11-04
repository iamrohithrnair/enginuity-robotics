 
 

import { box, C, cyl, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 760;
const AT: [number, number] = [330, 0];
const HOUSING: [number, number, number] = [200, 130, 40];
const NEST_H = 15;

const spec: ExampleSpec = {
  name: "Glue Dispensing",
  description:
    "A compact ABB IRB 120 with a glue dispenser sets dots along the rim of a housing held in a nest. A point-follow project visits the points and calls the Dispense program at every point, which pulses the GLUE output.",
  features: ["Point follow project", "Program events", "MoveJ", "MoveL", "Program calls", "Digital I/O"],
  mainProgram: "Main",
  view: { azimuth: -60, elevation: 32, zoom: 1.15 },
  async build(b: ExampleBuilder) {
     
    const bench: Part[] = [rbox([1000, 700, 40], 8, [150, 0, TABLE_Z - 40], C.light)];
    for (const x of [-300, 600]) for (const y of [-300, 300]) bench.push(box([50, 50, TABLE_Z - 40], [x, y, 0], C.steel));
    bench.push(box([900, 30, 30], [150, -300, 160], C.steel), box([900, 30, 30], [150, 300, 160], C.steel));
    await b.assembly("Bench", bench);
    await b.shape("Robot Riser", rbox([240, 240, 20], 6, [0, 0, TABLE_Z], C.dark));
    const home = [0, 0, 0, 0, 60, 0];
    const robot = await b.robot("ABB-IRB-120-3-0-6.robot", [0, 0, TABLE_Z + 20], { home });
    const dispenser = await b.tool("Aim-Robotics-FD-310-Dispenser.tool", robot, { name: "Dispenser" });

     
    await b.assembly("Nest", [rbox([260, 190, NEST_H], 6, [0, 0, 0], C.base), ...[-1, 1].map((s) => box([20, 150, 10], [s * 112, 0, NEST_H], C.accent))], [AT[0], AT[1], TABLE_Z]);
    const top = TABLE_Z + NEST_H;
    const housing = await b.shape("Housing", rbox(HOUSING, 10, [AT[0], AT[1], top], C.white));
    await b.assembly("Cartridge Stand", [rbox([90, 90, 10], 4, [0, 0, 0], C.dark), cyl(22, 160, [0, 0, 10], C.accentSoft), cyl(10, 30, [0, 0, 170], C.dark)], [330, 250, TABLE_Z]);

     
    const pts: number[][] = [];
    const hx = HOUSING[0] / 2 - 8;
    const hy = HOUSING[1] / 2 - 8;
    const corners = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k];
      const [bx, by] = corners[(k + 1) % 4];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 20));
      for (let i = 0; i < n; i++) pts.push([AT[0] + ax + ((bx - ax) * i) / n, AT[1] + ay + ((by - ay) * i) / n, top + HOUSING[2]]);
    }
    await b.cmd("object.addPoints", { object: housing, points: pts, addToRef: true, projection: 0 });

    const frame = await b.frame("Nest", [AT[0], AT[1], top]);
    const dispense = await b.program("Dispense", robot);
    await dispense.setDO("GLUE", 1);
    await dispense.pause(120);
    await dispense.setDO("GLUE", 0);

    await b.cmd("robot.setJoints", { robot, joints: [0, 10, 10, 0, 70, 0] });
    const project = await b.cmd<{ id: string }>("machining.add", { kind: "point", name: "GlueDots settings", robot, object: housing });
    await b.cmd("machining.setParams", {
      project: project.id,
      frame,
      tool: dispenser,
      machining: { SpeedOperation: 150, SpeedRapid: 400, PointApproach: 15, RotZ_Range: 180, RotZ_Step: 15 },
      progEvents: { CallAction: "Dispense", CallActionOn: 1 },
      update: true,
    });
    const upd = await b.cmd<{ ok: boolean; message: string; ratio: number }>("machining.update", { project: project.id });
    if (!upd.ok) throw new Error(`Glue project: ${upd.message} (${upd.ratio})`);

    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const main = await b.program("Main", robot);
    await main.setTool(dispenser);
    await main.setDO("GLUE", 0);
    await main.speed(400, 120);
    await main.moveJ(homeT);
    await main.call("GlueDots");
    await main.moveJ(homeT);
    await main.message(`Housing glued: ${pts.length} dots`);

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Glue Dispensing</b> — run <b>Main</b>.</p><p><b>GlueDots settings</b> is a point-follow project on the housing's point list. It writes <b>GlueDots</b> and, through its program event <i>action on point</i>, calls <b>Dispense</b> at every point (GLUE on, 120 ms, off).</p>",
    );
  },
};

export default spec;
