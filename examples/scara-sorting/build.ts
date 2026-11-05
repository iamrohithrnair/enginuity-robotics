// Builds a high-speed SCARA cell that sorts colored parts with vacuum grip programs.
 

import { along, box, C, cyl, down, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 750;
const BASE_Z = TABLE_Z + 60;
const PART = { r: 18, h: 14 };
 
const GRID: { x: number; y: number; blue: boolean }[] = [
  { x: 420, y: -110, blue: true },
  { x: 420, y: 0, blue: false },
  { x: 420, y: 110, blue: true },
  { x: 520, y: -110, blue: false },
  { x: 520, y: 0, blue: true },
  { x: 520, y: 110, blue: false },
];
const BIN_A: [number, number] = [200, -380];
const BIN_B: [number, number] = [200, 380];

function bin(w: number, d: number, h: number, rim: number[]): Part[] {
  const t = 5;
  return [
    rbox([w, d, t], 3, [0, 0, 0], C.base),
    box([w, t, h], [0, -d / 2 + t / 2, 0], rim),
    box([w, t, h], [0, d / 2 - t / 2, 0], rim),
    box([t, d, h], [-w / 2 + t / 2, 0, 0], rim),
    box([t, d, h], [w / 2 - t / 2, 0, 0], rim),
  ];
}

const spec: ExampleSpec = {
  name: "SCARA Sorting",
  description:
    "An ABB IRB 910SC SCARA with a small vacuum cup sorts six parts from a feeder plate into two bins by colour. It runs at 2 m/s with blended (rounded) approach moves; Grip and Release subprograms switch the vacuum and attach or drop the part.",
  features: ["SCARA", "High speed with rounding", "MoveJ", "MoveL", "Program calls", "Digital I/O", "Attach / detach events"],
  mainProgram: "Main",
  view: { azimuth: -35, elevation: 38, zoom: 1.1 },
  async build(b: ExampleBuilder) {
    const table: Part[] = [rbox([1000, 1100, 40], 8, [250, 0, TABLE_Z - 40], C.light)];
    for (const x of [-180, 680]) for (const y of [-480, 480]) table.push(box([50, 50, TABLE_Z - 40], [x, y, 0], C.steel));
    for (const x of [-180, 680]) table.push(box([30, 910, 30], [x, 0, 200], C.steel));
    await b.assembly("Sorting Table", table);
    await b.assembly("Robot Stand", [rbox([260, 260, 60], 10, [0, 0, TABLE_Z], C.dark)]);
    const home = [0, 60, 0, 0];
    const robot = await b.robot("ABB-IRB-910SC-3-0-65.robot", [0, 0, BASE_Z], { home });
    const cup = await b.tool("SMC-ZXP7A01-ZP20U-X1-Vacuum-Gripper.tool", robot, { name: "Vacuum Cup" });

    await b.assembly("Feeder Plate", [rbox([260, 340, 8], 4, [0, 0, 0], C.white)], [470, 0, TABLE_Z]);
    for (const [k, p] of GRID.entries()) await b.shape(`Part ${k + 1}`, cyl(PART.r, PART.h, [p.x, p.y, TABLE_Z + 8], p.blue ? C.accent : C.frame));
    await b.assembly("Bin A", bin(180, 160, 50, C.accent), [BIN_A[0], BIN_A[1], TABLE_Z]);
    await b.assembly("Bin B", bin(180, 160, 50, C.frame), [BIN_B[0], BIN_B[1], TABLE_Z]);

    const table0 = await b.frame("Table", [0, 0, TABLE_Z]);
    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const grip = 8 + PART.h;
    const parts: [string, string][] = [];
    for (const [k, p] of GRID.entries()) {
      const at = down(p.x, p.y, grip, 0);
      parts.push([await b.target(`Part ${k + 1} Above`, table0, robot, along(at, -60), home), await b.target(`Part ${k + 1}`, table0, robot, at)]);
    }
     
    const drops: Record<"A" | "B", [string, string][]> = { A: [], B: [] };
    for (const [key, at, seed] of [
      ["A", BIN_A, [-60, 70, -20, 0]],
      ["B", BIN_B, [60, -70, -20, 0]],
    ] as const) {
      for (const [i, dx] of [-50, 0, 50].entries()) {
        const p = down(at[0] + dx, at[1], 5 + PART.h + 1, 0);
        drops[key].push([await b.target(`Bin ${key} ${i + 1} Above`, table0, robot, along(p, -70), [...seed]), await b.target(`Bin ${key} ${i + 1}`, table0, robot, p)]);
      }
    }

    const gripProg = await b.program("Grip", robot);
    await gripProg.setDO("VACUUM", 1);
    await gripProg.pause(60);
    await gripProg.attach(cup);
    for (const [name, frame] of [
      ["ReleaseA", "Bin A"],
      ["ReleaseB", "Bin B"],
    ] as const) {
      const p = await b.program(name, robot);
      await p.setDO("VACUUM", 0);
      await p.detach(cup, table0);
      await p.comment(`Part dropped into ${frame}`);
    }

    const main = await b.program("Main", robot);
    await main.comment("Reset: parts back on the feeder plate, vacuum off");
    await main.resetObjects();
    await main.setDO("VACUUM", 0);
    await main.setFrame(table0);
    await main.setTool(cup);
    await main.speed(2000, 600, 8000, 3000);
    await main.moveJ(homeT);
    const used = { A: 0, B: 0 };
    for (const [k, [above, at]] of parts.entries()) {
      const key = GRID[k].blue ? "A" : "B";
      const [binAbove, binAt] = drops[key][used[key]++];
      await main.rounding(10);
      await main.moveJ(above);
      await main.rounding(-1);
      await main.moveL(at);
      await main.call("Grip");
      await main.rounding(10);
      await main.moveL(above);
      await main.moveJ(binAbove);
      await main.rounding(-1);
      await main.moveL(binAt);
      await main.call(`Release${key}`);
      await main.rounding(10);
      await main.moveL(binAbove);
    }
    await main.moveJ(homeT);
    await main.message("Sorted: 3 blue parts in bin A, 3 grey parts in bin B");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>SCARA Sorting</b> — run <b>Main</b>.</p><p>Main picks the six parts in turn (<b>Grip</b>: vacuum on, attach) and drops each one over the bin of its colour (<b>ReleaseA</b> / <b>ReleaseB</b>: vacuum off, detach). Approach and retract moves are blended with a 10 mm rounding.</p>",
    );
  },
};

export default spec;
