"use client";
// Hosts server questions, item pickers, and rename dialogs.

import { useEffect, useRef, useState } from "react";
import { answerDialog, cmd } from "@/client/api";
import { answerLocalDialog } from "@/client/interaction";
import { shownRows } from "@/client/treeDrop";
import { useRC, type ServerDialog } from "@/client/store";
import FileDialogs from "./FileDialogs";
import { Icon } from "./icons";
import { Modal, richText } from "./Modal";

 
export default function DialogHost() {
  const dialogs = useRC((s) => s.dialogs);
  const picker = useRC((s) => s.picker);
  const renameFor = useRC((s) => s.renameFor);
  const groupRename = useRC((s) => s.groupRename);
  const jointList = useRC((s) => s.jointList);
  const ws = useRC((s) => s.ws);
  const top = dialogs[0];

  return (
    <>
      {top && <ServerQuestion key={top.id} dialog={top} />}
      {picker && <PickerDialog />}
      {renameFor && ws?.items[renameFor] && !shownRows.has(renameFor) && <RenameDialog id={renameFor} />}
      {groupRename && <GroupRenameDialog />}
      <FileDialogs />
      {jointList && ws?.items[jointList.robot] && (
        <div className="glass liquid rc-enter" style={{ position: "fixed", left: "50%", bottom: 92, translate: "-50% 0", zIndex: 36, borderRadius: 18, padding: 12, width: 560, maxWidth: "calc(100vw - 32px)", maxHeight: 260, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, font: "650 12px var(--font-ui)" }}>
            <span>
              Robot {ws.items[jointList.robot].name} joint list: {jointList.rows.length}
            </span>
            <button className="g-btn icon ghost" onClick={() => useRC.setState({ jointList: null })} aria-label="Close joint list" title="Close joint list">
              <Icon.Close />
            </button>
          </div>
          {jointList.rows.map((r, i) => (
            <button key={i} className="g-btn ghost mono" style={{ width: "100%", justifyContent: "flex-start", fontSize: 11 }} onClick={() => void cmd("robot.setJoints", { robot: jointList.robot, joints: r })}>
              {i + 1}. {r.map((v) => v.toFixed(3)).join("  ")}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

 
function ServerQuestion({ dialog }: { dialog: ServerDialog }) {
  const [text, setText] = useState(dialog.input ?? "");
  const answer = (b: string) => void (dialog.id.startsWith("local-") ? answerLocalDialog(dialog.id, b) : answerDialog(dialog.id, b, dialog.input !== undefined ? text : undefined));
  const last = dialog.buttons.length - 1;
  return (
    <Modal title={dialog.title}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ color: "var(--accent)", marginTop: 2 }}>
          <Icon.Info size={20} />
        </div>
        <div style={{ font: "500 13px/1.5 var(--font-ui)", color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: richText(dialog.html) }} />
      </div>
      {dialog.input !== undefined && (
        <input
          autoFocus
          className="g-input"
          aria-label="Value"
          style={{ width: "100%", marginTop: 12 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && last >= 0) answer(dialog.buttons[last]);
          }}
        />
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        {dialog.buttons.map((b, i) => (
          <button key={b} autoFocus={dialog.input === undefined && i === last} className={`g-btn ${i === last ? "primary" : ""}`} onClick={() => answer(b)}>
            {b}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PickerDialog() {
  const picker = useRC((s) => s.picker)!;
  const ws = useRC((s) => s.ws);
  const [sel, setSel] = useState(picker.items[0] ?? "");
  return (
    <Modal title={picker.title} onClose={() => picker.onPick("")}>
      <div style={{ font: "500 12.5px/1.45 var(--font-ui)", color: "var(--ink-1)", marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: richText(picker.label) }} />
      <div className="glass-inset" style={{ borderRadius: 12, maxHeight: 240, overflow: "auto", padding: 4 }}>
        {picker.items.map((id) => (
          <button
            key={id}
            className={`g-btn ${sel === id ? "active" : "ghost"}`}
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => setSel(id)}
            onDoubleClick={() => picker.onPick(id)}
          >
            {ws?.items[id]?.name || "(no name)"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={() => picker.onPick("")}>
          Cancel
        </button>
        <button className="g-btn primary" disabled={!sel} onClick={() => picker.onPick(sel)}>
          OK
        </button>
      </div>
    </Modal>
  );
}

 
function RenameDialog({ id }: { id: string }) {
  const item = useRC((s) => s.ws?.items[id]);
  const [text, setText] = useState(item?.name ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  const close = () => useRC.setState({ renameFor: null });
  const ok = () => {
    if (text !== "") void cmd("item.rename", { item: id, name: text });
    close();
  };
  return (
    <Modal title="Rename item" onClose={close}>
      <div style={{ font: "500 12.5px var(--font-ui)", color: "var(--ink-1)", marginBottom: 8 }}>
        Enter the new name for:
        <br />
        <strong>{item?.name}</strong>
      </div>
      <input
        ref={input}
        className="g-input"
        style={{ width: "100%" }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ok();
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={close}>
          Cancel
        </button>
        <button className="g-btn primary" onClick={ok}>
          OK
        </button>
      </div>
    </Modal>
  );
}

 
function GroupRenameDialog() {
  const g = useRC((s) => s.groupRename)!;
  const [text, setText] = useState(g.base);
  const close = () => useRC.setState({ groupRename: null });
  const ok = () => {
    if (text) void cmd("item.renameGroup", { items: g.ids, name: text });
    close();
  };
  return (
    <Modal title="Rename" onClose={close}>
      <div style={{ font: "500 12.5px var(--font-ui)", color: "var(--ink-1)", marginBottom: 8 }}>{g.label}</div>
      <input autoFocus className="g-input" style={{ width: "100%" }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="g-btn" onClick={close}>
          Cancel
        </button>
        <button className="g-btn primary" onClick={ok}>
          OK
        </button>
      </div>
    </Modal>
  );
}
