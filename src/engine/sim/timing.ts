// Computes joint and Cartesian motion durations from speed and acceleration limits.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

 
export interface MoveProfile {
  d: number;
  v: number;
  a: number;
}

 
export interface SpeedState {
  linear: number;
  joint: number;
  linearAccel: number;
  jointAccel: number;
   
  rounding: number;
}

 
export const MOVE_TIME_STRICTEST = 0;
export const MOVE_TIME_LINEAR = 1;
export const MOVE_TIME_JOINT = 2;
 
export const MOVE_TIME_BY_MOVE = 3;
export const MOVE_TIME_SHORTEST = 4;

 
export function effectiveSpeeds(s: SpeedState): { linear: number; joint: number; linearAccel: number; jointAccel: number } {
  const linear = s.linear < 0.1 || !Number.isFinite(s.linear) ? 2000 : s.linear;
  const joint = s.joint < 0.1 || !Number.isFinite(s.joint) ? 2 * linear : s.joint;
  if (s.rounding > 0) return { linear, joint, linearAccel: -1, jointAccel: -1 };
  const linearAccel = s.linearAccel < 0.1 || !Number.isFinite(s.linearAccel) ? 100 : s.linearAccel;
  const jointAccel = s.jointAccel < 0.1 || !Number.isFinite(s.jointAccel) ? 2 * linearAccel : s.jointAccel;
  return { linear, joint, linearAccel, jointAccel };
}







export function profileTime(d: number, v: number, a: number): number {
  d = Math.abs(d);
  if (d < 1e-6 || !(v > 0)) return 0;
  if (!(a > 0)) return d / v;
  const ta = v / a;
  const da = 0.5 * a * ta * ta;
  if (2 * da < d) return (d - 2 * da) / v + 2 * ta;
  return 2 * Math.sqrt(d / a);
}






export function moveTiming(state: SpeedState, linearDistance: number, jointDistance: number, moveType: "joint" | "linear" | "circular", mode: number = MOVE_TIME_BY_MOVE): MoveProfile & { time: number; linearProfile: boolean } {
  const s = effectiveSpeeds(state);
  const lin = { d: Math.abs(linearDistance), v: s.linear, a: s.linearAccel };
  const jnt = { d: Math.abs(jointDistance), v: s.joint, a: s.jointAccel };
  const tLin = profileTime(lin.d, lin.v, lin.a);
  const tJnt = profileTime(jnt.d, jnt.v, jnt.a);
  let linear: boolean;
  if (mode === MOVE_TIME_LINEAR) linear = true;
  else if (mode === MOVE_TIME_JOINT) linear = false;
  else if (mode === MOVE_TIME_SHORTEST) linear = tJnt > tLin;
  else if (mode === MOVE_TIME_BY_MOVE && lin.d > 0.001) linear = moveType !== "joint";
   
  else linear = tJnt <= tLin;
  const p = linear ? lin : jnt;
  return { ...p, time: linear ? tLin : tJnt, linearProfile: linear };
}





export function motionTiming(
  st: { speed: { linear: number; joint: number; linearAccel: number; jointAccel: number }; rounding: number },
  linearDistance: number,
  jointDistance: number,
  moveType: "joint" | "linear" | "circular",
  mode?: number,
): { profile: MoveProfile; time: number } {
  const t = moveTiming({ ...st.speed, rounding: st.rounding }, linearDistance, jointDistance, moveType, mode ?? MOVE_TIME_BY_MOVE);
  return { profile: { d: t.d, v: t.v, a: t.a }, time: t.time };
}

 
export function largestJointChange(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(b[i] - a[i]));
  return m;
}
