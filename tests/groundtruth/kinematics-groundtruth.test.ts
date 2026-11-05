// Checks stored joints/pose pairs across mirrored stations for kinematics consistency.
 
 
 
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../helpers";
import { analyzeStation, CLOSE, consistent, EXACT, fkExact, fkRigid, groupBy, hasMirror, stationFiles, stats, type PairResult, type StationReport } from "./groundtruth";

const OUT = path.join(ROOT, "research/evidence/groundtruth");






const KNOWN_UNEXPLAINED: Record<string, number> = {
   
  "Inspection-with-UR10e.rdk|OutputBot": 989,
  "Inspection-with-UR10e.rdk|InputBot": 989,
   
   
  "Synchronization-and-Welding-with-ABB-and-Lucas-02.rdk|ABB IRB 2600ID-8/2.00": 67,
   
  "Material-Handling-with-Motoman-HP20D-02.rdk|RobotiQ 2F85": 3,
   
  "Material-Handling-and-Welding-with-KUKA.rdk|Piston5_1": 2,
  "Material-Handling-and-Welding-with-KUKA.rdk|Piston5_2": 2,
  "Material-Handling-and-Welding-with-KUKA.rdk|SPiston3_1": 2,
  "Material-Handling-and-Welding-with-KUKA.rdk|SPiston3_2": 2,
  "Material-Handling-and-Welding-with-KUKA.rdk|SPiston4_1": 2,
  "Material-Handling-and-Welding-with-KUKA.rdk|SPiston4_2": 2,
  "Synchronization-and-Welding.rdk|T1": 3,
  "Synchronization-and-Welding-with-ABB-IRB-2600ID-8-2-00.rdk|Ferris_Wheel_J1": 1,
   
   
   
   
   
  "Mixed-Applications-with-RoboDK-RDK-1440.rdk|RoboDK RDK-1440": 22,
  "Mixed-Applications-with-RoboDK-RDK-1440-02.rdk|RoboDK RDK-1440": 1,
  "Assembly-and-Material-Handling-with-igus-ReBeL-6DOF.rdk|igus ReBeL 6DOF": 14,
  "Assembly-and-Material-Handling-with-Mitsubishi-RV-2F.rdk|Mitsubishi RV-2F": 13,
  "Assembly-and-Material-Handling-with-Hyundai-HH4.rdk|Hyundai HH4": 9,
  "Assembly-and-Material-Handling-with-Rokae-XB4.rdk|Rokae XB4": 7,
  "Assembly-and-Material-Handling-with-INOVANCE-IR-R4-56S5.rdk|INOVANCE IR-R4-56S5": 5,
  "Assembly-and-Material-Handling-with-FAIRINO-FR3.rdk|FAIRINO FR3": 3,
  "Assembly-and-Material-Handling-with-Adept-Viper-s650.rdk|Adept Viper s650": 1,
  "Assembly-and-Material-Handling-with-Epson-C3.rdk|Epson C3": 1,
  "Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk|KUKA KR 3 R540": 1,
  "Assembly-and-Material-Handling-with-Leantec-LA596-4H-R.rdk|Leantec LA596-4H-R": 1,
  "Assembly-and-Material-Handling-with-Nachi-MZ04-01.rdk|Nachi MZ04-01": 1,
  "Assembly-and-Material-Handling-with-Robostar-RA004.rdk|Robostar RA004": 1,
  "Assembly-and-Material-Handling-with-Staubli-TX2-40.rdk|Staubli TX2-40": 1,
  "Assembly-and-Material-Handling-with-TM5X-700.rdk|TM5X-700": 1,
  "Assembly-and-Material-Handling-with-Yaskawa-GP4.rdk|Yaskawa GP4": 1,
  "Drilling-and-Milling-with-KUKA-KR-10-R900-sixx-02.rdk|KUKA KR 10 R900 sixx": 13,
  "Calibration-and-Inspection-with-UR5e.rdk|UR5e": 12,
  "Material-Handling-with-Mecademic-Meca500-R3.rdk|Mecademic Meca500 R3": 5,
  "Conveying-Inspection-and-Material-Handling-with-UR10.rdk|UR10 A": 3,
  "Machine-Tending-Machining-and-Material-Handling-with-AUBO-i10.rdk|AUBO-i10": 3,
  "Material-Handling-with-Doosan-Robotics-M1013.rdk|Doosan Robotics M1013": 3,
  "Mixed-Applications-with-Multiple-Robots.rdk|ABB IRB 2600-12/1.85": 2,
  "Mixed-Applications-with-Multiple-Robots.rdk|KUKA KR 120 R2900 extra": 1,
  "Synchronization-and-Welding-with-ABB-IRB-2600ID-8-2-00.rdk|ABB IRB 2600ID-8/2.00": 2,
  "Welding-with-Panasonic-TA-1600.rdk|Panasonic TA-1600": 1,
  "Welding-with-Panasonic-TA-1600.rdk|RobotC": 1,
   
   
   
  "Material-Handling-with-Mecademic-and-RoboDK.rdk|RoboDK RDK-1440": 7,
};

 
const MIN_EXACT: Record<string, number> = {
  "mech 1": 0.994,
   
  "mech 1 +ext": 0.992,
  "mech 6": 0.887,
  "mech 8": 0.994,
  "mech -3": 1,
  "mech -8": 1,
  "mech 0": 0.912,
  "mech 0 +ext": 1,
  "mech 2": 1,
  "mech 2 +ext": 1,
  "mech 21": 0.98,
  "mech 22": 1,
  "mech 9": 0.69,
   
  "mech 5": 0.217,
};

const mechKey = (r: PairResult) => `mech ${r.mech}${r.ext ? " +ext" : ""}`;

describe.skipIf(!hasMirror())("RoboDK example stations as kinematics ground truth", () => {
  it("compares every stored joints/pose pair", { timeout: 1_800_000 }, async () => {
    const reports: StationReport[] = [];
    for (const f of stationFiles()) reports.push(await analyzeStation(f));
    const all: PairResult[] = reports.flatMap((r) => r.results);
    const failed = reports.filter((r) => !r.ok);
    const ok = all.filter(consistent);

     
     
    const verified = new Set(ok.filter(fkExact).map((r) => `${r.station}|${r.robot}`));
    const mismatched = ok.filter((r) => !fkRigid(r));
    const stale = mismatched.filter((r) => verified.has(`${r.station}|${r.robot}`));
    const unexplained = Object.fromEntries(
      Object.entries(groupBy(mismatched.filter((r) => !verified.has(`${r.station}|${r.robot}`)), (r) => `${r.station}|${r.robot}`)).map(([k, v]) => [k, v.length]),
    );
    const ikChecked = ok.filter((r) => fkExact(r) && r.ik !== null);
    const ikMisses = ikChecked.filter((r) => !r.ik);

    const summary = {
      stations: reports.length,
      stationsAnalyzed: reports.length - failed.length,
      stationFailures: failed.map((r) => ({ station: r.station, error: r.error })),
      robots: new Set(all.map((r) => r.robot)).size,
      pairs: all.length,
      targets: all.filter((r) => r.source === "target").length,
      moves: all.filter((r) => r.source === "move").length,
      skippedTargets: reports.reduce((a, r) => a + r.skippedTargets, 0),
      skippedMoves: reports.reduce((a, r) => a + r.skippedMoves, 0),
      kinematicsErrors: Object.fromEntries(Object.entries(groupBy(reports.flatMap((r) => r.errors), (x) => `${x.error} · mech ${x.mech} · ${x.robot}`)).map(([k, v]) => [k, v.length])),
      tolerances: { exact: EXACT, close: CLOSE, ikJointsDegOrMm: 0.01 },
      overall: stats(all),
      excluded: {
        unreachable: all.filter((r) => r.unreachable).length,
        sharedJoints: all.filter((r) => r.sharedJoints).length,
        referenceCarriedByAnotherRobot: all.filter((r) => r.carried).length,
        unmappedExternalAxes: all.filter((r) => r.extMap === "unmapped").length,
        gripperTargets: all.filter((r) => r.mech === 15 && r.source === "target").length,
      },
      consistent: {
        ...stats(ok),
        staleButRobotVerified: stale.length,
        unexplained: Object.values(unexplained).reduce((a, b) => a + b, 0),
      },
      ik: {
        checked: ikChecked.length,
        members: ikChecked.length - ikMisses.length,
        singularMembers: ikChecked.filter((r) => r.ik && r.ikSingular).length,
        misses: ikMisses.map((r) => ({ station: r.station, robot: r.robot, item: r.item, nearest: r.ikNearest, singular: !!r.ikSingular, joints: r.joints })),
      },
      bySource: Object.fromEntries(Object.entries(groupBy(all, (r) => r.source)).map(([k, v]) => [k, stats(v)])),
      byMech: Object.fromEntries(Object.entries(groupBy(ok, mechKey)).map(([k, v]) => [k, stats(v)])),
      byExternalAxes: Object.fromEntries(Object.entries(groupBy(all, (r) => r.extMap)).map(([k, v]) => [k, stats(v)])),
      byTool: Object.fromEntries(Object.entries(groupBy(all, (r) => r.tool)).map(([k, v]) => [k, stats(v)])),
      byFrame: Object.fromEntries(Object.entries(groupBy(all, (r) => r.frame)).map(([k, v]) => [k, stats(v)])),
      unexplainedByStationRobot: unexplained,
    };
    const byRobot = Object.fromEntries(
      Object.entries(groupBy(ok, (r) => r.robot))
        .map(([k, v]) => [k, { mech: v[0].mech, stations: new Set(v.map((r) => r.station)).size, ...stats(v) }] as const)
        .sort((a, b) => b[1].n - a[1].n),
    );
    const worst = mismatched
      .filter((r) => !verified.has(`${r.station}|${r.robot}`))
      .sort((a, b) => b.posErr - a.posErr)
      .slice(0, 300);

    console.log(JSON.stringify({ ...summary, bySource: undefined, byTool: undefined, byFrame: undefined }, null, 1));
    if (process.env.GROUNDTRUTH_DUMP) writeFileSync(process.env.GROUNDTRUTH_DUMP, JSON.stringify({ all, errors: reports.flatMap((r) => r.errors) }));
    if (process.env.GROUNDTRUTH_WRITE) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
      writeFileSync(path.join(OUT, "by-robot.json"), JSON.stringify(byRobot, null, 2));
      writeFileSync(path.join(OUT, "mismatches.json"), JSON.stringify(worst, null, 2));
    }

     
    expect(failed.map((r) => `${r.station}: ${r.error}`)).toEqual([]);
    expect(summary.kinematicsErrors).toEqual({});
    expect(all.length).toBeGreaterThan(520_000);

     
    const exact = ok.filter(fkExact);
    expect(exact.reduce((a, r) => Math.max(a, r.posErr), 0)).toBeLessThan(1e-3);
    expect(exact.reduce((a, r) => Math.max(a, r.rotErr), 0)).toBeLessThan(1e-4);
    for (const [k, v] of Object.entries(groupBy(ok, mechKey))) {
      if (MIN_EXACT[k] === undefined) continue;
      expect(v.filter(fkExact).length / v.length, k).toBeGreaterThanOrEqual(MIN_EXACT[k]);
    }
     
    for (const [k, n] of Object.entries(unexplained)) expect(n, k).toBeLessThanOrEqual(KNOWN_UNEXPLAINED[k] ?? 0);

     
    expect(ikChecked.length).toBeGreaterThan(13_000);
    expect(ikMisses.filter((r) => !r.ikSingular).map((r) => `${r.station} ${r.robot} ${r.item} ${r.ikNearest}`)).toEqual([]);
    expect(ikMisses.length).toBeLessThanOrEqual(1);

     
    expect(ok.filter((r) => fkRigid(r) && !r.inLimits).map((r) => `${r.station} ${r.robot} ${r.item}`)).toEqual([]);
  });
});
