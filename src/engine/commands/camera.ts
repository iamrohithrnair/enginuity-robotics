// Registers simulated camera setup, parameter editing and snapshot commands.
 
 
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { type Mat } from "../math";
import { CommandError, defineCommand, ItemRef, type CmdCtx, type Services } from "../registry";
import type { Item, Workspace } from "../types";
import {
  applyCameraParams,
  CAMERA_MSG,
  defaultCameraSettings,
  formatCameraSettings,
  formatColor,
  paramsKeepClosed,
  type CameraSettings,
} from "../utilities/camera";
import { encodePngCompressed, type PngInput } from "../utilities/png";
import { rasterize, toDepth32, toGray, type RasterImage } from "../utilities/raster";
import { sceneMeshes } from "../utilities/scene";
import { absPose, makeItem, stationOf } from "../workspace";
import { activeStationId, apiNoUndo } from "./items";

 
const ANCHORS = new Set(["frame", "object", "tool"]);

const viewAngle = (services: Pick<Services, "settings">) => Number(services.settings.ViewAngle ?? 30) || 30;

 
export function cameraSettings(services: Pick<Services, "settings">, cam: Item): CameraSettings {
  return applyCameraParams(defaultCameraSettings(viewAngle(services)), cam.camera?.params ?? "");
}

 
export function serializeCameraSettings(s: CameraSettings): string {
  const parts = [
    `FOV=${s.fov}`,
    `FOCAL_LENGTH=${s.focal}`,
    `FAR_LENGTH=${s.far}`,
    `SIZE=${s.width}x${s.height}`,
    ...(s.snapshot ? [`SNAPSHOT=${s.snapshot[0]}x${s.snapshot[1]}`] : []),
    `BG_COLOR=${formatColor(s.bg)}`,
    `LIGHT_AMBIENT=${formatColor(s.ambient)}`,
    `LIGHT_DIFFUSE=${formatColor(s.diffuse)}`,
    `LIGHT_SPECULAR=${formatColor(s.specular)}`,
    s.depth ? "DEPTH" : "",
    s.gray ? "GRAYSCALE" : "",
    s.ortho ? "ORTHO" : "PERSP",
    s.windowFixed ? "WINDOWFIXED" : "WINDOWRESIZE",
    s.noTaskbar ? "NO_TASKBAR" : "",
    s.minimized ? "MINIMIZED" : "",
    s.docked ? "DOCKED" : "",
    s.popup ? "POPUP" : "",
    s.showLimits ? "SHOW_LIMITS=1" : "",
    s.title ? `WINDOW_TITLE="${s.title.replace(/"/g, "'")}"` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export function requireCamera(ws: Workspace, ref: string | number | undefined): Item {
  if (ref === undefined) {
    const sel = ws.selection.map((id) => ws.items[id]).find((i) => i?.type === "camera");
    if (sel) return sel;
    throw new CommandError("Select a camera");
  }
  const it = requireRef(ws, ref, "camera");
  if (it.type !== "camera" || !it.camera) throw new CommandError(`${it.name} is not a camera`);
  return it;
}

 
export function cameraPose(ws: Workspace, cam: Item): Mat {
  const link = cam.camera?.link ? ws.items[cam.camera.link] : undefined;
  return absPose(ws, link?.id ?? cam.id);
}

 
function anchorFor(ws: Workspace, ref: string | number | undefined): Item {
  if (ref !== undefined && ref !== "") {
    const it = requireRef(ws, ref, "camera location");
    if (!ANCHORS.has(it.type)) throw new CommandError(CAMERA_MSG.selectLocation);
    return it;
  }
  const sel = ws.selection.map((id) => ws.items[id]).find((i) => i && ANCHORS.has(i.type));
  if (!sel) throw new CommandError(CAMERA_MSG.needLocation);
  return sel;
}

 
export function addCamera(ctx: CmdCtx, anchor: Item, params: string): Item {
  const { ws, tx, services } = ctx;
  const station = stationOf(ws, anchor.id)?.id ?? activeStationId(ws);
  const count = Object.values(ws.items).filter((i) => i.type === "camera" && stationOf(ws, i.id)?.id === station).length;
  const settings = applyCameraParams(defaultCameraSettings(viewAngle(services)), params);
  const cam = makeItem(ws, "camera", `Camera ${count + 1}`, { camera: { link: anchor.id, params: serializeCameraSettings(settings), open: !paramsKeepClosed(params) } });
  tx.add(cam, station);
  ctx.undoLabel = `Add: ${cam.name}`;
  return cam;
}

 
export function cameraInfo(ws: Workspace, services: Pick<Services, "settings">, cam: Item) {
  const s = cameraSettings(services, cam);
  return {
    camera: cam.name,
    id: cam.id,
    attachedTo: cam.camera?.link ? (ws.items[cam.camera.link]?.name ?? null) : null,
    open: !!cam.camera?.open,
    settings: formatCameraSettings(s),
    fov: s.fov,
    focalLength: s.focal,
    farLength: s.far,
    pixelSize: s.pixelSize,
    size: [s.width, s.height],
    snapshotSize: s.snapshot ?? [s.width, s.height],
    pose: cameraPose(ws, cam),
  };
}

export type SnapshotKind = "color" | "gray" | "depth";

 
export function renderCamera(
  ws: Workspace,
  services: Pick<Services, "settings" | "geometry">,
  cam: Item,
  opts: { width?: number; height?: number } = {},
): { img: RasterImage; settings: CameraSettings } {
  const s = cameraSettings(services, cam);
  const [w0, h0] = s.snapshot ?? [s.width, s.height];
  const width = Math.max(1, Math.min(8192, Math.round(opts.width ?? w0)));
  const height = Math.max(1, Math.min(8192, Math.round(opts.height ?? (opts.width ? (opts.width * h0) / w0 : h0))));
  const station = stationOf(ws, cam.id)?.id ?? ws.activeStation;
  const meshes = station ? sceneMeshes(ws, services.geometry, station) : [];
  const img = rasterize(meshes, { pose: cameraPose(ws, cam), fov: s.fov, near: s.focal, far: s.far, width, height, ortho: s.ortho }, { bg: s.bg, ambient: s.ambient, diffuse: s.diffuse, specular: s.specular });
  return { img, settings: s };
}

 
export function imageRgb(img: RasterImage): Uint8Array {
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) {
    rgb[i * 3] = img.rgba[i * 4];
    rgb[i * 3 + 1] = img.rgba[i * 4 + 1];
    rgb[i * 3 + 2] = img.rgba[i * 4 + 2];
  }
  return rgb;
}





export async function renderCameraPng(
  ws: Workspace,
  services: Pick<Services, "settings" | "geometry">,
  cam: Item,
  opts: { kind?: SnapshotKind; width?: number; height?: number } = {},
): Promise<{ png: Uint8Array; width: number; height: number; kind: SnapshotKind; img: RasterImage }> {
  const { img, settings: s } = renderCamera(ws, services, cam, opts);
  const kind = opts.kind ?? (s.depth ? "depth" : s.gray ? "gray" : "color");
  const { width, height } = img;
  let input: PngInput;
  if (kind === "gray") input = { width, height, channels: 1, data: toGray(img) };
  else if (kind === "depth") {
    const d32 = toDepth32(img, s.focal, s.far);
    const d16 = new Uint16Array(d32.length);
    for (let i = 0; i < d32.length; i++) d16[i] = d32[i] >>> 16;
    input = { width, height, channels: 1, bitDepth: 16, data: d16 };
  } else input = { width, height, channels: 3, data: imageRgb(img) };
  return { png: await encodePngCompressed(input), width, height, kind, img };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

defineCommand({
  name: "camera.add",
  title: "Simulate 2D Camera",
  description:
    "Add a simulated 2D camera (Connect ▸ Simulate 2D Camera) attached to a reference frame, object or tool: the camera looks along the Z axis of that item (X right, Y down the image). Creates the item \"Camera N\" and opens its view window unless params contain Closed. `params` uses the camera parameter grammar, e.g. \"FOCAL_LENGTH=6 FOV=32 FAR_LENGTH=1000 SIZE=640x480 BG_COLOR=black GRAYSCALE\" (defaults: focal length 5 mm, FOV 30°, far length 2005 mm). Pass `camera` to change the settings of an existing camera and open it.",
  category: "tools",
  spec: "B-CONN-09",
  schema: z.object({
    attachTo: ItemRef.optional().describe("reference frame, object or tool the camera follows (default: the selection)"),
    params: z.string().default(""),
    camera: ItemRef.optional().describe("existing camera to update and open"),
  }),
  run(ctx, p) {
    const { ws, tx, services } = ctx;
    if (p.camera !== undefined && p.camera !== "") {
      const cam = requireCamera(ws, p.camera);
      const settings = applyCameraParams(cameraSettings(services, cam), p.params);
      const link = p.attachTo !== undefined ? anchorFor(ws, p.attachTo).id : cam.camera!.link;
      tx.set(cam.id, { camera: { link, params: serializeCameraSettings(settings), open: !paramsKeepClosed(p.params) } });
      ctx.undoLabel = null;
      return cameraInfo(ws, services, ws.items[cam.id]);
    }
    const cam = addCamera(ctx, anchorFor(ws, p.attachTo), p.params);
    apiNoUndo(ctx);
    return cameraInfo(ws, services, ws.items[cam.id] ?? cam);
  },
});

defineCommand({
  name: "camera.setParams",
  title: "Camera Settings",
  description:
    "Change a simulated camera's settings with the camera parameters (FOV, FOCAL_LENGTH, FAR_LENGTH, PIXELSIZE, SIZE=WxH, SNAPSHOT=WxH, BG_COLOR, LIGHT_AMBIENT/DIFFUSE/SPECULAR, DEPTH, GRAYSCALE, COLOR, PERSP/ORTHO, SHOW_LIMITS=1, WINDOW_TITLE=…). Returns the camera's settings read-back.",
  category: "tools",
  spec: "B-CONN-09",
  schema: z.object({ camera: ItemRef.optional(), params: z.string() }),
  run(ctx, p) {
    const cam = requireCamera(ctx.ws, p.camera);
    const settings = applyCameraParams(cameraSettings(ctx.services, cam), p.params);
    ctx.tx.set(cam.id, { camera: { ...cam.camera!, params: serializeCameraSettings(settings) } });
    ctx.undoLabel = ctx.origin === "api" ? null : `Camera settings: ${cam.name}`;
    return cameraInfo(ctx.ws, ctx.services, ctx.ws.items[cam.id]);
  },
});

defineCommand({
  name: "camera.setLocation",
  title: "Camera Location",
  description: "Attach a simulated camera to another reference frame, object or tool (the camera follows that item's pose).",
  category: "tools",
  spec: "B-CONN-09",
  schema: z.object({ camera: ItemRef.optional(), attachTo: ItemRef }),
  run(ctx, p) {
    const cam = requireCamera(ctx.ws, p.camera);
    const anchor = anchorFor(ctx.ws, p.attachTo);
    ctx.tx.set(cam.id, { camera: { ...cam.camera!, link: anchor.id } });
    ctx.undoLabel = `Camera location: ${cam.name}`;
    apiNoUndo(ctx);
    return { camera: cam.name, attachedTo: anchor.name };
  },
});

defineCommand({
  name: "camera.window",
  title: "Show Camera",
  description: "Open or close a simulated camera's view window (all cameras when `camera` is omitted and open=false, like Cam2D_CloseAll).",
  category: "tools",
  undoable: false,
  spec: "B-CONN-09",
  schema: z.object({ camera: ItemRef.optional(), open: z.boolean() }),
  run(ctx, p) {
    const { ws, tx } = ctx;
    ctx.undoLabel = null;
    if (p.camera === undefined && !p.open) {
      const cams = Object.values(ws.items).filter((i) => i.type === "camera" && i.camera?.open);
      for (const c of cams) tx.set(c.id, { camera: { ...c.camera!, open: false } });
      return { closed: cams.map((c) => c.name) };
    }
    const cam = requireCamera(ws, p.camera);
    if (cam.camera!.open !== p.open) tx.set(cam.id, { camera: { ...cam.camera!, open: p.open } });
    return { camera: cam.name, open: p.open };
  },
});

defineCommand({
  name: "camera.info",
  title: "Camera Information",
  description: "Settings read-back, attachment, window state and pose (station coordinates) of a simulated camera; without `camera`, lists every camera.",
  category: "tools",
  readonly: true,
  undoable: false,
  spec: "B-CONN-09",
  schema: z.object({ camera: ItemRef.optional() }),
  run(ctx, p) {
    if (p.camera === undefined) {
      const sel = ctx.ws.selection.map((id) => ctx.ws.items[id]).find((i) => i?.type === "camera");
      if (!sel) return { cameras: Object.values(ctx.ws.items).filter((i) => i.type === "camera").map((c) => cameraInfo(ctx.ws, ctx.services, c)) };
    }
    return cameraInfo(ctx.ws, ctx.services, requireCamera(ctx.ws, p.camera));
  },
});

defineCommand({
  name: "camera.snapshot",
  title: "Take Snapshot",
  description:
    "Render what a simulated camera sees (Take snapshot / Cam2D_Snapshot) as a PNG: kind 'color' (RGB), 'gray' (8-bit) or 'depth' (16-bit, white = close, black = far); defaults to the camera's own mode and snapshot size. width/height override the size. save=true writes the PNG to Enginuity's exports folder and returns the path; inline (default except for the agent) returns the image as base64 `png` and a `dataUrl`.",
  category: "tools",
  readonly: true,
  undoable: false,
  spec: "B-CONN-09",
  schema: z.object({
    camera: ItemRef.optional(),
    kind: z.enum(["color", "gray", "depth"]).optional(),
    width: z.number().int().min(1).max(8192).optional(),
    height: z.number().int().min(1).max(8192).optional(),
    save: z.boolean().default(false),
    inline: z.boolean().optional(),
  }),
  async run(ctx, p) {
    const cam = requireCamera(ctx.ws, p.camera);
    const shot = await renderCameraPng(ctx.ws, ctx.services, cam, { kind: p.kind, width: p.width, height: p.height });
    let file: string | undefined;
    if (p.save) {
      if (!ctx.services.files?.writeExport) throw new CommandError("Snapshots are saved by the Enginuity server");
      file = ctx.services.files.writeExport(`${cam.name.replace(/[\\/:*?"<>| ]+/g, "_")}_snapshot.png`, shot.png);
    }
    const inline = p.inline ?? ctx.origin !== "agent";
    const b64 = inline ? toBase64(shot.png) : undefined;
    return {
      camera: cam.name,
      kind: shot.kind,
      width: shot.width,
      height: shot.height,
      bytes: shot.png.length,
      ...(file ? { file } : {}),
      ...(b64 ? { png: b64, dataUrl: `data:image/png;base64,${b64}` } : {}),
    };
  },
});
