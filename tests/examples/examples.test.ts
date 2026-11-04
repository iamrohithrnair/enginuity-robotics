 
 
 
 
 
 
 
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExampleCatalog, ExampleEntry, StationFile } from "@/engine/examples";
import { remapItemRefs } from "@/engine/itemRefs";
import { extrudeMesh, roundedBoxMesh, triangulatePolygon, tubeMesh } from "@/engine/shapes";
import type { Item } from "@/engine/types";
import { engine, LIBRARY_DIR, LIBRARY_FILE, ROOT } from "../helpers";

const EXAMPLES = path.join(ROOT, "examples");
 
const MIRROR = LIBRARY_DIR;
const hasMirror = existsSync(LIBRARY_FILE("robots", "UR5e.robot"));
const catalog = (JSON.parse(readFileSync(path.join(EXAMPLES, "catalog.json"), "utf8")) as ExampleCatalog).examples;

 
function volume(t: Float32Array): number {
  let v = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.subarray(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

function bounds(t: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], t[i + k]);
      max[k] = Math.max(max[k], t[i + k]);
    }
  return { min, max };
}

describe("parametric shapes", () => {
  it("rounded box: closed, outward, centred on XY with its base on z = 0; volume of a box with rounded edges", () => {
    const t = roundedBoxMesh(200, 100, 50, 10, 8);
    const { min, max } = bounds(t);
    expect(min.map((v) => Math.round(v * 1000) / 1000)).toEqual([-100, -50, 0]);
    expect(max.map((v) => Math.round(v * 1000) / 1000)).toEqual([100, 50, 50]);
     
    const r = 10;
    const [x, y, z] = [180, 80, 30];
    const exact = x * y * z + 2 * (x * y + y * z + z * x) * r + Math.PI * (x + y + z) * r * r + (4 / 3) * Math.PI * r ** 3;
    const v = volume(t);
    expect(v).toBeLessThan(exact);
    expect((exact - v) / exact).toBeLessThan(0.005);
  });

  it("tube: wall volume π(R² − r²)h, wound outwards", () => {
    const v = volume(tubeMesh(60, 50, 100, 96));
    expect(v / (Math.PI * (60 ** 2 - 50 ** 2) * 100)).toBeCloseTo(1, 2);
  });

  it("extrusion: concave profiles are triangulated exactly (area × height), either winding", () => {
    const L = [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 80],
      [0, 80],
    ];
    const area = 100 * 20 + 20 * 60;
    expect(volume(extrudeMesh(L, 30))).toBeCloseTo(area * 30, 3);
    expect(volume(extrudeMesh([...L].reverse(), 30))).toBeCloseTo(area * 30, 3);
    expect(triangulatePolygon(L.map((p) => [p[0], p[1]] as [number, number]))).toHaveLength(4);
    expect(extrudeMesh([[0, 0], [1, 1], [2, 2]], 10)).toHaveLength(0);
  });

  it("object.addShape makes rounded boxes, tubes and extrusions, and refuses an extrusion without a profile", async () => {
    const e = await engine();
    for (const p of [
      { shape: "roundedBox", sizeX: 300, sizeY: 200, sizeZ: 50, cornerRadius: 12 },
      { shape: "tube", radius: 40, innerRadius: 30, height: 120 },
      { shape: "extrusion", profile: [[0, 0], [50, 0], [50, 10], [0, 10]], height: 400 },
    ]) {
      const r = (await e.run("object.addShape", p)) as unknown as { id: string };
      const tri = e.services.geometry.get(e.ws.items[r.id].object!.meshes[0].geometry)!;
      expect(volume(tri)).toBeGreaterThan(0);
    }
    const bad = await e.tryRun("object.addShape", { shape: "extrusion", height: 10 });
    expect(bad.ok).toBe(false);
  });
});

describe("item links when items are re-keyed", () => {
  it("remapItemRefs rewrites every link: robot, target, instruction, events, decisions, projects, cameras, collision map", () => {
    const map: Record<string, string> = { r: "R", t: "T", f: "F", tl: "TL", o: "O", p: "P", c: "C" };
    const remap = (id: string | null | undefined) => (id && map[id] ? map[id] : null);
    const it = {
      robot: { activeTool: "tl", activeFrame: "f" },
      target: { robot: "r" },
      program: { robot: "r" },
      instruction: {
        kind: "event",
        target: "t",
        target2: null,
        frame: "f",
        tool: "tl",
        robot: "r",
        event: { action: "move", tool: "tl", object: "o", frame: "f", objects: ["o", "gone"], positions: [{ item: "o", parent: "f", pose: [] }, { item: "gone", parent: null, pose: [] }] },
        decision: { camera: "c" },
      },
      machining: { robot: "r", frame: "f", tool: "tl", program: "p", input: { object: "o" } },
      camera: { link: "f" },
      collisionMap: { mode: "default", pairs: [["r", 1, "o", 0, false], ["gone", 0, "o", 0, true]] },
    } as unknown as Item;
    remapItemRefs(it, remap);
    expect(it.robot).toMatchObject({ activeTool: "TL", activeFrame: "F" });
    expect([it.target!.robot, it.program!.robot]).toEqual(["R", "R"]);
    expect(it.instruction).toMatchObject({ target: "T", frame: "F", tool: "TL", robot: "R", decision: { camera: "C" } });
    expect(it.instruction!.event).toMatchObject({ tool: "TL", object: "O", frame: "F", objects: ["O"], positions: [{ item: "O", parent: "F" }] });
    expect(it.machining).toMatchObject({ robot: "R", frame: "F", tool: "TL", program: "P", input: { object: "O" } });
    expect(it.camera!.link).toBe("F");
    expect(it.collisionMap!.pairs).toEqual([["R", 1, "O", 0, false]]);
  });
});

describe("example catalog", () => {
  it("lists the example cells with their files, robots, tools, features and main program", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    for (const e of catalog) {
      expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(existsSync(path.join(EXAMPLES, e.station))).toBe(true);
      expect(existsSync(path.join(EXAMPLES, e.thumbnail))).toBe(true);
      expect(existsSync(path.join(EXAMPLES, e.slug, "build.ts"))).toBe(true);
      expect(e.robots.length).toBeGreaterThan(0);
      expect(e.features.length).toBeGreaterThan(2);
      expect(e.programs).toContain(e.mainProgram);
       
      expect([...readFileSync(path.join(EXAMPLES, e.thumbnail)).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it("station files reference library robots and tools instead of embedding them, and name no other product", () => {
    for (const e of catalog) {
      const text = readFileSync(path.join(EXAMPLES, e.station), "utf8");
      const data = JSON.parse(text) as StationFile;
      expect(data.format).toBe("enginuity-station");
      expect(text).not.toMatch(/robodk|robocraft/i);
      const files = [...new Set((data.library ?? []).map((r) => r.file))].sort();
      expect(files).toEqual([...new Set([...e.robots, ...e.tools])].sort());
      for (const ref of data.library ?? []) {
        const it = data.items.find((i) => i.id === ref.item)!;
        if (it.robot) {
          expect(it.robot.model).toBeUndefined();
          expect(it.robot.links).toBeUndefined();
        }
        if (it.tool) expect(it.tool.meshes).toEqual([]);
      }
       
      const ids = new Set(Object.keys(data.geometry ?? {}));
      for (const it of data.items) for (const m of [...(it.object?.meshes ?? []), ...(it.tool?.meshes ?? []), ...(it.robot?.links?.flat() ?? [])]) expect(ids.has(m.geometry)).toBe(true);
    }
  });
});

describe.skipIf(!hasMirror)("example cells in the real engine", () => {
  let store: typeof import("@/server/store");
  let statuses: string[] = [];
  const cmd = async <T = Record<string, unknown>>(name: string, params: Record<string, unknown> = {}, origin: "ui" | "agent" | "system" = "system") => {
    const r = await store.run(name, params, origin);
    if (!r.ok) throw new Error(`${name}: ${r.error}`);
    return r.result as T;
  };

  beforeAll(async () => {
    const data = mkdtempSync(path.join(os.tmpdir(), "mb-examples-"));
    symlinkSync(MIRROR, path.join(data, "library"));
    process.env.ROBOCRAFT_DATA_DIR = data;
     
    process.env.ROBOCRAFT_LIBRARY_OFFLINE = "1";
    store = await import("@/server/store");
    await store.getServer().ready;
    store.getServer().flags.Popups = "0";
    store.getServer().listeners.add((e) => {
      if (e.type === "status") statuses.push(String(e.text));
    });
    const { generateProgram } = await import("@/server/post");
    store.getServer().services.post = generateProgram;
  }, 60_000);

  afterAll(() => {
    delete process.env.ROBOCRAFT_LIBRARY_OFFLINE;
  });

  it("examples.list returns every example with its thumbnail route and nothing missing offline", async () => {
    const list = await cmd<(ExampleEntry & { missing: string[]; thumbnail: string })[]>("examples.list");
    expect(list.map((e) => e.slug)).toEqual(catalog.map((e) => e.slug));
    for (const e of list) {
      expect(e.thumbnail).toBe(`/api/examples/${e.slug}/thumbnail`);
      expect(e.missing).toEqual([]);
    }
    const welding = await cmd<ExampleEntry[]>("examples.list", { query: "movec welding" });
    expect(welding.map((e) => e.slug)).toContain("arc-welding");
    const { exampleThumbnail } = await import("@/server/examples");
    expect([...exampleThumbnail(catalog[0].slug).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  for (const e of catalog) {
    it(`${e.name}: opens, every program passes Check Path, ${e.mainProgram} runs to the end and generates with the robot's post`, { timeout: 240_000 }, async () => {
      const s = store.getServer();
      const before = s.ws.stations.length;
      const res = await cmd<{ id: string; name: string; mainProgram: string }>("examples.open", { example: e.slug }, "agent");
      expect(res.name).toBe(e.name);
      expect(s.ws.stations.length).toBe(before + 1);
      expect(s.ws.activeStation).toBe(res.id);
      const { descendants } = await import("@/engine/workspace");
      const items = descendants(s.ws, res.id);
       
      for (const it of items) {
        if (it.robot) expect(it.robot.model.joints.length).toBeGreaterThan(0);
        if (it.robot) expect(it.robot.links.flat().every((m) => s.services.geometry.get(m.geometry)?.length)).toBe(true);
        if (it.tool) expect(it.tool.meshes.every((m) => s.services.geometry.get(m.geometry)?.length)).toBe(true);
        if (it.object) expect(it.object.meshes.every((m) => s.services.geometry.get(m.geometry)?.length)).toBe(true);
      }
      const programs = new Map(items.filter((i) => i.type === "program").map((i) => [i.name, i.id]));
      expect([...programs.keys()].sort()).toEqual([...e.programs].sort());
      for (const [name, id] of programs) {
        const check = await cmd<{ ok: boolean; message: string }>("program.check", { program: id });
        expect(check.ok, `${name}: ${check.message}`).toBe(true);
      }

       
      statuses = [];
      await cmd("sim.setSpeed", { factor: 100 });
      await cmd("program.run", { program: programs.get(e.mainProgram) });
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      while ((s.ws.busy?.length || s.ws.running) && Date.now() - t0 < 180_000) await new Promise((r) => setTimeout(r, 10));
      expect(s.ws.busy ?? []).toEqual([]);
      expect(statuses, statuses.join("\n")).toContain(statuses.find((t) => t.startsWith(`Program ${e.mainProgram} finished`)));
      const fallback = e.slug === "camera-inspection" ? /running the error branch/ : /^$/;
      const bad = statuses.filter((t) => /failed|not reachable|collision|does not exist|not defined|simulation error|timed out|no object is close|has been deleted|not possible/i.test(t) && !fallback.test(t));
      expect(bad).toEqual([]);
      if (e.slug === "camera-inspection") expect(statuses.some((t) => /No decision model is set up.*running the error branch/.test(t))).toBe(true);

       
      const gen = await cmd<{ post: string; files: { name: string; content: string }[] }>("program.generate", { program: programs.get(e.mainProgram) });
      expect(gen.files.length).toBeGreaterThan(0);
      expect(gen.files[0].content.length).toBeGreaterThan(50);

       
      for (const py of items.filter((i) => i.type === "python")) {
        const out = spawnSync("python3", ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py.python!.code, encoding: "utf8" });
        expect(out.status, out.stderr).toBe(0);
      }
      await cmd("station.close", { station: res.id, ifUnsaved: "discard" });
    });
  }

  it("an example station file also opens with File ▸ Open, and saving it writes a regular station", async () => {
    const e = catalog[0];
    const s = store.getServer();
    const r = await cmd<{ id: string }>("file.open", { path: path.join(EXAMPLES, e.station) });
    const st = s.ws.items[r.id];
    expect(st.name).toBe(e.name);
     
    const saved = await cmd<{ path: string }>("station.save", { station: r.id });
    expect(saved.path).toMatch(/\.mech$/);
    expect(saved.path.startsWith(EXAMPLES)).toBe(false);
    await cmd("station.close", { station: r.id, ifUnsaved: "discard" });
  });

  it("fails with a clear message, adding nothing, when a library file is missing from the offline library", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mb-examples-missing-"));
    const station: StationFile = JSON.parse(readFileSync(path.join(EXAMPLES, catalog[0].station), "utf8"));
    station.library = station.library!.map((r, i) => (i === 0 ? { ...r, file: "Enginuity-Test-Robot-404.robot" } : r));
    mkdirSync(path.join(dir, "missing"), { recursive: true });
    writeFileSync(path.join(dir, "missing", "missing.mech"), JSON.stringify(station));
    writeFileSync(path.join(dir, "missing", "thumbnail.png"), "");
    const entry: ExampleEntry = { ...catalog[0], slug: "missing", name: "Missing Robot", station: "missing/missing.mech", thumbnail: "missing/thumbnail.png", robots: ["Enginuity-Test-Robot-404.robot"] };
    writeFileSync(path.join(dir, "catalog.json"), JSON.stringify({ format: "enginuity-examples", version: 1, examples: [entry] }));
    const s = store.getServer();
    const { createExampleServices } = await import("@/server/examples");
    const real = s.services.examples;
    s.services.examples = createExampleServices(dir);
    try {
      const list = await cmd<{ missing: string[] }[]>("examples.list");
      expect(list[0].missing).toEqual(["Enginuity-Test-Robot-404.robot"]);
      const stations = s.ws.stations.length;
      const items = Object.keys(s.ws.items).length;
      const r = await store.run("examples.open", { example: "missing" }, "ui");
      expect(r.ok).toBe(false);
      expect(r.error).toBe(
        'The example "Missing Robot" needs Enginuity-Test-Robot-404.robot from the robot library, but Enginuity-Test-Robot-404.robot is not in the offline library on this computer. Download the library for offline use (Robot Library ▸ Download all for offline use) or allow online access, then open it again.',
      );
      expect(s.ws.stations.length).toBe(stations);
      expect(Object.keys(s.ws.items).length).toBe(items);
    } finally {
      s.services.examples = real;
    }
  });

  it("the library's own example stations are hidden unless 'Show library example stations' is on", async () => {
    const s = store.getServer();
    const { GET } = await import("@/app/api/library/catalog/route");
    const page = async () => (await (await GET(new Request("http://localhost/api/library/catalog?kind=station&limit=5"))).json()) as { total: number; items: unknown[]; counts: { station: number; robot: number } };
    expect(s.services.settings.RC_SHOW_LIBRARY_STATIONS).toBe(false);
    const hidden = await page();
    expect([hidden.total, hidden.items.length, hidden.counts.station]).toEqual([0, 0, 0]);
    expect(hidden.counts.robot).toBeGreaterThan(1000);
    expect((await cmd<{ total: number }>("library.search", { kind: "station" })).total).toBe(0);
    expect((await cmd<{ items: { kind: string }[] }>("library.search", { query: "ABB", limit: 200 })).items.some((i) => i.kind === "station")).toBe(false);

    await cmd("settings.set", { key: "RC_SHOW_LIBRARY_STATIONS", value: true });
    try {
      const shown = await page();
      expect(shown.total).toBeGreaterThan(300);
      expect(shown.counts.station).toBe(shown.total);
      expect((await cmd<{ total: number }>("library.search", { kind: "station" })).total).toBe(shown.total);
    } finally {
      await cmd("settings.set", { key: "RC_SHOW_LIBRARY_STATIONS", value: false });
    }
  });

  describe("Physics: Drop, Stack and Push", () => {
    const slug = "physics-drop-stack-push";
    const RELEASE_Z = 360 + 150;  

    async function openCell() {
      const res = await cmd<{ id: string }>("examples.open", { example: slug });
      const s = store.getServer();
      const { descendants } = await import("@/engine/workspace");
      const items = descendants(s.ws, res.id);
      const named = (n: string) => items.find((i) => i.name === n)!;
      return { id: res.id, named, grid: Array.from({ length: 9 }, (_, k) => named(`Part ${k + 1}`)) };
    }

    async function runMain(id: string, ratio: number) {
      const s = store.getServer();
      const { descendants } = await import("@/engine/workspace");
      const main = descendants(s.ws, id).find((i) => i.type === "program" && i.name === "Main")!;
      statuses = [];
      await cmd("sim.setSpeed", { factor: ratio });
      await cmd("program.run", { program: main.id });
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      while ((s.ws.busy?.length || s.ws.running) && Date.now() - t0 < 180_000) await new Promise((r) => setTimeout(r, 10));
      expect(statuses.some((t) => t.startsWith("Program Main finished")), statuses.join("\n")).toBe(true);
    }

    it("the station saves the per-object physics settings", () => {
      const data = JSON.parse(readFileSync(path.join(EXAMPLES, slug, `${slug}.mech`), "utf8")) as StationFile;
      const byName = (n: string) => data.items.find((i) => i.name === n)!;
      expect(byName("Bouncy Cylinder").physics).toEqual({ body: "dynamic", mass: 2, restitution: 0.4 });
      expect(byName("Chute").physics).toMatchObject({ body: "static" });
      for (const n of ["Table", "Robot Pedestal", "Bin", "Part 1"]) expect(byName(n).physics).toBeUndefined();
      const note = data.items.find((i) => i.type === "notes")!.notes!.html;
      expect(note).toMatch(/Physics/);
      expect(note).toMatch(/physics\.enable/);
    });

    it("with physics off (the default), released parts stay where the robot let them go", { timeout: 240_000 }, async () => {
      const s = store.getServer();
      expect(s.services.settings.RC_PHYSICS ?? false).toBe(false);
      const { id, grid } = await openCell();
      const { absPose } = await import("@/engine/workspace");
      const before = absPose(s.ws, grid[8].id);
      await runMain(id, 100);
      for (const part of grid.slice(0, 8)) expect(absPose(s.ws, part.id)[11]).toBeCloseTo(RELEASE_Z, 3);
       
      expect(absPose(s.ws, grid[8].id)).toEqual(before);
      await cmd("station.close", { station: id, ifUnsaved: "discard" });
    });

    it("with physics on, the parts fall into the bin and settle; fixtures resolve to Static", { timeout: 240_000 }, async () => {
      const s = store.getServer();
      const { id, named, grid } = await openCell();
      await cmd("physics.enable", { on: true });
      try {
        const role = async (n: string) => (await cmd<{ item: { role: string; text: string; mass?: number } }>("physics.status", { item: named(n).id })).item;
        expect((await role("Table")).text).toMatch(/^Auto: Static \(supports \d+ parts\)$/);
        expect((await role("Robot Pedestal")).text).toMatch(/^Auto: Static \(carries UR5e/);
        expect((await role("Bin")).text).toBe("Auto: Static (supports Chute)");
        expect((await role("Chute")).text).toBe("Static (set to Static)");
        expect(await role("Bouncy Cylinder")).toMatchObject({ role: "dynamic", text: "Dynamic (set to Dynamic)", mass: 2 });
        expect((await role("Part 1")).role).toBe("dynamic");

         
        await runMain(id, 4);
        const settled = await cmd<{ settled: boolean; moved: { name: string; mm: number }[] }>("physics.settle", { maxSeconds: 5 });
        expect(settled.settled, `still moving: ${JSON.stringify(settled.moved)}`).toBe(true);

         
        const { absPose } = await import("@/engine/workspace");
        const bin = named("Bin");
        const P = absPose(s.ws, bin.id);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const m of bin.object!.meshes) {
          const t = s.services.geometry.get(m.geometry)!;
          for (let i = 0; i + 2 < t.length; i += 3)
            for (let k = 0; k < 3; k++) {
              const v = P[k * 4] * t[i] + P[k * 4 + 1] * t[i + 1] + P[k * 4 + 2] * t[i + 2] + P[k * 4 + 3];
              min[k] = Math.min(min[k], v);
              max[k] = Math.max(max[k], v);
            }
        }
        for (const part of grid) {
          const p = absPose(s.ws, part.id);
          const at = [p[3], p[7], p[11]];
          expect(
            at.every((v, k) => v >= min[k] - 1 && v <= max[k]),
            `${part.name} at ${at.map((v) => v.toFixed(0)).join(", ")}, bin ${min.map((v) => v.toFixed(0))} … ${max.map((v) => v.toFixed(0))}`,
          ).toBe(true);
        }
      } finally {
        await cmd("physics.enable", { on: false });
        await cmd("station.close", { station: id, ifUnsaved: "discard" });
      }
    });
  });

  it("examples.list and examples.open are agent and MCP tools whose descriptions name only Enginuity", async () => {
    const { allCommands } = await import("@/engine/registry");
    for (const name of ["examples.list", "examples.open"]) {
      const c = allCommands().find((x) => x.name === name)!;
      expect(c).toBeDefined();
      expect(c.internal).toBeFalsy();
      expect(c.description).not.toMatch(/RoboDK|RoboCraft/);
    }
  });
});
