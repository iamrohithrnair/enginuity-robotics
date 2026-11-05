// Builds, validates, and packages example stations with thumbnails and a catalog.
 
 
 
 
 
 
 
 
 
 
 

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExampleCatalog, ExampleEntry } from "../src/engine/examples";
import type { ExampleSpec } from "../examples/lib/spec";

const ROOT = process.cwd();
const EXAMPLES = path.join(ROOT, "examples");

type Store = typeof import("../src/server/store");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runToEnd(store: Store, program: string, ratio: number, timeoutMs: number) {
  const s = store.getServer();
  const statuses: string[] = [];
  const listener = (e: { type: string; [k: string]: unknown }) => {
    if (e.type === "status") statuses.push(String(e.text));
  };
  s.listeners.add(listener);
  try {
    await call(store, "sim.setSpeed", { factor: ratio });
    const t0 = Date.now();
    await call(store, "program.run", { program });
    await wait(50);
    while ((s.ws.busy?.length || s.ws.running) && Date.now() - t0 < timeoutMs) await wait(10);
    const busy = !!(s.ws.busy?.length || s.ws.running);
    if (busy) await call(store, "sim.stop", {});
    return { statuses, seconds: ((Date.now() - t0) / 1000) * ratio, timedOut: busy };
  } finally {
    s.listeners.delete(listener);
  }
}

async function call<T = Record<string, unknown>>(store: Store, name: string, params: Record<string, unknown>): Promise<T> {
  const r = await store.run(name, params, "system");
  if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
  return r.result as T;
}

 
const BAD = /failed|not reachable|collision|does not exist|not defined|simulation error|timed out|no object is close|has been deleted|stopped by|not possible|singularit/i;

async function buildOne(store: Store, slug: string): Promise<ExampleEntry> {
  const { ExampleBuilder } = await import("../examples/lib/builder");
  const { renderThumbnail } = await import("../examples/lib/thumbnail");
  const { packStation } = await import("../src/engine/examples");
  const spec = ((await import(path.join(EXAMPLES, slug, "build.ts"))) as { default: ExampleSpec }).default;
  const s = store.getServer();
  const b = new ExampleBuilder((name, params) => store.run(name, params, "system"), () => s.ws);
  const t0 = Date.now();
  const station = await b.newStation(spec.name);
  await spec.build(b);
  await call(store, "edit.select", { items: [] }).catch(() => undefined);
  const programs = s.ws.items[station].children.map((c) => s.ws.items[c]).filter((i) => i?.type === "program").map((i) => i.name);
  if (!programs.includes(spec.mainProgram)) throw new Error(`${slug}: no main program ${spec.mainProgram}`);

   
  const built: string[] = [];
  for (const prog of s.ws.items[station].children.map((c) => s.ws.items[c]).filter((i) => i?.type === "program")) {
    const r = await call<{ ok: boolean; message: string }>(store, "program.check", { program: prog.id });
    if (!r.ok) built.push(`${prog.name}: ${r.message.replace(/<[^>]+>/g, " ")}`);
  }
  if (built.length) throw new Error(`${slug}: Check Path failed in the built station\n  ${built.join("\n  ")}`);

  const dir = path.join(EXAMPLES, slug);
  const png = await renderThumbnail(s.ws, s.services.geometry, station, spec.view);
  writeFileSync(path.join(dir, "thumbnail.png"), png);
  const packed = await packStation(s.ws, s.services.geometry, station, b.library);
  const file = path.join(dir, `${slug}.mech`);
  writeFileSync(file, JSON.stringify(packed));
  await call(store, "station.close", { station, ifUnsaved: "discard" });

   
  const opened = await call<{ id: string }>(store, "file.open", { path: file });
  const progIds = new Map(s.ws.items[opened.id].children.map((c) => s.ws.items[c]).filter((i) => i?.type === "program").map((i) => [i.name, i.id]));
  const checks: string[] = [];
  for (const [name, id] of progIds) {
    const r = await call<{ ok: boolean; message: string }>(store, "program.check", { program: id });
    if (!r.ok) checks.push(`${name}: ${r.message.replace(/<[^>]+>/g, " ")}`);
  }
  if (checks.length) throw new Error(`${slug}: Check Path failed\n  ${checks.join("\n  ")}`);
  const run = await runToEnd(store, progIds.get(spec.mainProgram)!, spec.ratio ?? 10, 240_000);
  const finished = run.statuses.find((t) => t.startsWith(`Program ${spec.mainProgram} finished`));
  const bad = run.statuses.filter((t) => BAD.test(t) && !(spec.expectedStatus ?? []).some((re) => re.test(t)));
  if (run.timedOut || !finished || bad.length) throw new Error(`${slug}: the main program did not run cleanly${run.timedOut ? " (timed out)" : ""}\n  ${run.statuses.join("\n  ")}`);
  for (const re of spec.expectedStatus ?? []) if (!run.statuses.some((t) => re.test(t))) throw new Error(`${slug}: expected a status matching ${re}\n  ${run.statuses.join("\n  ")}`);
  const gen = await call<{ post: string; files: { name: string }[] }>(store, "program.generate", { program: progIds.get(spec.mainProgram)! });
  await call(store, "station.close", { station: opened.id, ifUnsaved: "discard" });
  console.log(
    `${slug}: ${programs.length} programs, ${packed.items.length} items, ${(JSON.stringify(packed).length / 1e6).toFixed(2)} MB, cycle ≈ ${run.seconds.toFixed(1)} s, ${gen.post} → ${gen.files.map((f) => f.name).join(", ")} (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
  return {
    slug,
    name: spec.name,
    description: spec.description,
    features: spec.features,
    robots: [...new Set(b.robots)],
    tools: [...new Set(b.tools)],
    station: `${slug}/${slug}.mech`,
    thumbnail: `${slug}/thumbnail.png`,
    mainProgram: spec.mainProgram,
    programs,
    cycleTime: Math.round(run.seconds * 2) / 2,
  };
}

export async function main(args: string[]): Promise<number> {
  const slugs = readdirSync(EXAMPLES).filter((d) => existsSync(path.join(EXAMPLES, d, "build.ts"))).sort();
  const want = args.filter((a) => !a.startsWith("-"));
  for (const w of want) if (!slugs.includes(w)) throw new Error(`No example ${w} (have: ${slugs.join(", ")})`);
   
  const data = mkdtempSync(path.join(os.tmpdir(), "enginuity-examples-"));
  if (existsSync(path.join(ROOT, "data", "library"))) symlinkSync(path.join(ROOT, "data", "library"), path.join(data, "library"));
  process.env.ROBOCRAFT_DATA_DIR = data;
  const store: Store = await import("../src/server/store");
  await store.getServer().ready;
  store.getServer().flags.Popups = "0";

  const catalogFile = path.join(EXAMPLES, "catalog.json");
  const previous: ExampleEntry[] = existsSync(catalogFile) ? (JSON.parse(readFileSync(catalogFile, "utf8")) as ExampleCatalog).examples : [];
  const entries = new Map(previous.filter((e) => slugs.includes(e.slug)).map((e) => [e.slug, e]));
  let failed = 0;
  for (const slug of want.length ? want : slugs) {
    mkdirSync(path.join(EXAMPLES, slug), { recursive: true });
    try {
      entries.set(slug, await buildOne(store, slug));
    } catch (err) {
      failed++;
      console.error(err instanceof Error ? err.message : err);
      for (const id of [...store.getServer().ws.stations]) await store.run("station.close", { station: id, ifUnsaved: "discard" }, "system");
    }
  }
  const order = slugs.map((s) => entries.get(s)).filter((e): e is ExampleEntry => !!e);
  const catalog: ExampleCatalog = { format: "enginuity-examples", version: 1, examples: order.sort((a, b) => (ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99)) };
  writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
  rmSync(data, { recursive: true, force: true });
  return failed ? 1 : 0;
}

 
const ORDER = [
  "conveyor-pick-place",
  "palletizing",
  "cnc-machine-tending",
  "arc-welding",
  "deburring",
  "glue-dispensing",
  "dual-robot-assembly",
  "camera-inspection",
  "python-api",
  "scara-sorting",
  "physics-drop-stack-push",
];
