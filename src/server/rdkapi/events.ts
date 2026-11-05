// Streams workspace events over dedicated API event-channel connections.
 
 
 
 

import type { Socket } from "node:net";
import type { Item, Workspace } from "@/engine/types";
import { getServer, type ServerEvent } from "@/server/store";
import { typeCode } from "./bridge";
import { WireWriter } from "./codec";
import { def } from "./context";
import { eventChannelClosed, eventChannelOpened } from "@/server/viewbridge";

export const EVENT = {
  SELECTION_TREE_CHANGED: 1,
  TOOL_MODIFIED: 5,
  ROBOT_MOVED: 9,
  ITEM_MOVED_POSE: 11,
  ITEM_CHANGED: 16,
  ITEM_RENAMED: 17,
  ITEM_VISIBILITY: 18,
  STATION_CHANGED: 19,
} as const;

interface Snap {
  name: string;
  visible: boolean;
  parent: string | null;
  pose: string;
  joints: string;
  children: string;
}

const snapOf = (it: Item): Snap => ({
  name: it.name,
  visible: it.visible,
  parent: it.parent,
  pose: it.pose.join(","),
  joints: it.robot?.joints.join(",") ?? "",
  children: it.children.join(","),
});

for (const name of ["RDK_EVT", "RDK_EVT_FILTER"]) {
  def(name, "", async (c) => {
    let filter: number[] | null = null;
    if (name === "RDK_EVT_FILTER") {
      const n = await c.r.int();
      filter = [];
      for (let i = 0; i < n; i++) filter.push(await c.r.int());
    }
    await c.r.int();  
    c.w.line("RDK_EVT").int(1).status(0);
    c.flush();
    c.startEvents(filter);
    return "raw";
  });
}

export function startEventChannel(socket: Socket, filter: number[] | null, log: (m: string) => void) {
  const s = getServer();
  const ws = (): Workspace => s.ws;
  const snaps = new Map<string, Snap>();
  for (const it of Object.values(ws().items)) snaps.set(it.id, snapOf(it));
  let selection = ws().selection.join(",");
  let station = ws().activeStation;
  const lastLive = new Map<string, number>();

  const wants = (id: number) => !filter || filter.includes(id);
  const send = (id: number, it: Item | undefined, extra?: (w: WireWriter) => void) => {
    if (!wants(id) || socket.destroyed) return;
    const w = new WireWriter().int(id);
    if (it) w.item(it.handle, typeCode(it));
    else w.nullItem();
    extra?.(w);
    socket.write(w.toBuffer());
  };

  const onEvent = (e: ServerEvent) => {
    try {
      const w = ws();
      if (e.type === "live") {
        const robot = w.items[String(e.robot)];
        const now = Date.now();
        if (robot && now - (lastLive.get(robot.id) ?? 0) > 33) {
          lastLive.set(robot.id, now);
          send(EVENT.ROBOT_MOVED, robot);
        }
        return;
      }
      if (e.type === "api-event") {
         
         
        const it = e.item ? w.items[String(e.item)] : undefined;
        send(Number(e.id), it, (ww) => {
          for (const n of (e.ints as number[] | undefined) ?? []) ww.int(n);
          if (Array.isArray(e.array)) ww.array(e.array as number[]);
        });
        return;
      }
      if (e.type === "snapshot") {
        snaps.clear();
        for (const it of Object.values(w.items)) snaps.set(it.id, snapOf(it));
        send(EVENT.STATION_CHANGED, w.activeStation ? w.items[w.activeStation] : undefined);
        send(EVENT.ITEM_CHANGED, undefined);
        return;
      }
      if (e.type !== "patch") return;
      const patch = e.patch as { upserts: Item[]; removes: string[] };
      let treeChanged = patch.removes.length > 0;
      for (const id of patch.removes) snaps.delete(id);
      for (const up of patch.upserts) {
        const it = w.items[up.id] ?? up;
        const prev = snaps.get(it.id);
        const next = snapOf(it);
        snaps.set(it.id, next);
        if (!prev) {
          treeChanged = true;
          continue;
        }
        if (prev.parent !== next.parent || prev.children !== next.children) treeChanged = true;
        if (prev.name !== next.name) send(EVENT.ITEM_RENAMED, it, (ww) => ww.line(it.name));
        if (prev.visible !== next.visible) send(EVENT.ITEM_VISIBILITY, it, (ww) => ww.array([it.visible ? 1 : 0, it.visible ? 1 : 0]));
        if (prev.joints !== next.joints && it.type === "robot") send(EVENT.ROBOT_MOVED, it);
        if (prev.pose !== next.pose) send(EVENT.ITEM_MOVED_POSE, it, (ww) => ww.int(16).pose(it.pose));
         
        if (prev.pose !== next.pose && it.type === "tool") send(EVENT.TOOL_MODIFIED, it);
      }
      const sel = w.selection.join(",");
      if (sel !== selection) {
        selection = sel;
        send(EVENT.SELECTION_TREE_CHANGED, w.selection.length ? w.items[w.selection[0]] : undefined);
      }
      if (w.activeStation !== station) {
        station = w.activeStation;
        send(EVENT.STATION_CHANGED, station ? w.items[station] : undefined);
      }
      if (treeChanged) send(EVENT.ITEM_CHANGED, undefined);
    } catch (err) {
      log(`Event channel error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  s.listeners.add(onEvent);
  eventChannelOpened();
  let stopped = false;
  const stop = () => {
    s.listeners.delete(onEvent);
    if (!stopped) eventChannelClosed();
    stopped = true;
  };
  socket.on("close", stop);
  socket.on("error", stop);
  log("Events loop started");
}
