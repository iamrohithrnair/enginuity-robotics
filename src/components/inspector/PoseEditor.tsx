"use client";

import { useState } from "react";
import { cmd, setStatus } from "@/client/api";
import { useRC } from "@/client/store";
import { alignedOrientation } from "@/engine/align";
import { eye, inv, type Mat } from "@/engine/math";
import { POSE_FORMATS, formatToPose, parsePoseText, poseFormat, poseToFormat, type PoseFormatId } from "@/engine/poseFormats";
import type { Item } from "@/engine/types";
import { DropMenu } from "../glass/Menu";
import { Icon } from "../icons";
import { Combo, Field, PoseFields } from "./fields";
import { usePanelPrefs } from "./prefs";
import { absoluteFrom, parentRef, poseIn, referenceOptions } from "./refs";

 
 
 

const fmtValues = (v: number[], unit: string) => v.map((x, i) => x.toFixed(i < 3 || unit === "deg" ? 3 : 6)).join(", ");
const fmtMatrix = (m: Mat) => [0, 1, 2, 3].map((r) => m.slice(r * 4, r * 4 + 4).map((x) => (Object.is(x, -0) ? 0 : x).toFixed(6)).join(", ")).join("\n");

async function writeClipboard(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${what} copied to the clipboard`);
  } catch {
    setStatus("The clipboard is not available in this browser context");
  }
}





export default function PoseEditor({ item, refLabel, disabled, title = "Position" }: { item: Item; refLabel: string; disabled?: boolean; title?: string }) {
  const ws = useRC((s) => s.ws)!;
  const kinReady = useRC((s) => s.kinReady);
  const fmt = usePanelPrefs((s) => s.poseFormat);
  const setFmt = usePanelPrefs((s) => s.setPoseFormat);
   
  const [ref, setRef] = useState(() => parentRef(ws, item));
  const [pasteBox, setPasteBox] = useState(false);

  const options = referenceOptions(ws, item);
  const refValue = options.some((o) => o.value === ref) ? ref : parentRef(ws, item);
  void kinReady;  
  const rel = poseIn(ws, item, refValue);
  const f = poseFormat(fmt);
  const values = poseToFormat(rel, fmt);

  const setRel = (m: Mat) => void cmd("item.setPose", { item: item.id, pose: absoluteFrom(ws, refValue, m), relativeTo: "station" });

  const paste = (text: string) => {
    const m = parsePoseText(text, fmt);
    if (!m) return setStatus("Paste [X,Y,Z,R,P,W] values or 4x4 homogeneous matrix");
    setRel(m);
    setPasteBox(false);
  };

  return (
    <section style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span className="g-label">{title}</span>
        <span style={{ marginLeft: "auto" }}>
          <DropMenu
            align="right"
            trigger={() => (
              <button className="g-btn ghost" style={{ height: 24 }} aria-label="More pose actions" disabled={disabled}>
                More <Icon.ChevronDown size={12} />
              </button>
            )}
            entries={[
              { label: "Copy Pose", icon: <Icon.Copy />, onSelect: () => void writeClipboard(fmtMatrix(rel), "Pose") },
              { label: "Copy Values", onSelect: () => void writeClipboard(fmtValues(values, f.unit), "Values") },
               
              { label: "Cut Pose", onSelect: () => void writeClipboard(fmtMatrix(rel), "Pose").then(() => setRel(eye())) },
              {
                label: "Paste Values or Pose",
                onSelect: () =>
                  void navigator.clipboard
                    .readText()
                    .then(paste)
                    .catch(() => setPasteBox(true)),
              },
              { separator: true },
              { label: "Invert Pose", onSelect: () => setRel(inv(rel)) },
               
              { label: "Align Orientation", onSelect: () => alignedOrientation(rel).changed && setRel(alignedOrientation(rel).pose) },
              { label: "Reset (Set Identity)", onSelect: () => setRel(eye()) },
            ]}
          />
        </span>
      </div>
      <Field label={refLabel}>
        <Combo label={refLabel} value={refValue} onChange={setRef} options={options} />
      </Field>
      <div style={{ marginBottom: 8 }}>
        <Combo<PoseFormatId> compact label="Pose format" value={fmt} onChange={setFmt} options={POSE_FORMATS.map((p) => ({ value: p.id, label: p.label }))} />
      </div>
      <PoseFields values={values} rot={f.rot} unit={f.unit} disabled={disabled} onCommit={(v) => setRel(formatToPose(v, fmt))} />
      {pasteBox && (
        <div style={{ marginTop: 8 }}>
          <input
            autoFocus
            className="g-input"
            aria-label="Paste values or a 4x4 matrix"
            placeholder="Paste [X,Y,Z,R,P,W] values or 4x4 homogeneous matrix"
            onPaste={(e) => {
              e.preventDefault();
              paste(e.clipboardData.getData("text/plain"));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") paste((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setPasteBox(false);
              e.stopPropagation();
            }}
          />
        </div>
      )}
    </section>
  );
}
