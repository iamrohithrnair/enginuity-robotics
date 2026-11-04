 
 
 
 
 
 
 
 
 
 

import type { Services } from "../registry";
import type { Workspace } from "../types";
import { activePhysics, type PhysicsRuntime } from "./runtime";

 
export interface SimTimer {
   
  elapsed(): number;
   
  end(): void;
}

class PhysicsTimer implements SimTimer {
  private id: number | null;
  private at = 0;
  private last = performance.now();

  constructor(
    private rt: PhysicsRuntime,
    private ws: Workspace,
    private length: number,
     
    private unit: number,
    robot?: string,
    joints?: (t: number) => number[],
  ) {
    this.id = rt.startTimer(length * unit, robot, joints && ((t: number) => joints(t / unit)));
  }

  elapsed(): number {
    const now = performance.now();
    if (this.id !== null) {
      const e = this.rt.timerElapsed(this.id);
      if (e) {
        this.at = e.done ? this.length : Math.min(this.length, e.seconds / this.unit);
        if (e.done) this.id = null;
        this.last = now;
        return this.at;
      }
       
      this.id = null;
    }
    if (!this.ws.paused && this.at < this.length) this.at = Math.min(this.length, this.at + (now - this.last) / 1000 / this.unit * this.ws.simulationSpeed);
    this.last = now;
    return this.at;
  }

  end() {
    if (this.id !== null) this.rt.endTimer(this.id);
    this.id = null;
  }
}






export function physicsMotion(services: Services, ws: Workspace, robot: string, joints: (t: number) => number[], seconds: number): SimTimer | null {
  const rt = seconds > 0 ? activePhysics(services, ws) : null;
  return rt ? new PhysicsTimer(rt, ws, seconds, 1, robot, joints) : null;
}

 
export function physicsWait(services: Services, ws: Workspace, ms: number): SimTimer | null {
  const rt = ms > 0 ? activePhysics(services, ws) : null;
  return rt ? new PhysicsTimer(rt, ws, ms, 0.001) : null;
}
