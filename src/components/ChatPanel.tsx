"use client";

import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useRC } from "@/client/store";
import type { DecisionResult } from "@/engine/decisions";
import type { ScriptRunView } from "@/engine/scripts";
import { type AgentInfo, type Guardrail, type WebInfo, browserKeys, hostOf, keyHeaders, openOptionsTab, saveBrowserKeys, toAgentInfo, useAgentInfo } from "./copilot/agentInfo";
import { CapabilityChips, GuardNotice, ModelBadge, TurnFooter, WebStepCard } from "./copilot/CopilotUi";
import { downscaleImage, MAX_PHOTOS, type PhotoAttachment, type PhotoInfo, PhotoStepCard, PhotoThumbs, PhotoTray } from "./copilot/PhotoUi";
import { DecisionResultCard } from "./decisions/ProbabilityBars";
import { openDecidePlayground, openDecisionModels, useDecisions } from "./decisions/uiStore";
import { Icon } from "./icons";
import { ScriptRunCard } from "./scripts/ScriptRunCard";

 
const GUARD = "#guardrail";

interface ToolStep {
  tool: string;
  args?: unknown;
  ok?: boolean;
  error?: string | null;
   
  decision?: DecisionResult;
   
  script?: ScriptRunView;
   
  web?: WebInfo;
   
  photo?: PhotoInfo;
   
  guard?: Guardrail;
}
interface Msg {
  role: "user" | "assistant";
  text: string;
  steps: ToolStep[];
   
  images?: PhotoAttachment[];
  error?: string;
  pending?: boolean;
   
  meta?: AgentInfo;
}

interface AgentEvent {
  type: string;
  delta?: string;
  tool?: string;
  args?: unknown;
  ok?: boolean;
  error?: string | null;
  message?: string;
  decision?: DecisionResult;
  script?: ScriptRunView;
  web?: WebInfo;
  photo?: PhotoInfo;
  kind?: Guardrail["kind"];
  action?: Guardrail["action"];
  probability?: number;
}

 
const PHOTO_SUGGESTION = "Attach a photo or sketch of a work area and build a matching cell";
const SUGGESTIONS = [
  PHOTO_SUGGESTION,
  "Look up the UR10e's payload and reach on the web, then add one to the station",
  "Build a palletizing cell: a UR10e, a SimReady pallet and two corrugated boxes, then write and simulate the program",
  "Find a SimReady conveyor and place it 800 mm in front of the robot",
  "Search the web for ISO 10218 guidance on safeguarding a robot cell like this one",
  "What is in my station right now?",
  "Create a pick-and-place program, check it, and generate ABB RAPID code",
];

const photoPrompt = (n: number) => (n > 1 ? "Build a robot cell that matches these photos." : "Build a robot cell that matches this photo.");

const isWeb = (tool: string) => tool === "web.search" || tool === "web.extract";
const isImageFile = (f: File) => /^image\/(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(f.type) || (!f.type && /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(f.name));

const LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/;

 
function inline(body: string) {
  return body.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g).map((p, j) => {
    const link = LINK.exec(p) ?? (/^https?:\/\//.test(p) ? [p, `${hostOf(p)}${/^https?:\/\/[^/]+\/./.test(p) ? "/…" : ""}`, p] : null);
    return link ? (
      <a key={j} href={link[2]} target="_blank" rel="noopener noreferrer" title={link[2]} style={{ color: "var(--accent-ink)", fontWeight: 550, textDecoration: "none", borderBottom: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" }}>
        {link[1]}
      </a>
    ) : p.startsWith("**") ? (
      <strong key={j}>{p.slice(2, -2)}</strong>
    ) : p.startsWith("`") ? (
      <code key={j} className="mono" style={{ padding: "1px 5px", borderRadius: 5, background: "var(--fill-2)", fontSize: 11.5 }}>
        {p.slice(1, -1)}
      </code>
    ) : (
      p
    );
  });
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function renderText(t: string) {
   
  const lines = t.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]); i++) {
        if (!TABLE_RULE.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      }
      i--;
      out.push(
        <div key={i} style={{ margin: "4px 0", overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", font: "500 11.5px/1.4 var(--font-ui)" }}>
            <tbody>
              {rows.map((cells, r) => (
                <tr key={r}>
                  {cells.map((c, k) => {
                    const Cell = r === 0 ? "th" : "td";
                    return (
                      <Cell key={k} style={{ textAlign: "left", verticalAlign: "top", padding: "4px 8px 4px 0", borderBottom: "1px solid var(--hair)", fontWeight: r === 0 ? 650 : k === 0 ? 600 : 500, color: r === 0 ? "var(--ink-1)" : "var(--ink-0)" }}>
                        {inline(c.replace(/^\*\*(.*)\*\*$/, "$1"))}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[-*•]\s+/.test(line);
    const heading = /^\s*#{1,4}\s+/.test(line);
    const body = line.replace(/^\s*[-*•]\s+/, "").replace(/^\s*#{1,4}\s+/, "");
    out.push(
      <div key={i} style={{ display: "flex", gap: 6, minHeight: line ? undefined : 8, fontWeight: heading ? 650 : undefined }}>
        {bullet && <span style={{ color: "var(--accent)" }}>•</span>}
        <span style={{ minWidth: 0 }}>{inline(body)}</span>
      </div>,
    );
  }
  return out;
}

export default function ChatPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conv = useRef(`c-${Date.now().toString(36)}`);
  const scroller = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useAgentInfo();
   
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const photoSeq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
     
    if (msgs.length) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const addFiles = async (files: Iterable<File> | ArrayLike<File> | null | undefined) => {
    const list = Array.from(files ?? []).filter(isImageFile);
    if (!list.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setPhotoError(`At most ${MAX_PHOTOS} photos per message`);
      return;
    }
    setPhotoError(list.length > room ? `Only the first ${room} photo${room === 1 ? "" : "s"} were added (at most ${MAX_PHOTOS} per message)` : null);
    const added: PhotoAttachment[] = [];
    for (const f of list.slice(0, room)) {
      try {
        added.push(await downscaleImage(f, `photo-${++photoSeq.current}`));
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : `${f.name} could not be read`);
      }
    }
    if (added.length) setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS));
  };

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  };

  const send = async (typed: string) => {
    const images = photos;
    if ((!typed.trim() && !images.length) || busy) return;
    const text = typed.trim() ? typed : photoPrompt(images.length);
    setInput("");
    setPhotos([]);
    setPhotoError(null);
    setBusy(true);
     
    setMsgs((m) => [...m, { role: "user", text, steps: [], ...(images.length ? { images } : {}) }, { role: "assistant", text: "", steps: [], pending: true, meta: info ?? undefined }]);
    const update = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json", ...keyHeaders() },
        body: JSON.stringify({ conversation: conv.current, message: text, ...(images.length ? { images: images.map(({ id, name, dataUrl, width, height }) => ({ id, name, dataUrl, width, height })) } : {}) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `The Copilot request failed (HTTP ${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as AgentEvent;
          if (ev.type === "meta") {
            const meta = toAgentInfo(ev);
            if (meta) {
              setInfo(meta);
              update((m) => ({ ...m, meta }));
            }
          } else if (ev.type === "text") update((m) => ({ ...m, text: m.text + (ev.delta ?? "") }));
          else if (ev.type === "tool_call") update((m) => ({ ...m, steps: [...m.steps, { tool: ev.tool!, args: ev.args }] }));
          else if (ev.type === "tool_result")
            update((m) => {
              const steps = m.steps.slice();
              const k = steps.map((s) => s.tool).lastIndexOf(ev.tool!);
              const result = { ok: ev.ok, error: ev.error, decision: ev.decision, script: ev.script, web: ev.web, photo: ev.photo };
              if (k >= 0 && steps[k].ok === undefined) steps[k] = { ...steps[k], ...result };
              else steps.push({ tool: ev.tool!, ...result });
              return { ...m, steps };
            });
          else if (ev.type === "guardrail" && ev.kind)
            update((m) => ({ ...m, steps: [...m.steps, { tool: GUARD, ok: true, guard: { kind: ev.kind!, action: ev.action ?? "blocked", message: ev.message, tool: ev.tool, probability: ev.probability } }] }));
          else if (ev.type === "error") update((m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (err) {
      update((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }));
    }
    update((m) => ({ ...m, pending: false }));
    setBusy(false);
  };

  const notReady = info !== null && !info.ready;
  const decisionModels = useDecisions((s) => s.profiles);
  const defaultDecision = decisionModels.find((p) => p.isDefault);
   
  const sentPhotos = msgs.flatMap((m) => m.images ?? []);
  const photoFor = (s: ToolStep) => {
    const want = s.photo?.id ?? (typeof (s.args as { photo?: unknown } | undefined)?.photo === "string" ? (s.args as { photo: string }).photo : "");
    return (want && sentPhotos.find((p) => p.id === want)) || (!want ? sentPhotos[sentPhotos.length - 1] : undefined);
  };

  return (
    <aside
      className="glass liquid rc-enter"
      style={{ position: "fixed", top: "calc(var(--topbar-bottom, 58px) + 12px)", right: 12, bottom: 96, width: 400, zIndex: 31, display: "flex", flexDirection: "column" }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div style={{ position: "absolute", inset: 8, zIndex: 2, display: "grid", placeItems: "center", borderRadius: 18, border: "2px dashed var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent-ink)", font: "650 13px var(--font-ui)", pointerEvents: "none" }}>
          Drop a photo or sketch of the work area
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: "conic-gradient(from 210deg, #4f8cff, #7c5cff, #c084fc, #4f8cff)" }}>
          <Icon.Sparkle size={18} color="#fff" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "700 14px var(--font-ui)" }}>Copilot</div>
          <div style={{ color: "var(--ink-2)", font: "500 11px var(--font-ui)" }}>Every Enginuity command is a tool</div>
        </div>
        <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} title="Decide playground" onClick={openDecidePlayground}>
          <Icon.Decision size={15} />
        </button>
        <button
          className="g-btn icon ghost"
          title="New conversation"
          onClick={() => {
            void fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json", ...keyHeaders() }, body: JSON.stringify({ conversation: conv.current, reset: true }) });
            conv.current = `c-${Date.now().toString(36)}`;
            setMsgs([]);
            setPhotos([]);
            setPhotoError(null);
            photoSeq.current = 0;
          }}
        >
          <Icon.New size={15} />
        </button>
        <button className="g-btn icon ghost" title="Close" onClick={() => useRC.setState({ rightPanel: "inspector" })}>
          <Icon.Close size={15} />
        </button>
      </div>
      <div style={{ display: "grid", gap: 8, padding: "0 14px 12px", borderBottom: "1px solid var(--hair)" }}>
        <ModelBadge info={info} busy={busy} onOpen={() => openOptionsTab("Copilot")} />
        <CapabilityChips info={info} onOpen={() => openOptionsTab("Copilot")}>
          <button
            type="button"
            className="g-btn ghost"
            style={{ height: 24, padding: "0 9px 0 7px", gap: 5, borderRadius: 999, font: "550 11px var(--font-ui)", background: "var(--fill-1)", boxShadow: "inset 0 0 0 1px var(--hair)", whiteSpace: "nowrap", color: defaultDecision?.ready ? "var(--ink-1)" : "var(--warn)" }}
            title="Decision models the Copilot and Decision instructions use"
            onClick={() => openDecisionModels(defaultDecision?.id ?? "new")}
          >
            <span style={{ display: "inline-flex", color: defaultDecision?.ready ? "var(--accent-ink)" : "var(--warn)" }}>
              <Icon.Decision size={12} />
            </span>
            {defaultDecision ? `Decisions · ${defaultDecision.name}${defaultDecision.ready ? "" : " (needs setup)"}` : "Set up decision models"}
          </button>
        </CapabilityChips>
      </div>
      <div ref={scroller} className="g-scroll" style={{ flex: 1, padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
        {msgs.length === 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>What should we build?</div>
            <div style={{ color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 12 }}>
              Copilot drives the whole app — library, SimReady assets, robots, programs, simulation and code generation — reads photos and sketches of your work area, and can look things up on the web.
            </div>
            {notReady && (
              <button className="g-btn" style={{ marginBottom: 12 }} onClick={() => openOptionsTab("Copilot")}>
                <Icon.Settings size={14} /> Configure model &amp; API key
              </button>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              {SUGGESTIONS.map((s) => {
                const photo = s === PHOTO_SUGGESTION;
                return (
                  <button
                    key={s}
                    className="g-btn ghost"
                    style={{ height: "auto", padding: "9px 12px", justifyContent: "flex-start", gap: 8, textAlign: "left", lineHeight: 1.4, borderRadius: 12, background: "var(--fill-1)", whiteSpace: "normal" }}
                    onClick={() => {
                      if (!photo) return void send(s);
                      if (!input.trim()) setInput(photoPrompt(1));
                      fileInput.current?.click();
                    }}
                  >
                    {photo && (
                      <span style={{ display: "inline-flex", color: "var(--accent-ink)" }}>
                        <Icon.Camera size={14} />
                      </span>
                    )}
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="rc-pop" style={{ alignSelf: "flex-end", maxWidth: "86%", display: "grid", justifyItems: "end" }}>
              {m.images && <PhotoThumbs photos={m.images} />}
              <div style={{ padding: "9px 13px", borderRadius: "18px 18px 6px 18px", background: "var(--fill-2)", color: "var(--ink-0)", lineHeight: 1.45, userSelect: "text", overflowWrap: "anywhere" }}>{m.text}</div>
            </div>
          ) : (
            <div key={i} style={{ alignSelf: "stretch", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, minWidth: 0 }}>
              {m.steps.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
                  {m.steps.map((s, k) => {
                    if (s.guard) {
                       
                      const removed = m.steps.reduce((n, x) => n + (x.web?.blocked ?? 0), 0);
                      if (s.guard.kind === "injection" && (s.guard.tool || s.guard.action === "redacted") && removed > 0) return null;
                      return <GuardNotice key={k} g={s.guard} removed={removed} />;
                    }
                    if (isWeb(s.tool)) return <WebStepCard key={k} tool={s.tool} args={s.args} ok={s.ok} error={s.error} web={s.web} />;
                    if (s.tool === "photo.findObjects") return <PhotoStepCard key={k} ok={s.ok} error={s.error} info={s.photo} image={photoFor(s)} />;
                    return (
                      <div key={k} className="rc-enter" style={{ display: "grid", gap: 8, padding: "5px 9px", borderRadius: 10, background: "var(--fill-1)", font: "500 11.5px var(--font-ui)" }} title={s.error ?? JSON.stringify(s.args ?? {})}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 16, display: "inline-flex", color: s.ok === undefined ? "var(--accent)" : s.ok ? "var(--good)" : "var(--bad)" }}>
                            {s.ok === undefined ? <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--accent)", animation: "rc-pulse 1s infinite" }} /> : s.ok ? <Icon.Check size={13} /> : <Icon.Warning size={13} />}
                          </span>
                          <span className="mono" style={{ color: "var(--ink-1)", fontSize: 11 }}>
                            {s.tool}
                          </span>
                          <span style={{ marginLeft: "auto", color: "var(--ink-3)", maxWidth: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.error ?? summarize(s.args)}</span>
                        </div>
                        {s.decision && (
                          <div style={{ padding: "6px 2px 4px" }}>
                            <DecisionResultCard result={s.decision} compact />
                          </div>
                        )}
                        {s.script && <ScriptRunCard run={s.script} showCode />}
                      </div>
                    );
                  })}
                </div>
              )}
              {(m.text || m.pending) && (
                <div style={{ padding: "10px 13px", borderRadius: "18px 18px 18px 6px", background: "var(--fill-1)", lineHeight: 1.5, color: "var(--ink-0)", userSelect: "text", overflowWrap: "anywhere" }}>
                  {m.text ? renderText(m.text) : <span className="rc-shimmer" style={{ display: "block", width: 120, height: 10, borderRadius: 6 }} />}
                </div>
              )}
              {m.error && <div style={{ padding: "8px 12px", borderRadius: 12, background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", lineHeight: 1.45 }}>{m.error}</div>}
              {m.meta && <TurnFooter info={m.meta} web={m.steps.some((s) => isWeb(s.tool) && s.ok !== false)} />}
            </div>
          ),
        )}
      </div>
      <div style={{ padding: 12 }}>
        {info?.byok && <KeyForm ready={info.ready} />}
        <PhotoTray photos={photos} onRemove={(id) => setPhotos((p) => p.filter((x) => x.id !== id))} />
        {photoError && <div style={{ padding: "0 6px 6px", color: "var(--warn)", font: "550 11px/1.4 var(--font-ui)" }}>{photoError}</div>}
        <div className="glass-inset" style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: 6, borderRadius: 18 }}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="g-btn icon ghost"
            style={{ width: 34, height: 34, flexShrink: 0 }}
            disabled={busy || photos.length >= MAX_PHOTOS}
            onClick={() => fileInput.current?.click()}
            aria-label="Attach a photo or sketch"
            title={`Attach a photo or sketch of the work area (or paste / drop an image; up to ${MAX_PHOTOS})`}
          >
            <Icon.Camera size={16} />
          </button>
          <textarea
            className="g-input"
            rows={2}
            placeholder={photos.length ? "Say what to build from the photo, or just press Enter…" : info ? `Ask ${info.model.label} to build, simulate or look something up…` : "Ask Copilot to build, simulate or explain…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter(isImageFile);
              if (!files.length) return;
              e.preventDefault();
              void addFiles(files);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            style={{ background: "transparent", boxShadow: "none", minHeight: 40, maxHeight: 140 }}
          />
          <button className="g-btn primary icon" style={{ width: 34, height: 34, flexShrink: 0 }} disabled={busy || (!input.trim() && !photos.length)} onClick={() => void send(input)} aria-label="Send to the Copilot" title="Send to the Copilot (Enter)">
            <Icon.Send size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function summarize(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .filter(([k]) => k !== "code")
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}





function KeyForm({ ready }: { ready: boolean }) {
  const [keys, setKeys] = useState(browserKeys);
  const [open, setOpen] = useState(!ready);
  const field = { height: 30, fontSize: 12 } as const;
  if (!open)
    return (
      <button className="g-btn ghost" style={{ height: 26, fontSize: 11.5, marginBottom: 8 }} onClick={() => setOpen(true)}>
        Your API key (stored in this browser)
      </button>
    );
  return (
    <div className="glass-inset" style={{ display: "grid", gap: 6, padding: 10, borderRadius: 14, marginBottom: 8 }}>
      <div style={{ font: "600 12px var(--font-ui)" }}>Use your own key</div>
      <div style={{ font: "500 11px var(--font-ui)", color: "var(--ink-2)", lineHeight: 1.4 }}>
        Kept in this browser only and sent with your Copilot requests; never stored on the server. Get a Meta Model API key at dev.meta.ai.
      </div>
      <input className="g-input" style={field} type="password" placeholder="Meta Model API key (required)" value={keys.meta} onChange={(e) => setKeys({ ...keys, meta: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="g-btn primary" style={{ height: 28, fontSize: 12 }} onClick={() => { saveBrowserKeys(keys); setOpen(false); }}>
          Save
        </button>
        <button className="g-btn ghost" style={{ height: 28, fontSize: 12 }} onClick={() => { const empty = { ...keys, meta: "" }; setKeys(empty); saveBrowserKeys(empty); }}>
          Forget key
        </button>
      </div>
    </div>
  );
}
