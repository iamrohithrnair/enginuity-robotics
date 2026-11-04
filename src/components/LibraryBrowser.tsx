"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { cmd } from "@/client/api";
import { pushView, useRC } from "@/client/store";
import type { LibraryEntry } from "@/engine/registry";
import ExamplesPanel from "./ExamplesPanel";
import { Icon } from "./icons";
import SimReadyPanel, { SimReadySubtitle } from "./SimReadyPanel";

type Kind = "robot" | "tool" | "axis" | "station";
 
type Tab = Kind | "simready";
interface Facet {
  value: string;
  count: number;
}
interface CatalogPage {
  total: number;
  items: LibraryEntry[];
  counts: Record<Kind, number>;
  facets: { brand: Facet[]; type: Facet[]; application: Facet[] };
  error?: string;
}

const TABS: { kind: Tab; label: string }[] = [
  { kind: "robot", label: "Robots" },
  { kind: "tool", label: "Tools" },
  { kind: "axis", label: "External axes" },
  { kind: "station", label: "Examples" },
  { kind: "simready", label: "SimReady" },
];

function Chip({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button className={`g-btn ${active ? "active" : "ghost"}`} style={{ height: 24, padding: "0 9px", fontSize: 11.5, background: active ? undefined : "var(--fill-1)" }} onClick={onClick}>
      {children}
    </button>
  );
}

function Spec({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === "") return null;
  return (
    <div>
      <div style={{ font: "600 9.5px var(--font-ui)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div className="mono" style={{ font: "650 13px var(--font-mono)" }}>
        {value}
      </div>
    </div>
  );
}

export default function LibraryBrowser() {
  const open = useRC((s) => s.libraryOpen);
  const ws = useRC((s) => s.ws);
   
  const kind = useRC((s) => s.libraryKind);
   
  const libraryStations = useRC((s) => !!s.settings.RC_SHOW_LIBRARY_STATIONS);
  const ownExamplesOnly = kind === "station" && !libraryStations;
  const simready = kind === "simready";
  const setKind = (k: Tab) => useRC.setState({ libraryKind: k });
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [type, setType] = useState("");
  const [app, setApp] = useState("");
  const [payloadMin, setPayloadMin] = useState("");
  const [reachMin, setReachMin] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [items, setItems] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<LibraryEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reqId = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++reqId.current;
      setLoading(true);
      const qs = new URLSearchParams({ kind, query, brand, type, application: app, payloadMin, reachMin, offset: String(offset), limit: "48" });
      const res = await fetch(`/api/library/catalog?${qs}`);
      const data = (await res.json()) as CatalogPage;
      if (id !== reqId.current) return;
      setLoading(false);
      setPage(data);
      setItems((prev) => (offset === 0 ? data.items ?? [] : [...prev, ...(data.items ?? [])]));
    },
    [kind, query, brand, type, app, payloadMin, reachMin],
  );

  useEffect(() => {
     
    if (!open || kind === "simready") return;
    const t = setTimeout(() => void fetchPage(0), 160);
    return () => clearTimeout(t);
  }, [open, kind, fetchPage]);

   
  const selectKind = (k: Tab) => {
    setKind(k);
    setBrand("");
    setType("");
    setApp("");
    setDetail(null);
  };

  const robots = useMemo(() => (ws ? Object.values(ws.items).filter((i) => i.type === "robot") : []), [ws]);

  if (!open) return null;
  const close = () => useRC.setState({ libraryOpen: false });

  const load = async (e: LibraryEntry) => {
    if (e.kind === "station") {
       
      setBusy(e.file);
      const res = await cmd<{ name: string; imported: number; skipped: { name: string }[] }>("station.openRdk", { file: e.file });
      setBusy(null);
      if (res) {
        useRC.getState().toast({
          kind: "success",
          title: `${res.name} opened`,
          body: `${res.imported} items imported${res.skipped.length ? ` · ${res.skipped.length} not supported (${res.skipped.map((x) => x.name).slice(0, 3).join(", ")})` : ""}`,
        });
        close();
        setTimeout(() => pushView({ action: "fit" }), 500);
      }
      return;
    }
    setBusy(e.file);
    const res = await cmd<{ name: string; imported?: number }>("library.load", { file: e.file, kind: e.kind === "axis" ? "robot" : e.kind });
    setBusy(null);
    if (res) {
       
      const body = isArchive(e) ? `Opened as a new station · ${res.imported ?? 0} items` : e.kind === "tool" ? "Attached to the selected robot" : "Placed at the station origin";
      useRC.getState().toast({ kind: "success", title: `${res.name} ${isArchive(e) ? "opened" : "added"}`, body });
      close();
      setTimeout(() => pushView({ action: "fit" }), 400);
    }
  };

  const brands = (page?.facets.brand ?? []).filter((b) => b.value.toLowerCase().includes(brandFilter.toLowerCase()));
   
  const showBrands = kind !== "station";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", background: "var(--scrim)", backdropFilter: "blur(3px)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass glass-strong liquid rc-pop" style={{ width: "min(1240px, calc(100vw - 48px))", height: "min(820px, calc(100vh - 48px))", borderRadius: 28, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        { }
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px 12px" }}>
          <div style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Icon.Library size={22} color="currentColor" />
          </div>
          <div>
            <div style={{ font: "700 18px var(--font-ui)", letterSpacing: "-0.02em" }}>Robot Library</div>
            <div style={{ color: "var(--ink-2)", font: "500 12px var(--font-ui)" }}>
              {simready ? (
                <SimReadySubtitle />
              ) : page?.counts ? (
                `${page.counts.robot.toLocaleString()} robots · ${page.counts.tool} tools · ${page.counts.axis} external axes${page.counts.station ? ` · ${page.counts.station} library stations` : ""}`
              ) : (
                "Loading catalog…"
              )}
            </div>
            {!simready && <MirrorLine onFinished={() => void fetchPage(0)} />}
          </div>
          <div className="glass-inset" style={{ display: "flex", padding: 3, borderRadius: 999, marginLeft: 18 }}>
            {TABS.map((t) => (
              <button key={t.kind} className={`g-btn ${kind === t.kind ? "active" : "ghost"}`} style={{ height: 28 }} onClick={() => selectKind(t.kind)}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ position: "relative", flex: 1, maxWidth: 360, marginLeft: "auto" }}>
            <span style={{ position: "absolute", left: 11, top: 9, color: "var(--ink-3)" }}>
              <Icon.Search size={16} />
            </span>
            <input autoFocus className="g-input" style={{ height: 34, paddingLeft: 34, borderRadius: 999 }} placeholder={simready ? "Search SimReady assets: pallet, crate, cart…" : "Search name, brand or model"} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
          </div>
          <button className="g-btn icon ghost" onClick={close} title="Close (Esc)">
            <Icon.Close />
          </button>
        </div>

        {simready ? (
          <SimReadyPanel query={query} />
        ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: `${ownExamplesOnly ? "0px" : "230px"} 1fr ${detail && !ownExamplesOnly ? "330px" : "0px"}`, minHeight: 0, transition: "grid-template-columns .45s var(--ease-out)" }}>
          { }
          <div className="g-scroll" style={{ padding: ownExamplesOnly ? 0 : "4px 12px 16px 20px", visibility: ownExamplesOnly ? "hidden" : undefined }}>
            {page?.facets.type.length ? (
              <>
                <div className="g-label" style={{ margin: "6px 0 8px" }}>
                  Type
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
                  <Chip active={!type} onClick={() => setType("")}>
                    All
                  </Chip>
                  {page.facets.type.slice(0, 12).map((t) => (
                    <Chip key={t.value} active={type === t.value} onClick={() => setType(type === t.value ? "" : t.value)}>
                      {t.value}
                    </Chip>
                  ))}
                </div>
              </>
            ) : null}
            {kind !== "station" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
                <label>
                  <div className="g-label" style={{ marginBottom: 6 }}>
                    Payload ≥
                  </div>
                  <input className="g-input num" placeholder="kg" value={payloadMin} onChange={(e) => setPayloadMin(e.target.value)} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
                </label>
                <label>
                  <div className="g-label" style={{ marginBottom: 6 }}>
                    Reach ≥
                  </div>
                  <input className="g-input num" placeholder="mm" value={reachMin} onChange={(e) => setReachMin(e.target.value)} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
                </label>
              </div>
            )}
            {showBrands && (
              <>
              <div className="g-label" style={{ margin: "6px 0 8px" }}>
                Brand
              </div>
              <input className="g-input" placeholder="Filter brands" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} style={{ marginBottom: 6 }} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
              <div style={{ display: "grid", gap: 1 }}>
                <BrandRow label="All brands" active={!brand} count={page?.total} onClick={() => setBrand("")} />
                {brands.slice(0, 60).map((b) => (
                  <BrandRow key={b.value} label={b.value} active={brand === b.value} count={b.count} onClick={() => setBrand(brand === b.value ? "" : b.value)} />
                ))}
              </div>
              </>
            )}
            {page?.facets.application.length ? (
              <>
                <div className="g-label" style={{ margin: "14px 0 8px" }}>
                  Application
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {page.facets.application.slice(0, 14).map((a) => (
                    <Chip key={a.value} active={app === a.value} onClick={() => setApp(app === a.value ? "" : a.value)}>
                      {a.value}
                    </Chip>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          { }
          <div className="g-scroll" style={{ padding: ownExamplesOnly ? "4px 20px 20px" : "4px 14px 20px 6px" }}>
            {kind === "station" && <ExamplesPanel query={query} onOpened={close} />}
            {!ownExamplesOnly && (
              <>
            {kind === "station" && <div style={{ font: "650 13px var(--font-ui)", margin: "8px 4px 2px" }}>Library stations</div>}
            {page?.error && <div style={{ padding: 20, color: "var(--bad)" }}>{page.error}</div>}
            <div style={{ display: "flex", alignItems: "center", margin: "4px 4px 10px", color: "var(--ink-2)", font: "500 12px var(--font-ui)" }}>
              {page ? `${page.total.toLocaleString()} results` : ""}
              {loading && <span className="rc-shimmer" style={{ marginLeft: 10, width: 60, height: 6, borderRadius: 6 }} />}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))", gap: 12 }}>
              {items.map((e) => (
                <Card key={`${e.kind}-${e.file}`} e={e} active={detail?.file === e.file} busy={busy === e.file} onOpen={() => setDetail(e)} onLoad={() => void load(e)} />
              ))}
              {!items.length && loading &&
                Array.from({ length: 12 }, (_, i) => <div key={i} className="rc-shimmer" style={{ height: 232, borderRadius: 20 }} />)}
            </div>
            {page && items.length < page.total && (
              <div style={{ display: "grid", placeItems: "center", marginTop: 16 }}>
                <button className="g-btn" onClick={() => void fetchPage(items.length)}>
                  Load more
                </button>
              </div>
            )}
              </>
            )}
          </div>

          { }
          <div className="g-scroll" style={{ borderLeft: detail ? "1px solid var(--hair)" : "none", overflowX: "hidden" }}>
            {detail && (
              <div className="rc-enter" style={{ padding: 18 }}>
                <div className="glass-inset" style={{ height: 230, borderRadius: 20, display: "grid", placeItems: "center", overflow: "hidden", background: "radial-gradient(circle at 50% 35%, #ffffff, #ececea)" }}>
                  {detail.image ? <img src={detail.image} alt={detail.name} style={{ maxWidth: "88%", maxHeight: "88%", objectFit: "contain" }} /> : <Icon.Robot size={64} />}
                </div>
                <div style={{ font: "700 17px var(--font-ui)", margin: "14px 0 2px", letterSpacing: "-0.01em" }}>{detail.name}</div>
                <div style={{ color: "var(--ink-2)", marginBottom: 14 }}>
                  {detail.brand ?? "—"} · {detail.type ?? detail.kind}
                </div>
                <div className="glass-inset" style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <Spec label="Axes" value={detail.axes} />
                  <Spec label="Payload" value={detail.payload !== undefined ? `${detail.payload} kg` : undefined} />
                  <Spec label="Reach" value={detail.reach !== undefined ? `${detail.reach} mm` : undefined} />
                  <Spec label="Repeatability" value={detail.repeatability !== undefined ? `${detail.repeatability} mm` : undefined} />
                  <Spec label="Weight" value={detail.weight !== undefined ? `${detail.weight} kg` : undefined} />
                </div>
                {detail.applications?.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
                    {detail.applications.map((a) => (
                      <span key={a} style={{ padding: "3px 8px", borderRadius: 999, background: "var(--fill-2)", font: "500 11px var(--font-ui)", color: "var(--ink-1)" }}>
                        {a}
                      </span>
                    ))}
                  </div>
                ) : null}
                {detail.kind === "station" ? (
                  <>
                    <button className="g-btn primary" style={{ width: "100%", height: 40, fontSize: 13.5 }} disabled={busy === detail.file} onClick={() => void load(detail)}>
                      <Icon.Download size={16} /> {busy === detail.file ? "Opening…" : "Open station"}
                    </button>
                    <div style={{ color: "var(--ink-2)", font: "500 11px var(--font-ui)", marginTop: 8, lineHeight: 1.45 }}>
                      Opens as a new station with its robots, tools, parts, targets and programs. Machining projects and curves are listed as not supported.
                    </div>
                  </>
                ) : (
                  <button className="g-btn primary" style={{ width: "100%", height: 40, fontSize: 13.5 }} disabled={busy === detail.file || (needsRobot(detail) && robots.length === 0)} onClick={() => void load(detail)}>
                    <Icon.Download size={16} /> {busy === detail.file ? "Loading…" : needsRobot(detail) ? (robots.length ? "Attach to robot" : "Add a robot first") : isArchive(detail) ? "Open as station" : "Load into station"}
                  </button>
                )}
                <div style={{ color: "var(--ink-3)", font: "500 10.5px var(--font-ui)", marginTop: 12, lineHeight: 1.5 }}>From the online robot library ({detail.file}).</div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

 
const isArchive = (e: LibraryEntry) => /\.rdka$/i.test(e.file);
 
const needsRobot = (e: LibraryEntry) => e.kind === "tool" && !isArchive(e);

interface MirrorStatus {
  state: "idle" | "running" | "done" | "error";
  progress?: { total: number; done: number; failed: number; bytes: number } | null;
  items?: number;
  files?: number;
  bytes?: number;
  mirrored?: boolean;
  failures?: unknown[];
  offlineOnly?: boolean;
  runningElsewhere?: { pid: number };
  lastRun?: { error?: string };
}

const size = (n = 0) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);

 
function MirrorLine({ onFinished }: { onFinished: () => void }) {
  const [st, setSt] = useState<MirrorStatus | null>(null);
  const [runs, setRuns] = useState(0);
  const finished = useEffectEvent(onFinished);
  useEffect(() => {
    let alive = true;
    let wasRunning = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const s = await cmd<MirrorStatus>("library.mirrorStatus", {}, { quiet: true });
      if (!alive || !s) return;
      setSt(s);
      const running = s.state === "running" || !!s.runningElsewhere;
      if (running) timer = setTimeout(() => void poll(), 1500);
      else if (wasRunning) finished();
      wasRunning = running;
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runs]);
  const start = async () => {
    if (await cmd("library.mirror", { refresh: !!st?.mirrored })) setRuns((n) => n + 1);
  };
  if (!st) return null;
  const line = { display: "flex", alignItems: "center", gap: 8, marginTop: 4, color: "var(--ink-2)", font: "500 11.5px var(--font-ui)", whiteSpace: "nowrap" } as const;
  if (st.state === "running") {
    const p = st.progress;
    return (
      <div style={line}>
        <div style={{ width: 120, height: 5, borderRadius: 5, background: "var(--well)", overflow: "hidden" }}>
          <div style={{ width: `${p?.total ? (100 * p.done) / p.total : 0}%`, height: "100%", background: "var(--accent)", transition: "width .4s" }} />
        </div>
        <span>{p ? `Downloading for offline use · ${p.done.toLocaleString()} / ${p.total.toLocaleString()} · ${size(p.bytes)}` : "Starting download…"}</span>
        {p?.failed ? <span style={{ color: "var(--warn)" }}>{p.failed} failed</span> : null}
      </div>
    );
  }
  if (st.runningElsewhere)
    return (
      <div style={line}>
        <span className="rc-shimmer" style={{ width: 60, height: 5, borderRadius: 5 }} />
        <span>Downloading in another process (pid {st.runningElsewhere.pid}) · {(st.files ?? 0).toLocaleString()} files stored</span>
      </div>
    );
  const failed = st.failures?.length ?? 0;
  return (
    <div style={line}>
      <span style={{ width: 7, height: 7, borderRadius: 7, background: st.mirrored ? "var(--good)" : "var(--ink-3)" }} />
      <span>{st.mirrored ? `Offline · ${(st.items ?? 0).toLocaleString()} items · ${size(st.bytes)} on this computer` : `${(st.files ?? 0).toLocaleString()} of ${(st.items ?? 0).toLocaleString()} items available offline`}</span>
      {failed ? <span style={{ color: "var(--warn)" }}>{failed} failed</span> : null}
      {st.lastRun?.error && <span style={{ color: "var(--bad)" }}>{st.lastRun.error}</span>}
      {st.offlineOnly ? (
        <span style={{ color: "var(--info)" }}>offline only</span>
      ) : (
        <button className="g-btn ghost" style={{ height: 20, padding: "0 7px", fontSize: 11, color: "var(--accent)" }} onClick={() => void start()}>
          {st.mirrored ? "Update" : "Download all for offline use"}
        </button>
      )}
    </div>
  );
}

function BrandRow({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", height: 26, padding: "0 8px", border: 0, borderRadius: 8, background: active ? "var(--accent-soft)" : "transparent", color: active ? "var(--accent-ink)" : "var(--ink-1)", font: "500 12px var(--font-ui)", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {count !== undefined && <span className="mono" style={{ opacity: 0.6, fontSize: 10.5 }}>{count}</span>}
    </button>
  );
}

function Card({ e, active, busy, onOpen, onLoad }: { e: LibraryEntry; active: boolean; busy: boolean; onOpen: () => void; onLoad: () => void }) {
  return (
    <div
      onClick={onOpen}
      onDoubleClick={onLoad}
      className="rc-card"
      style={{
        position: "relative",
        borderRadius: 20,
        padding: 10,
        cursor: "pointer",
        background: active ? "var(--accent-soft)" : "var(--fill-1)",
        boxShadow: active ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--hair)",
        transition: "transform .35s var(--ease-spring), box-shadow .2s, background .2s",
      }}
    >
      <div style={{ height: 150, borderRadius: 14, display: "grid", placeItems: "center", overflow: "hidden", background: "radial-gradient(circle at 50% 30%, #ffffff, #ececea)" }}>
        {e.image ? <img loading="lazy" src={e.image} alt="" style={{ maxWidth: "86%", maxHeight: "86%", objectFit: "contain", transition: "transform .5s var(--ease-out)" }} className="rc-card-img" /> : <Icon.Robot size={46} color="var(--ink-3)" />}
      </div>
      <div style={{ font: "650 12.5px var(--font-ui)", marginTop: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 4, color: "var(--ink-2)", font: "500 11px var(--font-ui)" }}>
        {e.payload !== undefined && <span>{e.payload} kg</span>}
        {e.reach !== undefined && <span>{e.reach} mm</span>}
        {e.axes ? <span>{e.axes} ax</span> : null}
        {!e.payload && !e.reach && <span>{e.brand ?? e.type}</span>}
      </div>
      {(
        <button
          className="g-btn primary rc-card-load"
          title={e.kind === "station" ? "Open station" : "Load into station"}
          style={{ position: "absolute", top: 18, right: 18, height: 28, opacity: busy ? 1 : 0, transition: "opacity .2s" }}
          onClick={(ev) => {
            ev.stopPropagation();
            onLoad();
          }}
        >
          {busy ? "…" : <Icon.Download size={14} />}
        </button>
      )}
      <style>{`.rc-card:hover{transform:translateY(-3px)}.rc-card:hover .rc-card-load{opacity:1!important}.rc-card:hover .rc-card-img{transform:scale(1.05)}`}</style>
    </div>
  );
}
