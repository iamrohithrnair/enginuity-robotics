"use client";
// Renders modal shells and sanitizes supported rich-text content.

import type { ReactNode } from "react";

const escapeText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

 
const TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "SPAN", "CODE", "PRE", "UL", "OL", "LI", "SMALL", "SUB", "SUP", "FONT", "A", "H3", "H4", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]);
 
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TEMPLATE", "SVG", "MATH"]);
const STYLE_PROPS = new Set(["color", "background-color", "font-family", "font-weight", "font-style", "text-decoration"]);
const SAFE_VALUE = /^[#\w\s(),.%'"-]+$/;

function cleanStyle(style: string | null): string {
  if (!style) return "";
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (STYLE_PROPS.has(prop) && SAFE_VALUE.test(value) && !/url|expression/i.test(value)) kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

function sanitize(node: Node): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return "";
  const inner = Array.from(el.childNodes).map(sanitize).join("");
  if (!TAGS.has(tag)) return inner;
  if (tag === "BR") return "<br/>";
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    return /^https?:\/\//i.test(href) ? `<a href="${escapeText(href).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
  }
  const style = cleanStyle(tag === "FONT" ? `color:${el.getAttribute("color") ?? ""}` : el.getAttribute("style"));
  if (tag === "FONT") return style ? `<span style="${style.replace(/"/g, "&quot;")}">${inner}</span>` : inner;
  const name = tag.toLowerCase();
  return `<${name}${style ? ` style="${style.replace(/"/g, "&quot;")}"` : ""}>${inner}</${name}>`;
}






export function richText(html: string) {
  if (typeof DOMParser === "undefined") {
     
    return escapeText(html)
      .replace(/&lt;br\s*\/?&gt;/gi, "<br/>")
      .replace(/&lt;(\/?)(strong|b)&gt;/gi, "<$1strong>");
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  return root ? Array.from(root.childNodes).map(sanitize).join("") : "";
}

export function Modal({ title, children, onClose, width = 420 }: { title: string; children: ReactNode; onClose?: () => void; width?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "var(--scrim)", backdropFilter: "blur(2px)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="glass-strong liquid rc-pop" role="dialog" aria-label={title || "Message"} style={{ width, maxWidth: "calc(100vw - 32px)", borderRadius: 22, padding: "18px 18px 14px" }}>
        {title && <div style={{ font: "650 14px var(--font-ui)", marginBottom: 10 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}
