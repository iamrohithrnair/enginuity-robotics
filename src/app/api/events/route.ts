import { connection } from "next/server";
import { getServer, type ServerEvent } from "@/server/store";
import { eventChannels, viewConnected, viewDisconnected } from "@/server/viewbridge";

 
export async function GET(request: Request) {
   
   
  await connection();
  const s = getServer();
  await s.ready;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: ServerEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send({ type: "snapshot", ws: s.ws });
      send({ type: "api-events", count: eventChannels() });
      for (const d of s.runner?.pendingDialogs() ?? []) send(d);
      for (const d of s.services.posts?.pendingPicks?.() ?? []) send(d as ServerEvent);
      s.listeners.add(send);
      viewConnected();
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);
      let closed = false;
      cleanup = () => {
        clearInterval(ping);
        s.listeners.delete(send);
        if (!closed) viewDisconnected();
        closed = true;
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
           
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
       
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
