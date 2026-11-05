"use client";
// Prepares photo attachments and renders image previews and analysis cards.

 
 
 

import type { CSSProperties } from "react";

export interface PhotoAttachment {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PhotoBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c?: number | null;
}

 
export interface PhotoInfo {
  id: string;
  width: number | null;
  height: number | null;
  objects: { label: string; boxes: PhotoBox[]; error?: string }[];
  ms?: number;
}

export const MAX_PHOTOS = 4;
const MAX_SIDE = 1600;
const COLORS = ["#4f8cff", "#f59e0b", "#10b981", "#ef4444", "#a855f7", "#06b6d4"];

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  try {
     
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

 
export async function downscaleImage(file: File, id: string): Promise<PhotoAttachment> {
  const { source, width, height, close } = await decode(file);
  try {
    if (!width || !height) throw new Error(`${file.name || "The image"} could not be read`);
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot prepare images");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const name = (file.name || "photo").replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return { id, name, dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: w, height: h };
  } finally {
    close?.();
  }
}

const thumb: CSSProperties = { display: "block", objectFit: "cover", borderRadius: 9, boxShadow: "inset 0 0 0 1px var(--hair)", background: "var(--fill-2)" };

 
export function PhotoTray({ photos, onRemove }: { photos: PhotoAttachment[]; onRemove: (id: string) => void }) {
  if (!photos.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, padding: "0 4px 8px", flexWrap: "wrap" }}>
      {photos.map((p) => (
        <div key={p.id} className="rc-pop" style={{ position: "relative" }} title={`${p.id} · ${p.name} · ${p.width} × ${p.height} px`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
          <img src={p.dataUrl} alt={p.name} width={52} height={52} style={{ ...thumb, width: 52, height: 52 }} />
          <span style={{ position: "absolute", left: 4, bottom: 3, padding: "0 4px", borderRadius: 5, background: "rgba(0,0,0,.55)", color: "#fff", font: "600 9px/14px var(--font-ui)" }}>{p.id.replace("photo-", "#")}</span>
          <button
            type="button"
            className="g-btn icon"
            aria-label={`Remove ${p.id}`}
            title={`Remove ${p.id}`}
            onClick={() => onRemove(p.id)}
            style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, minWidth: 18, padding: 0, borderRadius: 9, font: "700 11px/1 var(--font-ui)" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

 
export function PhotoThumbs({ photos }: { photos: PhotoAttachment[] }) {
  if (!photos.length) return null;
  const size = photos.length === 1 ? 160 : 76;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: 6 }}>
      {photos.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- a local data URL
        <img key={p.id} src={p.dataUrl} alt={`${p.id}: ${p.name}`} title={`${p.id} · ${p.name}`} style={{ ...thumb, maxWidth: "100%", width: photos.length === 1 ? "auto" : size, height: photos.length === 1 ? "auto" : size, maxHeight: size }} />
      ))}
    </div>
  );
}

const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

 
export function PhotoStepCard({ ok, error, info, image }: { ok?: boolean; error?: string | null; info?: PhotoInfo; image?: PhotoAttachment }) {
  const pending = ok === undefined;
  const W = info?.width || image?.width || 0;
  const H = info?.height || image?.height || 0;
  const objects = info?.objects ?? [];
  const found = objects.reduce((n, o) => n + o.boxes.length, 0);
  const title = pending ? "Finding objects with SAM 3.1…" : ok ? `SAM 3.1 found ${found} object${found === 1 ? "" : "s"}${info?.id ? ` in ${info.id}` : ""}` : "SAM 3.1 could not search the photo";
  const c = ok === false ? "var(--bad)" : "var(--info)";
  const fs = Math.max(12, Math.round(Math.max(W, H) / 45));
  return (
    <div className="rc-enter" style={{ display: "grid", gap: 8, padding: "10px 11px", borderRadius: 13, background: "var(--fill-1)", boxShadow: "inset 0 0 0 1px var(--hair)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, animation: pending ? "rc-pulse 1s infinite" : undefined }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
            <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" />
          </svg>
        </span>
        <span style={{ font: "650 12px var(--font-ui)", color: "var(--ink-0)", ...ellipsis }}>{title}</span>
        {!pending && info?.ms !== undefined && <span style={{ marginLeft: "auto", flexShrink: 0, color: "var(--ink-3)", font: "500 10.5px var(--font-ui)" }}>{(info.ms / 1000).toFixed(1)} s</span>}
      </div>
      {image && (
        <div style={{ position: "relative", borderRadius: 9, overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--hair)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
          <img src={image.dataUrl} alt={`${image.id}: ${image.name}`} style={{ display: "block", width: "100%", height: "auto", opacity: pending ? 0.7 : 1 }} />
          {W > 0 && H > 0 && found > 0 && (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
              {objects.map((o, k) =>
                o.boxes.map((b, j) => {
                  const color = COLORS[k % COLORS.length];
                  return (
                    <g key={`${k}-${j}`}>
                      <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={`${color}22`} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" rx={fs / 4} />
                      <text x={b.x1 + fs / 3} y={b.y1 + fs * 1.05} fill="#fff" stroke="rgba(0,0,0,.65)" strokeWidth={fs / 5} paintOrder="stroke" style={{ font: `650 ${fs}px var(--font-ui)` }}>
                        {o.label}
                        {typeof b.c === "number" ? ` ${b.c.toFixed(2)}` : ""}
                      </text>
                    </g>
                  );
                }),
              )}
            </svg>
          )}
        </div>
      )}
      {objects.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
          {objects.map((o, k) => (
            <span key={o.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "550 11px var(--font-ui)", color: o.error ? "var(--bad)" : o.boxes.length ? "var(--ink-1)" : "var(--ink-3)" }} title={o.error}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: COLORS[k % COLORS.length], opacity: o.boxes.length ? 1 : 0.35 }} />
              {o.label} · {o.error ? "failed" : o.boxes.length}
            </span>
          ))}
        </div>
      )}
      {error && <div style={{ color: "var(--bad)", font: "500 11.5px/1.4 var(--font-ui)" }}>{error}</div>}
    </div>
  );
}
