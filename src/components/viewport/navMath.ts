 
 
 

import * as THREE from "three";
import type { Mat } from "@/engine/math";

export const MM = 0.001;

 
export const w2t = (v: [number, number, number]) => new THREE.Vector3(v[0], v[2], -v[1]);
 
export const toStation = (v: THREE.Vector3): [number, number, number] => [v.x / MM, -v.z / MM, v.y / MM];
 
export const dirToStation = (v: THREE.Vector3): [number, number, number] => [v.x, -v.z, v.y];







export const PRESETS: Record<string, { z: [number, number, number]; y: [number, number, number] }> = {
  iso: { z: [0.612, -0.612, 0.5], y: [-0.354, 0.354, 0.866] },
  top: { z: [0, 0, 1], y: [-1, 0, 0] },
  front: { z: [1, 0, 0], y: [0, 0, 1] },
  right: { z: [0, 1, 0], y: [0, 0, 1] },
  left: { z: [0, -1, 0], y: [0, 0, 1] },
  back: { z: [-1, 0, 0], y: [0, 0, 1] },
};

export type Op = "none" | "select" | "rotate" | "pan" | "zoom" | "drag" | "band" | "measure";


 
export function classicOp(type: number, button: "left" | "middle" | "right", mods: { shift: boolean; cmd: boolean }, left: string, custom: { mid: string; right: string }): Op {
  const lower = (s: string) => s.toLowerCase() as Op;
  if (button === "left") {
    if (mods.shift && mods.cmd) return "rotate";
    if (mods.shift) return "zoom";
    if (type === 3) return "rotate";  
    return left === "none" || left === "select" ? "select" : (left as Op);
  }
  if (button === "right") {
    if (type === 2) return mods.shift ? "pan" : mods.cmd ? "zoom" : "rotate";  
    if (type === 4) return mods.shift ? "rotate" : mods.cmd ? "zoom" : "pan";  
    if (type === 5) return "pan";  
    if (type === 7) return lower(custom.right);
    if (type === 1) return "pan";  
    return "rotate";  
  }
  if (type === 1 || type === 4 || type === 5) return "rotate";  
  if (type === 2 || type === 3) return "pan";  
  if (type === 6) return mods.cmd ? "pan" : mods.shift ? "zoom" : "rotate";  
  if (type === 7) return lower(custom.mid);
  return "pan";  
}

 
export function wheelStep(deg: number, dist: number | null, settings: Record<string, unknown>): number {
  const ratio = Number(settings.Mouse3D_SpeedZoom ?? 1) || 1;
  const fixed = Number(settings.Mouse3D_ZoomSpeed ?? -1);
  if (fixed >= 0) return fixed * deg * 20 * MM * ratio;
  if (dist === null) return deg * 20 * MM * ratio;
  return Math.max(-5, Math.min(5, dist * deg * 0.015 * ratio));
}

 
export function dragZoomStep(dy: number, depth: number | null): number {
  if (depth === null) return dy * 20 * MM;
  return Math.max(-5, Math.min(5, depth * dy * 0.005));
}

 
export const rotateRate = (aligned: boolean, speed: number) => (aligned ? 0.004 : (0.2 * Math.PI) / 180) * speed;

 
export function viewPoseOf(camera: THREE.Camera): Mat {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const right = dirToStation(new THREE.Vector3(e[0], e[1], e[2]));
  const up = dirToStation(new THREE.Vector3(e[4], e[5], e[6]));
  const back = dirToStation(new THREE.Vector3(e[8], e[9], e[10]));
  const p = toStation(new THREE.Vector3(e[12], e[13], e[14]));
  const R = [right, up, back];
  const t = R.map((r) => -(r[0] * p[0] + r[1] * p[1] + r[2] * p[2]));
  return [right[0], right[1], right[2], t[0], up[0], up[1], up[2], t[1], back[0], back[1], back[2], t[2], 0, 0, 0, 1];
}
