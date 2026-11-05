"use client";
// Searches and runs application commands from a keyboard palette.

import { useEffect, useMemo, useRef, useState } from "react";
import { cmd } from "@/client/api";
import { prettyKeys } from "@/client/shortcuts";
import { useRC } from "@/client/store";
import { runAction } from "@/client/uiActions";
import { effectiveShortcut, MAIN_ACTIONS } from "@/engine/actions";
import { stationFileBase } from "@/engine/stationFile";
import { Icon } from "./icons";

interface CmdInfo {
  name: string;
  title: string;
  description: string;
  category: string;
  shortcut: string | null;
  schema: { properties?: Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown }>; required?: string[] };
}

function score(q: string, c: CmdInfo) {
  if (!q) return 1;
  const hay = `${c.title} ${c.name} ${c.category} ${c.description}`.toLowerCase();
  let s = 0;
  for (const t of q.toLowerCase().split(/\s+/)) {
    if (!t) continue;
    if (c.title.toLowerCase().startsWith(t)) s += 4;
    else if (c.title.toLowerCase().includes(t)) s += 3;
    else if (hay.includes(t)) s += 1;
    else return 0;
  }
  return s;
}

 
let catalog: Promise<CmdInfo[]> | null = null;

 
function menuActions(settings: Record<string, unknown>): CmdInfo[] {
  return MAIN_ACTIONS.filter((a) => !a.unavailable && !a.noop).map((a) => ({
    name: `action:${a.name}`,
    title: a.text.replace(/\s*\(F2\)$/, "").replace(/\.\.\.$/, "…"),
    description: a.menu === "None" ? "Action" : `${a.menu} menu`,
    category: "menu",
    shortcut: effectiveShortcut(a, settings) ?? null,
    schema: {},
  }));
}

export default function CommandPalette() {
  const open = useRC((s) => s.paletteOpen);
   
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const open = true;
  const [all, setAll] = useState<CmdInfo[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<CmdInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const settings = useRC((s) => s.settings);

  useEffect(() => {
    catalog ??= fetch("/api/commands").then((r) => r.json() as Promise<CmdInfo[]>);
    void catalog.then(setAll);
    void cmd<string[]>("station.listFiles", {}, { quiet: true }).then((s) => setStations(s ?? []));
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const results = useMemo(() => {
    const hidden = new Set(["sim.finish"]);
    const cmds = [...menuActions(settings), ...all.filter((c) => !hidden.has(c.name))].map((c) => ({ c, s: score(q, c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
    const files = stations.filter((f) => !q || f.toLowerCase().includes(q.toLowerCase())).map((f) => ({ name: `open:${f}`, title: `Open ${stationFileBase(f)}`, description: "Saved station", category: "file", shortcut: null, schema: {} }) as CmdInfo);
    return [...files.slice(0, 5), ...cmds].slice(0, 60);
  }, [all, q, stations, settings]);

  void open;
  const close = () => useRC.setState({ paletteOpen: false });

  const run = (c: CmdInfo) => {
    if (c.name.startsWith("action:")) {
      close();
      void runAction(c.name.slice(7));
      return;
    }
    if (c.name.startsWith("open:")) {
      void cmd("station.open", { path: c.name.slice(5) });
      close();
      return;
    }
    const props = c.schema.properties ?? {};
    const required = c.schema.required ?? [];
    if (required.length || Object.keys(props).length) {
      setForm(c);
      setValues({});
      return;
    }
    void cmd(c.name);
    close();
  };

  const submit = () => {
    if (!form) return;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === "") continue;
      const t = form.schema.properties?.[k]?.type;
      if (t === "number" || t === "integer") params[k] = Number(v);
      else if (t === "boolean") params[k] = v === "true";
      else if (t === "array") {
        try {
          params[k] = JSON.parse(v.startsWith("[") ? v : `[${v}]`);
        } catch {
          params[k] = v.split(",").map((x) => Number(x.trim()));
        }
      } else params[k] = v;
    }
    void cmd(form.name, params).then((r) => r !== null && useRC.getState().toast({ kind: "success", title: form.title, body: JSON.stringify(r).slice(0, 220) }));
    close();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 75, display: "flex", justifyContent: "center", paddingTop: "12vh", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass glass-strong liquid rc-pop" style={{ width: 640, maxHeight: "68vh", borderRadius: 24, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!form ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--hair)" }}>
              <Icon.Command size={18} />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setIdx(0);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "ArrowDown") setIdx((i) => Math.min(results.length - 1, i + 1));
                  if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
                  if (e.key === "Enter" && results[idx]) run(results[idx]);
                  if (e.key === "Escape") close();
                }}
                placeholder="Type a command, e.g. “teach target”, “generate”, “open”…"
                style={{ flex: 1, height: 30, border: 0, outline: "none", background: "transparent", color: "var(--ink-0)", font: "500 15px var(--font-ui)" }}
              />
              <span className="g-kbd">esc</span>
            </div>
            <div className="g-scroll" style={{ padding: 6 }}>
              {results.map((c, i) => (
                <div
                  key={c.name}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => run(c)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: i === idx ? "var(--fill-2)" : "transparent", color: "var(--ink-0)", cursor: "pointer" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13px var(--font-ui)" }}>{c.title}</div>
                    <div style={{ font: "500 11px var(--font-ui)", opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.description}</div>
                  </div>
                  <span style={{ font: "500 10.5px var(--font-mono)", opacity: 0.6 }}>{c.category}</span>
                  {c.shortcut && <span className="g-kbd">{prettyKeys(c.shortcut)}</span>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ padding: 18 }}>
            <div style={{ font: "700 16px var(--font-ui)", marginBottom: 4 }}>{form.title}</div>
            <div style={{ color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.45 }}>{form.description}</div>
            <div className="g-scroll" style={{ display: "grid", gap: 10, maxHeight: "44vh" }}>
              {Object.entries(form.schema.properties ?? {}).map(([k, p]) => (
                <label key={k} style={{ display: "grid", gap: 5 }}>
                  <span className="g-label">
                    {k}
                    {form.schema.required?.includes(k) ? " *" : ""}
                    <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, marginLeft: 6, color: "var(--ink-3)" }}>{p.description ?? p.type}</span>
                  </span>
                  {p.enum ? (
                    <select className="g-input" value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })}>
                      <option value="" />
                      {p.enum.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="g-input" value={values[k] ?? ""} placeholder={p.default !== undefined ? String(p.default) : ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") submit();
                      }} />
                  )}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="g-btn ghost" onClick={() => setForm(null)}>
                Back
              </button>
              <button className="g-btn primary" onClick={submit}>
                Run
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
