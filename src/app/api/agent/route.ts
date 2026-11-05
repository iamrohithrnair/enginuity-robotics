// Serves Copilot status and streams chat responses.
import { chat, resetChat, wakeGuard } from "@/server/agent";
import { byok, copilotInfo, requestScope } from "@/server/copilot/config";
import { parseImages } from "@/server/copilot/vision";
import { getServer } from "@/server/store";

 
 
 
 
export async function GET(request: Request) {
  await getServer().ready;
  if (!byok()) wakeGuard();
  const s = requestScope(request.headers);
  return Response.json(copilotInfo(s.settings, s.env), { headers: { "cache-control": "no-store" } });
}

 
 
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { conversation?: string; message?: string; reset?: boolean; images?: unknown };
  const conversation = body.conversation || "default";
  if (body.reset) {
    resetChat(conversation);
    return Response.json({ ok: true });
  }
  let images;
  try {
    images = parseImages(body.images);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid photos" }, { status: 400 });
  }
  const text = typeof body.message === "string" ? body.message : "";
  if (!text.trim() && !images.length) return Response.json({ error: "Empty message" }, { status: 400 });
  const message = text.trim() ? text : images.length > 1 ? "Build a robot cell that matches these photos." : "Build a robot cell that matches this photo.";
  const encoder = new TextEncoder();
  const gen = chat(conversation, message, requestScope(request.headers), images);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
