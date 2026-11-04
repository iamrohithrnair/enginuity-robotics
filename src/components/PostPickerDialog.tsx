"use client";

 
 
 
 
 
 

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { onServerEvent } from "@/client/api";
import type { PostPick } from "@/engine/posts";
import { Icon } from "./icons";
import { Modal } from "./Modal";

type OpenPick = PostPick & { id: string };

const usePicks = create<{ picks: OpenPick[] }>(() => ({ picks: [] }));

 
export default function PostPickerHost() {
  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "post-pick" && typeof e.id === "string") usePicks.setState((s) => (s.picks.some((p) => p.id === e.id) ? s : { picks: [...s.picks, e as unknown as OpenPick] }));
        if (e.type === "post-pick-close" && typeof e.id === "string") usePicks.setState((s) => ({ picks: s.picks.filter((p) => p.id !== e.id) }));
      }),
    [],
  );
  const top = usePicks((s) => s.picks[0]);
  return top ? <PostPicker key={top.id} pick={top} /> : null;
}

function PostPicker({ pick }: { pick: OpenPick }) {
  const [sel, setSel] = useState(pick.selected);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
     
    list.current?.querySelector<HTMLElement>("[data-selected='1']")?.scrollIntoView({ block: "nearest" });
  }, []);
  const answer = (post: string | null) => {
    usePicks.setState((s) => ({ picks: s.picks.filter((p) => p.id !== pick.id) }));
     
    void fetch("/api/postpick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: pick.id, post }) });
  };
  return (
    <Modal title={pick.title} onClose={() => answer(null)} width={340}>
      <div style={{ font: "500 12.5px/1.45 var(--font-ui)", color: "var(--ink-1)", marginBottom: 10 }}>{pick.label}</div>
      <div ref={list} role="listbox" aria-label="Post processors" className="glass-inset" style={{ borderRadius: 12, height: 260, overflow: "auto", padding: 4 }}>
        {pick.items.map((it, i) => (
          <button
            key={it.name}
            role="option"
            aria-selected={sel === i}
            data-selected={sel === i ? "1" : "0"}
            className={`g-btn ${sel === i ? "active" : "ghost"}`}
            style={{ width: "100%", justifyContent: "flex-start", gap: 8, height: 26, fontSize: 12.5 }}
            title={it.tooltip}
            onClick={() => setSel(i)}
            onDoubleClick={() => answer(it.name)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") answer(it.name);
            }}
          >
            {it.valid ? <Icon.Code size={13} /> : <Icon.Warning size={13} />}
            {it.text}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn primary" onClick={() => sel >= 0 && answer(pick.items[sel].name)}>
          OK
        </button>
        <button className="g-btn" onClick={() => answer(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
