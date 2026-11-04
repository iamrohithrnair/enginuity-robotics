 
 
 
 
 

import "server-only";
import { randomUUID } from "node:crypto";
import { getServer } from "./store";
import { viewClients } from "./viewbridge";

export interface ViewPickResult {
   
  item: string | null;
   
  xyz: number[];
}

interface Pending {
  resolve(v: ViewPickResult | null): void;
  timer: ReturnType<typeof setTimeout>;
}

declare global {
  var __enginuity_viewpick: Map<string, Pending> | undefined;
}

function pending(): Map<string, Pending> {
  if (!globalThis.__enginuity_viewpick) globalThis.__enginuity_viewpick = new Map();
  return globalThis.__enginuity_viewpick;
}






export function requestViewPick(x: number, y: number, timeoutMs = 5000): Promise<ViewPickResult | null> {
  if (!viewClients()) return Promise.resolve(null);
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending().delete(id);
      resolve(null);
    }, timeoutMs);
    pending().set(id, { resolve, timer });
    getServer().services.emit?.({ type: "view-pick-request", id, x, y });
  });
}

 
export function completeViewPick(id: string, result: ViewPickResult | null): boolean {
  const p = pending().get(id);
  if (!p) return false;
  pending().delete(id);
  clearTimeout(p.timer);
  p.resolve(result);
  return true;
}
