"use client";

 
 
 

import { useEffect, useState } from "react";
import { cmd } from "@/client/api";
import { pushView, useRC } from "@/client/store";
import type { ExampleEntry } from "@/engine/examples";
import { Icon } from "./icons";

type Example = ExampleEntry & { missing: string[]; thumbnail: string };

 
const libraryName = (file: string) => file.replace(/\.(robot|tool|rdka)$/i, "").replace(/-/g, " ");

export default function ExamplesPanel({ query, onOpened }: { query: string; onOpened: () => void }) {
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void cmd<Example[]>("examples.list", {}, { quiet: true }).then((list) => alive && setExamples(list ?? []));
    return () => {
      alive = false;
    };
  }, []);

  const open = async (e: Example) => {
    setBusy(e.slug);
    const res = await cmd<{ name: string; mainProgram: string }>("examples.open", { example: e.slug });
    setBusy(null);
    if (!res) return;
    useRC.getState().toast({ kind: "success", title: `${res.name} opened`, body: `Run ${res.mainProgram} to start the cell` });
    onOpened();
    setTimeout(() => pushView({ action: "fit" }), 500);
  };

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (examples ?? []).filter((e) => {
    const hay = [e.name, e.description, ...e.features, ...e.robots, ...e.tools].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  return (
    <div data-testid="examples-panel" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "4px 4px 10px" }}>
        <div style={{ font: "650 13px var(--font-ui)" }}>Enginuity examples</div>
        <div style={{ color: "var(--ink-2)", font: "500 12px var(--font-ui)" }}>{examples ? `${shown.length} ready-to-run cells` : "Loading…"}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))", gap: 14 }}>
        {shown.map((e) => (
          <div
            key={e.slug}
            className="rc-example"
            data-testid={`example-${e.slug}`}
            onDoubleClick={() => void open(e)}
            style={{ display: "flex", flexDirection: "column", borderRadius: 20, padding: 10, background: "var(--fill-1)", boxShadow: "inset 0 0 0 1px var(--hair)", transition: "transform .35s var(--ease-spring)" }}
          >
            <div style={{ aspectRatio: "16 / 10", borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 30%, #ffffff, #ececea)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.thumbnail} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <div style={{ font: "650 13.5px var(--font-ui)", margin: "10px 2px 3px" }}>{e.name}</div>
            <div style={{ color: "var(--ink-2)", font: "500 11.5px/1.45 var(--font-ui)", margin: "0 2px", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={e.description}>
              {e.description}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "9px 0 8px" }}>
              {e.features.slice(0, 4).map((f) => (
                <span key={f} style={{ padding: "2px 7px", borderRadius: 999, background: "var(--fill-2)", font: "500 10.5px var(--font-ui)", color: "var(--ink-1)" }}>
                  {f}
                </span>
              ))}
              {e.features.length > 4 && (
                <span title={e.features.slice(4).join(", ")} style={{ padding: "2px 7px", borderRadius: 999, font: "500 10.5px var(--font-ui)", color: "var(--ink-2)" }}>
                  +{e.features.length - 4}
                </span>
              )}
            </div>
            <div style={{ color: "var(--ink-2)", font: "500 11px var(--font-ui)", margin: "0 2px 10px", display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
              <Icon.Robot size={13} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={[...e.robots, ...e.tools].join(", ")}>
                {[...e.robots, ...e.tools].map(libraryName).join(" · ")}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
              <button className="g-btn primary" style={{ height: 32, flex: 1 }} disabled={busy === e.slug} onClick={() => void open(e)}>
                <Icon.Open size={15} /> {busy === e.slug ? "Opening…" : "Open example"}
              </button>
              {e.cycleTime ? <span className="mono" style={{ color: "var(--ink-2)", font: "500 11px var(--font-mono)" }} title="Simulated cycle time of the main program">{`${Math.round(e.cycleTime)} s`}</span> : null}
            </div>
            {e.missing.length > 0 && (
              <div style={{ marginTop: 8, color: "var(--warn)", font: "500 10.5px/1.4 var(--font-ui)" }} title={e.missing.join(", ")}>
                {e.missing.length === 1 ? "1 library file is" : `${e.missing.length} library files are`} not on this computer yet: Enginuity downloads them when the example opens (not in offline mode).
              </div>
            )}
          </div>
        ))}
      </div>
      <style>{`.rc-example:hover{transform:translateY(-3px)}`}</style>
    </div>
  );
}
