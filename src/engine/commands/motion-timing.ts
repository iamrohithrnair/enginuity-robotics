import { z } from "zod";
import { defineCommand, ItemRef } from "../registry";
import { effectiveSpeeds } from "../sim/timing";
import { requireRobot } from "./robot";

 
 
 
 
 

defineCommand({
  name: "robot.setRounding",
  title: "Set Robot Rounding",
  description:
    "Set a robot's rounding (zone) state in mm, -1 = off (the robot parameter 'Rounding value'; Set Rounding instructions change it while a program runs). While the rounding is above 0, program estimates and simulations time every move at constant speed (t = distance / speed, no accelerations); otherwise moves accelerate and stop at each target.",
  category: "robot",
  undoable: false,
  spec: "R-KIN-12 (cell 6,2), R-PROG-17, R-PROG-22",
  schema: z.object({ robot: ItemRef.optional(), rounding: z.number() }),
  run({ ws, tx }, p) {
    const r = requireRobot(ws, p.robot);
    tx.set(r.id, { robot: { ...r.robot!, rounding: p.rounding } });
    return { robot: r.name, rounding: p.rounding };
  },
});

defineCommand({
  name: "robot.motionState",
  title: "Robot Speed State",
  description:
    "A robot's speed state as move times use it: stored linear/joint speeds and accelerations and rounding, the values a move actually uses (a speed below 0.1 runs at 2000 mm/s, a joint speed below 0.1 at twice the linear speed, accelerations likewise), and whether moves run at constant speed because the rounding is on.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "R-PROG-17",
  schema: z.object({ robot: ItemRef.optional() }),
  run({ ws }, p) {
    const r = requireRobot(ws, p.robot);
    const rd = r.robot!;
    const rounding = rd.rounding ?? -1;
    const used = effectiveSpeeds({ ...rd.speeds, rounding });
    return { robot: r.name, stored: { ...rd.speeds, rounding }, used, constantSpeed: rounding > 0 };
  },
});
