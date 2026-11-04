import { setProfileKey } from "@/server/decisions/profiles";
import { getServer } from "@/server/store";

 
 
 
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { profile?: string; apiKey?: string | null };
  if (!body.profile) return Response.json({ error: "profile is required" }, { status: 400 });
  try {
    const profile = setProfileKey(body.profile, typeof body.apiKey === "string" ? body.apiKey : null);
    getServer().services.emit?.({ type: "decision-profiles" });
    return Response.json({ ok: true, profile });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
