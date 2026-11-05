// Forwards dialog button and text responses to the server runner.
import { getServer } from "@/server/store";

 
export async function POST(request: Request) {
  const s = getServer();
  await s.ready;
  const body = (await request.json().catch(() => ({}))) as { id?: string; button?: string; text?: unknown };
  if (!body.id || !body.button) return Response.json({ ok: false, error: "id and button are required" }, { status: 400 });
   
  const text = typeof body.text === "string" ? body.text : undefined;
  return Response.json({ ok: s.runner?.answer(body.id, body.button, text) ?? false });
}
