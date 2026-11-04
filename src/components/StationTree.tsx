"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cmd, cmdx, selectNow, setStatus } from "@/client/api";
import { activateItem } from "@/client/interaction";
import { useRC } from "@/client/store";
import { instructionTreeLabel } from "@/engine/naming";
import { dropIndices, dropPlan, type DropZone, shownRows, treeChildren } from "@/client/treeDrop";
import { KEEPS_ABSOLUTE_ON_SHIFT, stationIdOf } from "@/engine/treeRules";
import type { Item, Workspace } from "@/engine/types";
import { ContextMenu } from "./glass/Menu";
import { Icon, InstructionIcon, ItemIcon } from "./icons";
import { itemMenu } from "./tree/menus";
import { angleDelta, treeSizes, zoomTree } from "@/engine/treeSize";

const DRAG_TYPE = "application/x-robocraft-item";

 
function visibleOrder(ws: Workspace, expanded: Set<string>): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    const it = ws.items[id];
    if (it && expanded.has(id)) for (const c of treeChildren(ws, it)) walk(c);
  };
  for (const s of ws.stations) walk(s);
  return out;
}

let dragIds: string[] = [];
let lastDropStatus = { text: "", at: 0 };

 
function dropStatus(text: string | undefined) {
  if (!text) return;
  const now = Date.now();
  if (text === lastDropStatus.text && now - lastDropStatus.at < 2000) return;
  lastDropStatus = { text, at: now };
  setStatus(text);
}

function Row(props: {
  ws: Workspace;
  id: string;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
}) {
  const { ws, id, depth, expanded, toggle, onSelect } = props;
  const it = ws.items[id];
  const selected = ws.selection.includes(id);
  const current = useRC((s) => (it?.parent ? s.currentInstruction[it.parent] === id : false));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [zone, setZone] = useState<DropZone | null>(null);
  const renaming = useRC((s) => s.renameFor === id);
   
  const sizes = treeSizes(useRC((s) => s.settings));
  useEffect(() => {
    shownRows.add(id);
    return () => void shownRows.delete(id);
  }, [id]);
  if (!it) return null;
  const kids = treeChildren(ws, it);
  const open = expanded.has(id);
  const label = it.type === "instruction" ? instructionTreeLabel(ws, it) : it.name;
  const isActiveStation = it.type === "station" && ws.activeStation === id;
  const running = ws.busy?.includes(id);
  const insInvalid =
    it.instruction && (it.instruction.kind === "move" || it.instruction.kind === "movec") && ((it.instruction.target && !ws.items[it.instruction.target]) || (it.instruction.target2 && !ws.items[it.instruction.target2]));
  const activeFrameOf = it.type === "frame" ? Object.values(ws.items).find((r) => r.robot?.activeFrame === id) : undefined;
  const activeTool = it.type === "tool" && it.parent ? ws.items[it.parent]?.robot?.activeTool === id : false;

  const zoneOf = (e: React.DragEvent): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    return f < 0.28 ? "before" : f > 0.72 ? "after" : "inside";
  };

  return (
    <>
      <div
        data-id={id}
        draggable={it.type !== "station" && !renaming}
        onDragStart={(e) => {
          dragIds = ws.selection.includes(id) ? ws.selection.slice() : [id];
          e.dataTransfer.setData(DRAG_TYPE, dragIds.join(","));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          const z = zoneOf(e);
          const { plan, status } = dropPlan(ws, id, z, dragIds);
          dropStatus(status);
          if (plan) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setZone(z);
          } else setZone(null);
        }}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => {
          e.preventDefault();
          const z = zoneOf(e);
          setZone(null);
          const ids = (e.dataTransfer.getData(DRAG_TYPE) || "").split(",").filter(Boolean);
          const { plan, status } = dropPlan(ws, id, z, ids);
          dropStatus(status);
          if (!plan) return;
          const indices = dropIndices(ws, plan, ids);
          void (async () => {
            for (const [k, src] of ids.entries()) {
              const keepAbsolute = e.shiftKey && KEEPS_ABSOLUTE_ON_SHIFT.includes(ws.items[src]?.type);
              const r = await cmdx("item.setParent", { item: src, parent: plan.parent, keepAbsolute, index: indices[k] });
              if (!r.ok) setStatus(r.error ?? "Not allowed operation");
            }
          })();
        }}
        onClick={(e) => onSelect(id, e)}
        onDoubleClick={(e) => void activateItem(id, { alt: e.altKey })}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selected) void selectNow([id]);
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className="rc-row"
        aria-selected={selected}
        role="treeitem"
        aria-expanded={kids.length ? open : undefined}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: sizes.row,
          margin: "1px 0",
          paddingLeft: 6 + depth * 14,
          paddingRight: 6,
          borderRadius: 9,
          cursor: "default",
          background: selected ? "var(--accent-soft)" : zone === "inside" ? "var(--accent-soft)" : current ? "color-mix(in srgb, var(--good) 14%, transparent)" : "transparent",
          boxShadow: selected ? "inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)" : zone === "inside" ? "inset 0 0 0 1px var(--accent)" : "none",
          color: selected ? "var(--accent-ink)" : it.visible ? "var(--ink-0)" : "var(--ink-3)",
          transition: "background .15s",
        }}
      >
        {zone && zone !== "inside" && (
          <span style={{ position: "absolute", left: 8 + depth * 14, right: 6, height: 2, borderRadius: 2, background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", [zone === "before" ? "top" : "bottom"]: -1 }} />
        )}
        <span
          onClick={(e) => {
            e.stopPropagation();
            toggle(id);
          }}
          style={{ width: 14, display: "inline-flex", opacity: kids.length ? 0.75 : 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .25s var(--ease-spring)" }}
        >
          <Icon.ChevronRight size={12} />
        </span>
        <span
          style={{ position: "relative", display: "inline-flex", color: iconColor(it.type), filter: running ? "drop-shadow(0 0 4px var(--good))" : "none" }}
          title={activeFrameOf ? `Active reference frame of ${activeFrameOf.name}` : activeTool ? "Active tool" : undefined}
        >
          {it.type === "instruction" ? <InstructionIcon kind={it.instruction?.kind} moveType={it.instruction?.moveType} size={sizes.icon - 1} /> : <ItemIcon type={it.type} isJoint={it.target?.isJoint} size={sizes.icon} />}
          {(activeFrameOf || activeTool) && (
            <span style={{ position: "absolute", right: -3, bottom: -2, width: 7, height: 7, borderRadius: 7, background: "var(--good)", boxShadow: "0 0 0 1.5px var(--bg-1)" }} />
          )}
          {insInvalid && <span style={{ position: "absolute", right: -4, top: -4, color: "var(--warn)" }}><Icon.Warning size={10} /></span>}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            font: `${isActiveStation ? 650 : 500} ${sizes.text}px var(--font-ui)`,
            color: insInvalid && !selected ? "var(--bad)" : undefined,
          }}
        >
          {renaming ? <InlineRename it={it} /> : label || " "}
        </span>
        {running && <span style={{ width: 7, height: 7, borderRadius: 7, background: "var(--good)", animation: "rc-pulse 1s infinite" }} />}
        {it.params?.Loop === "1" && it.type === "program" && (
          <span style={{ display: "inline-flex", opacity: 0.8 }} title="Loop">
            <Icon.Loop size={13} />
          </span>
        )}
        {it.type !== "instruction" && it.type !== "station" && (
          <span
            className="rc-eye"
            onClick={(e) => {
              e.stopPropagation();
              void cmd("item.setVisible", { items: [id], visible: !it.visible });
            }}
            style={{ display: "inline-flex", opacity: it.visible ? 0 : 0.8, transition: "opacity .15s" }}
            title={it.visible ? "Hide (F7)" : "Show (F7)"}
          >
            {it.visible ? <Icon.Eye size={14} /> : <Icon.EyeOff size={14} />}
          </span>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={itemMenu(ws, id)} onClose={() => setMenu(null)} />}
      {open && kids.map((c) => <Row key={c} ws={ws} id={c} depth={depth + 1} expanded={expanded} toggle={toggle} onSelect={onSelect} />)}
    </>
  );
}





function InlineRename({ it }: { it: Item }) {
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    if (text !== null && text !== "" && text !== it.name) void cmd("item.rename", { item: it.id, name: text });
    useRC.setState({ renameFor: null });
  };
  return (
    <input
      autoFocus
      className="g-input"
      aria-label="Item name"
      defaultValue={it.name}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      style={{ height: 22, padding: "0 6px", width: "100%", font: "inherit" }}
    />
  );
}

function iconColor(type: string) {
  return (
    {
      station: "var(--accent)",
      robot: "var(--orange)",
      frame: "var(--info)",
      tool: "var(--warn)",
      object: "var(--purple)",
      target: "var(--orange)",
      program: "var(--good)",
      script: "var(--good)",
      folder: "var(--ink-3)",
      camera: "var(--info)",
    } as Record<string, string>
  )[type] ?? "var(--ink-1)";
}

const AUTO_EXPAND: Item["type"][] = ["station", "frame", "robot", "program", "folder", "tool", "object"];






export default function StationTree() {
  const ws = useRC((s) => s.ws);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const collapsed = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const anchor = useRef<string | null>(null);
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const treeWidth = treeSizes(useRC((s) => s.settings)).width;
  const hasWs = !!ws;
   
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const next = zoomTree(useRC.getState().settings, angleDelta(e.deltaY, e.deltaMode));
      for (const [key, value] of Object.entries(next)) void cmd("settings.set", { key, value }, { quiet: true });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasWs]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) {
        n.delete(id);
        collapsed.current.add(id);
      } else {
        n.add(id);
        collapsed.current.delete(id);
      }
      return n;
    });

   
  useEffect(() => {
    if (!ws) return;
     
    const fresh: string[] = [];
    for (const it of Object.values(ws.items)) {
      if (seen.current.has(it.id)) continue;
      seen.current.add(it.id);
      if (AUTO_EXPAND.includes(it.type)) fresh.push(it.id);
    }
    setExpanded((prev) => {
      const n = new Set(prev);
      for (const id of fresh) n.add(id);
      for (const s of ws.stations) {
        if (s === ws.activeStation) {
          if (!collapsed.current.has(s)) n.add(s);
        } else n.delete(s);
      }
      return n;
    });
  }, [ws]);

   
  useEffect(() => {
    const reveal = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      const w = useRC.getState().ws;
      if (!w) return;
      setExpanded((prev) => {
        const n = new Set(prev);
        let cur = w.items[id];
        while (cur?.parent) {
          n.add(cur.parent);
          collapsed.current.delete(cur.parent);
          cur = w.items[cur.parent];
        }
        return n;
      });
      setTimeout(() => box.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    };
    const expand = (e: Event) => {
      const { id, exclusive } = (e as CustomEvent<{ id: string; exclusive?: boolean }>).detail;
      const w = useRC.getState().ws;
      setExpanded((prev) => {
        const n = new Set(prev);
        if (exclusive && w) {
          const st = stationIdOf(w, id);
          for (const c of (st && w.items[st]?.children) || []) if (w.items[c]?.type === "folder" && c !== id) n.delete(c);
        }
        n.add(id);
        return n;
      });
    };
    window.addEventListener("rc-reveal", reveal);
    window.addEventListener("rc-expand", expand);
    return () => {
      window.removeEventListener("rc-reveal", reveal);
      window.removeEventListener("rc-expand", expand);
    };
  }, []);

  const counts = useMemo(() => {
    if (!ws) return { robots: 0, programs: 0, targets: 0 };
    const all = Object.values(ws.items).filter((i) => stationIdOf(ws, i.id) === ws.activeStation);
    return { robots: all.filter((i) => i.type === "robot").length, programs: all.filter((i) => i.type === "program").length, targets: all.filter((i) => i.type === "target").length };
  }, [ws]);

  if (!ws) return null;

  const onSelect = (id: string, e: React.MouseEvent) => {
    const order = visibleOrder(ws, expanded);
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(id);
      void selectNow(order.slice(Math.min(a, b), Math.max(a, b) + 1));
      return;
    }
    anchor.current = id;
    void selectNow([id], e.metaKey || e.ctrlKey ? "toggle" : "replace");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const sel = ws.selection;
    if (e.key === "Enter" && sel.length === 1) {
      e.preventDefault();
      void activateItem(sel[0]);
    } else if (e.key === "ArrowRight" && sel.length === 1) {
      const it = ws.items[sel[0]];
      if (it?.type === "instruction") {
        e.preventDefault();
        const prog = it.parent ? ws.items[it.parent] : undefined;
        if ((e.metaKey || e.ctrlKey) && prog) void cmd("program.run", { program: prog.id, startAt: prog.children.indexOf(it.id) });
        else void activateItem(it.id);
      } else if (it?.type === "program" && expanded.has(it.id)) {
        e.preventDefault();
        void activateItem(it.id);
      }
    } else if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void selectNow(visibleOrder(ws, expanded).filter((id) => ws.items[id]?.type !== "station"));
    }
  };

  const matches = filter ? Object.values(ws.items).filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()) && i.type !== "station") : null;

  return (
    <aside
      className="glass liquid rc-enter"
      aria-label="Station tree"
      style={{ position: "fixed", top: "calc(var(--topbar-bottom, 58px) + 12px)", left: 12, bottom: 96, width: treeWidth, zIndex: 30, display: "flex", flexDirection: "column", padding: 10, animationDelay: "60ms" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 8px" }}>
        <span className="g-label">Station</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, color: "var(--ink-2)", font: "500 11px var(--font-ui)" }}>
          <span title="Robots">◆ {counts.robots}</span>
          <span title="Programs">▶ {counts.programs}</span>
          <span title="Targets">◎ {counts.targets}</span>
        </span>
      </div>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <span style={{ position: "absolute", left: 9, top: 6, color: "var(--ink-3)" }}>
          <Icon.Search size={15} />
        </span>
        <input className="g-input" placeholder="Filter items" aria-label="Filter items" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 30 }} />
      </div>
      <div ref={box} role="tree" tabIndex={0} onKeyDown={onKeyDown} className="g-scroll" style={{ flex: 1, margin: "0 -4px", padding: "0 4px", outline: "none" }}>
        {matches
          ? matches.map((m) => <Row key={m.id} ws={ws} id={m.id} depth={0} expanded={new Set()} toggle={() => {}} onSelect={onSelect} />)
          : ws.stations.map((s) => <Row key={s} ws={ws} id={s} depth={0} expanded={expanded} toggle={toggle} onSelect={onSelect} />)}
      </div>
      <style>{`.rc-row:hover .rc-eye{opacity:.7!important}.rc-row:hover{background:var(--fill-1)}`}</style>
    </aside>
  );
}
