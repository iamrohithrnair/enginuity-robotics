 
 
 
 
 

import "server-only";
import { snapshotStation } from "@/engine/commands/station";
import { stationFileName } from "@/engine/stationFile";
import type { ServerState } from "./store";

const pad = (n: number) => String(n).padStart(2, "0");

 
export function backupFileName(stationName: string, at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}h${pad(at.getMinutes())}m${pad(at.getSeconds())}s`;
  return stationFileName(`${stationName.replace(/[^\w .()-]+/g, "_")} - Auto saved on ${stamp}`);
}





export function autoBackupTick(state: ServerState, now: number, last: { at: number }): "off" | "wait" | "clean" | "saved" | "failed" {
  const s = state.services;
  const on = Number(s.settings.AutoBackup_On ?? 0) !== 0 && s.settings.AutoBackup_On !== false;
  if (!on) return "off";
  const minutes = Math.max(0.1, Number(s.settings.AutoBackup_Min ?? 5));
  if (now - last.at < minutes * 60_000) return "wait";
  last.at = now;
  const st = state.ws.activeStation;
  if (!st || !state.ws.items[st] || !s.files?.writeBackup) return "clean";
  if (state.undo.stack(st).isClean()) {
     
    console.log("Auto backup already done, empty station or station is in saved state");
    return "clean";
  }
  const name = state.ws.items[st].name;
  try {
    const file = s.files.writeBackup(name, snapshotStation(state.ws, st));
    s.emit?.({ type: "status", text: `Saving auto backup: ${file}   Please wait...`, ms: 10000 });
    return "saved";
  } catch {
    s.emit?.({ type: "status", text: "Unable to access temporary folder to save station", ms: 10000 });
    return "failed";
  }
}

declare global {
  var __robocraftBackupTimer: ReturnType<typeof setInterval> | undefined;
}

export function startAutoBackup(state: ServerState) {
  if (globalThis.__robocraftBackupTimer) clearInterval(globalThis.__robocraftBackupTimer);
  const last = { at: Date.now() };
  globalThis.__robocraftBackupTimer = setInterval(() => autoBackupTick(state, Date.now(), last), 15_000);
  globalThis.__robocraftBackupTimer.unref?.();
}
