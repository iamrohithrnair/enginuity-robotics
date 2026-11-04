import { connection } from "next/server";
import { completeScreenshot, failScreenshot } from "@/server/viewbridge";

 
 
export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as { id?: string; dataUrl?: string; width?: number; height?: number; error?: string } | null;
  if (!body?.id) return Response.json({ ok: false, error: "missing id" }, { status: 400 });
  if (body.error) {
    failScreenshot(body.id, body.error);
    return Response.json({ ok: true });
  }
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body.dataUrl ?? "");
  if (!m) return Response.json({ ok: false, error: "expected a PNG or JPEG data URL" }, { status: 400 });
  const ok = completeScreenshot(body.id, new Uint8Array(Buffer.from(m[2], "base64")), Number(body.width ?? 0), Number(body.height ?? 0));
  return Response.json({ ok });
}
