// Reads and transactionally updates ordered station parameter lists.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import type { Tx } from "./tx";
import type { Item, Workspace } from "./types";

export type StationParam = [name: string, value: string];

 
export function paramStation(ws: Workspace, stationId?: string | null): Item | undefined {
  const id = stationId ?? ws.activeStation;
  const st = id ? ws.items[id] : undefined;
  return st?.type === "station" ? st : undefined;
}

 
export function stationParamList(ws: Workspace, stationId?: string | null): StationParam[] {
  return paramStation(ws, stationId)?.stationParams ?? [];
}

 
export function paramsView(list: readonly StationParam[]): Record<string, string> {
  const seen = new Set<string>();
  return Object.fromEntries(list.filter(([name]) => !seen.has(name) && (seen.add(name), true)));
}

 
export function stationParams(ws: Workspace, stationId?: string | null): Record<string, string> {
  return paramsView(stationParamList(ws, stationId));
}

 
export function getStationParam(ws: Workspace, name: string, stationId?: string | null): string | undefined {
  return stationParamList(ws, stationId).find(([k]) => k === name)?.[1];
}

export type SetParamResult = "added" | "changed" | "removed" | "unchanged";






export function setStationParam(ctx: { ws: Workspace; tx: Tx }, name: string, value: string, stationId?: string | null): SetParamResult | null {
  const st = paramStation(ctx.ws, stationId);
  if (!st) return null;
  const list = st.stationParams ?? [];
  const i = list.findIndex(([k]) => k === name);
  let next: StationParam[];
  let result: SetParamResult;
  if (i < 0) {
    next = [...list, [name, value]];
    result = "added";
  } else if (value === "") {
    next = list.filter((_, j) => j !== i);
    result = "removed";
  } else if (list[i][1] === value) {
    return "unchanged";
  } else {
    next = list.map((e, j) => (j === i ? [name, value] : e));
    result = "changed";
  }
  ctx.tx.set(st.id, { stationParams: next });
  return result;
}

 
export function deleteStationParam(ctx: { ws: Workspace; tx: Tx }, name: string, stationId?: string | null): boolean {
  const st = paramStation(ctx.ws, stationId);
  const list = st?.stationParams ?? [];
  if (!st || !list.some(([k]) => k === name)) return false;
  ctx.tx.set(st.id, { stationParams: list.filter(([k]) => k !== name) });
  return true;
}
