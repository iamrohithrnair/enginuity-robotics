// Samples robot motion to schedule spray emission along simulated paths.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { profileAt, type Profile } from "../sim/planner";

 
export function sampleIndexAt(seg: { samples: number[][]; profile?: Profile; t1: number; t0?: number }, t: number): number {
  const n = seg.samples.length;
  if (n <= 1) return 0;
  let s: number;
  if (seg.profile && seg.profile.d > 0) s = profileAt(seg.profile, t) / seg.profile.d;
  else s = t / Math.max(1e-9, seg.t1 - (seg.t0 ?? 0));
  s = Math.max(0, Math.min(1, s));
  return Math.min(n - 1, Math.max(0, Math.ceil(s * (n - 1) - 1e-9)));
}

export interface TickMotion {
  robot: string;
  samples: number[][];
  profile?: Profile;
   
  T: number;
}

interface Entry {
  m: TickMotion;
   
  r0: number;
  s0: number;
  r1: number;
  s1: number;
  idx: number;
}

export interface TickerOptions {
   
  periodMs: () => number;
   
  ratio: () => number;
   
  paused?: () => boolean;
   
  emit: (joints: Map<string, number[]>) => void;
   
  maxTicksPerUpdate?: number;
}

export class SprayTicker {
  private motions = new Map<object, Entry>();
   
  private next = 0;
   
  ticks = 0;
  emissions = 0;

  constructor(private o: TickerOptions) {}

  get active() {
    return this.motions.size;
  }

   
  currentJoints(): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const e of this.motions.values()) out.set(e.m.robot, e.m.samples[e.idx]);
    return out;
  }

   
  start(handle: object, m: TickMotion, now: number) {
    if (!this.motions.size) this.next = now + this.period();
    this.motions.set(handle, { m, r0: now, s0: 0, r1: now, s1: 0, idx: sampleIndexAt({ samples: m.samples, profile: m.profile, t1: m.T }, 0) });
  }

   
  update(handle: object, now: number, sim: number) {
    const e = this.motions.get(handle);
    if (!e) return;
    e.r0 = e.r1;
    e.s0 = e.s1;
    e.r1 = now;
    e.s1 = Math.min(sim, e.m.T);
    this.process(now);
  }

  



  end(handle: object, now: number, sim: number, completed: boolean) {
    const e = this.motions.get(handle);
    if (!e) return;
    this.update(handle, now, sim);
    if (completed) {
      const last = e.m.samples.length - 1;
      if (e.idx !== last) {
        e.idx = last;
        this.fire(this.jointsAt(now, e));
      }
    }
    this.motions.delete(handle);
  }

  private period() {
    const p = Number(this.o.periodMs());
    return Number.isFinite(p) && p > 0 ? p : 5;
  }

  





  private simAt(e: Entry, t: number): number {
    const ratio = this.o.paused?.() ? 0 : this.o.ratio() / 1000;
    let s: number;
    if (t <= e.r1 && e.r1 > e.r0) {
      s = e.s1 >= e.m.T ? Math.min(e.s1, e.s0 + (t - e.r0) * ratio) : e.s0 + ((e.s1 - e.s0) * (t - e.r0)) / (e.r1 - e.r0);
    } else if (t <= e.r1) {
      s = e.s1;
    } else {
      s = e.s1 + (t - e.r1) * ratio;
    }
    return Math.max(0, Math.min(e.m.T, s));
  }

  private jointsAt(t: number, only?: Entry): Map<string, number[]> {
    const joints = new Map<string, number[]>();
    for (const e of this.motions.values()) {
      const idx = e === only ? e.idx : sampleIndexAt({ samples: e.m.samples, profile: e.m.profile, t1: e.m.T }, this.simAt(e, t));
      joints.set(e.m.robot, e.m.samples[idx]);
    }
    return joints;
  }

  private fire(joints: Map<string, number[]>) {
    this.emissions++;
    this.o.emit(joints);
  }

  private process(now: number) {
    const per = this.period();
    const max = this.o.maxTicksPerUpdate ?? 4000;
    let n = 0;
    while (this.next <= now) {
      if (++n > max) {
        this.next = now + per;
        break;
      }
      const t = this.next;
      this.next += per;
      this.ticks++;
      let moved = false;
      const joints = new Map<string, number[]>();
      for (const e of this.motions.values()) {
        const idx = sampleIndexAt({ samples: e.m.samples, profile: e.m.profile, t1: e.m.T }, this.simAt(e, t));
        joints.set(e.m.robot, e.m.samples[idx]);
        if (idx !== e.idx) {
          e.idx = idx;
          moved = true;
        }
      }
      if (moved) this.fire(joints);
    }
  }
}
