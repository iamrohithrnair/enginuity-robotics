import { connection } from "next/server";
import { lastClick, setViewPoseFromView } from "@/server/rdkapi/cmd-actions";
import { broadcast, getServer } from "@/server/store";
import { eventChannels } from "@/server/viewbridge";

 
 
 
 
const ALLOWED = new Set([3, 4, 7, 8, 10, 15]);

export async function GET() {
  await connection();
  return Response.json({ channels: eventChannels() });
}

export async function POST(request: Request) {
  await connection();
  const s = getServer();
  await s.ready;
  const b = (await request.json().catch(() => null)) as { id?: number; item?: string; ints?: number[]; array?: number[]; viewPose?: number[]; click?: number } | null;
  const id = Number(b?.id);
  if (!b || !ALLOWED.has(id)) return Response.json({ ok: false, error: "unsupported event" }, { status: 400 });
  if (b.item && !s.ws.items[b.item]) return Response.json({ ok: false, error: "unknown item" }, { status: 400 });
  if (id === 8 && Array.isArray(b.viewPose) && b.viewPose.length === 16) setViewPoseFromView(b.viewPose.map(Number));
  if (id === 15 && b.click !== undefined) lastClick.mode = Number(b.click);
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : undefined);
  broadcast({ type: "api-event", id, item: b.item, ints: nums(b.ints), array: nums(b.array) });
  return Response.json({ ok: true });
}
