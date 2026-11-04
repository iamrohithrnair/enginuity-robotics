 
 
 
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerFileHandler, STEP_NOT_SUPPORTED } from "@/engine/commands/files";
import { STATION_FILE_CORRUPTED } from "@/engine/commands/rdk";
import { autoBackupTick } from "@/server/backup";
import { createFileServices } from "@/server/fileStore";
import type { ServerState } from "@/server/store";
import { engine, hasLibraryFile, LIBRARY_FILE, qUncompress, ROOT } from "../helpers";

 
const UR5E = LIBRARY_FILE("robots", "UR5e.robot");
const itUR5e = it.skipIf(!hasLibraryFile("robots", "UR5e.robot"));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "rc-files-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function setup() {
  const e = await engine();
  e.services.files = createFileServices(dir);
  return e;
}
const b64 = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64");
const statuses = (e: Awaited<ReturnType<typeof engine>>) => e.events.filter((x) => x.type === "status").map((x) => String(x.text));
const stationOf = (e: Awaited<ReturnType<typeof engine>>) => e.ws.items[e.ws.activeStation!];
const asciiStl = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n";

describe("file.open dispatches by extension (R-SLF-33)", () => {
  itUR5e(".robot adds the robot under '<name> Base' with the original's loading messages and one 'Add:' step", async () => {
    const e = await setup();
    const bytes = readFileSync(UR5E);
    const r = await e.run("file.open", { fileName: "UR5e.robot", base64: b64(bytes) }, "ui");
    expect(r.kind).toBe("robot");
    expect(r.name).toBe("UR5e");
    const robot = e.ws.items[String(r.id)];
    expect(e.ws.items[robot.parent!].name).toBe("UR5e Base");
    expect(statuses(e)).toEqual(["Loading: UR5e.robot", "Loading finished."]);
    expect(e.undo.list().undo).toEqual(["Add: UR5e"]);
  });

  itUR5e("an uncompressed or damaged robot file gives D-26 (R-EDGE-77)", async () => {
    const e = await setup();
     
    const raw = qUncompress(readFileSync(UR5E));
    const r = await e.tryRun("file.open", { fileName: "UR5e.robot", base64: b64(raw) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("The robot file is not valid. The robot file is corrupted or there's not enough available space. Errors will follow.");
    const junk = await e.tryRun("file.open", { fileName: "x.robot", base64: b64(Buffer.from("not a robot")) });
    expect(junk.error).toBe(r.error);
  });

  it("meshes become objects named after the file in the active frame or station root, one 'Add:' step", async () => {
    const e = await setup();
    const r = await e.run("file.open", { fileName: "Part A.stl", base64: b64(Buffer.from(asciiStl)) });
    expect(r).toMatchObject({ kind: "object", name: "Part A", triangles: 1 });
    expect(e.ws.items[String(r.id)].parent).toBe(e.ws.activeStation);
    expect(e.undo.list().undo).toEqual(["Add: Part A"]);
  });

  it(".rdk opens as a new active station; a damaged station file gives the original's message", async () => {
    const e = await setup();
    const before = e.ws.stations.length;
    const r = await e.run("file.open", { fileName: "minimal.rdk", base64: b64(readFileSync(path.join(ROOT, "research/evidence/slf/minimal.rdk"))) });
    expect(r.kind).toBe("station");
    expect(e.ws.stations.length).toBe(before + 1);
    expect(e.ws.activeStation).toBe(r.id);
    expect(statuses(e)).toContain("Loading finished.");
    const bad = await e.tryRun("file.open", { fileName: "bad.rdk", base64: b64(Buffer.from("garbage station")) });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe(STATION_FILE_CORRUPTED);
  });

  it("STEP/IGES without a CAD kernel gives the original's own message; unknown files are refused", async () => {
    const e = await setup();
    for (const f of ["part.step", "part.STP", "part.igs"]) {
      const r = await e.tryRun("file.open", { fileName: f, base64: b64(Buffer.from("ISO-10303-21;")) });
      expect(r.error).toBe(STEP_NOT_SUPPORTED);
    }
    const u = await e.tryRun("file.open", { fileName: "notes.xyz123", base64: b64(Buffer.from("x")) });
    expect(u.error).toBe("File format not supported: notes.xyz123");
  });

  it("features can register their own extensions; .url opens the link", async () => {
    const e = await setup();
    registerFileHandler([".rcdemo"], (_ctx, file) => ({ bytes: file.bytes.length, name: file.name }));
    expect(await e.run("file.open", { fileName: "a.rcdemo", base64: b64(Buffer.from("12345")) })).toMatchObject({ kind: "rcdemo", bytes: 5 });
    const url = await e.run("file.open", { fileName: "help.url", base64: b64(Buffer.from("[InternetShortcut]\nURL=https://example.com/doc\n")) });
    expect(url).toMatchObject({ kind: "url", openUrl: "https://example.com/doc" });
    expect(statuses(e)).toContain("Opening URL link: https://example.com/doc");
  });

  it("files opened from a path go to the recent list (UI and agent), not from the API", async () => {
    const e = await setup();
    const f = path.join(dir, "Part.stl");
    writeFileSync(f, asciiStl);
    await e.run("file.open", { path: f }, "api");
    expect(e.services.files!.recent!()).toEqual([]);
    await e.run("file.open", { path: f }, "ui");
    expect(e.services.files!.recent!()).toEqual([f]);
    const missing = await e.tryRun("file.open", { path: path.join(dir, "nope.stl") });
    expect(missing.error).toBe(`File doesn't exist: ${path.join(dir, "nope.stl")}`);
  });
});

describe("Save, Save As and unsaved changes (R-SLF-29/30)", () => {
  it("first save writes <name>.mech with the original's statuses and marks the station clean", async () => {
    const e = await setup();
    await e.run("item.addFrame", {}, "ui");
    let info = (await e.run("station.info")) as unknown as { modified: boolean; file: string | null }[];
    expect(info[0]).toMatchObject({ modified: true, file: null });
    const { path: p } = (await e.run("station.save", {}, "ui")) as unknown as { path: string };
    expect(p).toBe(path.join(dir, "stations", "New Station (1).mech"));
    expect(existsSync(p)).toBe(true);
    expect(statuses(e)).toEqual([`Saving station to ${p}. Please wait...`, `Station saved successfully (${p})`]);
    info = (await e.run("station.info")) as unknown as { modified: boolean; file: string | null }[];
    expect(info[0]).toMatchObject({ modified: false, file: p });
    expect(e.services.files!.recent!()).toEqual([p]);
    expect(e.undo.list()).toMatchObject({ index: 1, cleanIndex: 1, clean: true });
  });

  it("a renamed station keeps saving to its file; Save As switches to the new file", async () => {
    const e = await setup();
    const st = stationOf(e).id;
    const first = ((await e.run("station.save", {})) as unknown as { path: string }).path;
    await e.run("item.rename", { item: st, name: "Cell 7" });
    expect(((await e.run("station.save", {})) as unknown as { path: string }).path).toBe(first);
    const as = ((await e.run("station.save", { name: "Welding cell" })) as unknown as { path: string }).path;
    expect(as).toBe(path.join(dir, "stations", "Welding cell.mech"));
    expect(e.ws.items[st].file).toBe(as);
    expect(((await e.run("station.save", {})) as unknown as { path: string }).path).toBe(as);
  });

  it("undoing back to the saved position is clean again; new steps after undo lose the clean point (QUndoStack)", async () => {
    const e = await setup();
    await e.run("item.addFrame", {});
    await e.run("station.save", {});
    await e.run("item.addFrame", {});
    expect(e.undo.list().clean).toBe(false);
    await e.run("edit.undo");
    expect(e.undo.list().clean).toBe(true);
    await e.run("edit.undo");
    expect(e.undo.list().clean).toBe(false);
    await e.run("item.addFrame", {});
    expect(e.undo.list().cleanIndex).toBe(-1);
  });

  it("open restores the station with its file, clean, and in the recent list", async () => {
    const e = await setup();
    await e.run("item.addFrame", { name: "Fixture" });
    const p = ((await e.run("station.save", {}, "ui")) as unknown as { path: string }).path;
    const r = await e.run("station.open", { path: p }, "ui");
    expect(e.ws.items[String(r.id)].file).toBe(p);
    expect(Object.values(e.ws.items).some((i) => i.name === "Fixture" && i.id !== undefined)).toBe(true);
    expect(e.undo.list().clean).toBe(true);
    expect(statuses(e).slice(-2)).toEqual([`Loading: ${p}`, "Loading finished."]);
  });
});

describe("Enginuity station files: .mech, older .rcstation.json still open", () => {
  it("Save As takes a name with or without .mech; the station list shows both extensions", async () => {
    const e = await setup();
    const a = ((await e.run("station.save", { name: "Cell A.mech" })) as unknown as { path: string }).path;
    expect(a).toBe(path.join(dir, "stations", "Cell A.mech"));
    const legacy = path.join(dir, "stations", "Old cell.rcstation.json");
    writeFileSync(legacy, readFileSync(a));
    expect(((await e.run("station.listFiles", {})) as unknown as string[]).sort()).toEqual(["Cell A.mech", "Old cell.rcstation.json"]);
  });

  it("an older .rcstation.json opens (station.open, file.open, a bare name) and saves back as .mech", async () => {
    const e = await setup();
    await e.run("item.addFrame", {});
    const saved = ((await e.run("station.save", { name: "Old cell" })) as unknown as { path: string }).path;
    const legacy = path.join(dir, "stations", "Old cell.rcstation.json");
    writeFileSync(legacy, readFileSync(saved));
    rmSync(saved);
    const opened = (await e.run("station.open", { path: legacy })) as unknown as { id: string };
    expect(e.ws.items[opened.id].file).toBe(legacy);
    const byName = (await e.run("station.open", { path: "Old cell" })) as unknown as { id: string };
    expect(e.ws.items[byName.id].file).toBe(legacy);
    const viaOpen = await e.run("file.open", { fileName: "Old cell.rcstation.json", base64: b64(readFileSync(legacy)) });
    expect(viaOpen.kind).toBe("station");
    expect(e.ws.items[String(viaOpen.id)].name).toBe(e.ws.items[opened.id].name);
     
    const again = ((await e.run("station.save", { station: opened.id })) as unknown as { path: string }).path;
    expect(again).toBe(path.join(dir, "stations", "Old cell.mech"));
    expect(e.ws.items[opened.id].file).toBe(again);
    expect(existsSync(legacy)).toBe(true);
  });

  it("file.open opens a .mech file dropped on the window as a new station", async () => {
    const e = await setup();
    await e.run("item.addFrame", {});
    const p = ((await e.run("station.save", { name: "Dropped" })) as unknown as { path: string }).path;
    const name = stationOf(e).name;
    const r = await e.run("file.open", { fileName: "Dropped.mech", base64: b64(readFileSync(p)) });
    expect(r.kind).toBe("station");
    expect(e.ws.items[String(r.id)].name).toBe(name);
    expect(e.ws.stations.length).toBe(2);
  });
});

describe("Close with unsaved changes (D-06)", () => {
  it("the agent must decide; discard closes, save saves first", async () => {
    const e = await setup();
    await e.run("item.addFrame", {});
    const r = await e.tryRun("station.close", {}, "agent");
    expect(r).toMatchObject({ ok: false, code: "unsaved_changes" });
    await e.run("station.close", { ifUnsaved: "save" }, "agent");
    expect(readdirSync(path.join(dir, "stations"))).toEqual(["New Station (1).mech"]);
  });

  it("the UI asks 'Do you want to save NAME?' Yes / No / Cancel; the API closes silently", async () => {
    const e = await setup();
    const asked: { html: string; buttons: string[] }[] = [];
    let answer = "Cancel";
    e.services.ask = async (html, buttons) => {
      asked.push({ html, buttons });
      return answer;
    };
    await e.run("item.addFrame", {}, "ui");
    const st = stationOf(e);
    expect(await e.run("station.close", {}, "ui")).toMatchObject({ closed: null, cancelled: true });
    expect(asked[0]).toEqual({ html: `Do you want to save <strong>${st.name}</strong>?`, buttons: ["Yes", "No", "Cancel"] });
    expect(e.ws.items[st.id]).toBeDefined();
    answer = "No";
    expect(await e.run("station.close", {}, "ui")).toMatchObject({ closed: st.name });
    expect(readdirSync(path.join(dir, "stations"))).toEqual([]);
     
    await e.run("item.addFrame", {}, "ui");
    const n = asked.length;
    await e.run("station.close", {}, "api");
    expect(asked.length).toBe(n);
  });

  it("a clean station closes without a question", async () => {
    const e = await setup();
    let asked = 0;
    e.services.ask = async () => (asked++, "Cancel");
    await e.run("station.close", {}, "ui");
    expect(asked).toBe(0);
  });
});

describe("View Undo Stack and edit.undoTo (D-24)", () => {
  it("jumps the history by undoing or redoing step by step", async () => {
    const e = await setup();
    for (const name of ["A", "B", "C"]) await e.run("item.addFrame", { name });
    const has = (n: string) => Object.values(e.ws.items).some((i) => i.name === n);
    await e.run("edit.undoTo", { index: 0 });
    expect(["A", "B", "C"].some(has)).toBe(false);
    expect(e.undo.list()).toMatchObject({ index: 0, redo: ["Add: A", "Add: B", "Add: C"] });
    await e.run("edit.undoTo", { index: 2 });
    expect([has("A"), has("B"), has("C")]).toEqual([true, true, false]);
    await e.run("edit.undoTo", { index: 99 });
    expect(has("C")).toBe(true);
  });
});

describe("recent files and auto backup (R-SLF-13, R-SLF-14)", () => {
  it("keeps 20 entries, newest first, without duplicates", async () => {
    const files = createFileServices(dir);
    for (let k = 0; k < 21; k++) files.pushRecent!(`/tmp/s${k}.rdk`);
    files.pushRecent!("/tmp/s5.rdk");
    const list = files.recent!();
    expect(list.length).toBe(20);
    expect(list[0]).toBe("/tmp/s5.rdk");
    expect(list.filter((f) => f === "/tmp/s5.rdk").length).toBe(1);
    expect(list).not.toContain("/tmp/s0.rdk");
  });

  it("backs up a modified station every AutoBackup_Min minutes; save deletes its backups", async () => {
    const e = await setup();
    const state = { ws: e.ws, undo: e.undo.group, services: e.services } as unknown as ServerState;
    const last = { at: 0 };
    expect(autoBackupTick(state, 10 * 60_000, last)).toBe("off");
    e.services.settings.AutoBackup_On = 1;
    e.services.settings.AutoBackup_Min = 5;
    expect(autoBackupTick(state, 10 * 60_000, last)).toBe("clean");
    await e.run("item.addFrame", {});
    expect(autoBackupTick(state, 12 * 60_000, last)).toBe("wait");
    expect(autoBackupTick(state, 16 * 60_000, last)).toBe("saved");
    const backups = e.services.files!.listBackups!();
    expect(backups.length).toBe(1);
    expect(backups[0].file).toMatch(/^New Station \(1\) - Auto saved on \d{4}-\d\d-\d\d \d\dh\d\dm\d\ds\.mech$/);
    const listed = (await e.run("station.recoverBackup", {})) as unknown as { backups: { file: string }[] };
    expect(listed.backups.map((b) => b.file)).toEqual([backups[0].file]);
    const opened = await e.run("station.recoverBackup", { file: backups[0].file });
    expect(e.ws.activeStation).toBe(opened.id);
    await e.run("station.save", { station: e.ws.stations[0] });
    expect(e.services.files!.listBackups!()).toEqual([]);
  });
});
