// Places loaded instructions within synchronized robot and external-axis frames.
 
 
 
 
 
 
 
 

import { inv, mul, poseDistance, type Mat } from "../math";
import type { InstructionData, Item, Workspace } from "../types";
import { combinedJoints } from "./axes";
import { SyncKinematics, syncFrameOf, syncMotionFrame } from "./plan";

const samePose = (a: Mat, b: Mat) => {
  const d = poseDistance(a, b);
  return d.mm < 1e-6 && d.deg < 1e-6;
};

 
export class SyncImport {
  private readonly k: SyncKinematics;
  private readonly cur: number[];
   
  frame: Mat;
  constructor(
    private readonly ws: Workspace,
    private readonly robot: Item,
  ) {
    this.k = new SyncKinematics(ws, robot);
    this.cur = combinedJoints(ws, robot);
    this.frame = syncMotionFrame(ws, robot, this.cur);
  }
  



  setRef(frame: string | null, stored: Mat | undefined, flag: number | undefined): InstructionData {
    const linked = frame ? syncFrameOf(this.ws, this.robot, frame, this.cur) : null;
    const forced = !!stored && (!linked || (flag === 1 && !samePose(stored, linked)));
    this.frame = forced ? stored! : linked ?? this.frame;
    return { kind: "frame", frame, ...(stored ? { pose: stored } : {}), ...(forced && frame ? { forcePose: true } : {}) };
  }
   
  place(rel: Mat, joints: number[] | null | undefined): Mat {
    const q = this.k.fill(joints ?? undefined, this.cur);
    return mul(mul(this.k.base(q), this.frame), rel);
  }
   
  frameAbs(joints?: number[]): Mat {
    return mul(this.k.base(this.k.fill(joints, this.cur)), this.frame);
  }
   
  relative(abs: Mat, joints?: number[]): Mat {
    return mul(inv(this.frameAbs(joints)), abs);
  }
}
