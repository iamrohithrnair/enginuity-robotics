"use client";
// Edits, saves, approves, and deletes robot post processors.

 
 
 
 
 
 

import { useEffect, useState, type KeyboardEvent } from "react";
import { create } from "zustand";
import { cmd, cmdx, onServerEvent } from "@/client/api";
import { useRC } from "@/client/store";
import { postFileName, type PostInfo, type PostSource } from "@/engine/posts";
import { Icon } from "./icons";
import PostPickerHost from "./PostPickerDialog";

interface PostList {
  folder: string;
  posts: PostInfo[];
  unavailable: { name: string; robots: number }[];
}

export const usePostEditor = create<{ open: boolean; selected: string | null }>(() => ({ open: false, selected: null }));

export function openPostEditor(selected?: string | null) {
  usePostEditor.setState((s) => ({ open: true, selected: selected ?? s.selected }));
}

const close = () => usePostEditor.setState({ open: false });
const select = (name: string | null) => usePostEditor.setState({ selected: name });

 
export default function PostEditorHost() {
  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "post-confirm" && typeof e.name === "string") openPostEditor(e.name);
      }),
    [],
  );
  const open = usePostEditor((s) => s.open);
  return (
    <>
      <PostPickerHost />
      {open && <PostEditor />}
    </>
  );
}

function PostEditor() {
  const selected = usePostEditor((s) => s.selected);
  const ws = useRC((s) => s.ws);
  const toast = useRC((s) => s.toast);
  const [list, setList] = useState<PostList | null>(null);
  const [post, setPost] = useState<PostSource | null>(null);
  const [code, setCode] = useState("");
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [askRobots, setAskRobots] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [version, setVersion] = useState(0);
   
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void cmd<PostList>("post.list", {}, { quiet: true }).then((r) => live && r && setList(r));
    return () => {
      live = false;
    };
  }, [version]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    void cmdx<PostSource>("post.get", { name: selected }).then((r) => {
      if (!live) return;
      setPost(r.ok ? r.result : null);
      setCode(r.ok && r.result ? r.result.source : "");
      setError(r.ok ? null : r.error);
      setConfirmDelete(false);
    });
    return () => {
      live = false;
    };
  }, [selected, version]);

  const reload = () => setVersion((v) => v + 1);
  const stop = (e: KeyboardEvent) => e.stopPropagation();
  const robots = Object.values(ws?.items ?? {}).filter((i) => i.type === "robot");
  const shown = (list?.posts ?? []).filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
  const user = post?.kind === "user";
  const dirty = user && code !== post?.source;

  const run = async (name: string, params: Record<string, unknown>) => {
    const r = await cmdx<Record<string, unknown>>(name, params);
    if (!r.ok) setError(r.error);
    else setError(null);
    return r;
  };

  const customize = async () => {
    if (!post || !newName.trim()) return;
    const name = newName.trim();
    const r = await run("post.save", { name, base: post.name });
    if (!r.ok) return;
    setNewName("");
    select(name);
    reload();
    if (robots.length) setAskRobots(name);
  };

  const save = async () => {
    if (!post) return;
    const r = await run("post.save", { name: post.name, source: code });
    if (r.ok) {
      toast({ kind: "success", title: "Post processor saved", body: `${list?.folder ?? ""}/${post.name}.py` });
      reload();
    }
  };

  const remove = async () => {
    if (!post) return;
    const r = await run("post.delete", { name: post.name });
    if (r.ok) {
      select(null);
      setPost(null);
      reload();
    }
  };

  const approve = async () => {
    if (!post?.hash) return;
    const r = await run("post.approve", { name: post.name, hash: post.hash });
    if (r.ok) reload();
  };

  const createNew = async () => {
    if (creating === null || !creating) return;
     
    const name = postFileName(creating);
    const r = await run("post.save", { name, base: "Post_Generic" });
    if (!r.ok) return;
    setCreating(null);
    select(name);
    reload();
  };

  const applyToRobots = async (name: string) => {
    setAskRobots(null);
    for (const r of robots) await cmd("robot.setPostProcessor", { robot: r.id, post: name });
    toast({ kind: "success", title: "Post processor", body: `${robots.length} robot(s) now use ${name}` });
  };

  const group = (kind: PostInfo["kind"], title: string) => {
    const items = shown.filter((p) => p.kind === kind);
    if (!items.length) return null;
    return (
      <>
        <div className="g-label" style={{ padding: "10px 10px 4px" }}>
          {title}
        </div>
        {items.map((p) => (
          <button
            key={p.name}
            className={`g-btn ${p.name === selected ? "active" : "ghost"}`}
            style={{ width: "100%", justifyContent: "space-between", height: 28, fontSize: 12.5 }}
            onClick={() => select(p.name)}
            title={p.robots ? `Default post of ${p.robots} library robot(s)` : undefined}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name.replace(/_/g, " ")}</span>
            {p.needsApproval ? <Icon.Warning size={13} /> : p.robots ? <span style={{ opacity: 0.55, fontSize: 11 }}>{p.robots}</span> : null}
          </button>
        ))}
      </>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 76, display: "grid", placeItems: "center", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass glass-strong liquid rc-pop" role="dialog" aria-label="Post Processor Editor" style={{ width: 1040, maxWidth: "calc(100vw - 32px)", height: 680, maxHeight: "90vh", borderRadius: 24, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--hair)" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Icon.Code size={18} />
          </div>
          <div style={{ font: "700 15px var(--font-ui)" }}>Post Processor Editor</div>
          <div style={{ marginLeft: 12, fontSize: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={list?.folder}>
            Path to posts: <span style={{ fontFamily: "var(--font-mono)" }}>{list?.folder ?? "…"}</span>
          </div>
          <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} aria-label="Close" title="Close" onClick={close}>
            <Icon.Close size={15} />
          </button>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "250px 1fr", minHeight: 0 }}>
          <section className="g-scroll" style={{ borderRight: "1px solid var(--hair)", padding: 8 }} aria-label="Post processors">
            <input className="g-input" placeholder="Pick a post processor to customize" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={stop} style={{ width: "100%" }} />
            {creating === null ? (
              <button className="g-btn ghost" style={{ width: "100%", justifyContent: "flex-start", height: 28, fontSize: 12.5, marginTop: 6 }} onClick={() => setCreating("")}>
                <Icon.Plus size={13} /> Add new Post Processor
              </button>
            ) : (
              <div className="glass-inset" role="group" aria-label="Create Post Processor" style={{ borderRadius: 12, padding: 8, marginTop: 6, display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12 }}>Enter the name of the new Post Processor:</div>
                <input
                  className="g-input"
                  autoFocus
                  value={creating}
                  onChange={(e) => setCreating(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") void createNew();
                    if (e.key === "Escape") setCreating(null);
                  }}
                />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="g-btn primary" disabled={!creating} onClick={() => void createNew()}>
                    OK
                  </button>
                  <button className="g-btn" onClick={() => setCreating(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {group("user", "Your posts")}
            {group("builtin", "Enginuity posts")}
            {!!list?.unavailable.length && !filter && (
              <div style={{ padding: 10, fontSize: 11.5, opacity: 0.6 }} title={list.unavailable.map((u) => `${u.name} (${u.robots})`).join(", ")}>
                {list.unavailable.length} library default posts are not available in Enginuity.
              </div>
            )}
          </section>
          <section style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: 14, gap: 10 }}>
            {!post && <div style={{ margin: "auto", opacity: 0.6 }}>{error ?? "Pick a post processor to customize"}</div>}
            {post && (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ font: "700 14px var(--font-ui)" }}>{post.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>
                    {user ? `User post${post.base ? ` based on ${post.base}` : ""} · ${post.file}` : `Built-in · python/robocraft_post/posts/${post.file} (read-only)`}
                  </div>
                </div>
                {post.needsApproval && (
                  <div className="glass-inset" role="alert" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderRadius: 12 }}>
                    <Icon.Warning size={16} />
                    <div style={{ flex: 1, fontSize: 12.5 }}>
                      The Copilot or an API client wrote this post processor. Programs are generated with it only after you approve this exact code.
                    </div>
                    <button className="g-btn primary" disabled={dirty} onClick={() => void approve()}>
                      <Icon.Check size={14} /> Approve
                    </button>
                  </div>
                )}
                {askRobots && (
                  <div className="glass-inset" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderRadius: 12 }}>
                    <div style={{ flex: 1, fontSize: 12.5 }}>Would you like to update all robots in the station to use this new post processor?</div>
                    <button className="g-btn primary" onClick={() => void applyToRobots(askRobots)}>
                      Yes
                    </button>
                    <button className="g-btn" onClick={() => setAskRobots(null)}>
                      No
                    </button>
                  </div>
                )}
                {!user && post.variables && Object.keys(post.variables).length > 0 && (
                  <div style={{ fontSize: 12 }}>
                    <span className="g-label">Customize Post Processor: </span>
                    <span style={{ fontFamily: "var(--font-mono)", opacity: 0.8 }}>
                      {Object.entries(post.variables)
                        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                        .join("   ")}
                    </span>
                  </div>
                )}
                <textarea
                  className="g-input"
                  aria-label="Post processor code"
                  spellCheck={false}
                  readOnly={!user}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={stop}
                  style={{ flex: 1, minHeight: 0, resize: "none", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre", overflow: "auto" }}
                />
                {error && (
                  <div role="alert" style={{ color: "var(--danger, #d33)", fontSize: 12.5 }}>
                    {error}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {!user && (
                    <>
                      <input className="g-input" style={{ width: 240 }} placeholder={`New post name, e.g. ${post.name}_Custom`} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === "Enter" && void customize())} />
                      <button className="g-btn primary" disabled={!newName.trim()} onClick={() => void customize()}>
                        <Icon.Plus size={14} /> Customize
                      </button>
                    </>
                  )}
                  {user && (
                    <>
                      <button className="g-btn primary" disabled={!dirty} onClick={() => void save()}>
                        <Icon.Save size={14} /> Save
                      </button>
                      {confirmDelete ? (
                        <>
                          <span style={{ fontSize: 12.5 }}>Delete {post.name}.py?</span>
                          <button className="g-btn danger" onClick={() => void remove()}>
                            Delete
                          </button>
                          <button className="g-btn" onClick={() => setConfirmDelete(false)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="g-btn ghost" onClick={() => setConfirmDelete(true)}>
                          <Icon.Trash size={14} /> Delete
                        </button>
                      )}
                      {robots.length > 0 && (
                        <button className="g-btn ghost" style={{ marginLeft: "auto" }} disabled={post.needsApproval} onClick={() => setAskRobots(post.name)}>
                          Use for robots…
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
