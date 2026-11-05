// Completes pending viewport picks with selected items and coordinates.
import { connection } from "next/server";
import { completeViewPick } from "@/server/viewpick";

 
 
export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as { id?: string; item?: string | null; xyz?: number[]; error?: string } | null;
  if (!body?.id) return Response.json({ ok: false, error: "missing id" }, { status: 400 });
  if (body.error) return Response.json({ ok: completeViewPick(body.id, null) });
  const xyz = Array.isArray(body.xyz) && body.xyz.length === 3 ? body.xyz.map(Number) : [0, 0, 0];
  const ok = completeViewPick(body.id, { item: typeof body.item === "string" ? body.item : null, xyz: xyz.map((v) => (Number.isFinite(v) ? v : 0)) });
  return Response.json({ ok });
}
