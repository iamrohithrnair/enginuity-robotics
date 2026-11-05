// Proxies image assets from the robot library.
import { connection } from "next/server";
import { LibraryError, libraryImage } from "@/server/library";

 
 
 
export async function GET(_req: Request, ctx: RouteContext<"/api/library/image/[...path]">) {
  await connection();
  const { path } = await ctx.params;
  try {
    const img = await libraryImage(path.join("/"));
    return new Response(img.bytes, {
      headers: { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof LibraryError ? err.status : 502 });
  }
}
