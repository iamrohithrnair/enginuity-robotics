import { connection } from "next/server";
import { exampleThumbnail } from "@/server/examples";

 
 
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await ctx.params;
  try {
    return new Response(exampleThumbnail(slug) as Uint8Array<ArrayBuffer>, {
      headers: { "content-type": "image/png", "cache-control": "no-cache", "x-content-type-options": "nosniff" },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
