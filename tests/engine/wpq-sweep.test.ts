 
 
 
 
 
 
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { engine, LIBRARY_KIND_DIR } from "../helpers";

const DIR = LIBRARY_KIND_DIR("stations");
const KNOWN_FILE = path.join(__dirname, "wpq-sweep-known.json");

describe.skipIf(!existsSync(DIR) || !existsSync(KNOWN_FILE) || !process.env.ENGINUITY_SWEEP)("library example sweep (Check Path)", () => {
  it("opens every example station and checks every program", { timeout: 4 * 3600_000 }, async () => {
    const KNOWN = JSON.parse(readFileSync(KNOWN_FILE, "utf8")) as { minPassRate: number; failures: Record<string, string> };
    const failing: string[] = [];
    const openErrors: string[] = [];
    let programs = 0;
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".rdk")).sort()) {
      const e = await engine();
      const r = await e.tryRun("station.openRdk", { base64: readFileSync(path.join(DIR, f)).toString("base64") });
      if (!r.ok) {
        openErrors.push(`${f}: ${r.error}`);
        continue;
      }
      for (const p of Object.values(e.ws.items).filter((i) => i.type === "program")) {
        programs += 1;
        const c = await e.tryRun("program.check", { program: p.id });
        if (!c.ok || !(c.result as { ok: boolean }).ok) failing.push(`${f}::${p.name}`);
      }
    }
    expect(openErrors).toEqual([]);
    expect((programs - failing.length) / programs).toBeGreaterThanOrEqual(KNOWN.minPassRate);
    expect(failing.filter((k) => !(k in KNOWN.failures))).toEqual([]);
  });
});
