 
 
 
 
 
 
 
 
 
 
 
 

export type RGBA = [number, number, number, number];

export interface CameraSettings {
   
  fov: number;
   
  focal: number;
   
  far: number;
   
  pixelSize: number;
   
  width: number;
  height: number;
   
  snapshot: [number, number] | null;
  bg: RGBA;
  ambient: RGBA;
  diffuse: RGBA;
  specular: RGBA;
  depth: boolean;
  gray: boolean;
  ortho: boolean;
  windowFixed: boolean;
  noTaskbar: boolean;
  minimized: boolean;
  docked: boolean;
  popup: boolean;
  title: string;
   
  showLimits: boolean;
}

 
export const CAMERA_DEFAULT_FOCAL = 5;
export const CAMERA_DEFAULT_FOV = 30;
 
export const CAMERA_DEFAULT_SIZE: [number, number] = [640, 480];

 
export const CAMERA_MSG = {
  needLocation: "Use a reference frame, object or tool to establish the position of the camera",
  selectLocation: "Select the camera object or reference frame",
  noContext: "Cannot create new camera context",
  noWindow: "Main window not available",
} as const;

 
export const pixelSizeFor = (fovDeg: number, focal: number) => (focal * 1000 * Math.tan((fovDeg * Math.PI) / 360)) / 540;

export function defaultCameraSettings(viewAngle = CAMERA_DEFAULT_FOV): CameraSettings {
  const focal = CAMERA_DEFAULT_FOCAL;
  const fov = viewAngle > 0 ? viewAngle : (2 * Math.atan(2.7 / focal) * 180) / Math.PI;
  return {
    fov,
    focal,
    far: focal + 2000,
    pixelSize: pixelSizeFor(fov, focal),
    width: CAMERA_DEFAULT_SIZE[0],
    height: CAMERA_DEFAULT_SIZE[1],
    snapshot: null,
    bg: [1, 1, 1, 1],
     
    ambient: [0.373, 0.373, 0.373, 1],
    diffuse: [0.6, 0.6, 0.6, 1],
    specular: [0.545, 0.545, 0.545, 1],
    depth: false,
    gray: false,
    ortho: false,
    windowFixed: false,
    noTaskbar: false,
    minimized: false,
    docked: false,
    popup: false,
    title: "",
    showLimits: false,
  };
}

 
const NAMED: Record<string, string> = {
  black: "000000",
  white: "ffffff",
  red: "ff0000",
  green: "008000",
  lime: "00ff00",
  blue: "0000ff",
  yellow: "ffff00",
  cyan: "00ffff",
  magenta: "ff00ff",
  gray: "808080",
  grey: "808080",
  darkgray: "a9a9a9",
  lightgray: "d3d3d3",
  orange: "ffa500",
  transparent: "00000000",
};

 
export function parseColor(text: string): RGBA | null {
  const s = text.trim().toLowerCase();
  let hex = s.startsWith("#") ? s.slice(1) : NAMED[s];
  if (hex === undefined) return null;
  if (s === "transparent") return [0, 0, 0, 0];
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const b = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  if (hex.length === 6) return [b(0), b(2), b(4), 1];
  if (hex.length === 8) return [b(2), b(4), b(6), b(0)];
  return null;
}

 
export function formatColor(c: RGBA): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(c[3])}${h(c[0])}${h(c[1])}${h(c[2])}`;
}

const SIZE_RE = /^(\d+)\s*x\s*(\d+)$/i;






export function applyCameraParams(base: CameraSettings, params: string): CameraSettings {
  const s: CameraSettings = { ...base, bg: [...base.bg], ambient: [...base.ambient], diffuse: [...base.diffuse], specular: [...base.specular], snapshot: base.snapshot ? [...base.snapshot] : null };
   
  const tokens = params.match(/[A-Za-z_]+=("[^"]*"|\S+)|\S+/g) ?? [];
  let fovSet = false;
  let pixelSet = false;
  let farSet = false;
  const working = base.far - base.focal;
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    const key = (eq < 0 ? tok : tok.slice(0, eq)).toUpperCase();
    const raw = eq < 0 ? "" : tok.slice(eq + 1).replace(/^"(.*)"$/, "$1");
    const num = Number(raw);
    switch (key) {
      case "FOV":
        if (Number.isFinite(num)) {
          s.fov = num;
          fovSet = true;
        }
        break;
      case "FOCAL_LENGTH":
      case "FOCAL_LENGHT":
        if (Number.isFinite(num) && num > 0) s.focal = num;
        break;
      case "FAR_LENGTH":
      case "FAR_LENGHT":
        if (Number.isFinite(num) && num > 0) {
          s.far = num;
          farSet = true;
        }
        break;
      case "PIXELSIZE":
        if (Number.isFinite(num) && num > 0) {
          s.pixelSize = num;
          pixelSet = true;
        }
        break;
      case "SIZE":
      case "SNAPSHOT": {
        const m = SIZE_RE.exec(raw);
        if (!m) break;
        const wh: [number, number] = [Math.max(1, Number(m[1])), Math.max(1, Number(m[2]))];
        if (key === "SIZE") [s.width, s.height] = wh;
        else s.snapshot = wh;
        break;
      }
      case "BG_COLOR":
      case "LIGHT_AMBIENT":
      case "LIGHT_DIFFUSE":
      case "LIGHT_SPECULAR": {
        const c = parseColor(raw);
        if (!c) break;
        if (key === "BG_COLOR") s.bg = c;
        else if (key === "LIGHT_AMBIENT") s.ambient = c;
        else if (key === "LIGHT_DIFFUSE") s.diffuse = c;
        else s.specular = c;
        break;
      }
      case "WINDOW_TITLE":
        s.title = raw;
        break;
      case "SHOW_LIMITS":
        s.showLimits = raw === "" || !/^(0|false|no)$/i.test(raw);
        break;
      case "DEPTH":
        s.depth = true;
        break;
      case "BNW":
      case "GRAYSCALE":
        s.gray = true;
        break;
      case "COLOR":
        s.gray = false;
        s.depth = false;
        break;
      case "PERSP":
        s.ortho = false;
        break;
      case "ORTHO":
        s.ortho = true;
        break;
      case "WINDOWFIXED":
        s.windowFixed = true;
        break;
      case "WINDOWRESIZE":
        s.windowFixed = false;
        break;
      case "NO_TASKBAR":
        s.noTaskbar = true;
        break;
      case "MINIMIZED":
        s.minimized = true;
        break;
      case "DOCKED":
        s.docked = true;
        break;
      case "FLOATING":
        s.docked = false;
        break;
      case "POPUP":
        s.popup = true;
        break;
      default:
        break;
    }
  }
  if (!farSet && s.focal !== base.focal) s.far = s.focal + working;
  if (fovSet && s.fov <= 0) s.fov = (2 * Math.atan(2.7 / s.focal) * 180) / Math.PI;
  if (pixelSet && !fovSet) s.fov = (2 * Math.atan((s.pixelSize * 540) / (s.focal * 1000)) * 180) / Math.PI;
  else if (fovSet || s.focal !== base.focal) s.pixelSize = pixelSizeFor(s.fov, s.focal);
  return s;
}

 
export const paramsKeepClosed = (params: string) => /(^|\s)closed(\s|$)/i.test(params);

const num = (v: number) => String(Math.round(v * 1e6) / 1e6);






export function formatCameraSettings(s: CameraSettings, actual?: [number, number]): string {
  const snap = s.snapshot ?? [s.width, s.height];
  const parts = [
    `FOV=${num(s.fov)}`,
    `PixelSize=${num(s.pixelSize)}`,
    `Size=${s.width}x${s.height}`,
    `ActualSize=${(actual ?? [s.width, s.height]).join("x")}`,
    `Snapshot=${snap[0]}x${snap[1]}`,
    `FOCAL_LENGTH=${num(s.focal)}`,
    `FAR_LENGTH=${num(s.far)}`,
    `BG_COLOR=${formatColor(s.bg)}`,
  ];
  if (s.depth) parts.push("DEPTH");
  if (s.gray) parts.push("GRAYSCALE");
  parts.push(s.ortho ? "Ortho" : "Persp", s.windowFixed ? "WindowFixed" : "WindowResize");
  if (s.noTaskbar) parts.push("NO_TASKBAR");
  if (s.minimized) parts.push("MINIMIZED");
  if (s.docked) parts.push("Docked");
  return parts.join(" ");
}

 
export function snapshotKind(params: string, s: CameraSettings): "color" | "gray" | "depth" {
  const p = params.toUpperCase();
  if (p.includes("DEPTH")) return "depth";
  if (p.includes("GRAYSCALE") || p.includes("BNW")) return "gray";
  if (p.includes("COLOR") || p.includes("NORMAL")) return "color";
  return s.depth ? "depth" : s.gray ? "gray" : "color";
}
