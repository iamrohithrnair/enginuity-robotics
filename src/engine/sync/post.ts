 
 
 
 
 
 
 
 
 
 
 
 

import { inv, mul, type Mat } from "../math";
import type { Item, Workspace } from "../types";
import { combinedJoints } from "./axes";
import { SyncKinematics, syncFrameOf, syncMotionFrame } from "./plan";

export class SyncPost {
  private readonly k: SyncKinematics;
  private readonly cur: number[];
  constructor(
    private readonly ws: Workspace,
    private readonly robot: Item,
  ) {
    this.k = new SyncKinematics(ws, robot);
    this.cur = combinedJoints(ws, robot);
  }
   
  get axes(): number {
    return this.k.dof;
  }
   
  extTypes(): string[] {
    return this.k.axes.flatMap((a) => a.item.robot!.model.joints.slice(0, a.nq).map((j) => (j.kind === "linear" ? "'T'" : "'J'")));
  }
   
  frame(): Mat {
    return syncMotionFrame(this.ws, this.robot, this.cur);
  }
   
  frameOf(frameId: string): Mat {
    return syncFrameOf(this.ws, this.robot, frameId, this.cur);
  }
   
  inFrame(abs: Mat, frame: Mat, joints?: number[]): Mat {
    return mul(inv(mul(this.k.base(this.k.fill(joints, this.cur)), frame)), abs);
  }
   
  joints(q?: number[]): number[] {
    return this.k.fill(q, this.cur);
  }
}
