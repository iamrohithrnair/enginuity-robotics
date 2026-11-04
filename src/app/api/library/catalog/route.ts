import { visibleLibraryEntries } from "@/server/examples";
import { LibraryError, libraryCatalog, searchCatalog } from "@/server/library";
import { getServer } from "@/server/store";

 
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = Object.fromEntries(url.searchParams.entries());
  const num = (k: string) => (q[k] !== undefined && q[k] !== "" ? Number(q[k]) : undefined);
  try {
     
    const all = visibleLibraryEntries(await libraryCatalog(q.refresh === "1"), getServer().services.settings);
    const kind = (q.kind as "robot" | "tool" | "axis" | "station" | undefined) || "robot";
    const res = searchCatalog(all, {
      query: q.query,
      kind,
      brand: q.brand || undefined,
      type: q.type || undefined,
      axes: num("axes"),
      payloadMin: num("payloadMin"),
      payloadMax: num("payloadMax"),
      reachMin: num("reachMin"),
      reachMax: num("reachMax"),
      application: q.application || undefined,
      limit: num("limit") ?? 48,
      offset: num("offset") ?? 0,
    });
    const ofKind = all.filter((e) => e.kind === kind);
    const tags = (v?: string) => (v ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const facet = (key: "brand" | "type") => {
      const m = new Map<string, number>();
       
      for (const e of ofKind) for (const v of tags(e[key])) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };
    const apps = new Map<string, number>();
    for (const e of ofKind) for (const a of e.applications ?? []) apps.set(a, (apps.get(a) ?? 0) + 1);
    return Response.json({
      total: res.total,
      items: res.items,
      counts: { robot: all.filter((e) => e.kind === "robot").length, tool: all.filter((e) => e.kind === "tool").length, axis: all.filter((e) => e.kind === "axis").length, station: all.filter((e) => e.kind === "station").length },
      facets: { brand: facet("brand"), type: facet("type"), application: [...apps.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof LibraryError ? err.status : 502 });
  }
}
