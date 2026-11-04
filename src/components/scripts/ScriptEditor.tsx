"use client";

 
 
 

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cmdx, onServerEvent } from "@/client/api";
import { useRC } from "@/client/store";
import { SCRIPT_EXAMPLES, SCRIPT_LIMITS, SCRIPT_REFERENCE } from "@/engine/scripts";
import { Icon } from "../icons";
import { ScriptRunCard } from "./ScriptRunCard";
import { appendLive, closeScriptEditor, runScript, stopScript, useScriptEditor } from "./uiStore";

 
const LINE = 20;

const NEW_SCRIPT = `// Enginuity script: robolink-style API and robomath (see Reference)
const robot = RDK.ItemList(ITEM_TYPE_ROBOT)[0];
if (!robot) throw new Error("Add a robot first (Library)");
print("Robot:", robot.Name(), "joints:", robot.Joints().list().join(", "));
`;

 
export default function ScriptEditorHost() {
  const open = useScriptEditor((s) => s.open);
  const nonce = useScriptEditor((s) => s.nonce);
  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "script-log" && e.run === useScriptEditor.getState().running) appendLive(String(e.line ?? ""));
      }),
    [],
  );
  return open ? <ScriptEditor key={nonce} /> : null;
}

function ScriptEditor() {
  const [init] = useState(() => {
    const s = useScriptEditor.getState();
    return { item: s.item, name: s.draft?.name ?? "Script", code: s.draft?.code ?? NEW_SCRIPT, autoRun: s.autoRun };
  });
  const [itemId, setItemId] = useState<string | null>(init.item);
  const [name, setName] = useState(init.name);
  const [code, setCode] = useState(init.item ? "" : init.code);
  const [baseline, setBaseline] = useState<{ name: string; code: string } | null>(init.item ? null : { name: init.name, code: init.code });
  const [tab, setTab] = useState<"output" | "reference" | "examples">("output");
  const [closing, setClosing] = useState(false);
  const running = useScriptEditor((s) => s.running);
  const live = useScriptEditor((s) => s.live);
  const result = useScriptEditor((s) => s.result);
  const keepOnError = useScriptEditor((s) => s.keepOnError);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const toast = useRC((s) => s.toast);

  useEffect(() => {
    if (!init.item) return;
    let active = true;
    void cmdx<{ id: string; name: string; code: string }>("script.get", { item: init.item }).then((r) => {
      if (!active) return;
      if (!r.ok || !r.result) {
        useRC.getState().toast({ kind: "error", title: "Script", body: r.error ?? "Script not found" });
        closeScriptEditor();
        return;
      }
      const s = r.result;
      setItemId(s.id);
      setName(s.name);
      setCode(s.code);
      setBaseline({ name: s.name, code: s.code });
      if (init.autoRun) void runScript(s.code, s.name);
    });
    return () => {
      active = false;
    };
  }, [init]);

  const loading = baseline === null;
  const dirty = !loading && (baseline.code !== code || baseline.name !== name || !itemId);
  const lineCount = code.split("\n").length;
  const errLine = result?.error?.line ?? null;

  const run = () => {
    if (!running && !loading) {
      setTab("output");
      void runScript(code, name.trim() || "Script");
    }
  };

  const save = async (asNew = false) => {
    const params = asNew || !itemId ? { code, name: name.trim() || "Script" } : { item: itemId, code, name: name.trim() || "Script" };
    const r = await cmdx<{ id: string; name: string }>("script.save", params);
    if (!r.ok || !r.result) return toast({ kind: "error", title: "Save script", body: r.error ?? "failed" });
    setItemId(r.result.id);
    setName(r.result.name);
    setBaseline({ name: r.result.name, code });
    toast({ kind: "success", title: `Saved ${r.result.name}`, body: "Saved in the station: double-click it in the tree to run it." });
  };

  const close = () => {
    if (dirty && itemId && !closing) return setClosing(true);
    closeScriptEditor();
  };

  const gotoLine = (n: number) => {
    const el = area.current;
    if (!el) return;
    const lines = code.split("\n");
    const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (n - 6) * LINE);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    } else if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
       
      if (!document.execCommand?.("insertText", false, "  ")) {
        const { selectionStart: a, selectionEnd: b } = el;
        setCode(code.slice(0, a) + "  " + code.slice(b));
        requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
      }
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 73, display: "grid", placeItems: "center", background: "var(--scrim)" }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
    >
      <div className="glass glass-strong liquid rc-pop" role="dialog" aria-label="Script editor" style={{ width: "min(1180px, calc(100vw - 40px))", height: "min(800px, calc(100vh - 40px))", borderRadius: 26, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--hair)" }}>
          <span style={{ display: "inline-flex", color: "var(--good)" }}>
            <Icon.Script size={19} />
          </span>
          <input className="g-input" aria-label="Script name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ width: 220, height: 30, font: "650 13.5px var(--font-ui)" }} />
          <span style={{ color: running ? "var(--accent-ink)" : dirty ? "var(--warn)" : "var(--ink-3)", font: "550 11.5px var(--font-ui)" }}>
            {running ? "Running…" : loading ? "Loading…" : !itemId ? "Not saved" : dirty ? "Unsaved changes" : "Saved in the station"}
          </span>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            {running ? (
              <button className="g-btn" style={{ color: "var(--bad)" }} onClick={stopScript} title="Stop the script (changes so far stay, as one undo step)">
                <Icon.Stop size={14} /> Stop
              </button>
            ) : (
              <button className="g-btn primary" disabled={loading} onClick={run} title="Run on the active station (⌘↩)">
                <Icon.Play size={14} /> Run
              </button>
            )}
            <button className="g-btn" disabled={loading} onClick={() => void save()} title={itemId ? "Save the script item (⌘S)" : "Save as a station item (⌘S)"}>
              <Icon.Save size={14} /> Save
            </button>
            {itemId && (
              <button className="g-btn ghost" onClick={() => void save(true)} title="Save a copy as a new script item">
                Save as new
              </button>
            )}
            <button className="g-btn icon ghost" onClick={close} title="Close">
              <Icon.Close />
            </button>
          </div>
        </div>
        {closing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "color-mix(in srgb, var(--warn) 12%, transparent)", font: "550 12px var(--font-ui)" }}>
            Close without saving the changes to {baseline?.name}?
            <button className="g-btn" style={{ height: 26, marginLeft: "auto" }} onClick={closeScriptEditor}>
              Discard changes
            </button>
            <button className="g-btn ghost" style={{ height: 26 }} onClick={() => setClosing(false)}>
              Keep editing
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 520px", minWidth: 0, minHeight: 260, position: "relative", background: "var(--well)" }}>
            <div ref={gutter} aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 46, overflow: "hidden", padding: "12px 0", font: `500 11.5px/${LINE}px var(--font-mono)`, color: "var(--ink-3)", textAlign: "right", userSelect: "none" }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} style={{ height: LINE, paddingRight: 10, color: errLine === i + 1 ? "var(--bad)" : undefined, background: errLine === i + 1 ? "color-mix(in srgb, var(--bad) 16%, transparent)" : undefined }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              ref={area}
              aria-label="Script code"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              value={code}
              disabled={loading}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKey}
              onScroll={(e) => {
                if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
              }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", resize: "none", border: 0, outline: "none", background: "transparent", color: "var(--ink-0)", padding: "12px 14px 12px 56px", font: `500 12.5px/${LINE}px var(--font-mono)`, tabSize: 2, whiteSpace: "pre", overflow: "auto" }}
            />
          </div>
          <div style={{ flex: "1 1 340px", maxWidth: "100%", minWidth: 0, minHeight: 220, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--hair)" }}>
            <div style={{ display: "flex", gap: 4, padding: "8px 10px", borderBottom: "1px solid var(--hair)" }}>
              {(["output", "reference", "examples"] as const).map((t) => (
                <button key={t} className={`g-btn ${tab === t ? "active" : "ghost"}`} style={{ height: 26, textTransform: "capitalize" }} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="g-scroll" style={{ flex: 1, minHeight: 0, padding: 10 }}>
              {tab === "output" &&
                (running ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-ink)", font: "600 12px var(--font-ui)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--accent)", animation: "rc-pulse 1s infinite" }} />
                      Running {name}…
                    </div>
                    <pre className="mono" style={{ margin: 0, padding: "6px 8px", borderRadius: 8, background: "var(--well)", font: "500 11px/1.5 var(--font-mono)", whiteSpace: "pre-wrap", userSelect: "text" }}>
                      {live.length ? live.join("\n") : "No output yet"}
                    </pre>
                  </div>
                ) : result ? (
                  <ScriptRunCard run={result} onLine={gotoLine} />
                ) : (
                  <div style={{ color: "var(--ink-2)", lineHeight: 1.55, font: "500 12px var(--font-ui)" }}>
                    Run the script (⌘↩) to see what it prints, what it changed in the station and the program files it generated. Every call is a real Enginuity command on the active station, and the whole run is one undo step.
                  </div>
                ))}
              {tab === "reference" && (
                <pre className="mono" style={{ margin: 0, font: "500 11px/1.55 var(--font-mono)", whiteSpace: "pre-wrap", color: "var(--ink-1)", userSelect: "text" }}>
                  {SCRIPT_REFERENCE}
                </pre>
              )}
              {tab === "examples" && (
                <div style={{ display: "grid", gap: 8 }}>
                  {SCRIPT_EXAMPLES.map((ex) => (
                    <div key={ex.name} style={{ padding: "8px 10px", borderRadius: 10, background: "var(--fill-1)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ font: "650 12px var(--font-ui)" }}>{ex.name}</span>
                        <button
                          className="g-btn"
                          style={{ height: 24, marginLeft: "auto" }}
                          onClick={() => {
                            setCode(ex.code);
                            if (!itemId) setName(ex.name);
                          }}
                        >
                          Use
                        </button>
                      </div>
                      <div style={{ color: "var(--ink-2)", font: "500 11.5px var(--font-ui)", marginTop: 3 }}>{ex.code.split("\n")[0].replace(/^\/\/\s*/, "")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "7px 16px", borderTop: "1px solid var(--hair)", color: "var(--ink-3)", font: "500 11px var(--font-ui)" }}>
          <span>
            JavaScript · robolink-style names · runs on the active station · one undo step per run · limits {SCRIPT_LIMITS.timeMs / 1000} s, {SCRIPT_LIMITS.calls.toLocaleString()} commands, no files or network
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto", color: "var(--ink-2)" }} title="By default a run that fails or is stopped is undone completely">
            <input type="checkbox" checked={keepOnError} onChange={(e) => useScriptEditor.setState({ keepOnError: e.target.checked })} />
            Keep changes when a run fails
          </label>
        </div>
      </div>
    </div>
  );
}
