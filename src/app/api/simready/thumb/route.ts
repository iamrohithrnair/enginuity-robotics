// Serves SimReady asset thumbnails with HTTP error responses.
import { connection } from "next/server";
import { SimReadyError, errorMessageOf, simready } from "@/server/simready";

 
 
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const size = Math.min(512, Math.max(64, Math.round(Number(url.searchParams.get("size") ?? 192) || 192)));
  try {
    const img = await simready().thumbnail(id, size);
    return new Response(new Uint8Array(img), {
      headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  } catch (err) {
    return Response.json({ error: errorMessageOf(err) }, { status: err instanceof SimReadyError ? err.status : 502 });
  }
}
