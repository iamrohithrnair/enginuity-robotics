// Searches SimReady assets and returns category and dataset metadata.
import { connection } from "next/server";
import { DATASET_ID, DATASET_LICENSE, DATASET_URL, errorMessageOf, searchSimReady, simreadyCatalog } from "@/server/simready";

const DATASET = { id: DATASET_ID, url: DATASET_URL, license: DATASET_LICENSE };

 
 
export async function GET(request: Request) {
  await connection();
  const q = Object.fromEntries(new URL(request.url).searchParams.entries());
  const num = (k: string, d: number) => (q[k] !== undefined && q[k] !== "" && Number.isFinite(Number(q[k])) ? Number(q[k]) : d);
  try {
    const cat = await simreadyCatalog(q.refresh === "1");
    const res = searchSimReady(cat.entries, {
      query: q.query || undefined,
      category: q.category || undefined,
      offset: Math.max(0, Math.floor(num("offset", 0))),
      limit: Math.min(200, Math.max(1, Math.floor(num("limit", 48)))),
    });
    return Response.json({
      total: res.total,
      items: res.items.map((e) => ({ id: e.id, name: e.name, category: e.category, thumb: `/api/simready/thumb?id=${encodeURIComponent(e.id)}` })),
      categories: res.categories,
      dataset: DATASET,
      fetchedAt: cat.fetchedAt,
      ...(cat.stale ? { error: `Showing the cached catalog: ${cat.stale}` } : {}),
    });
  } catch (err) {
    return Response.json({ total: 0, items: [], categories: [], dataset: DATASET, error: errorMessageOf(err) });
  }
}
