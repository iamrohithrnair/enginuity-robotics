"use client";
// Provides a floating notepad with file, clipboard, and formatting controls.

 
 
 
 
 
 

import { useRef, useState } from "react";
import { create } from "zustand";
import { setStatus } from "@/client/api";
import { registerUiAction } from "@/client/uiActions";
import { Icon } from "./icons";

interface NotepadState {
  open: boolean;
  name: string;
  text: string;
  saved: string;
  handle: FileSystemFileHandle | null;
}

const useNotepad = create<NotepadState>(() => ({
  open: false,
  name: "New Document.txt",
  text: "",
  saved: "",
  handle: null,
}));

registerUiAction("actionOpen_Notepad", () => useNotepad.setState({ open: true }));

type Picker = {
  showOpenFilePicker?: (o?: object) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o?: object) => Promise<FileSystemFileHandle>;
};
const picker = () => window as unknown as Picker;
const cancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function write(handle: FileSystemFileHandle, text: string) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function openFile() {
  try {
    if (picker().showOpenFilePicker) {
      const [handle] = await picker().showOpenFilePicker!();
      const file = await handle.getFile();
      const text = await file.text();
      useNotepad.setState({ name: file.name, text, saved: text, handle });
      return;
    }
  } catch (e) {
    if (cancelled(e)) return;
    throw e;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    useNotepad.setState({ name: file.name, text, saved: text, handle: null });
  };
  input.click();
}

async function saveAs() {
  const { name, text } = useNotepad.getState();
  try {
    if (picker().showSaveFilePicker) {
      const handle = await picker().showSaveFilePicker!({
        suggestedName: name,
      });
      await write(handle, text);
      useNotepad.setState({ name: handle.name, saved: text, handle });
      return;
    }
  } catch (e) {
    if (cancelled(e)) return;
    throw e;
  }
  download(name, text);
  useNotepad.setState({ saved: text });
}

async function save() {
  const { handle, text } = useNotepad.getState();
  if (!handle) return saveAs();
  await write(handle, text);
  useNotepad.setState({ saved: text });
}

function printText(name: string, text: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.title = name;
  const pre = doc.createElement("pre");
  pre.style.cssText = "font: 11pt Menlo, Consolas, monospace; white-space: pre-wrap";
  pre.textContent = text;
  doc.body.appendChild(pre);
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 1000);
}

const FONT_SIZES = [11, 12, 13, 14, 16, 18, 22];

function Tool({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button className={`g-btn icon ghost ${active ? "active" : ""}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

export default function Notepad() {
  const open = useNotepad((s) => s.open);
  return open ? <NotepadWindow /> : null;
}

function NotepadWindow() {
  const { name, text, saved } = useNotepad();
  const area = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState(13);
  const [style, setStyle] = useState({
    bold: false,
    italic: false,
    underline: false,
  });
  const modified = text !== saved;
  const safely = (fn: () => Promise<void> | void) => {
    void Promise.resolve()
      .then(fn)
      .catch((e) => setStatus(`Notepad: ${e instanceof Error ? e.message : String(e)}`));
  };
  const edit = (command: "undo" | "redo" | "cut" | "copy") => {
    area.current?.focus();
    document.execCommand(command);
  };
  const paste = async () => {
    const el = area.current;
    if (!el) return;
    const clip = await navigator.clipboard.readText();
    el.focus();
     
    document.execCommand("insertText", false, clip);
  };
  const toggle = (k: keyof typeof style) => setStyle((s) => ({ ...s, [k]: !s[k] }));
  const nextSize = () => setSize((s) => FONT_SIZES[(FONT_SIZES.indexOf(s) + 1) % FONT_SIZES.length]);
  const close = () => useNotepad.setState({ open: false });
  const glyph = (t: string, css: React.CSSProperties) => (
    <span
      style={{
        font: "700 13px var(--font-ui)",
        width: 16,
        textAlign: "center",
        ...css,
      }}
    >
      {t}
    </span>
  );
  return (
    <div
      className="glass glass-strong rc-pop"
      role="dialog"
      aria-label="Notepad"
      style={{
        position: "fixed",
        zIndex: 70,
        right: 24,
        top: 120,
        width: 560,
        height: 460,
        minWidth: 360,
        minHeight: 240,
        resize: "both",
        overflow: "hidden",
        borderRadius: 18,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onKeyDown={(e) => {
         
        e.stopPropagation();
        const keys: Record<string, () => void> = {
          s: () => safely(save),
          o: () => safely(openFile),
          b: () => toggle("bold"),
          i: () => toggle("italic"),
          u: () => toggle("underline"),
          f: nextSize,
          y: () => edit("redo"),
        };
        const key = e.key.toLowerCase();
        if (e.altKey && e.code === "KeyS") {
          e.preventDefault();
          safely(saveAs);
        } else if ((e.metaKey || e.ctrlKey) && keys[key]) {
          e.preventDefault();
          keys[key]();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon.Notes size={16} />
        <div
          style={{
            font: "700 14px var(--font-ui)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Notepad — {name}
          {modified ? " •" : ""}
        </div>
        <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} title="Exit notepad" aria-label="Exit notepad" onClick={close}>
          <Icon.Close size={14} />
        </button>
      </div>
      <div
        role="toolbar"
        aria-label="Notepad"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Tool
          label="New text document"
          onClick={() =>
            useNotepad.setState({
              name: "New Document.txt",
              text: "",
              saved: "",
              handle: null,
            })
          }
        >
          <Icon.New size={15} />
        </Tool>
        <Tool label="Open file" onClick={() => safely(openFile)}>
          <Icon.Open size={15} />
        </Tool>
        <Tool label="Save file" onClick={() => safely(save)}>
          <Icon.Save size={15} />
        </Tool>
        <Tool label="Save file as" onClick={() => safely(saveAs)}>
          <Icon.Download size={15} />
        </Tool>
        <Tool label="Print file" onClick={() => printText(name, text)}>
          <Icon.Print size={15} />
        </Tool>
        <span
          style={{
            width: 1,
            height: 18,
            background: "var(--hair)",
            margin: "0 4px",
          }}
        />
        <Tool label="Undo" onClick={() => edit("undo")}>
          <Icon.Undo size={15} />
        </Tool>
        <Tool label="Redo" onClick={() => edit("redo")}>
          <Icon.Redo size={15} />
        </Tool>
        <Tool label="Cut" onClick={() => edit("cut")}>
          <Icon.Cut size={15} />
        </Tool>
        <Tool label="Copy" onClick={() => edit("copy")}>
          <Icon.Copy size={15} />
        </Tool>
        <Tool label="Paste" onClick={() => safely(paste)}>
          <Icon.Paste size={15} />
        </Tool>
        <span
          style={{
            width: 1,
            height: 18,
            background: "var(--hair)",
            margin: "0 4px",
          }}
        />
        <Tool label={`Font (${size} px)`} onClick={nextSize}>
          {glyph("Aa", { width: 22, fontWeight: 600 })}
        </Tool>
        <Tool label="Bold" onClick={() => toggle("bold")} active={style.bold}>
          {glyph("B", {})}
        </Tool>
        <Tool label="Italic font" onClick={() => toggle("italic")} active={style.italic}>
          {glyph("I", { fontStyle: "italic", fontFamily: "Georgia, serif" })}
        </Tool>
        <Tool label="Underline" onClick={() => toggle("underline")} active={style.underline}>
          {glyph("U", { textDecoration: "underline" })}
        </Tool>
      </div>
      <textarea
        ref={area}
        className="g-input"
        aria-label="Text"
        spellCheck={false}
        value={text}
        onChange={(e) => useNotepad.setState({ text: e.target.value })}
        style={{
          flex: 1,
          resize: "none",
          height: "auto",
          padding: 10,
          lineHeight: 1.45,
          font: `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${size}px var(--font-mono)`,
          textDecoration: style.underline ? "underline" : "none",
          whiteSpace: "pre",
          overflow: "auto",
        }}
      />
    </div>
  );
}
