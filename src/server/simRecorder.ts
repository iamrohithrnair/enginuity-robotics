// Attaches simulation pose recording and portable viewer assets to server services.
 
 
 
 

import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSimRecorder } from "@/engine/simExport";
import { apiState } from "./rdkapi/context";
import type { ServerState } from "./store";

const TICK_MS = 40;

declare global {
  var __robocraft_simrec: ReturnType<typeof createSimRecorder> | undefined;
}

export function attachSimRecorder(state: ServerState) {
  if (!globalThis.__robocraft_simrec) {
    const rec = createSimRecorder(() => state.ws);
    globalThis.__robocraft_simrec = rec;
    state.listeners.add((e) => rec.onEvent(e));
    setInterval(() => rec.tick(), TICK_MS).unref?.();
  }
  state.services.simRecorder = globalThis.__robocraft_simrec;
  state.services.simViewerScript = () => readFileSync(path.join(  process.cwd(), "public", "sim-viewer", "sim-viewer.js"), "utf8");
}

 
 
const running = globalThis.__robocraft;
if (running && !running.services.simRecorder) attachSimRecorder(running);
if (running?.services.view && !running.services.view.pose) running.services.view.pose = () => apiState().viewPose;
