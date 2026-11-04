"use client";

 
 
 
 

import { useMemo, useState } from "react";
import { create } from "zustand";
import { cmd, setStatus } from "@/client/api";
import { useRC } from "@/client/store";
import { registerUiAction } from "@/client/uiActions";
import { syncCandidates, syncLabel } from "@/engine/commands/sync";
import { syncAxes } from "@/engine/sync/axes";
import type { Item } from "@/engine/types";
import { descendants } from "@/engine/workspace";
import { Icon } from "../icons";
import { Combo, Field, Radios } from "../inspector/fields";
import { contributeItemMenu } from "../menuContrib";

const useSync = create<{ robot: string | null }>(() => ({ robot: null }));
const open = (robot: string) => useSync.setState({ robot });
const close = () => useSync.setState({ robot: null });

const robotsOf = (): Item[] => {
  const w = useRC.getState().ws;
  if (!w?.activeStation) return [];
  return descendants(w, w.activeStation).filter((i) => i.type === "robot" && !!i.robot);
};

 
function openFromSelection() {
  const w = useRC.getState().ws;
  const robots = robotsOf();
  if (!w || !robots.length) return setStatus("Load a robot first");
  const sel = w.selection.map((id) => w.items[id]).find((i) => i?.type === "robot");
  open((sel ?? robots.find((r) => (r.robot!.model.nq ?? 0) >= 4) ?? robots[0]).id);
}

registerUiAction("actionSyncExternalAxis", openFromSelection);

contributeItemMenu((w, item) => (item.type === "robot" && item.robot ? [{ label: "Synchronize External Axes", onSelect: () => open(item.id) }] : []), 72);

const NONE = "";

function SyncDialog({ robotId }: { robotId: string }) {
  const ws = useRC((s) => s.ws);
  const [robot, setRobot] = useState(robotId);
  const r = ws?.items[robot];
  const current = useMemo(() => (ws && r ? syncAxes(ws, r) : []), [ws, r]);
  const cand = useMemo(() => (ws && r ? syncCandidates(ws, r) : { robotSide: [], partSide: [] }), [ws, r]);
  const [track, setTrack] = useState<string>(current.find((a) => a.side === "robot")?.item.id ?? NONE);
  const [table, setTable] = useState<string>(current.find((a) => a.side === "part")?.item.id ?? NONE);
  const [first, setFirst] = useState<"track" | "table">(current[0]?.side === "part" ? "table" : "track");
  if (!ws || !r?.robot) return null;
  const pick = (id: string) => (id ? ws.items[id] : undefined);
  const chosen = (first === "track" ? [pick(track), pick(table)] : [pick(table), pick(track)]).filter((i): i is Item => !!i);
  const pending = chosen.map((i) => i.id).join(",") !== current.map((a) => a.item.id).join(",");
  const label = syncLabel(r, pending ? chosen : current.map((a) => a.item), pending);
  const apply = async (axes: string[]) => {
    const res = await cmd<{ message: string }>("robot.syncAxes", { robot, axes });
    if (res) setStatus(res.message);
    close();
  };
  const robots = robotsOf();
  return (
    <div
      className="glass-strong liquid rc-pop"
      role="dialog"
      aria-label="Synchronize External Axes"
      style={{ position: "fixed", left: "calc(clamp(260px, 18vw, 350px) + 12px)", top: 88, width: 380, maxWidth: "calc(100vw - 32px)", zIndex: 60, borderRadius: 18, padding: "12px 14px 14px" }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ font: "650 14px var(--font-ui)" }}>Synchronize External Axes</span>
        <span style={{ flex: 1 }} />
        <button className="g-btn icon ghost" style={{ width: 24, height: 24 }} aria-label="Close" title="Close" onClick={close}>
          <Icon.Close size={12} />
        </button>
      </div>
      {!robots.length ? (
        <div style={{ font: "500 12.5px var(--font-ui)" }}>No robots found</div>
      ) : (
        <>
          <Field label="Robot">
            <Combo label="Robot" value={robot} onChange={(v) => setRobot(v)} options={robots.map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
          <Field label="Linear track">
            <Combo label="Linear track" value={track} onChange={setTrack} options={[{ value: NONE, label: "(none)" }, ...cand.robotSide.map((m) => ({ value: m.id, label: m.name }))]} disabled={!cand.robotSide.length} />
          </Field>
          <Field label="Turntable or Linear track">
            <Combo label="Turntable or Linear track" value={table} onChange={setTable} options={[{ value: NONE, label: "(none)" }, ...cand.partSide.map((m) => ({ value: m.id, label: m.name }))]} disabled={!cand.partSide.length} />
          </Field>
          {track && table ? (
            <Field label="First axis">
              <Radios
                label="First axis"
                value={first}
                onChange={setFirst}
                options={[
                  { value: "track", label: pick(track)?.name ?? "Linear track" },
                  { value: "table", label: pick(table)?.name ?? "Turntable or Linear track" },
                ]}
              />
            </Field>
          ) : null}
          <div className="glass-inset" style={{ borderRadius: 12, padding: 10, margin: "4px 0 10px", font: "500 12px var(--font-ui)" }}>
            {label}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="g-btn ghost" disabled={!current.length} onClick={() => void apply([])}>
              Remove Sync
            </button>
            <button className="g-btn primary" onClick={() => void apply(chosen.map((i) => i.id))}>
              OK
            </button>
          </div>
        </>
      )}
    </div>
  );
}

 
export default function SyncHost() {
  const robot = useSync((s) => s.robot);
  return robot ? <SyncDialog key={robot} robotId={robot} /> : null;
}
