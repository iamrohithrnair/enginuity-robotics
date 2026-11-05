// Prepares SimReady assets with optional textures and forced refresh.
import { SimReadyError, errorMessageOf, simready } from "@/server/simready";

 
 
 
export async function POST(request: Request) {
  let body: { id?: unknown; textures?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) return Response.json({ ok: false, error: "Missing SimReady asset id" }, { status: 400 });
  const t0 = Date.now();
  try {
     
    const r = await simready().ensure(body.id, { ...(typeof body.textures === "boolean" ? { textures: body.textures } : {}), ...(body.force === true ? { force: true } : {}) });
    return Response.json({
      ok: true,
      id: r.meta.id,
      name: r.meta.name,
      cached: r.cached,
      triangles: r.meta.triangles,
      bytes: r.meta.bytes,
      downloadedBytes: r.downloadedBytes,
      size: r.meta.size,
      ms: Date.now() - t0,
      warnings: r.meta.warnings,
    });
  } catch (err) {
    return Response.json({ ok: false, error: errorMessageOf(err) }, { status: err instanceof SimReadyError ? err.status : 500 });
  }
}
