 
 
 
 
 
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerEvent } from "@/server/store";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

const ROOT = path.resolve(__dirname, "../..");
 
const ABB = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");

let ui: (name: string, value: string) => Promise<string | undefined>;
let server: Awaited<ReturnType<typeof import("@/server/store")["getServer"]>>;
let run: typeof import("@/server/store")["run"];
let vb: typeof import("@/server/viewbridge");
let trace: typeof import("@/server/trace");

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-wpb-"));
  const store = await import("@/server/store");
  server = store.getServer();
  await server.ready;
  run = store.run;
  ui = (await import("@/server/rdkapi/cmd-actions")).uiStationCommand;
  vb = await import("@/server/viewbridge");
  trace = await import("@/server/trace");
}, 60_000);

const settings = () => server.services.settings;
const view = () => ({ frames: true, trace: false, traceReset: 0, toolbar: "Default", ...(server.ws.view ?? {}) });
const stations = () => Object.values(server.ws.items).filter((i) => i.type === "station").length;

describe("TriggerAction and KeyEvent (R-IM-4)", () => {
  it("lists the actions with an empty name and answers unknown names", async () => {
    const listing = readFileSync(path.join(ROOT, "research/evidence/interaction-model/trigger-action-list.txt"), "utf8").trim();
    expect(await ui("TriggerAction", "")).toBe(listing);
    expect(await ui("TriggerAction", "actionNope")).toBe("Triggering action actionNope");
  });

  it("runs actions by objectName", async () => {
    const n = stations();
    expect(await ui("TriggerAction", "actionNew_Station")).toBe("OK");
    expect(stations()).toBe(n + 1);
  });

  it("matches key sequences by their macOS native text", async () => {
    const n = stations();
    expect(await ui("KeyEvent", "Ctrl+N")).toBe("Action for shortcut found: Ctrl+N");
    expect(stations()).toBe(n);
    expect(await ui("KeyEvent", "⌘N")).toBe("OK");
    expect(await ui("KeyEvent", "⌘n")).toBe("OK");
    expect(stations()).toBe(n + 2);
    expect(await ui("KeyEvent", "Alt+/")).toBe("Action for shortcut found: Alt+/");
    expect(await ui("KeyEvent", "⌥/")).toBe("OK");
    expect(view().frames).toBe(false);
    await ui("KeyEvent", "⌥/");
    expect(view().frames).toBe(true);
  });
});

describe("display commands", () => {
  it("ShowCoords / ShowText read and set the display state", async () => {
    expect(await ui("ShowCoords", "")).toBe("1");
    expect(await ui("ShowCoords", "0")).toBe("OK");
    expect(await ui("ShowCoords", "")).toBe("0");
    await ui("ShowCoords", "1");
    expect(await ui("ShowText", "off")).toBe("OK");
    expect(await ui("ShowText", "")).toBe("0");
    await ui("ShowText", "1");
  });

  it("Trace On / Off / Reset", async () => {
    expect(await ui("Trace", "")).toBe("Off");
    expect(await ui("Trace", "On")).toBe("OK");
    expect(await ui("Trace", "")).toBe("On");
    const before = view().traceReset;
    expect(await ui("Trace", "Reset")).toBe("OK");
    expect(view().traceReset).toBe(before + 1);
    await ui("Trace", "Off");
  });

  it("FrameSizes scales the defaults; FrameSizes<Kind> read and set one size", async () => {
    expect(await ui("FrameSizes", "")).toBe("1");
    expect(await ui("FrameSizes", "2")).toBe("OK");
    expect([settings().FrameSizesRef, settings().FrameSizesTarget, settings().FrameSizesPath, settings().FrameSizesOther]).toEqual([700, 500, 300, 200]);
    expect(await ui("FrameSizesTarget", "")).toBe("500");
    expect(await ui("FrameSizesTarget", "120")).toBe("OK");
    expect(settings().FrameSizesTarget).toBe(120);
    expect(await ui("FrameSizesPath", "-3")).toBe("Invalid value");
  });

  it("ToolbarLayout follows RoboDK's startsWith rule", async () => {
    expect(await ui("ToolbarLayout", "Viewer2")).toBe("OK");
    expect(await ui("ToolbarLayout", "")).toBe("Viewer");
    expect(await ui("ToolbarLayout", "bogus")).toBe("OK");
    expect(await ui("ToolbarLayout", "")).toBe("Default");
  });

  it("mouse operation, navigation type and zoom speed", async () => {
    expect(await ui("MouseClickLeft", "Pan")).toBe("OK");
    expect(await ui("MouseClickLeft", "")).toBe("Pan");
    expect(await ui("MouseClickLeft", "Spin")).toBe("Invalid value");
    await ui("MouseClickLeft", "Select");
    expect(await ui("MouseNav", "12")).toBe("OK");
    expect(await ui("MouseNav", "")).toBe("7");
    expect(await ui("ZoomSpeed", "")).toBe("Auto");
  });

  it("Theme drives the appearance; Settings Defaults restores the options", async () => {
    expect(await ui("Theme", "2")).toBe("OK");
    expect(settings().RC_THEME).toBe("dark");
    expect(await ui("Theme", "1")).toBe("OK");
    expect(settings().RC_THEME).toBe("light");
    expect(await ui("Settings", "Defaults")).toBe("OK");
    expect(settings().FrameSizesRef).toBe(350);
    expect(settings().Mouse3D_Type).toBe(0);
  });

  it("names that belong to other modules are left alone", async () => {
    expect(await ui("NotAViewCommand", "")).toBeUndefined();
  });
});

describe("snapshots through a 3D view (R-SLF-36)", () => {
  it("fails clearly when no view is open", async () => {
    expect(vb.viewClients()).toBe(0);
    expect(await ui("Snapshot", "shot.png")).toBe("No 3D view is open: open Enginuity in a browser to take screenshots");
  });

  it("saves the image the view renders, in the screenshots folder", async () => {
    vb.viewConnected();
     
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asked: ServerEvent[] = [];
    const answer = (e: ServerEvent) => {
      if (e.type !== "screenshot-request") return;
      asked.push(e);
      setTimeout(() => vb.completeScreenshot(String(e.id), png, 640, 480), 5);
    };
    server.listeners.add(answer);
    try {
      expect(await ui("SnapshotWhite", "white-shot.png")).toBe("OK");
      expect(asked[0]).toMatchObject({ white: true, format: "png" });
      const file = path.join(vb.SCREENSHOT_DIR, "white-shot.png");
      expect(existsSync(file)).toBe(true);
      expect(new Uint8Array(readFileSync(file))).toEqual(png);
    } finally {
      server.listeners.delete(answer);
      vb.viewDisconnected();
    }
  });
});

describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("server-side trace (R-SLF-43)", () => {
  it("records the TCP of moving robots while the trace is on, and Reset clears it", async () => {
    const r = await run("file.open", { path: ABB }, "system");
    expect(r.ok).toBe(true);
    const robot = (r.result as { id: string }).id;
    await ui("Trace", "On");
    const emit = (joints: number[]) => server.services.emit?.({ type: "live", robot, joints });
    emit([0, 0, 0, 0, 30, 0]);
    emit([20, 0, 0, 0, 30, 0]);
    emit([20, 0, 0, 0, 30, 0.0001]);  
    expect(trace.tracePaths()[robot]).toHaveLength(2);
    await ui("Trace", "Reset");
    emit([40, 0, 0, 0, 30, 0]);
    expect(trace.tracePaths()[robot]).toHaveLength(1);
    await ui("Trace", "Off");
    emit([60, 0, 0, 0, 30, 0]);
    expect(trace.tracePaths()[robot]).toHaveLength(1);
  });
});

describe("API event channel", () => {
  it("tells the views when key and 3D events are wanted", () => {
    const seen: ServerEvent[] = [];
    const l = (e: ServerEvent) => e.type === "api-events" && seen.push(e);
    server.listeners.add(l);
    vb.eventChannelOpened();
    vb.eventChannelClosed();
    vb.eventChannelClosed();  
    server.listeners.delete(l);
    expect(seen.map((e) => (e as { count?: number }).count)).toEqual([1, 0, 0]);
    expect(vb.eventChannels()).toBe(0);
  });
});
