// Serves spray-gun metadata and binary particle chunks.
import { connection } from "next/server";
import { gunByKey, PARTICLE_BYTES, stationMeta } from "@/engine/spray";
import { getServer } from "@/server/store";

 
const CHUNK = 262_144;

 
 
 
 
 
 
 
export async function GET(request: Request) {
  await connection();
  const s = getServer();
  await s.ready;
  const url = new URL(request.url);
  const key = url.searchParams.get("gun");
  if (!key) return Response.json({ station: s.ws.activeStation, guns: stationMeta(s.ws.activeStation), bytesPerParticle: PARTICLE_BYTES });
  const gun = gunByKey(key);
  if (!gun) return new Response(null, { status: 404 });
  const from = Math.max(0, Math.floor(Number(url.searchParams.get("from") ?? 0)) || 0);
  const to = Math.min(gun.particles.count, from + CHUNK);
  const bytes = gun.particles.bytes(from, to);
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-spray-from": String(from),
      "x-spray-to": String(Math.max(from, to)),
      "x-spray-count": String(gun.particles.count),
    },
  });
}
