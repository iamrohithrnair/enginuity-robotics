// Tracks browser view connections and coordinates screenshot requests and files.
 
 
 

import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, getServer } from "./store";

interface Pending {
  file: string;
  resolve(v: { path: string; width: number; height: number }): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface BridgeState {
  clients: number;
  channels?: number;
  pending: Map<string, Pending>;
}

declare global {
  var __robocraft_viewbridge: BridgeState | undefined;
}

function bridge(): BridgeState {
  if (!globalThis.__robocraft_viewbridge) globalThis.__robocraft_viewbridge = { clients: 0, pending: new Map() };
  return globalThis.__robocraft_viewbridge;
}

export const SCREENSHOT_DIR = path.join(DATA_DIR, "screenshots");

 
export function viewConnected() {
  bridge().clients += 1;
}
export function viewDisconnected() {
  bridge().clients = Math.max(0, bridge().clients - 1);
}
export const viewClients = () => bridge().clients;

 
export function eventChannelOpened() {
  bridge().channels = (bridge().channels ?? 0) + 1;
  getServer().services.emit?.({ type: "api-events", count: bridge().channels });
}
export function eventChannelClosed() {
  bridge().channels = Math.max(0, (bridge().channels ?? 0) - 1);
  getServer().services.emit?.({ type: "api-events", count: bridge().channels });
}
export const eventChannels = () => bridge().channels ?? 0;

 
export function screenshotPath(file: string): string {
  return path.isAbsolute(file) ? file : path.join(SCREENSHOT_DIR, file);
}

export function requestScreenshot(opts: { file: string; white: boolean }, timeoutMs = 20000): Promise<{ path: string; width: number; height: number }> {
  if (!viewClients()) return Promise.reject(new Error("No 3D view is open: open Enginuity in a browser to take screenshots"));
  const id = randomUUID();
  const format = /\.jpe?g$/i.test(opts.file) ? "jpeg" : "png";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge().pending.delete(id);
      reject(new Error("The 3D view did not answer the screenshot request"));
    }, timeoutMs);
    bridge().pending.set(id, { file: opts.file, resolve, reject, timer });
    getServer().services.emit?.({ type: "screenshot-request", id, white: opts.white, format });
  });
}

 
export function completeScreenshot(id: string, bytes: Uint8Array, width: number, height: number): boolean {
  const p = bridge().pending.get(id);
  if (!p) return false;
  bridge().pending.delete(id);
  clearTimeout(p.timer);
  try {
    const out = screenshotPath(p.file);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    p.resolve({ path: out, width, height });
  } catch (e) {
     
    p.reject(new Error(`Problems saving screenshot to ${p.file}: ${e instanceof Error ? e.message : String(e)}`));
  }
  return true;
}

export function failScreenshot(id: string, message: string) {
  const p = bridge().pending.get(id);
  if (!p) return;
  bridge().pending.delete(id);
  clearTimeout(p.timer);
  p.reject(new Error(message));
}
