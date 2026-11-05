// Registers browser handlers for menu actions, dialogs and viewport controls.
"use client";

 
 
 

import { MESH_EXTENSIONS } from "@/engine/meshio";
import { cmd, setStatus } from "./api";
import { openFilesUI } from "./fileActions";
import { previewTargets, renameUI, revealInTree, runProgramUI } from "./interaction";
import { answerScreenshotRequest, captureView, lastScreenshot } from "./screenshot";
import { useRC, viewState } from "./store";
import { registerUiAction, runForwardedAction } from "./uiActions";

const st = () => useRC.getState();
const selected = () => (st().ws?.selection ?? []).map((id) => st().ws?.items[id]).filter((i) => !!i);

function selectedProgram(): string | undefined {
  const s = selected()[0];
  if (s?.type === "program") return s.id;
  if (s?.type === "instruction") return s.parent ?? undefined;
  return undefined;
}

function openLibrary(kind: "robot" | "tool" | "axis" | "station") {
  useRC.setState({ libraryOpen: true, libraryKind: kind });
}

async function toggleFullscreen(on?: boolean) {
  const isOn = !!document.fullscreenElement;
  const want = on ?? !isOn;
  try {
    if (want && !isOn) await document.documentElement.requestFullscreen();
    else if (!want && isOn) await document.exitFullscreen();
  } catch {
     
    setStatus("Full screen needs a click or a key press in the Enginuity window");
  }
}

registerUiAction("action-Options", () => useRC.setState({ settingsOpen: true }));
registerUiAction("actionOpen_weblib", () => openLibrary("robot"));
registerUiAction("actionAdd_Robot", () => openLibrary("robot"));
registerUiAction("actionAdd_Tool", () => openLibrary("tool"));
 
registerUiAction("actionAdd_Object", () => openFilesUI({ accept: [...MESH_EXTENSIONS].map((e) => `.${e}`).join(",") }));
registerUiAction("actionOpen_examples", () => openLibrary("station"));
registerUiAction("actionChange_Color_Form", () => {
  const ids = selected()
    .filter((i) => i.type === "object" || i.type === "robot" || i.type === "tool")
    .map((i) => i.id);
  if (!ids.length) return setStatus("Select an object, tool or robot to change its color");
  useRC.setState({ colorFor: ids });
});
registerUiAction("actionHelp", () => useRC.setState({ helpOpen: true }));
registerUiAction("action-About", () => useRC.setState({ aboutOpen: true }));
registerUiAction("actionMeasure_tool", () => useRC.setState({ measureOpen: true }));
registerUiAction("actionClose_Windows", () => useRC.setState({ rightPanel: "none", jointList: null }));
registerUiAction("actionShow_Fullscreen", () => toggleFullscreen());
 
registerUiAction("actionShow_Cinema_Mode", async () => {
  const entering = !viewState().cinema;
  if (entering) void toggleFullscreen(true);
  await cmd("view.toggle", { what: "cinema" });
});
registerUiAction("actionRename_item", () => renameUI());
registerUiAction("actionReveal_in_the_Tree", () => revealInTree());
 
registerUiAction("actionPreview_Targets", () => {
   
  const py = selected().find((i) => i.type === "python");
  if (py) return cmd((useRC.getState().ws?.busy ?? []).includes(py.id) ? "python.stop" : "python.run", { item: py.id });
  previewTargets();
});
registerUiAction("actionModify_target", () => {
  if (selected().some((i) => i.type === "target")) useRC.setState({ rightPanel: "inspector" });
  else setStatus("Select a target first");
});
registerUiAction("actionRun_Program", () => runProgramUI());
for (const name of ["actionGenerate_program", "actionGenerate_program_fast"]) {
  registerUiAction(name, () => {
    const p = selectedProgram();
    if (p) return cmd("program.generate", { program: p });
    setStatus("Select a program first");
  });
}
registerUiAction("actionCopy", () => document.execCommand("copy"));
registerUiAction("actionCut", () => document.execCommand("cut"));
 
 
registerUiAction("actionTake_screenshot", async () => {
  const r = await cmd<{ path: string }>("view.screenshot", {});
  const url = lastScreenshot() ?? (await captureView()).dataUrl;
  if (!r) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = r.path.split(/[\\/]/).pop() ?? "screenshot.png";
  a.click();
  st().toast({ kind: "success", title: "Screenshot saved", body: r.path });
});

 
const onAction = (e: Event) => void runForwardedAction(String((e as CustomEvent<{ name: string }>).detail.name));
const onShot = (e: Event) => void answerScreenshotRequest((e as CustomEvent<{ id: string; white?: boolean; format?: "png" | "jpeg" }>).detail);
if (typeof window !== "undefined") {
   
  const w = window as unknown as { __rcActionListeners?: [EventListener, EventListener] };
  if (w.__rcActionListeners) {
    window.removeEventListener("rc-ui-action", w.__rcActionListeners[0]);
    window.removeEventListener("rc-screenshot-request", w.__rcActionListeners[1]);
  }
  window.addEventListener("rc-ui-action", onAction);
  window.addEventListener("rc-screenshot-request", onShot);
  w.__rcActionListeners = [onAction, onShot];
}

 
registerUiAction("rc.endEffectorView", () => cmd("view.rendering", { endEffectorView: st().settings.RC_EE_VIEW !== true }));
 
registerUiAction("rc.windowResize", () => window.dispatchEvent(new Event("resize")));
