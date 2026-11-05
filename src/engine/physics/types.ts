// Defines rigid-body settings, role reports and physics runtime state.
 
 
 
 
 
 
 

 
export type BodyMode = "auto" | "dynamic" | "static";

 
export interface ItemPhysics {
  body?: BodyMode;
   
  mass?: number | null;
   
  density?: number | null;
   
  friction?: number | null;
   
  restitution?: number | null;
}

export const PHYSICS_DEFAULTS = {
   
  density: 1000,
  friction: 0.6,
  restitution: 0,
   
  gravity: 9.81,
   
  substeps: 2,
   
  kinematicFriction: 0.8,
  floorFriction: 0.6,
} as const;

 
export const PHYSICS_KEYS = {
  enabled: "RC_PHYSICS",
  gravity: "RC_PHYSICS_GRAVITY",
  substeps: "RC_PHYSICS_SUBSTEPS",
} as const;

 
export const FRAME_S = 1 / 60;

export type BodyRole = "dynamic" | "static" | "kinematic";

 
export interface BodyReport {
  item: string;
  name: string;
   
  kind: "object" | "tool" | "robot";
  role: BodyRole;
   
  mode?: BodyMode;
   
  text: string;
  reason: string;
   
  mass?: number;
  sleeping?: boolean;
  links?: number;
}

export interface PhysicsCounts {
  dynamic: number;
  static: number;
  kinematic: number;
  awake: number;
}

 
export interface PhysicsState {
  enabled: boolean;
   
  station: string | null;
   
  floorZ: number | null;
  counts: PhysicsCounts;
  gravity: number;
  substeps: number;
   
  report: Record<string, BodyReport>;
   
  buildMs?: number;
   
  stepMs?: number;
}

 
export function roleText(role: BodyRole, reason: string, mode?: BodyMode | "attached"): string {
  const name = role === "dynamic" ? "Dynamic" : role === "static" ? "Static" : "Kinematic";
  const prefix = mode === "auto" ? "Auto: " : "";
  return reason ? `${prefix}${name} (${reason})` : `${prefix}${name}`;
}
