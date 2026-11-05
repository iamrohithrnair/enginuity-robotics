"use client";
// Renders anchored dropdown and context menus with nested entries.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { prettyKeys } from "@/client/shortcuts";

export interface MenuEntry {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
   
  checked?: boolean;
   
  submenu?: MenuEntry[];
}

 
const EDGE = 8;

 
const MENU_ATTR = "data-rc-menu";
const insideMenu = (t: EventTarget | null) => t instanceof Element && !!t.closest(`[${MENU_ATTR}]`);

interface Anchor {
   
  x: number;
  y: number;
  alignRight?: boolean;
   
  flipTo?: number;
}






function FloatingMenu({ anchor, entries, onClose }: { anchor: Anchor; entries: MenuEntry[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const ul = list.current;
    if (!el || !ul) return;
    ul.style.maxHeight = "";
    const w = ul.offsetWidth;
    const h = ul.scrollHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.alignRight ? anchor.x - w : anchor.x;
    if (left + w > vw - EDGE) left = anchor.flipTo !== undefined ? anchor.flipTo - w : vw - EDGE - w;
    left = Math.max(EDGE, left);
    let top = anchor.y;
    if (top + h > vh - EDGE) top = Math.max(EDGE, vh - EDGE - h);
    if (h > vh - 2 * EDGE) ul.style.maxHeight = `${vh - 2 * EDGE}px`;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [anchor.x, anchor.y, anchor.alignRight, anchor.flipTo, entries]);
  return createPortal(
    <div ref={box} {...{ [MENU_ATTR]: "" }} style={{ position: "fixed", left: anchor.x, top: anchor.y, zIndex: 90, visibility: "hidden" }}>
      <MenuList ref={list} entries={entries} onClose={onClose} />
    </div>,
    document.body,
  );
}

function Entry({ e, onClose }: { e: MenuEntry; onClose: () => void }) {
  const [sub, setSub] = useState<Anchor | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const openSub = () => {
    const r = row.current?.getBoundingClientRect();
    if (r) setSub({ x: r.right - 4, y: r.top - 6, flipTo: r.left + 4 });
  };
  return (
    <div ref={row} style={{ position: "relative" }} onMouseEnter={() => e.submenu && openSub()} onMouseLeave={() => e.submenu && setSub(null)}>
      <button
        role={e.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
        aria-haspopup={e.submenu ? "menu" : undefined}
        aria-checked={e.checked}
        disabled={e.disabled}
        onClick={() => {
          if (e.submenu) return sub ? setSub(null) : openSub();
          onClose();
          e.onSelect?.();
        }}
        className="rc-menu-item"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          height: 30,
          padding: "0 10px",
          border: 0,
          borderRadius: 10,
          background: sub ? "var(--fill-2)" : "transparent",
          color: e.danger ? "var(--bad)" : "var(--ink-0)",
          font: "500 12.5px var(--font-ui)",
          cursor: e.disabled ? "default" : "pointer",
          opacity: e.disabled ? 0.38 : 1,
          textAlign: "left",
        }}
      >
        <span style={{ width: 16, display: "inline-flex", color: "var(--ink-1)" }}>{e.checked ? "✓" : e.icon}</span>
        <span style={{ flex: 1, whiteSpace: "nowrap" }}>{e.label}</span>
        {e.shortcut && <span className="g-kbd">{prettyKeys(e.shortcut)}</span>}
        {e.submenu && <span style={{ opacity: 0.7 }}>▸</span>}
      </button>
      {e.submenu && sub && <FloatingMenu anchor={sub} entries={e.submenu.length ? e.submenu : [{ label: "(none)", disabled: true }]} onClose={onClose} />}
    </div>
  );
}

export function MenuList({ entries, onClose, ref }: { entries: MenuEntry[]; onClose: () => void; ref?: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={ref} className="glass glass-strong rc-pop g-scroll" style={{ padding: 6, minWidth: 236, borderRadius: 16, overflowY: "auto", overscrollBehavior: "contain" }} role="menu">
      {entries.map((e, i) => (e.separator ? <div key={i} style={{ height: 1, margin: "5px 8px", background: "var(--hair)" }} /> : <Entry key={i} e={e} onClose={onClose} />))}
      <style>{`.rc-menu-item:not(:disabled):hover{background:var(--fill-2)!important}`}</style>
    </div>
  );
}

 
function closeOnEscape(e: KeyboardEvent, close: () => void) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

 
function useDismiss(open: boolean, area: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (area.current?.contains(e.target as Node) || insideMenu(e.target)) return;
      close();
    };
    const esc = (e: KeyboardEvent) => closeOnEscape(e, close);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open, area, close]);
}

export function DropMenu({ trigger, entries, align = "left" }: { trigger: (open: boolean) => ReactNode; entries: MenuEntry[]; align?: "left" | "right" }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [close] = useState(() => () => setAnchor(null));
  useDismiss(!!anchor, ref, close);
  const toggle = () => {
    if (anchor) return setAnchor(null);
    const r = ref.current?.getBoundingClientRect();
    if (r) setAnchor({ x: align === "right" ? r.right : r.left, y: r.bottom + 8, alignRight: align === "right" });
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={toggle}>{trigger(!!anchor)}</div>
      {anchor && <FloatingMenu anchor={anchor} entries={entries} onClose={close} />}
    </div>
  );
}

 
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const none = useRef<HTMLElement>(null);
  useDismiss(true, none, onClose);
  return <FloatingMenu anchor={{ x, y }} entries={entries} onClose={onClose} />;
}
