 
 
 
 
 
 

import { actionForKeySequence, actionListing, findAction } from "@/engine/actions";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { FRAME_SIZE_DEFAULTS, FRAME_SIZE_KEYS, viewOf } from "@/engine/view";
import { broadcast, getServer } from "@/server/store";
import { cmd, ws } from "./bridge";
import { apiState } from "./context";

const flag = (b: boolean) => (b ? "1" : "0");
const isOn = (v: string) => /^(1|on|true|yes)$/i.test(v.trim());
const settings = () => getServer().services.settings;

const MOUSE_OPS = ["None", "Select", "Rotate", "Zoom", "Pan"] as const;
const opName = (v: string) => MOUSE_OPS.find((o) => o.toLowerCase() === v.trim().toLowerCase());

 
async function triggerAction(name: string): Promise<string> {
  if (!name.trim()) return actionListing(settings());
  const a = findAction(name);
  if (!a) return `Triggering action ${name}`;
  await runActionForApi(a.name);
  return "OK";
}

 
async function runActionForApi(name: string) {
  try {
    await cmd("view.action", { name });
  } catch (e) {
    broadcast({ type: "status", text: e instanceof Error ? e.message : String(e), ms: 10000 });
  }
}

 
export const lastClick = { mode: 0 };





export async function uiStationCommand(name: string, value: string): Promise<string | undefined> {
  const get = value === "";
  switch (name) {
    case "TriggerAction":
      return triggerAction(value);
    case "KeyEvent": {
      const a = actionForKeySequence(value, settings());
      if (!a) return `Action for shortcut found: ${value}`;
      await runActionForApi(a.name);
      return "OK";
    }
    case "ShowCoords":
      if (get) return flag(viewOf(ws()).frames);
      await cmd("view.setDisplay", { frames: isOn(value) });
      return "OK";
    case "ShowText":
      if (get) return flag(viewOf(ws()).text);
      await cmd("view.setDisplay", { text: isOn(value) });
      return "OK";
    case "ShowTextObject":
      if (get) return flag(settings().ShowTextObjectOnly === true);
      await cmd("view.setDisplay", { textObjectsOnly: isOn(value) });
      return "OK";
    case "ToggleWorkspace":
      if (get) return flag(viewOf(ws()).workspace);
      await cmd("view.toggle", { what: "workspace" });
      return "OK";
    case "Trace": {
      if (get) return viewOf(ws()).trace ? "On" : "Off";
      if (/^reset$/i.test(value.trim())) await cmd("view.toggle", { what: "trace-reset" });
      else await cmd("view.setDisplay", { trace: isOn(value) });
      return "OK";
    }
    case "FrameSizes": {
       
      if (get) return String(Number(settings()[FRAME_SIZE_KEYS.ref] ?? FRAME_SIZE_DEFAULTS.ref) / FRAME_SIZE_DEFAULTS.ref);
      const r = Number(value);
      if (!(r >= 0)) return "Invalid value";
      await cmd("view.setDisplay", { frameSizes: Object.fromEntries(Object.entries(FRAME_SIZE_DEFAULTS).map(([k, d]) => [k, d * r])) });
      return "OK";
    }
    case "FrameSizesRef":
    case "FrameSizesTarget":
    case "FrameSizesPath":
    case "FrameSizesOther": {
      if (get) return String(settings()[name] ?? DEFAULT_SETTINGS[name]);
      const mm = Number(value);
      if (!(mm >= 0)) return "Invalid value";
      const kind = (Object.entries(FRAME_SIZE_KEYS).find(([, k]) => k === name) ?? ["ref"])[0];
      await cmd("view.setDisplay", { frameSizes: { [kind]: mm } });
      return "OK";
    }
    case "ViewPerspective":
      if (get) return flag(viewOf(ws()).perspective);
      await cmd("view.setDisplay", { perspective: isOn(value) });
      return "OK";
    case "MouseClickLeft": {
      if (get) {
        const l = viewOf(ws()).leftAction;
        return l === "none" ? "None" : l[0].toUpperCase() + l.slice(1);
      }
      const op = opName(value);
      if (!op) return "Invalid value";
      await cmd("view.setMouse", { left: op.toLowerCase() });
      return "OK";
    }
    case "MouseClickMid":
    case "MouseClickRight": {
      const key = name === "MouseClickMid" ? "Mouse3D_ClickMid" : "Mouse3D_ClickRight";
      if (get) return String(settings()[key] ?? DEFAULT_SETTINGS[key]);
      const op = opName(value);
      if (!op) return "Invalid value";
      await cmd("settings.set", { key, value: op });
      return "OK";
    }
    case "MouseNav":
      if (get) return String(settings().Mouse3D_Type ?? 0);
      await cmd("settings.set", { key: "Mouse3D_Type", value: Math.max(0, Math.min(7, Math.round(Number(value) || 0))) });
      return "OK";
    case "MouseFeedback":
      if (get) return flag(settings().MouseFeedback !== false);
      await cmd("settings.set", { key: "MouseFeedback", value: isOn(value) });
      return "OK";
    case "ZoomSpeed": {
      if (get) {
        const v = Number(settings().Mouse3D_ZoomSpeed ?? -1);
        return v < 0 ? "Auto" : String(v);
      }
      const v = /^auto$/i.test(value) ? -1 : /^fixed$/i.test(value) ? 1 : Number(value);
      if (!Number.isFinite(v)) return "Invalid value";
      await cmd("settings.set", { key: "Mouse3D_ZoomSpeed", value: v });
      return "OK";
    }
    case "ColorBgTop":
    case "ColorBgBottom": {
      if (get) return String(settings()[name] ?? "");
      await cmd("view.setDisplay", { background: { [name === "ColorBgTop" ? "top" : "bottom"]: value.trim() } });
      return "OK";
    }
    case "Theme": {
       
      if (get) return String(settings().Dark_Theme ?? 0);
      const t = Math.round(Number(value) || 0);
      await cmd("settings.set", { key: "Dark_Theme", value: t });
      await cmd("settings.set", { key: "RC_THEME", value: t === 2 || t === 10 ? "dark" : "light" });
      return "OK";
    }
    case "Settings": {
       
      if (/^defaults?$/i.test(value)) await cmd("settings.reset", {});
      else if (/^load$/i.test(value)) await reloadSettings();
      return "OK";
    }
    case "Snapshot":
    case "SnapshotWhite": {
      if (get) return "Invalid value";
      try {
        await cmd("view.screenshot", { file: value, white: name === "SnapshotWhite" });
        return "OK";
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
    case "BlockKeyEvents":
      if (get) return flag(viewOf(ws()).blockKeys);
      await cmd("view.setDisplay", { blockKeys: isOn(value) });
      return "OK";
    case "ToolbarLayout":
      if (get) return viewOf(ws()).toolbar;
      await cmd("view.toolbar", { layout: value });
      return "OK";
    case "Tree": {
       
      const v = viewOf(ws());
      if (get) return !v.treeVisible ? "Hidden" : v.treeInside ? "Visible" : "Detach";
      if (/^detach/i.test(value)) await cmd("view.setDisplay", { treeInside: false, treeVisible: true });
      else if (/^visible|^show/i.test(value)) await cmd("view.setDisplay", { treeVisible: true });
      else if (/^hidden|^hide/i.test(value)) await cmd("view.setDisplay", { treeVisible: false });
      return "OK";
    }
    case "Window":
       
      broadcast({ type: "ui-action", name: "rc.windowResize" });
      return "OK";
    case "Event":
       
      return String(lastClick.mode);
  }
  return undefined;
}

async function reloadSettings() {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { DATA_DIR } = await import("@/server/store");
  let saved: Record<string, number | string | boolean> = {};
  try {
    saved = JSON.parse(readFileSync(path.join(DATA_DIR, "settings.json"), "utf8"));
  } catch {
     
  }
  const values = { ...DEFAULT_SETTINGS, ...saved };
  for (const [key, value] of Object.entries(values)) {
    if (/KEY|TOKEN|SECRET/i.test(key) || settings()[key] === value) continue;
    getServer().services.setSetting?.(key, value);
  }
}

 
export function setViewPoseFromView(pose: number[]) {
  apiState().viewPose = pose as never;
}
