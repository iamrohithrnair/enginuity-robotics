// Lists pending post-processor picks and accepts selections.
import { connection } from "next/server";
import { getServer } from "@/server/store";

 
 
export async function POST(request: Request) {
  const s = getServer();
  await s.ready;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; post?: unknown };
  if (typeof body.id !== "string") return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  const post = typeof body.post === "string" && body.post ? body.post : null;
  return Response.json({ ok: s.services.posts?.answerPick?.(body.id, post) ?? false });
}

 
export async function GET() {
   
  await connection();
  const s = getServer();
  await s.ready;
  return Response.json({ picks: s.services.posts?.pendingPicks?.() ?? [] });
}
