"use client";
// Browses SimReady assets and tracks preparation and loading jobs.

 
 
 
 
 

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { cmdx, setStatus } from "@/client/api";
import { pushView, useRC } from "@/client/store";
import { Icon } from "./icons";

export interface SimReadyItem {
  id: string;
  name: string;
  category: string;
  thumb: string;
}
interface Facet {
  value: string;
  count: number;
}
interface CatalogPage {
  total: number;
  items: SimReadyItem[];
  categories: Facet[];
  dataset?: { id: string; url: string; license: string };
  error?: string;
}
interface StatusJob {
  asset: string;
  phase: string;
  file?: string;
  files: number;
  bytes: number;
  startedAt?: string | number;
}
interface CacheInfo {
  assets: number;
  bytes: number;
  dir: string;
}
interface StatusResponse {
  jobs: StatusJob[];
  cache: CacheInfo;
}
type PrepareResponse = { ok: true; id: string; cached: boolean; triangles: number; bytes: number; ms: number; warnings?: string[] } | { ok: false; error: string };
interface LoadResult {
  id: string;
  name: string;
  triangles: number;
   
  size: [number, number, number];
  cached: boolean;
  downloadedBytes: number;
  attribution: string;
}

 
interface Job {
  name: string;
  phase: string;
  file?: string;
  files: number;
  bytes: number;
  startedAt: number;
   
  secs: number;
  error?: string;
}

const useSimReady = create<{ jobs: Record<string, Job>; total: number | null; cache: CacheInfo | null }>(() => ({ jobs: {}, total: null, cache: null }));

const DATASET_URL = "https://huggingface.co/datasets/nvidia/simready-assets";
const ATTRIBUTION = "NVIDIA SimReady Assets · CC BY 4.0 · downloaded on demand and cached locally";
const hfUrl = (id: string) => `${DATASET_URL}/tree/main/${id.split("/").map(encodeURIComponent).join("/")}`;
const largeThumb = (thumb: string) => (/[?&]size=\d+/.test(thumb) ? thumb.replace(/([?&]size=)\d+/, "$1384") : `${thumb}${thumb.includes("?") ? "&" : "?"}size=384`);

 
export function prettyCategory(v: string): string {
  return v
    .split(/[_\s]+/)
    .flatMap((w) => w.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(" "))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const bytes = (n = 0) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
const mm = (v: number) => Math.round(v).toLocaleString();
const dims = (s?: [number, number, number]) => (s && s.length === 3 ? `${mm(s[0])} × ${mm(s[1])} × ${mm(s[2])} mm` : "");

const PHASES: Record<string, string> = {
  queued: "Starting",
  starting: "Starting",
  listing: "Reading the file list",
  list: "Reading the file list",
  download: "Downloading",
  downloading: "Downloading",
  fetch: "Downloading",
  layers: "Reading USD layers",
  geometry: "Building geometry",
  materials: "Reading materials",
  textures: "Fetching textures",
  mesh: "Meshing",
  convert: "Converting",
  converting: "Converting",
  simplify: "Simplifying",
  write: "Saving to cache",
  writing: "Saving to cache",
  saving: "Saving to cache",
  cache: "Saving to cache",
  adding: "Adding to station",
};

 
function phaseLabel(j: Job): string {
  const label = PHASES[j.phase] ?? (j.phase ? j.phase[0].toUpperCase() + j.phase.slice(1) : "Working");
  return j.bytes > 0 && j.phase !== "adding" ? `${label} · ${bytes(j.bytes)}` : label;
}

 
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? "Unexpected answer from the SimReady service" : `The SimReady service answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  }
}

const patchJob = (id: string, p: Partial<Job>) =>
  useSimReady.setState((s) => {
    const cur = s.jobs[id];
    return cur ? { jobs: { ...s.jobs, [id]: { ...cur, ...p } } } : {};
  });
const dropJob = (id: string) =>
  useSimReady.setState((s) => {
    const jobs = { ...s.jobs };
    delete jobs[id];
    return { jobs };
  });
const preparing = () => Object.values(useSimReady.getState().jobs).some((j) => !j.error && j.phase !== "adding");

 
let polling = false;
async function pollStatus() {
  if (polling) return;
  polling = true;
  try {
    while (preparing()) {
      try {
        const s = await getJson<StatusResponse>("/api/simready/status");
        useSimReady.setState((st) => {
          const jobs = { ...st.jobs };
          const now = Date.now();
          for (const [id, j] of Object.entries(jobs)) if (!j.error) jobs[id] = { ...j, secs: Math.round((now - j.startedAt) / 1000) };
          for (const sj of s.jobs ?? []) {
            const cur = jobs[sj.asset];
            if (cur && !cur.error && cur.phase !== "adding") jobs[sj.asset] = { ...cur, phase: sj.phase || cur.phase, file: sj.file, files: sj.files ?? cur.files, bytes: sj.bytes ?? cur.bytes };
          }
          return { jobs, cache: s.cache ?? st.cache };
        });
         
        const active = Object.values(useSimReady.getState().jobs).find((j) => !j.error && j.phase !== "adding");
        if (active && !useRC.getState().libraryOpen) setStatus(`SimReady · ${active.name}: ${phaseLabel(active)}`, 2500);
      } catch {
         
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  } finally {
    polling = false;
  }
}

async function refreshCache() {
  try {
    const s = await getJson<StatusResponse>("/api/simready/status");
    if (s.cache) useSimReady.setState({ cache: s.cache });
  } catch {
     
  }
}

 
export async function addSimReadyAsset(item: { id: string; name: string }) {
  const cur = useSimReady.getState().jobs[item.id];
  if (cur && !cur.error) return;
  useSimReady.setState((s) => ({ jobs: { ...s.jobs, [item.id]: { name: item.name, phase: "queued", files: 0, bytes: 0, startedAt: Date.now(), secs: 0 } } }));
  void pollStatus();
  const fail = (error: string) => {
    patchJob(item.id, { error });
    useRC.getState().toast({ kind: "error", title: `Couldn't add ${item.name}`, body: error });
  };
  let prep: PrepareResponse;
  try {
    prep = await getJson<PrepareResponse>("/api/simready/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
  } catch (err) {
    prep = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!prep.ok) return fail(prep.error || "The asset could not be downloaded or converted");
  patchJob(item.id, { phase: "adding" });
  const r = await cmdx<LoadResult>("simready.load", { asset: item.id });
  if (!r.ok || !r.result) return fail(r.error ?? "The asset could not be added to the station");
  dropJob(item.id);
  const res = r.result;
  const size = dims(res.size);
  useRC.getState().toast({
    kind: "success",
    title: `${res.name || item.name} added`,
    body: `${size ? `${size} · ` : ""}${(res.triangles ?? prep.triangles ?? 0).toLocaleString()} triangles`,
  });
  useRC.setState({ libraryOpen: false });
  setTimeout(() => pushView({ action: "fit" }), 400);
  void refreshCache();
}

 
export function SimReadySubtitle() {
  const total = useSimReady((s) => s.total);
  return <>{total !== null ? `${total.toLocaleString()} NVIDIA SimReady assets · CC BY 4.0 · downloaded on demand` : "NVIDIA SimReady assets · CC BY 4.0 · loading catalog…"}</>;
}

const SHOWN_CATEGORIES = 60;

export default function SimReadyPanel({ query }: { query: string }) {
  const [category, setCategory] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [allCats, setAllCats] = useState(false);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [items, setItems] = useState<SimReadyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<SimReadyItem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const jobs = useSimReady((s) => s.jobs);
  const cache = useSimReady((s) => s.cache);
  const reqId = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++reqId.current;
      setLoading(true);
      const qs = new URLSearchParams({ query: query.trim(), category, offset: String(offset), limit: "48" });
      let data: CatalogPage;
      try {
        data = await getJson<CatalogPage>(`/api/simready/catalog?${qs}`);
      } catch (err) {
        data = { total: 0, items: [], categories: [], error: err instanceof Error ? err.message : String(err) };
      }
      if (id !== reqId.current) return;
      setLoading(false);
      setPage(data);
      setItems((prev) => (offset === 0 ? (data.items ?? []) : [...prev, ...(data.items ?? [])]));
       
      if (!data.error && !query.trim() && !category) useSimReady.setState({ total: data.total });
    },
    [query, category],
  );

  useEffect(() => {
    const t = setTimeout(() => void fetchPage(0), 160);
    return () => clearTimeout(t);
  }, [fetchPage, attempt]);

  useEffect(() => {
    void refreshCache();
     
    if (useSimReady.getState().total === null)
      getJson<CatalogPage>("/api/simready/catalog?limit=1")
        .then((d) => typeof d.total === "number" && !d.error && useSimReady.setState((s) => (s.total === null ? { total: d.total } : {})))
        .catch(() => undefined);
  }, []);

  const cats = page?.categories ?? [];
  const allCount = cats.reduce((n, c) => n + c.count, 0);
  const filteredCats = cats.filter((c) => `${c.value} ${prettyCategory(c.value)}`.toLowerCase().includes(catFilter.trim().toLowerCase()));
  const shownCats = allCats || catFilter ? filteredCats : filteredCats.slice(0, SHOWN_CATEGORIES);
   
  const orphan = category && !cats.some((c) => c.value.toLowerCase() === category.toLowerCase());
  const error = page?.error && !items.length ? page.error : null;
  const empty = page && !page.error && !loading && !items.length;

  return (
    <div data-testid="simready-panel" style={{ flex: 1, display: "grid", gridTemplateColumns: `230px 1fr ${detail ? "330px" : "0px"}`, minHeight: 0, transition: "grid-template-columns .45s var(--ease-out)" }}>
      { }
      <div className="g-scroll" style={{ padding: "4px 12px 16px 20px", display: "flex", flexDirection: "column" }}>
        <div className="g-label" style={{ margin: "6px 0 8px" }}>
          Category
        </div>
        {cats.length > 12 && (
          <input className="g-input" placeholder={`Filter ${cats.length} categories`} value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ marginBottom: 6, flex: "none" }} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
        )}
        <div style={{ display: "grid", gap: 1, flex: "none" }}>
          <CategoryRow label="All categories" active={!category} count={page ? allCount : undefined} onClick={() => setCategory("")} />
          {orphan && <CategoryRow label={prettyCategory(category)} active count={0} onClick={() => setCategory("")} />}
          {shownCats.map((c) => (
            <CategoryRow key={c.value} label={prettyCategory(c.value)} title={c.value} active={category.toLowerCase() === c.value.toLowerCase()} count={c.count} onClick={() => setCategory(category === c.value ? "" : c.value)} />
          ))}
          {!page && Array.from({ length: 12 }, (_, i) => <div key={i} className="rc-shimmer" style={{ height: 14, margin: "6px 8px", borderRadius: 6, width: `${50 + ((i * 37) % 45)}%` }} />)}
          {page && !allCats && !catFilter && filteredCats.length > SHOWN_CATEGORIES && (
            <button className="g-btn ghost" style={{ height: 26, justifyContent: "flex-start", padding: "0 8px", fontSize: 12, color: "var(--accent)" }} onClick={() => setAllCats(true)}>
              Show all {filteredCats.length} categories
            </button>
          )}
          {page && catFilter && !filteredCats.length && <div style={{ padding: "6px 8px", color: "var(--ink-3)", font: "500 11.5px var(--font-ui)" }}>No category matches “{catFilter}”</div>}
        </div>
        <div style={{ height: 16, flex: "none" }} />
        <DatasetCard cache={cache} />
      </div>

      { }
      <div className="g-scroll" style={{ padding: "4px 14px 20px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", margin: "4px 4px 10px", color: "var(--ink-2)", font: "500 12px var(--font-ui)", minHeight: 16 }}>
          {page && !error ? `${page.total.toLocaleString()} ${page.total === 1 ? "asset" : "assets"}${category ? ` in ${prettyCategory(category)}` : ""}${query.trim() ? ` matching “${query.trim()}”` : ""}` : ""}
          {loading && <span className="rc-shimmer" style={{ marginLeft: 10, width: 60, height: 6, borderRadius: 6 }} />}
        </div>
        {error && (
          <StateCard icon={<Icon.Warning size={22} />} tone="bad" title="The SimReady catalog is not available" body={error}>
            <button className="g-btn primary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </StateCard>
        )}
        {empty && (
          <StateCard icon={<Icon.Search size={22} />} title="No SimReady assets found" body={`Nothing matches${query.trim() ? ` “${query.trim()}”` : ""}${category ? ` in ${prettyCategory(category)}` : ""}. Try another word or category.`}>
            {category && (
              <button className="g-btn" onClick={() => setCategory("")}>
                Search all categories
              </button>
            )}
          </StateCard>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))", gap: 12 }}>
          {items.map((it) => (
            <AssetCard key={it.id} item={it} active={detail?.id === it.id} job={jobs[it.id]} onOpen={() => setDetail(it)} onAdd={() => void addSimReadyAsset(it)} />
          ))}
          {!items.length && loading && !error && Array.from({ length: 12 }, (_, i) => <div key={i} className="rc-shimmer" style={{ height: 214, borderRadius: 20 }} />)}
        </div>
        {page && !page.error && items.length > 0 && items.length < page.total && (
          <div style={{ display: "grid", placeItems: "center", marginTop: 16 }}>
            <button className="g-btn" disabled={loading} onClick={() => void fetchPage(items.length)}>
              {loading ? "Loading…" : `Load more · ${(page.total - items.length).toLocaleString()} left`}
            </button>
          </div>
        )}
        {page?.error && items.length > 0 && <div style={{ margin: "14px 4px", color: "var(--bad)", font: "500 12px var(--font-ui)" }}>{page.error}</div>}
      </div>

      { }
      <div className="g-scroll" style={{ borderLeft: detail ? "1px solid var(--hair)" : "none", overflowX: "hidden" }}>
        {detail && <Detail key={detail.id} item={detail} job={jobs[detail.id]} />}
      </div>
      <style>{`
.rc-sr-card:hover{transform:translateY(-3px)}
.rc-sr-card:hover .rc-card-img{transform:scale(1.05)}
.rc-sr-card:hover .rc-sr-add:not(:disabled){background:var(--accent);color:var(--on-accent)}
@keyframes rc-sr-indet{from{transform:translateX(-110%)}to{transform:translateX(260%)}}
@keyframes rc-sr-spin{to{transform:rotate(360deg)}}
`}</style>
    </div>
  );
}

function CategoryRow({ label, title, active, count, onClick }: { label: string; title?: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ display: "flex", alignItems: "center", height: 26, padding: "0 8px", border: 0, borderRadius: 8, background: active ? "var(--accent-soft)" : "transparent", color: active ? "var(--accent-ink)" : "var(--ink-1)", font: "500 12px var(--font-ui)", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {count !== undefined && <span className="mono" style={{ opacity: 0.6, fontSize: 10.5 }}>{count.toLocaleString()}</span>}
    </button>
  );
}

 
function DatasetCard({ cache }: { cache: CacheInfo | null }) {
  return (
    <div className="glass-inset" style={{ marginTop: "auto", padding: 12, borderRadius: 14, display: "grid", gap: 6, flex: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "color-mix(in srgb, #76b900 18%, transparent)", color: "#4d7a00", flex: "none" }}>
          <Icon.Package size={15} />
        </span>
        <div style={{ font: "650 12px var(--font-ui)", lineHeight: 1.25, minWidth: 0 }}>
          NVIDIA SimReady
          <div style={{ color: "var(--ink-2)", font: "500 10.5px var(--font-ui)", whiteSpace: "nowrap" }}>OpenUSD · CC BY 4.0</div>
        </div>
      </div>
      <div style={{ color: "var(--ink-2)", font: "500 10.5px/1.45 var(--font-ui)" }}>
        Each asset is downloaded and converted when you add it, then cached on this computer.
        {cache && cache.assets > 0 ? ` ${cache.assets.toLocaleString()} ${cache.assets === 1 ? "asset" : "assets"} cached · ${bytes(cache.bytes)}.` : ""}
      </div>
      <a href={DATASET_URL} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--accent)", font: "550 11px var(--font-ui)", textDecoration: "none" }}>
        nvidia/simready-assets <Icon.ExternalLink size={11} />
      </a>
    </div>
  );
}

function StateCard({ icon, title, body, tone, children }: { icon: React.ReactNode; title: string; body: string; tone?: "bad"; children?: React.ReactNode }) {
  return (
    <div className="rc-enter glass-inset" style={{ margin: "8px 4px 16px", padding: "26px 22px", borderRadius: 20, display: "grid", justifyItems: "center", textAlign: "center", gap: 8 }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, display: "grid", placeItems: "center", background: tone === "bad" ? "color-mix(in srgb, var(--bad) 12%, transparent)" : "var(--fill-2)", color: tone === "bad" ? "var(--bad)" : "var(--ink-2)" }}>{icon}</div>
      <div style={{ font: "650 14px var(--font-ui)" }}>{title}</div>
      <div style={{ color: "var(--ink-2)", font: "500 12px/1.5 var(--font-ui)", maxWidth: 440, overflowWrap: "anywhere" }}>{body}</div>
      {children && <div style={{ display: "flex", gap: 8, marginTop: 6 }}>{children}</div>}
    </div>
  );
}





function Thumb({ src, alt, large }: { src: string; alt: string; large?: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <>
      {state === "loading" && <div className="rc-shimmer" style={{ position: "absolute", inset: 0 }} />}
      {state === "error" ? (
        <div style={{ display: "grid", justifyItems: "center", gap: 6, font: "500 10.5px var(--font-ui)" }}>
          <Icon.Package size={large ? 64 : 42} color="#b8b8b4" />
          {large && <span style={{ color: "#8a8a86" }}>No preview image</span>}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className="rc-card-img"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: state === "ok" ? 1 : 0, transition: "opacity .35s, transform .5s var(--ease-out)" }}
        />
      )}
    </>
  );
}

function Spinner({ size = 12 }: { size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", border: "2px solid currentColor", borderRightColor: "transparent", animation: "rc-sr-spin .8s linear infinite", flex: "none" }} />;
}

 
function Busy({ height = 3 }: { height?: number }) {
  return (
    <div style={{ height, borderRadius: height, background: "color-mix(in srgb, var(--accent) 16%, transparent)", overflow: "hidden" }}>
      <div style={{ width: "40%", height: "100%", borderRadius: height, background: "var(--accent)", animation: "rc-sr-indet 1.25s var(--ease-out) infinite" }} />
    </div>
  );
}

function AssetCard({ item, active, job, onOpen, onAdd }: { item: SimReadyItem; active: boolean; job?: Job; onOpen: () => void; onAdd: () => void }) {
  const busy = !!job && !job.error;
  return (
    <div
      data-testid={`simready-${item.id}`}
      onClick={onOpen}
      onDoubleClick={onAdd}
      className="rc-sr-card"
      style={{
        position: "relative",
        borderRadius: 20,
        padding: 10,
        cursor: "pointer",
        background: active ? "var(--accent-soft)" : "var(--fill-1)",
        boxShadow: active ? "inset 0 0 0 1.5px var(--accent)" : job?.error ? "inset 0 0 0 1px color-mix(in srgb, var(--bad) 45%, transparent)" : "inset 0 0 0 1px var(--hair)",
        transition: "transform .35s var(--ease-spring), box-shadow .2s, background .2s",
      }}
    >
      <div style={{ position: "relative", height: 140, borderRadius: 14, display: "grid", placeItems: "center", overflow: "hidden", background: "radial-gradient(circle at 50% 30%, #ffffff, #ececea)" }}>
        <Thumb key={item.thumb} src={item.thumb} alt="" />
        {busy && (
          <div className="rc-enter" style={{ position: "absolute", left: 8, right: 8, bottom: 8, padding: "6px 8px 7px", borderRadius: 10, background: "var(--label-bg)", color: "var(--label-ink)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", boxShadow: "0 1px 4px rgba(0,0,0,.14)" }}>
            <div style={{ font: "600 10.5px var(--font-ui)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 5 }}>{phaseLabel(job)}</div>
            <Busy />
          </div>
        )}
      </div>
      <div style={{ font: "650 12.5px var(--font-ui)", marginTop: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.name}>
        {item.name}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
        <span style={{ flex: 1, minWidth: 0, color: "var(--ink-2)", font: "500 11px var(--font-ui)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prettyCategory(item.category)}</span>
        <button
          className="g-btn rc-sr-add"
          title={busy ? phaseLabel(job) : "Add to station (download and convert)"}
          disabled={busy}
          style={{ height: 24, padding: "0 9px", fontSize: 11.5, flex: "none", opacity: busy ? 0.75 : undefined }}
          onClick={(ev) => {
            ev.stopPropagation();
            onAdd();
          }}
          onDoubleClick={(ev) => ev.stopPropagation()}
        >
          {busy ? <Spinner size={11} /> : <Icon.Plus size={13} />}
          {busy ? "Adding" : job?.error ? "Retry" : "Add"}
        </button>
      </div>
      {job?.error && (
        <div title={job.error} style={{ marginTop: 6, color: "var(--bad)", font: "500 10.5px/1.35 var(--font-ui)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {job.error}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ font: "600 9.5px var(--font-ui)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

function Detail({ item, job }: { item: SimReadyItem; job?: Job }) {
  const busy = !!job && !job.error;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(item.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="rc-enter" style={{ padding: 18 }} data-testid="simready-detail">
      <div className="glass-inset" style={{ position: "relative", height: 252, borderRadius: 20, display: "grid", placeItems: "center", overflow: "hidden", background: "radial-gradient(circle at 50% 35%, #ffffff, #ececea)" }}>
        <Thumb key={item.thumb} src={largeThumb(item.thumb)} alt={item.name} large />
        <span style={{ position: "absolute", top: 10, left: 10, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,.86)", color: "#3f6300", font: "650 10px var(--font-ui)", letterSpacing: ".02em", boxShadow: "0 1px 3px rgba(0,0,0,.18)" }}>SimReady</span>
      </div>
      <div style={{ font: "700 17px var(--font-ui)", margin: "14px 0 2px", letterSpacing: "-0.01em", overflowWrap: "anywhere" }}>{item.name}</div>
      <div style={{ color: "var(--ink-2)", marginBottom: 14 }}>{prettyCategory(item.category)} · OpenUSD prop</div>
      <div className="glass-inset" style={{ padding: 12, display: "grid", gap: 10, marginBottom: 14 }}>
        <Field label="Asset id">
          <button onClick={copy} title="Copy the asset id" style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: 0, border: 0, background: "transparent", color: "var(--ink-0)", cursor: "copy", textAlign: "left" }}>
            <span className="mono" style={{ font: "600 12px var(--font-mono)", overflowWrap: "anywhere", flex: 1 }}>
              {item.id}
            </span>
            <span style={{ color: copied ? "var(--good)" : "var(--ink-3)", display: "inline-flex" }}>{copied ? <Icon.Check size={13} /> : <Icon.Copy size={13} />}</span>
          </button>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Category">
            <div style={{ font: "600 12.5px var(--font-ui)" }}>{prettyCategory(item.category)}</div>
          </Field>
          <Field label="License">
            <div style={{ font: "600 12.5px var(--font-ui)" }}>CC BY 4.0</div>
          </Field>
        </div>
      </div>
      <button className="g-btn primary" data-testid="simready-add" style={{ width: "100%", height: 40, fontSize: 13.5, opacity: busy ? 0.8 : undefined }} disabled={busy} onClick={() => void addSimReadyAsset(item)}>
        {busy ? <Spinner size={14} /> : <Icon.Plus size={16} />}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{busy ? `${phaseLabel(job)}…` : job?.error ? "Try again" : "Add to station"}</span>
      </button>
      {busy && (
        <div className="rc-enter" style={{ marginTop: 9 }}>
          <Busy height={4} />
          <div className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6, color: "var(--ink-2)", font: "500 10.5px var(--font-mono)" }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={job.file}>
              {job.file ? job.file.split("/").pop() : job.phase === "adding" ? "creating the object" : "first add downloads the asset"}
            </span>
            <span style={{ flex: "none" }}>
              {job.files ? `${job.files} files · ` : ""}
              {job.secs} s
            </span>
          </div>
        </div>
      )}
      {job?.error && (
        <div role="alert" className="rc-enter" style={{ marginTop: 10, padding: "9px 11px", borderRadius: 12, background: "color-mix(in srgb, var(--bad) 10%, transparent)", color: "var(--bad)", font: "500 11.5px/1.45 var(--font-ui)", overflowWrap: "anywhere" }}>
          {job.error}
        </div>
      )}
      {!busy && !job?.error && (
        <div style={{ color: "var(--ink-2)", font: "500 11px/1.45 var(--font-ui)", marginTop: 8 }}>
          Added as one object in real-world size with its colours, under the active reference frame. The first add downloads and converts the asset; later adds are instant.
        </div>
      )}
      <a className="g-btn ghost" href={hfUrl(item.id)} target="_blank" rel="noopener noreferrer" style={{ width: "100%", height: 34, marginTop: 10, color: "var(--accent)", textDecoration: "none", background: "var(--fill-1)" }}>
        <Icon.ExternalLink size={14} /> View on Hugging Face
      </a>
      <div style={{ color: "var(--ink-3)", font: "500 10.5px/1.5 var(--font-ui)", marginTop: 12 }}>{ATTRIBUTION}</div>
    </div>
  );
}
