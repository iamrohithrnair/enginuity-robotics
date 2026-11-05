// Builds a camera-inspection cell that sorts picked parts through decision-driven outcomes.
 
 
 

import { along, box, C, cyl, down, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 760;
const PART = { r: 26, h: 12 };
const TRAY: [number, number] = [260, -230];
const SLOTS = [-70, 0, 70];
const GOOD_BIN: [number, number] = [-60, -330];
const REJECT_BIN: [number, number] = [-60, 330];
const CAMERA_SPOT: [number, number, number] = [330, 160, 960];

function bin(color: number[]): Part[] {
  const w = 200;
  const d = 160;
  const h = 90;
  const t = 6;
  return [
    rbox([w, d, t], 3, [0, 0, 0], C.base),
    box([w, t, h], [0, -d / 2 + t / 2, 0], color),
    box([w, t, h], [0, d / 2 - t / 2, 0], color),
    box([t, d, h], [-w / 2 + t / 2, 0, 0], color),
    box([t, d, h], [w / 2 - t / 2, 0, 0], color),
  ];
}

const spec: ExampleSpec = {
  name: "Camera Inspection",
  description:
    "An ABB IRB 120 with a vacuum cup holds each part under a simulated 2D camera. A Decision instruction asks the decision model whether the part is good, with the camera image, and routes it to the good or the reject bin. With no decision model set up the decision takes its fallback branch and the part goes to the reject bin.",
  features: ["Decision step", "2D camera", "Program calls", "MoveJ", "MoveL", "Digital I/O", "Attach / detach events"],
  mainProgram: "Main",
  view: { azimuth: -40, elevation: 32, zoom: 1.05 },
   
  expectedStatus: [/running the error branch/],
  async build(b: ExampleBuilder) {
    const bench: Part[] = [rbox([1100, 900, 40], 8, [100, 0, TABLE_Z - 40], C.light)];
    for (const x of [-380, 580]) for (const y of [-400, 400]) bench.push(box([50, 50, TABLE_Z - 40], [x, y, 0], C.steel));
    for (const y of [-400, 400]) bench.push(box([960, 30, 30], [100, y, 180], C.steel));
     
    bench.push(box([40, 40, 560], [CAMERA_SPOT[0] + 170, CAMERA_SPOT[1], TABLE_Z], C.steel), box([230, 40, 30], [CAMERA_SPOT[0] + 70, CAMERA_SPOT[1], TABLE_Z + 520], C.steel));
    bench.push(rbox([70, 70, 60], 8, [CAMERA_SPOT[0], CAMERA_SPOT[1], TABLE_Z + 470], C.dark), cyl(18, 20, [CAMERA_SPOT[0], CAMERA_SPOT[1], TABLE_Z + 452], C.accent));
    await b.assembly("Inspection Bench", bench);
    await b.shape("Robot Riser", rbox([240, 240, 20], 6, [0, 0, TABLE_Z], C.dark));
    const home = [30, 0, 10, 0, 60, 0];
    const robot = await b.robot("ABB-IRB-120-3-0-6.robot", [0, 0, TABLE_Z + 20], { home });
    const cup = await b.tool("RobotiQ-EPick-Vacuum-Gripper-1-Cup.tool", robot, { name: "Vacuum Cup" });

    await b.assembly("Part Tray", [rbox([240, 100, 12], 4, [0, 0, 0], C.white), ...SLOTS.map((x) => cyl(PART.r + 5, 2, [x, 0, 12], C.steel))], [TRAY[0], TRAY[1], TABLE_Z]);
    for (const [k, x] of SLOTS.entries()) await b.shape(`Part ${k + 1}`, cyl(PART.r, PART.h, [TRAY[0] + x, TRAY[1], TABLE_Z + 14], C.accent));
    await b.assembly("Good Bin", bin(C.good), [GOOD_BIN[0], GOOD_BIN[1], TABLE_Z]);
    await b.assembly("Reject Bin", bin(C.bad), [REJECT_BIN[0], REJECT_BIN[1], TABLE_Z]);

     
    const camMount = await b.frame("Camera Mount", [CAMERA_SPOT[0], CAMERA_SPOT[1], TABLE_Z + 450, 180, 0, 0]);
    const camera = await b.cmd<{ id: string }>("camera.add", { attachTo: camMount, params: "FOCAL_LENGTH=6 FOV=32 FAR_LENGTH=1000 SIZE=640x480 Closed" });
    await b.cmd("item.rename", { item: camera.id, name: "Inspection Camera" });

    const table = await b.frame("Bench", [0, 0, TABLE_Z]);
    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const grip = PART.h + 14;
    const pickT: [string, string][] = [];
    for (const [k, x] of SLOTS.entries()) {
      const p = down(TRAY[0] + x, TRAY[1], grip, 0);
      pickT.push([await b.target(`Part ${k + 1} Approach`, table, robot, along(p, -80), [-40, 30, 20, 0, 40, -40]), await b.target(`Part ${k + 1} Pick`, table, robot, p)]);
    }
     
    const show = await b.target("Show To Camera", table, robot, down(CAMERA_SPOT[0], CAMERA_SPOT[1], CAMERA_SPOT[2] - TABLE_Z - 200, 0), [25, 10, 0, 0, 80, 25]);
    const dropGood = await b.target("Good Drop", table, robot, down(GOOD_BIN[0], GOOD_BIN[1], 140, 0), [-100, 20, 10, 0, 60, -100]);
    const dropReject = await b.target("Reject Drop", table, robot, down(REJECT_BIN[0], REJECT_BIN[1], 140, 0), [100, 20, 10, 0, 60, 100]);

    for (const [k, [up, at]] of pickT.entries()) {
      const p = await b.program(`Pick${k + 1}`, robot);
      await p.setFrame(table);
      await p.moveJ(up);
      await p.moveL(at);
      await p.setDO("VACUUM", 1);
      await p.attach(cup);
      await p.moveL(up);
    }
    const present = await b.program("Present", robot);
    await present.setFrame(table);
    await present.moveJ(show);
    await present.setDO("LIGHT", 1);
    await present.pause(400);
    for (const [name, drop, bin] of [
      ["PlaceGood", dropGood, "Good Bin"],
      ["PlaceReject", dropReject, "Reject Bin"],
    ] as const) {
      const p = await b.program(name, robot);
      await p.setFrame(table);
      await p.setDO("LIGHT", 0);
      await p.moveJ(drop);
      await p.setDO("VACUUM", 0);
      await p.detach(cup, table);
      await p.message(`Part sent to the ${bin.toLowerCase()}`);
    }

    const main = await b.program("Main", robot);
    await main.comment("Reset: parts back in the tray, outputs off");
    await main.resetObjects();
    await main.setDO("VACUUM", 0);
    await main.setDO("LIGHT", 0);
    await main.setTool(cup);
    await main.speed(800, 180);
    await main.moveJ(homeT);
    for (let k = 0; k < SLOTS.length; k++) {
      await main.call(`Pick${k + 1}`);
      await main.call("Present");
      await main.decision({
        question: {
          name: "part_ok",
          type: "yesno",
          instructions: "Look at the camera image of the part held under the camera. Is the part complete, clean and free of visible defects?",
          yes: "the part is good",
          no: "the part has a defect",
        },
        input: "A part held under the inspection camera",
        image: "camera",
        camera: camera.id,
        onError: "branch",
        outcomes: {
          yes: [{ do: "call", program: "PlaceGood" }],
          no: [{ do: "call", program: "PlaceReject" }],
          error: [
            { do: "message", text: "No decision from a model: the part goes to the reject bin" },
            { do: "call", program: "PlaceReject" },
          ],
        },
      });
    }
    await main.moveJ(homeT);
    await main.message("Inspection done");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Camera Inspection</b> — run <b>Main</b>.</p><p>Each part is shown to <b>Inspection Camera</b>; the <b>Decision</b> instruction sends the camera image to the default decision model and asks whether the part is good: yes calls <b>PlaceGood</b>, no calls <b>PlaceReject</b>. Set up a decision model (Tools ▸ Decision Models…) to make real decisions; without one the decision fails and its fallback branch sends the part to the reject bin.</p>",
    );
  },
};

export default spec;
