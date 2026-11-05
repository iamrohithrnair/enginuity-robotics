// Captures viewport or simulated-camera images for decision-model requests.
 
 
 

import "server-only";
import { readFileSync, unlinkSync } from "node:fs";
import { cameraSettings, renderCameraPng, requireCamera } from "@/engine/commands/camera";
import { getServer } from "../store";

 
const MAX_SIDE = 1024;

export async function snapshot(src: { view: true } | { camera: string }): Promise<string> {
  const { ws, services } = getServer();
  if ("view" in src) {
    if (!services.view) throw new Error("the 3D view cannot be captured on this server");
    const shot = await services.view.screenshot({ file: `decision-input-${Date.now()}.png`, white: false });
    const bytes = readFileSync(shot.path);
    try {
      unlinkSync(shot.path);
    } catch {
       
    }
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }
  const cam = requireCamera(ws, src.camera);
   
  const s = cameraSettings(services, cam);
  const [w, h] = s.snapshot ?? [s.width, s.height];
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const shot = await renderCameraPng(ws, services, cam, { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) });
  return `data:image/png;base64,${Buffer.from(shot.png).toString("base64")}`;
}
