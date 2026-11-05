// Verifies regenerated machining projects match stored paths within geometric tolerances.
 
 
 
 
 
 
 
 
 
 
 
 
 
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initKinematics } from "@/engine/kinematics";
import { ROOT } from "../helpers";
import { hasMirror, stationFiles } from "./groundtruth";
import { analyzeMachiningStation, type ProjectReport } from "./machining";

interface Known {
  passing: string[];
  unexplained: Record<string, string>;
}
const KNOWN: Known = JSON.parse(readFileSync(path.join(__dirname, "machining-known.json"), "utf8"));
const key = (r: ProjectReport) => `${r.station} | ${r.project}`;

 
const SAMPLE: Record<string, string[]> = {
   
  "Curve-Following-with-Omron-TM5-700.rdk": ["Outline settings", "Slot Outline settings"],
   
  "Welding-with-Yaskawa-GP7.rdk": [
    "Approach Normal Settings",
    "Approach Tangent Settings",
    "Approach Side Settings",
    "Approach Arc Normal Settings",
    "Approach Arc Side Settings",
    "Approach Arc Rot Settings",
    "Approach XYZ Settings",
    "Approach Chain 1 Settings",
    "Approach Chain 2 Settings",
  ],
   
  "Dispensing-with-Foxbot-A1200.rdk": ["Dispensing_3-Axis Settings"],
   
  "Welding-with-KUKA-KR-120-R2900-extra.rdk": ["Weld1 settings"],
  "CAM-Drilling-Machining.rdk": ["Drilling Project"],
  "Additive-Manufacturing-with-ABB-IRB-120-3-0-6.rdk": ["Print3D settings"],
};

 
function totals(reports: ProjectReport[], group: (r: ProjectReport) => string) {
  const out: Record<string, Record<string, number>> = {};
  for (const r of reports) {
    const g = (out[group(r)] ??= { projects: 0 });
    g.projects++;
    g[r.status] = (g[r.status] ?? 0) + 1;
  }
  return out;
}

describe.skipIf(!hasMirror())("machining projects of the example stations regenerated", () => {
  it("regenerates the sampled projects exactly", async () => {
    await initKinematics();
    for (const [station, projects] of Object.entries(SAMPLE)) {
      const reports = await analyzeMachiningStation(station);
      for (const name of projects) {
        const r = reports.find((x) => x.project === name);
        expect(r, `${station} | ${name}`).toBeDefined();
        expect({ project: key(r!), status: r!.status, moves: r!.ourMoves }).toEqual({ project: key(r!), status: "pass", moves: r!.storedMoves });
      }
    }
  }, 600_000);

  it.skipIf(!process.env.GROUNDTRUTH_FULL)(
    "regenerates every project: the passing set holds and the unexplained set only shrinks",
    async () => {
      await initKinematics();
      const reports: ProjectReport[] = [];
      for (const f of stationFiles()) reports.push(...(await analyzeMachiningStation(f)));
      const summary = {
        projects: reports.length,
        byStatus: totals(reports, () => "all").all,
        byKind: totals(reports, (r) => r.kind),
        byApproach: totals(reports, (r) => (r.approach || "none").split(/[ ;]/)[0]),
      };
      console.log(JSON.stringify(summary, null, 1));
      if (process.env.GROUNDTRUTH_WRITE) {
        const out = path.join(ROOT, "research/evidence/groundtruth");
        mkdirSync(out, { recursive: true });
        writeFileSync(path.join(out, "machining-projects.json"), JSON.stringify({ summary, projects: reports }, null, 1));
      }
      const pass = new Set(reports.filter((r) => r.status === "pass").map(key));
      expect(KNOWN.passing.filter((k) => !pass.has(k))).toEqual([]);
      const unexplained = reports.filter((r) => r.status !== "pass" && !r.reason).map(key);
      expect(unexplained.filter((k) => !(k in KNOWN.unexplained))).toEqual([]);
    },
    3_600_000,
  );
});
