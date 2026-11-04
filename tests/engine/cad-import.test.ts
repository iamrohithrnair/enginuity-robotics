 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCadService, CAD_DEFAULT_COLOR } from "@/server/cad";
import { engine, ROOT } from "../helpers";

const DATA = path.join(ROOT, "crates/rc_cad/tests/data");
const WASM = path.join(ROOT, "public/wasm/rc_cad.wasm");
const b64 = (name: string) => readFileSync(path.join(DATA, name)).toString("base64");
const id = (r: unknown) => (r as { id: string }).id;

async function setup() {
  const e = await engine();
  e.services.cad = createCadService(WASM);
  return e;
}

function triangles(e: Awaited<ReturnType<typeof engine>>, objId: string) {
  return e.ws.items[objId].object!.meshes.reduce((n, m) => n + e.services.geometry.get(m.geometry)!.length / 9, 0);
}

describe("CAD import (R-SLF-34)", () => {
  it("a STEP part becomes one object named after the file, with its colour and RoboDK's statuses", async () => {
    const e = await setup();
    const r = await e.run("file.open", { fileName: "box.stp", base64: b64("box.stp") }, "ui");
    const obj = e.ws.items[id(r)];
    expect(obj.type).toBe("object");
    expect(obj.name).toBe("box");
    expect(triangles(e, obj.id)).toBe(12);
    expect(obj.object!.meshes.map((m) => m.color)).toEqual([[1, 0, 0, 1]]);
    expect(e.events.filter((x) => x.type === "status").map((x) => x.text)).toEqual(["Loading: box.stp", "Loading finished."]);
    expect(e.undo.list().undo).toEqual(["Add: box"]);
    expect(r).toMatchObject({ faces: 6, facesNotMeshed: 0 });
  });

  it("tessellates like RoboDK: 48 and 124 triangles for the Ø20 and Ø200 cylinders", async () => {
    const e = await setup();
    const small = id(await e.run("file.open", { fileName: "cylinder.stp", base64: b64("cylinder.stp") }));
    expect(triangles(e, small)).toBe(48);
     
    expect(e.ws.items[small].object!.meshes[0].color[0]).toBeCloseTo(0.21404, 4);
    const big = id(await e.run("file.open", { fileName: "cylinder-r100.stp", base64: b64("cylinder-r100.stp") }));
    expect(triangles(e, big)).toBe(124);
    expect(e.ws.items[big].object!.meshes[0].color).toEqual(CAD_DEFAULT_COLOR);
  });

  it("assemblies load as one object with every placed instance (STEP action 'Load as one object')", async () => {
    const e = await setup();
    const obj = id(await e.run("file.open", { fileName: "assembly.stp", base64: b64("assembly.stp") }));
    const tris = e.services.geometry.get(e.ws.items[obj].object!.meshes[0].geometry)!;
    expect(tris.length / 9).toBe(24);
    let maxX = -Infinity;
    for (let k = 0; k < tris.length; k += 3) maxX = Math.max(maxX, tris[k]);
    expect(maxX).toBeCloseTo(100, 4);
  });

  it("IGES trimmed surfaces with 314 colours; unreadable files report the problem", async () => {
    const e = await setup();
    const plate = id(await e.run("file.open", { fileName: "plate.igs", base64: b64("plate.igs") }));
    expect(e.ws.items[plate].name).toBe("plate");
    expect(e.ws.items[plate].object!.meshes[0].color[1]).toBeCloseTo(0.3185, 3);
    const bad = await e.tryRun("file.open", { fileName: "broken.step", base64: Buffer.from("ISO-10303-21;\nDATA;\n#1=GARBAGE(;\nENDSEC;").toString("base64") });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/^Problems reading file: broken\.step/);
  });
});

 
 
 
describe("STEP import action (D-41)", () => {
  it("Load as assembly: a frame named after the file with one object per part, named after its product", async () => {
    const e = await setup();
    e.services.settings.ImportStepAction = 2;
    const r = await e.run("file.open", { fileName: "assembly.stp", base64: b64("assembly.stp") }, "ui");
    expect(r).toMatchObject({ kind: "assembly", name: "assembly" });
    const frame = e.ws.items[id(r)];
    expect(frame.type).toBe("frame");
    const parts = frame.children.map((c) => e.ws.items[c]);
    expect(parts.map((p) => [p.type, p.name])).toEqual([
      ["object", "block"],
      ["object", "block"],
    ]);
    expect(parts.map((p) => triangles(e, p.id))).toEqual([12, 12]);
    expect(e.undo.list().undo).toEqual(["Add: assembly"]);
  });

  it("Ask: Assembly / Object / Cancel; API loads never ask", async () => {
    const e = await setup();
    e.services.settings.ImportStepAction = 0;
    const asked: string[] = [];
    let answer = "Assembly";
    e.services.ask = async (html, buttons) => (asked.push(`${html} | ${buttons.join("/")}`), answer);
    expect((await e.run("file.open", { fileName: "assembly.stp", base64: b64("assembly.stp") }, "ui")).kind).toBe("assembly");
    expect(asked).toEqual(["Import as assembly or single object?<br>assembly.stp | Assembly/Object/Cancel"]);
    answer = "Object";
    expect((await e.run("file.open", { fileName: "assembly.stp", base64: b64("assembly.stp") }, "ui")).kind).toBe("object");
    answer = "Cancel";
    const n = Object.keys(e.ws.items).length;
    expect((await e.run("file.open", { fileName: "assembly.stp", base64: b64("assembly.stp") }, "ui")).kind).toBe("cancelled");
    expect(Object.keys(e.ws.items).length).toBe(n);
    expect((await e.run("file.open", { fileName: "assembly.stp", base64: b64("assembly.stp") }, "api")).kind).toBe("object");
    expect(asked).toHaveLength(3);
     
    expect((await e.run("file.open", { fileName: "plate.igs", base64: b64("plate.igs") }, "ui")).kind).toBe("object");
    expect(asked).toHaveLength(3);
  });
});
