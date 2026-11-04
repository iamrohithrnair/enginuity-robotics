import { connection } from "next/server";
import { getServer, type ServerEvent } from "@/server/store";
import { eventChannels, viewConnected, viewDisconnected } from "@/server/viewbridge";

 
 
 
 

const KEEP = 4000;  
const WAIT_MS = 20_000;
const BATCH_MS = 40;  
const GONE_MS = 45_000;  

interface Log {
  seq: number;
  events: { seq: number; e: ServerEvent }[];
  waiters: Set<() => void>;
  clients: Map<string, ReturnType<typeof setTimeout>>;
}
declare global {
  var __enginuityPollLog: Log | undefined;
}

function log(): Log {
  if (globalThis.__enginuityPollLog) return globalThis.__enginuityPollLog;
  const l: Log = { seq: 0, events: [], waiters: new Set(), clients: new Map() };
  globalThis.__enginuityPollLog = l;
  getServer().listeners.add((e: ServerEvent) => {
    l.events.push({ seq: ++l.seq, e });
    if (l.events.length > KEEP) l.events.splice(0, l.events.length - KEEP);
    for (const w of l.waiters) w();
  });
  return l;
}

 
function seen(l: Log, client: string) {
  const t = l.clients.get(client);
  if (t) clearTimeout(t);
  else viewConnected();
  l.clients.set(
    client,
    setTimeout(() => {
      l.clients.delete(client);
      viewDisconnected();
    }, GONE_MS),
  );
}

export async function GET(request: Request) {
  await connection();
  const s = getServer();
  await s.ready;
  const l = log();
  const url = new URL(request.url);
  const client = (url.searchParams.get("client") ?? "").slice(0, 64);
  if (client) seen(l, client);
  const after = Number(url.searchParams.get("after"));
  const headers = { "cache-control": "no-store" };
   
  if (!url.searchParams.has("after") || !Number.isFinite(after) || (l.events.length && after < l.events[0].seq - 1) || after > l.seq) {
    const events: ServerEvent[] = [{ type: "snapshot", ws: s.ws }, { type: "api-events", count: eventChannels() }];
    for (const d of s.runner?.pendingDialogs() ?? []) events.push(d);
    for (const d of s.services.posts?.pendingPicks?.() ?? []) events.push(d as ServerEvent);
    return Response.json({ seq: l.seq, events }, { headers });
  }
  if (l.seq <= after) {
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        l.waiters.delete(wake);
        resolve();
      };
      const wake = () => {
        clearTimeout(timer);
        timer = setTimeout(done, BATCH_MS);
      };
      timer = setTimeout(done, WAIT_MS);
      l.waiters.add(wake);
      request.signal.addEventListener("abort", done);
    });
  }
  return Response.json({ seq: l.seq, events: l.events.filter((x) => x.seq > after).map((x) => x.e) }, { headers });
}
