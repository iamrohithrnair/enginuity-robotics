"use client";
// Edits collision-checking pairs between station items.

 
 
 
 
 

import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import { registerUiAction } from "@/client/uiActions";
import { Modal } from "./Modal";

interface MapBody {
  item: string;
  name: string;
  link: number;
  kind: "link" | "tool" | "object";
}

interface CollisionMap {
  station: string;
  mode: "default" | "all" | "none";
  bodies: MapBody[];
  active: boolean[][];
  checkedPairs: number;
}

const useCollisionMap = create<{ open: boolean }>(() => ({ open: false }));

export const openCollisionMap = () => useCollisionMap.setState({ open: true });
const close = () => useCollisionMap.setState({ open: false });

registerUiAction("actionCollision_Map", openCollisionMap);

const label = (b: MapBody) => (b.kind === "link" ? `${b.name} ${b.link === 0 ? "Base" : `J${b.link}`}` : b.name);

export default function CollisionMapHost() {
  const open = useCollisionMap((s) => s.open);
  return open ? <CollisionMapDialog /> : null;
}

function CollisionMapDialog() {
  const rev = useRC((s) => s.ws?.rev ?? 0);
  const [map, setMap] = useState<CollisionMap | null>(null);
  const [tick, setTick] = useState(0);
   
  useEffect(() => {
    let live = true;
    void cmd<CollisionMap>("collision.map", {}, { quiet: true }).then((m) => {
      if (live) setMap(m);
    });
    return () => {
      live = false;
    };
  }, [rev, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const toggle = async (i: number, j: number) => {
    if (!map || i === j) return;
    const a = map.bodies[i];
    const b = map.bodies[j];
    await cmd("collision.setPair", { item1: a.item, item2: b.item, link1: a.link, link2: b.link, active: !map.active[i][j] });
    reload();
  };
  const setMode = async (mode: CollisionMap["mode"]) => {
    await cmd("collision.setMap", { mode });
    reload();
  };

  const n = map?.bodies.length ?? 0;
  return (
    <Modal title={map ? `Collision Map: ${map.station}` : "Collision Map"} onClose={close} width={Math.min(980, 260 + n * 30)}>
      {!map ? (
        <div style={{ font: "13px var(--font-ui)" }}>Loading…</div>
      ) : (
        <>
          <div style={{ font: "12px var(--font-ui)", opacity: 0.75, marginBottom: 8 }}>
            Checked cells are the pairs collision checking tests ({map.checkedPairs} pairs). Click a cell to change a pair.
          </div>
          <div style={{ overflow: "auto", maxHeight: "60vh", border: "1px solid var(--line, rgba(0,0,0,.12))", borderRadius: 12 }}>
            <table style={{ borderCollapse: "collapse", font: "12px var(--font-ui)" }}>
              <thead>
                <tr>
                  <th />
                  {map.bodies.map((b, j) => (
                    <th key={`${b.item}:${b.link}`} title={label(b)} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", padding: "6px 2px", fontWeight: 500, whiteSpace: "nowrap", maxHeight: 140 }}>
                      {label(b)}
                      <span style={{ opacity: 0.5 }}> {j + 1}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {map.bodies.map((a, i) => (
                  <tr key={`${a.item}:${a.link}`}>
                    <th style={{ textAlign: "right", padding: "2px 8px", fontWeight: 500, whiteSpace: "nowrap" }}>
                      <span style={{ opacity: 0.5 }}>{i + 1} </span>
                      {label(a)}
                    </th>
                    {map.bodies.map((b, j) => (
                      <td key={`${b.item}:${b.link}`} style={{ padding: 2, textAlign: "center" }}>
                        {i === j ? (
                          <span style={{ display: "inline-block", width: 18, height: 18, borderRadius: 5, background: "var(--scrim, rgba(0,0,0,.08))" }} />
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`${label(a)} / ${label(b)}`}
                            checked={map.active[i][j]}
                            onChange={() => void toggle(i, j)}
                            style={{ width: 16, height: 16, accentColor: map.active[i][j] ? "#34c759" : undefined, cursor: "pointer" }}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className={`g-btn${map.mode === "default" ? " primary" : ""}`} onClick={() => void setMode("default")}>
              Reset to default
            </button>
            <button className={`g-btn${map.mode === "all" ? " primary" : ""}`} onClick={() => void setMode("all")}>
              Check all
            </button>
            <button className={`g-btn${map.mode === "none" ? " primary" : ""}`} onClick={() => void setMode("none")}>
              Uncheck all
            </button>
            <button className="g-btn" style={{ marginLeft: "auto" }} onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
