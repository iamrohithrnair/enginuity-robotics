"use client";

import { useEffect } from "react";
import { cmd } from "@/client/api";
import { pushView, useRC } from "@/client/store";



export default function ExampleBar() {
   
  const id = useRC((s) => {
    const st = s.ws?.activeStation ? s.ws.items[s.ws.activeStation] : undefined;
    return st?.params?.Example ? st.id : null;
  });
  const name = useRC((s) => (id ? s.ws?.items[id]?.name ?? "" : ""));
   
  useEffect(() => {
    if (!id) return;
     
    const ts = [1200, 4500].map((ms) => setTimeout(() => pushView({ action: "fit" }), ms));
    return () => ts.forEach(clearTimeout);
  }, [id]);
  if (!id) return null;
  const station = { id, name };
  return (
    <div
      className="glass"
      style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 14px", borderRadius: 14, font: "500 12.5px var(--font-ui)" }}
    >
      <span style={{ color: "var(--ink-1)" }}>
        Example cell: <b style={{ color: "var(--ink-0)" }}>{station.name}</b>
      </span>
      <button className="g-btn" style={{ height: 28, fontSize: 12 }} onClick={() => void cmd("station.close", { station: station.id, ifUnsaved: "discard" })}>
        Remove example
      </button>
    </div>
  );
}
