// Defines station items, robot models, workspace state and incremental patches.
import type { Mat } from "./math";

 
export const ITEM_TYPE_CODES = {
  station: 1,
  robot: 2,
  frame: 3,
  tool: 4,
  object: 5,
  target: 6,
  curve: 7,
  program: 8,
  instruction: 9,
  python: 10,
  machining: 11,
  folder: 17,
  camera: 19,
  notes: 22,
   
  script: 100,
} as const;

export type ItemType = keyof typeof ITEM_TYPE_CODES;

export type JointKind = "rotary" | "linear";

export interface DhJoint {
  kind: JointKind;
   
  alpha: number;
  a: number;
  theta: number;
  d: number;
   
  lower: number;
  upper: number;
}





export interface RobotModel {
  base: Mat;
  flange: Mat;
   
  joints: DhJoint[];
   
  nq: number;
   
  map: number[];
   
  userLower: number[];
  userUpper: number[];
   
  polygon: [number, number][];
   
  mech: number;
   
  meshLinks?: number;
   
  mechParams?: number[];
}

export interface MeshRef {
   
  geometry: string;
   
  normals?: string;
  color: [number, number, number, number];
}

export interface RobotData {
  model: RobotModel;
  joints: number[];
  home: number[];
   
  links: MeshRef[][];
  postProcessor: string;
   
  speeds: { linear: number; joint: number; linearAccel: number; jointAccel: number };
  libraryFile?: string;
  brand?: string;
   
  activeTool?: string | null;
   
  rounding?: number;
   
  activeFrame?: string | null;
   
  header?: number[];
   
  nativeName?: string;
  payload?: number;
  reach?: number;
  repeatability?: number;
  weight?: number;
  



  tcp?: Mat | null;
   
  framePose?: Mat | null;
   
  connection?: RobotConnection;
  




  sync?: string[];
}

 
export interface RobotConnection {
  ip: string;
  port: number;
  remotePath: string;
  ftpUser: string;
  ftpPass: string;
   
  state: number;
  message: string;
}

export interface TargetData {
  joints: number[];
  isJoint: boolean;
   
  robot?: string | null;
   
  config?: [number, number, number];
}

export type MoveType = "joint" | "linear" | "circular" | "search";

export type InstructionKind =
  | "move"
  | "movec"
  | "speed"
  | "frame"
  | "tool"
  | "robot"
  | "pause"
  | "event"
  | "code"
  | "print"
  | "rounding"
  | "io"
  | "custom"
   
  | "decision";

export interface InstructionData {
  kind: InstructionKind;
  moveType?: MoveType;
   
  target?: string | null;
  target2?: string | null;
   
  joints?: number[];
  pose?: Mat;
   
  pose2?: Mat;
   
  index?: number;
   
  speed?: { linear: number; joint: number; linearAccel: number; jointAccel: number };
  rounding?: number;
  pauseMs?: number;
   
  text?: string;
   
  codeType?: number;
   
  io?: { mode: "set" | "wait"; name: string; value: string; timeoutMs?: number; analog?: boolean };
  








  event?: {
    action: "attach" | "detach" | "detach-all" | "show" | "hide" | "move" | "home" | "replace" | "conveyor" | "create" | "remove" | "wait";
    tool?: string | null;
    object?: string | null;
    objects?: string[];
    frame?: string | null;
     
    distance?: number;
    




    option?: number;
    




    positions?: { item: string; parent: string | null; pose: Mat }[];
    relative?: boolean;
     
    listParents?: (string | null)[];
    listPoses?: Mat[];
  };
  frame?: string | null;
  tool?: string | null;
  robot?: string | null;
  




  forcePose?: boolean;
   
  contact?: Mat | null;
  




  refJoints?: number[];
   
  decision?: import("./decisions").DecisionInstruction;
}

export interface ProgramData {
  robot?: string | null;
  

  showInstructions?: boolean;
  displayPath?: boolean;
  locked?: boolean;
   
  lastUpdate?: { instructions: number; time: number; distance: number; ok: number; message: string };
}

export interface ObjectData {
  meshes: MeshRef[];
  source?: string;
   
  geometryPose?: Mat;
   
  curves?: ObjectCurve[];
   
  points?: number[][];
   
  pointNames?: Record<number, string>;
   
  display?: import("./displayString").DisplayStyle;
}

 
export interface ObjectCurve {
  points: number[][];
  name?: string;
  color?: [number, number, number, number];
}

 
export type MachiningKind = "machining" | "curve" | "point" | "print3d" | "weld";

 
export interface MachiningData {
  kind: MachiningKind;
  robot?: string | null;
   
  frame?: string | null;
  tool?: string | null;
   
  settings: Record<string, number | string | boolean>;
   
  events: Record<string, number | string | boolean>;
   
  optimAxes: Record<string, number | string | boolean>;
   
  approach: string;
  retract: string;
   
  input?: {
    object?: string | null;
     
    curves?: number[] | null;
     
    reversed?: number[] | null;
    nc?: { file: string; text: string } | null;
     
    flipped?: number[] | null;
    

    apt?: number[][] | null;
  } | null;
   
  pathToTool?: Mat | null;
   
  frameOffset?: Mat | null;
   
  toolOrientation?: Mat | null;
   
  startJoints?: number[] | null;
   
  program?: string | null;
   
  result?: { ok: boolean; ratio: number; message: string; points: number } | null;
   
  toolpath?: { poses: Mat[]; bad: number[] } | null;
}

export interface ToolData {
  meshes: MeshRef[];
   
  geometryPose?: Mat;
}

export interface CurveData {
   
  points: number[][];
  closed?: boolean;
}

 
export interface CameraData {
   
  link: string | null;
   
  params: string;
   
  open: boolean;
}

export interface Item {
  id: string;
   
  handle: number;
  type: ItemType;
  name: string;
  parent: string | null;
  children: string[];
  visible: boolean;
   
  pose: Mat;
  color?: [number, number, number, number];
  robot?: RobotData;
  tool?: ToolData;
  object?: ObjectData;
  target?: TargetData;
  program?: ProgramData;
  instruction?: InstructionData;
  curve?: CurveData;
   
  machining?: MachiningData;
   
  camera?: CameraData;
  

  python?: { code: string; author?: "user" | "agent"; approved?: string | null };
  notes?: { html: string };
   
  script?: import("./scripts").ScriptData;
   
  params?: Record<string, string>;
   
  file?: string;
   
  locked?: boolean;
   
  collisionMap?: CollisionMapData;
  



  stationParams?: [string, string][];
   
  physics?: import("./physics/types").ItemPhysics;
   
  rdk?: RdkExtra;
}






export interface RdkExtra {
   
  attachDistance?: number;
   
  dataParams?: [string, string][];
   
  view?: number[];
   
  savedWith?: { version: string; platform: string; build: number; date: number };
   
  robotTail?: string;
   
  programFlags?: number[];
}

 
export interface CollisionMapData {
  mode: "default" | "all" | "none";
   
  pairs: [string, number, string, number, boolean][];
}

export interface Settings {
  [key: string]: number | string | boolean;
}

export interface Workspace {
  rev: number;
  items: Record<string, Item>;
   
  stations: string[];
  activeStation: string | null;
  selection: string[];
  nextHandle: number;
   
  stationCounter: number;
  collisionsActive: boolean;
   
  simulationSpeed: number;
   
  running: { program: string; startedAt: number; duration: number } | null;
   
  busy?: string[];
   
  paused?: boolean;
   
  view?: ViewState;
}

 
export type LeftAction = "none" | "select" | "rotate" | "pan" | "zoom";
 
export type MoveModeName = "default" | "references" | "tools";







export interface ViewState {
  frames: boolean;
  text: boolean;
  workspace: boolean;
  trace: boolean;
   
  traceReset: number;
  perspective: boolean;
  leftAction: LeftAction;
  moveMode: MoveModeName;
  cinema: boolean;
   
  toolbar: string;
   
  treeInside: boolean;
   
  treeVisible: boolean;
   
  blockKeys: boolean;
   
  vr?: boolean;
}

 
export interface WorkspacePatch {
  rev: number;
  upserts: Item[];
  removes: string[];
  meta?: Partial<
    Pick<Workspace, "stations" | "activeStation" | "selection" | "collisionsActive" | "simulationSpeed" | "running" | "stationCounter" | "busy" | "paused" | "view">
  >;
   
  physics?: boolean;
}
