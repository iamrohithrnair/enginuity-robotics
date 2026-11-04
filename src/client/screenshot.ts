"use client";

 
 
 
 

import { closeUp } from "@/components/viewport/EndEffectorView";
import { useRC } from "./store";

 
function backdrop(): [string, string] {
  const s = useRC.getState().settings;
  const dark = s.RC_THEME === "dark";
  const top = typeof s.ColorBgTop === "string" && s.ColorBgTop ? s.ColorBgTop : dark ? "#19191b" : "#f4f4f2";
  const bottom = typeof s.ColorBgBottom === "string" && s.ColorBgBottom ? s.ColorBgBottom : dark ? "#0e0e0f" : "#e4e4e1";
  return [top, bottom];
}

 
const nextFrame = () => new Promise<void>((r) => {
  const t = setTimeout(r, 300);
  requestAnimationFrame(() => {
    clearTimeout(t);
    r();
  });
});

export async function captureView(opts: { white?: boolean; format?: "png" | "jpeg" } = {}): Promise<{ dataUrl: string; width: number; height: number }> {
  const gl = document.querySelector<HTMLCanvasElement>("canvas[data-rc-main]");
  if (!gl) throw new Error("The 3D view is not open");
  closeUp.suppress = true;
  try {
     
    await nextFrame();
    await nextFrame();
    const out = document.createElement("canvas");
    out.width = gl.width;
    out.height = gl.height;
    const g = out.getContext("2d")!;
    if (opts.white) g.fillStyle = "#ffffff";
    else {
      const [top, bottom] = backdrop();
      const grad = g.createLinearGradient(0, 0, 0, out.height);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bottom);
      g.fillStyle = grad;
    }
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(gl, 0, 0);
    return { dataUrl: out.toDataURL(opts.format === "jpeg" ? "image/jpeg" : "image/png", 0.95), width: out.width, height: out.height };
  } finally {
    closeUp.suppress = false;
  }
}

let lastShot: string | null = null;
 
export const lastScreenshot = () => lastShot;

 
export async function answerScreenshotRequest(req: { id: string; white?: boolean; format?: "png" | "jpeg" }) {
  try {
    const shot = await captureView(req);
    lastShot = shot.dataUrl;
    await fetch("/api/screenshot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: req.id, ...shot }) });
  } catch (e) {
    await fetch("/api/screenshot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: req.id, error: e instanceof Error ? e.message : String(e) }) }).catch(() => undefined);
  }
}
