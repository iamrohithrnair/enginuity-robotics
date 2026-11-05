// Serves cached triangle geometry as a binary response.
import { getServer } from "@/server/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/geometry/[id]">) {
  const { id } = await ctx.params;
  const s = getServer();
  await s.ready;
  const tri = s.services.geometry.get(id);
  if (!tri) return new Response("not found", { status: 404 });
  const body = tri.slice().buffer as ArrayBuffer;
  return new Response(body, {
    headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" },
  });
}
