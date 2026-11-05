// Coordinates station file dialogs, saving, recovery and item exports.
"use client";

 
 
 

import { create } from "zustand";
import type { Item } from "@/engine/types";
import { cmd, cmdx } from "./api";
import { pickItem } from "./interaction";
import { useRC } from "./store";
import { registerUiAction } from "./uiActions";
import { isStationFile, stationFileBase, stationFileName } from "@/engine/stationFile";
import { MESH_EXTENSIONS } from "@/engine/meshio";
import { NC_EXTENSIONS } from "@/engine/machining/nc";

 
interface FileDialogsState {
  prompt: null | { title: string; label: string; value: string; resolve: (v: string | null) => void };
  question: null | { title: string; html: string; buttons: string[]; resolve: (button: string) => void };
  undoStackOpen: boolean;
  stationParams: string | null;
  backups: null | { file: string; savedAt: string }[];
  recent: string[];
   
  robotConfigs: string | null;
   
  reorder: string[] | null;
}

export const useFileDialogs = create<FileDialogsState>(() => ({
  prompt: null,
  question: null,
  undoStackOpen: false,
  stationParams: null,
  backups: null,
  recent: [],
  robotConfigs: null,
  reorder: null,
}));

 
export function promptText(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => useFileDialogs.setState({ prompt: { title, label, value, resolve: (v) => (useFileDialogs.setState({ prompt: null }), resolve(v)) } }));
}

 
export function askQuestion(html: string, buttons: string[], title = ""): Promise<string> {
  return new Promise((resolve) => useFileDialogs.setState({ question: { title, html, buttons, resolve: (b) => (useFileDialogs.setState({ question: null }), resolve(b)) } }));
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const ws = () => useRC.getState().ws;
const activeStation = (): Item | undefined => {
  const w = ws();
  return w?.activeStation ? w.items[w.activeStation] : undefined;
};

export async function refreshRecent() {
  const r = await cmd<{ recent: string[] }>("file.recent", { action: "list" }, { quiet: true });
  if (r) useFileDialogs.setState({ recent: r.recent });
}

function robotsInTreeOrder(): Item[] {
  const w = ws();
  if (!w) return [];
  const out: Item[] = [];
  const walk = (id: string) => {
    const it = w.items[id];
    if (!it) return;
    if (it.type === "robot") out.push(it);
    it.children.forEach(walk);
  };
  if (w.activeStation) walk(w.activeStation);
  return out;
}





export async function openFiles(files: File[], opts: { robot?: string; parent?: string } = {}) {
  for (const f of files) {
    const base64 = toBase64(new Uint8Array(await f.arrayBuffer()));
    let res = await cmdx<{ openUrl?: string }>("file.open", { fileName: f.name, base64, ...opts });
    if (!res.ok && res.code === "pick_robot") {
      const robot = await pickItem(res.error ?? `Select a robot to place the tool: ${f.name}`, robotsInTreeOrder(), "Select a robot");
      if (!robot) continue;
      res = await cmdx("file.open", { fileName: f.name, base64, robot: robot.id, ...(opts.parent ? { parent: opts.parent } : {}) });
    }
    if (!res.ok) {
      await askQuestion(res.error ?? `Unable to open ${f.name}`, ["OK"], "Enginuity");
      continue;
    }
    if (res.result?.openUrl) window.open(res.result.openUrl, "_blank", "noopener");
  }
}






export const OPEN_FILE_ACCEPT = [
  ".mech", ".rdk", ".rdka", ".rdkbak", ".robot", ".tool", ".sld",
  ...[...MESH_EXTENSIONS].map((e) => `.${e}`),
  ".stp", ".step", ".igs", ".iges", ".csv", ".txt", ".py", ".url",
  ...NC_EXTENSIONS.map((e) => `.${e}`),
  ".json",
].join(",");

 
export const RDK_STATION_ACCEPT = ".rdk,.rdka,.rdkbak";

 
export function openFilesUI(opts: { robot?: string; parent?: string; accept?: string } = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = opts.accept ?? OPEN_FILE_ACCEPT;
  input.onchange = () => void openFiles(Array.from(input.files ?? []), { robot: opts.robot, parent: opts.parent });
  input.click();
}

 
export function importRdkStationUI() {
  openFilesUI({ accept: RDK_STATION_ACCEPT });
}

 
export async function openPathUI(path: string) {
  const res = await cmdx<{ openUrl?: string }>("file.open", { path });
  if (!res.ok) {
    await askQuestion(res.error ?? `Unable to open ${path}`, ["OK"], "Enginuity");
    return;
  }
  if (res.result?.openUrl) window.open(res.result.openUrl, "_blank", "noopener");
  void refreshRecent();
}

const fileBase = (file?: string) => (file === undefined ? undefined : isStationFile(file) ? stationFileBase(file) : file.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""));

 
export async function saveStationAsUI(stationId?: string): Promise<boolean> {
  const st = stationId ? ws()?.items[stationId] : activeStation();
  if (!st) return false;
  const name = await promptText("Save Station As...", "File name", fileBase(st.file) ?? st.name);
  if (name === null || !name.trim()) return false;
   
  if (/\.rdk$/i.test(name.trim())) return saveStationAsRdkUI(st.id, name.trim());
   
  const base = stationFileBase(name.trim()) || name.trim();
  const existing = await cmd<string[]>("station.listFiles", {}, { quiet: true });
  const fileName = stationFileName(base);
  if (existing?.includes(fileName) && (!st.file || !st.file.endsWith(`/${fileName}`))) {
    const b = await askQuestion(`“${fileName}” already exists. Do you want to replace it?`, ["Replace", "Cancel"]);
    if (b !== "Replace") return false;
  }
  const r = await cmd<{ path: string }>("station.save", { name: base, station: st.id });
  void refreshRecent();
  return !!r;
}






export async function saveStationAsRdkUI(stationId?: string, fileName?: string): Promise<boolean> {
  const st = stationId ? ws()?.items[stationId] : activeStation();
  if (!st) return false;
  const name = fileName ?? (await promptText("Export as robot station (.rdk)...", "File name", `${fileBase(st.file) ?? st.name}.rdk`));
  if (name === null || !name.trim()) return false;
  type Saved = { path: string; skipped: { name: string; type: string; reason: string }[] };
  let res = await cmdx<Saved>("station.saveRdk", { name: name.trim(), station: st.id });
  if (!res.ok && res.code === "file_exists") {
    const b = await askQuestion(res.error ?? "", ["Replace", "Cancel"]);
    if (b !== "Replace") return false;
    res = await cmdx<Saved>("station.saveRdk", { name: name.trim(), station: st.id, overwrite: true });
  }
  if (!res.ok || !res.result) {
    await askQuestion(res.error ?? "Unable to save the station", ["OK"], "Enginuity");
    return false;
  }
  const skipped = res.result.skipped;
  if (skipped.length) useRC.getState().toast({ kind: "info", title: `Saved ${res.result.path}`, body: `Not stored in the .rdk file: ${skipped.map((x) => x.name).join(", ")}` });
  void refreshRecent();
  return true;
}

 
export async function saveStationUI(stationId?: string): Promise<boolean> {
  const st = stationId ? ws()?.items[stationId] : activeStation();
  if (!st) return false;
  if (!st.file || !isStationFile(st.file)) return saveStationAsUI(st.id);
  const r = await cmd<{ path: string }>("station.save", { station: st.id });
  void refreshRecent();
  return !!r;
}





export async function closeStationUI(stationId?: string) {
  const st = stationId ? ws()?.items[stationId] : activeStation();
  if (!st) return;
  const info = await cmd<{ id: string; modified: boolean }[]>("station.info", {}, { quiet: true });
  const modified = info?.find((s) => s.id === st.id)?.modified ?? false;
  if (modified) {
    const b = await askQuestion(`Do you want to save <strong>${st.name}</strong>?`, ["Yes", "No", "Cancel"]);
    if (b === "Cancel") return;
    if (b === "Yes" && !(await saveStationUI(st.id))) return;
  }
  await cmd("station.close", { station: st.id, ifUnsaved: "discard" });
}

 
export function undoStackUI() {
  useFileDialogs.setState({ undoStackOpen: true });
}

 
export function stationParamsUI(stationId?: string) {
  const id = stationId ?? ws()?.activeStation ?? null;
  if (id) useFileDialogs.setState({ stationParams: id });
}

 
export async function recoverBackupUI() {
  const r = await cmd<{ backups: { file: string; savedAt: string }[] }>("station.recoverBackup", {});
  if (!r) return;
  if (!r.backups.length) {
    await askQuestion("No files available to recover. Files are saved automatically as *.mech in:<br>data/backups", ["OK"]);
    return;
  }
  useFileDialogs.setState({ backups: r.backups });
}

 
export function addToolFromFileUI(robotId: string) {
  pickFiles("", async (files) => {
    for (const f of files) {
      const res = await cmdx("robot.addToolFromFile", { robot: robotId, fileName: f.name, base64: toBase64(new Uint8Array(await f.arrayBuffer())) });
      if (!res.ok) await askQuestion(res.error ?? `Unable to open ${f.name}`, ["OK"], "Enginuity");
    }
  });
}

 
export function replaceRobotUI(robotId: string) {
  pickFiles(".robot", async ([f]) => {
    if (!f) return;
    const res = await cmdx("robot.replace", { robot: robotId, fileName: f.name, base64: toBase64(new Uint8Array(await f.arrayBuffer())) });
    if (!res.ok) await askQuestion(res.error ?? "Format not recognised.", ["OK"], "Enginuity");
  }, false);
}

function pickFiles(accept: string, onPick: (files: File[]) => void, multiple = true) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = multiple;
  if (accept) input.accept = accept;
  input.onchange = () => onPick(Array.from(input.files ?? []));
  input.click();
}

 
export function downloadBase64(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

 
export async function saveItemsAsUI(items: string[], format: "stl" | "ply" | "wrl" | "sld" | "tool" | "robot") {
  const r =
    format === "robot"
      ? await cmd<{ fileName: string; base64: string }>("robot.saveAs", { robot: items[0] })
      : await cmd<{ fileName: string; base64: string }>("item.saveAs", { items, format });
  if (r) downloadBase64(r.fileName, r.base64);
}

 
export function robotConfigurationsUI(robotId: string) {
  useFileDialogs.setState({ robotConfigs: robotId });
}

 
export function reorderUI(items: string[]) {
  const w = ws();
  const its = items.map((id) => w?.items[id]).filter((i): i is Item => !!i);
  const problem = !its.length
    ? "Select an item first"
    : its.some((i) => i.type === "station" || !i.parent)
      ? "A station can not be reordered"
      : its.some((i) => i.parent !== its[0].parent)
        ? "All items must belong to the same object"
        : its.some((i) => i.type === "instruction")
          ? "Instructions can not be reordered"
          : null;
  if (problem) void askQuestion(problem, ["OK"], "Enginuity");
  else useFileDialogs.setState({ reorder: items });
}

 
registerUiAction("actionOpen", () => openFilesUI());
registerUiAction("actionSave_Station", () => saveStationUI());
registerUiAction("actionSave_Station_as", () => saveStationAsUI());
registerUiAction("rc.saveStationRdk", () => saveStationAsRdkUI());
registerUiAction("rc.importStationRdk", () => importRdkStationUI());
registerUiAction("actionClose_Station", () => closeStationUI());
registerUiAction("rc.undoStack", undoStackUI);
 
registerUiAction("actionReorder_item_after", () => reorderUI(ws()?.selection ?? []));
