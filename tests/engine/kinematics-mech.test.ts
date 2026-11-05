// Verifies mechanism-specific kinematics, joint configurations, and IK solution ordering.
 
 
 
 
 
 
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { robotDataFromParsed } from "@/engine/commands/robot";
import { fk, ikAllDetailed, ikClosest, initKinematics, jointsConfig, linkFrames, parseRobotFile } from "@/engine/kinematics";
import { mul, rotx, roty, rotz, transl } from "@/engine/math";
import type { RobotModel } from "@/engine/types";
import { engine, LIBRARY_DIR, ROOT } from "../helpers";

const EVID = path.join(ROOT, "research/evidence");
 
const MIRROR = path.join(LIBRARY_DIR, "files");
const linf = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const load = (file: string): RobotModel => robotDataFromParsed(parseRobotFile(new Uint8Array(readFileSync(file))).json, []).model;
const deg = Math.PI / 180;

beforeAll(async () => {
  await initKinematics();
});

describe.skipIf(!existsSync(path.join(EVID, "utilities/mech/mech-16.robot")))("mechanism-builder types 21 and 22 (WP-D probe)", () => {
  const probe = () => JSON.parse(readFileSync(path.join(EVID, "utilities/robodk-mechanism-probe-2.json"), "utf8"));

  it("type 21 (AGV): linear axes along base X, Y, Z by d + q, then the DH turn", () => {
    const m = load(path.join(EVID, "utilities/mech/mech-15.robot"));
    const e = probe()["mech.15"];
    expect(linf(fk(m, e.fk_q), e.fk)).toBeLessThan(1e-6);
    const f = linkFrames(m, e.fk_q);
    expect(linf(f[1], transl(80, 0, 0))).toBeLessThan(1e-9);
    expect(linf(f[3], transl(80, 220, 310))).toBeLessThan(1e-9);
    expect(linf(ikClosest(m, e.fk, [0, 0, 0, 0])!, e.fk_q)).toBeLessThan(1e-6);
  });

  it("type 22 (6-axis mechanism): transl(q1, q2, q3) · Rx(q4) · Ry(q5) · Rz(q6)", () => {
    const m = load(path.join(EVID, "utilities/mech/mech-16.robot"));
    const e = probe()["mech.16"];
    expect(linf(fk(m, e.fk_q), e.fk)).toBeLessThan(1e-6);
    const q = [5, -7, 9, 25, -35, 60];
    const want = mul(transl(5, -7, 9), mul(rotx(25 * deg), mul(roty(-35 * deg), rotz(60 * deg))));
    expect(linf(fk(m, q), want)).toBeLessThan(1e-9);
    expect(linf(ikClosest(m, want, [0, 0, 0, 0, 0, 0])!, q)).toBeLessThan(1e-6);
  });
});

describe.skipIf(!existsSync(MIRROR))("library robots against RoboDK (robodk-probe-1.json)", () => {
  type Sample = { q: number[]; fk: number[]; links: number[][]; cfg: number[] };
  type IkCase = { q: number[]; seeds: number[][]; ik: number[][]; current: number[]; ik_current: number[]; ik_all: number[][] };
  type Rec = { file: string; group: string; mech: number; samples: Sample[]; ik?: IkCase[] };
  const probe = () => JSON.parse(readFileSync(path.join(EVID, "kinematics-mech/robodk-probe-1.json"), "utf8")) as { robots: Rec[] };
  const robots = () => probe().robots.filter((r) => r.group !== "toolmech");
  const model = (r: Rec) => load(path.join(MIRROR, "library-robots", r.file));

  it("FK and every link mesh frame (passive linkages, palletizers, deltas, coupled J2/J3)", () => {
    let frames = 0;
    for (const r of robots()) {
      const m = model(r);
      for (const s of r.samples) {
        if (!s.fk) continue;
         
        if (r.file.startsWith("Fanuc-M-2000iA") && Math.abs(s.q[1] + s.q[2] - 90) < 1e-6) continue;
        expect(linf(fk(m, s.q), s.fk), r.file).toBeLessThan(1e-6);
        const f = linkFrames(m, s.q);
        s.links.forEach((l, i) => {
          expect(linf(f[i], l), `${r.file} link ${i}`).toBeLessThan(1e-5);
          frames++;
        });
      }
    }
    expect(frames).toBeGreaterThan(5000);
  });

  it("JointsConfig by mechanism type", () => {
     
    const skip = /Kinova-Link-6|Franka|Kassow-Robots-KR0810|Productive-Robotics-OB7|Agile-Robots-Diana/;
    let n = 0;
    for (const r of robots()) {
      if (skip.test(r.file)) continue;
      const m = model(r);
      for (const s of r.samples) {
        if (!s.cfg) continue;
        expect(jointsConfig(m, s.q).slice(0, 3), `${r.file} ${s.q}`).toEqual(s.cfg.slice(0, 3));
        n++;
      }
    }
    expect(n).toBeGreaterThan(400);
  });

   
  const ANALYTIC = /IRB-910SC|Epson-LS3|Mitsubishi-RH-3CH|Yamaha-YK700|Brooks|IRB-6640|Nachi-MC500P|NJ-110|KR-300-R2700|IRB-1410|R-2000iC|M-2000iA|iiwa|SIA20D|LR-Mate-200iC-5H|RX170HSM|IRB-360|Codian|M-1iA|autonox|TM14|DUCO/;

  it("SolveIK from every probed seed", () => {
    let n = 0;
    for (const r of robots()) {
      if (!ANALYTIC.test(r.file)) continue;
      const m = model(r);
      for (const e of r.ik ?? []) {
        const pose = fk(m, e.q);
        const cases: [number[], number[]][] = e.seeds.map((s, k) => [s, e.ik[k]]);
        cases.push([e.current, e.ik_current]);
        for (const [seed, want] of cases) {
          if (!Array.isArray(want) || want.length < m.nq) {
            continue;
          }
          const got = ikClosest(m, pose, seed);
          expect(got, `${r.file} seed ${seed}`).not.toBeNull();
          expect(linf(got!, want.slice(0, m.nq)), `${r.file} seed ${seed}`).toBeLessThan(1e-3);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(300);
  });

  it("SolveIK_All rows, order and RoboDK's extra values", () => {
    let n = 0;
    for (const r of robots()) {
      if (!ANALYTIC.test(r.file) || /TM14|DUCO/.test(r.file)) continue;
      const m = model(r);
      for (const e of r.ik ?? []) {
        if (!Array.isArray(e.ik_all)) continue;
        const got = ikAllDetailed(m, fk(m, e.q), 64, e.current);
        expect(got.length, r.file).toBe(e.ik_all.length);
        got.forEach((g, i) => {
          const want = e.ik_all[i];
          expect(linf(g.joints, want.slice(0, m.nq)), `${r.file} row ${i}`).toBeLessThan(1e-3);
          expect(g.extras.length, `${r.file} row ${i}`).toBe(want.length - m.nq);
           
          const half = (v: number[]) => v.map((x) => (Math.abs(Math.abs(x) - 180) < 1e-6 ? 180 : x));
          if (g.extras.length) expect(linf(half(g.extras), half(want.slice(m.nq))), `${r.file} row ${i}`).toBeLessThan(1e-3);
        });
        n++;
      }
    }
    expect(n).toBeGreaterThan(40);
  });
});

describe.skipIf(!existsSync(MIRROR))("tool-kind .robot mechanisms against RoboDK", () => {
  type Tool = { file: string; mech: number; samples: { q: number[]; fk: number[]; links: number[][] }[] };
  const tools = () => (JSON.parse(readFileSync(path.join(EVID, "kinematics-mech/robodk-probe-1.json"), "utf8")) as { tools: Tool[] }).tools;
  const toolModel = (file: string) => load(path.join(MIRROR, "library-tools", file));

  it("type 15 grippers and single-axis tools: TCP and every mesh frame follow the joint", () => {
    let n = 0;
    for (const t of tools()) {
      if (t.mech === 17) continue;  
      const m = toolModel(t.file);
      for (const s of t.samples) {
        expect(linf(fk(m, s.q), s.fk), t.file).toBeLessThan(1e-6);
        const f = linkFrames(m, s.q);
        s.links.forEach((l, i) => expect(linf(f[i], l), `${t.file} link ${i} q=${s.q}`).toBeLessThan(1e-5));
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(30);
  });

  it("SCHUNK PGN-plus-E 80 sweep over its 0…25 mm stroke", () => {
    const sweep = JSON.parse(readFileSync(path.join(EVID, "kinematics-mech/robodk-gripper-sweep.json"), "utf8"))["SCHUNK-PGN-plus-E-80-Gripper"];
    const m = toolModel("SCHUNK-PGN-plus-E-80-Gripper.robot");
    expect([m.joints[0].lower, m.joints[0].upper]).toEqual([0, 25]);
    for (const s of sweep.samples) {
      const f = linkFrames(m, s.q);
      s.links.forEach((l: number[], i: number) => expect(linf(f[i], l)).toBeLessThan(1e-5));
    }
  });
});

describe.skipIf(!existsSync(path.join(MIRROR, "library-robots/ABB-IRB-910SC-3-0-65.robot")))("SCARA tilt (robodk-scara-tilt.json)", () => {
  it("accepts leans until the target Z leans 0.2 toward +X of the J4 frame", () => {
    const e = JSON.parse(readFileSync(path.join(EVID, "kinematics-mech/robodk-scara-tilt.json"), "utf8"));
    const m = load(path.join(MIRROR, "library-robots", e.robot));
    const pose = fk(m, e.q);
    const rot = (a: number, t: number) => {
      const [x, y] = [Math.cos(a * deg), Math.sin(a * deg)];
      const c = Math.cos(t * deg), s = Math.sin(t * deg), v = 1 - c;
      return [v * x * x + c, v * x * y, s * y, 0, v * x * y, v * y * y + c, -s * x, 0, -s * y, s * x, c, 0, 0, 0, 0, 1];
    };
    for (const [axis, maxOk] of Object.entries(e.max_ok_deg_by_axis_angle_a as Record<string, number>)) {
      const a = Number(axis);
      expect(ikClosest(m, mul(pose, rot(a, maxOk)), e.q), `axis ${a} at ${maxOk}`).not.toBeNull();
      if (maxOk < 40) expect(ikClosest(m, mul(pose, rot(a, maxOk + 0.16)), e.q), `axis ${a} past ${maxOk}`).toBeNull();
    }
  });
});

 
 
 
 
describe.skipIf(!existsSync(path.join(MIRROR, "library-tools/SCHUNK-PGN-plus-E-80-Gripper.robot")))("tool-kind .robot files load as mechanisms", () => {
  const GRIPPER = path.join(MIRROR, "library-tools/SCHUNK-PGN-plus-E-80-Gripper.robot");
  const withMirror = async () => {
    const e = await engine();
    const load = e.services.library!.load;
    e.services.library!.load = async (file, kind) => (file === "SCHUNK-PGN-plus-E-80-Gripper.robot" ? { bytes: new Uint8Array(readFileSync(GRIPPER)), url: `file://${file}` } : load(file, kind));
    return e;
  };

  it("with two robots and none selected it is added as its own robot", async () => {
    const e = await withMirror();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    await e.run("library.load", { file: "UR5e.robot" });
    await e.run("edit.select", { items: [] });
    const r = (await e.run("library.load", { file: "SCHUNK-PGN-plus-E-80-Gripper.robot", kind: "tool" })) as unknown as { id: string };
    const g = e.ws.items[r.id];
    expect(g.type).toBe("robot");
    expect(g.name).toBe("SCHUNK PGN-plus-E 80 Gripper");
    const base = e.ws.items[g.parent!];
    expect([base.type, base.name]).toEqual(["frame", "SCHUNK PGN-plus-E 80 Gripper Base"]);
    expect(e.ws.items[base.parent!].type).toBe("station");
    expect(Object.values(e.ws.items).filter((i) => i.type === "tool")).toEqual([]);
    for (const rb of Object.values(e.ws.items).filter((i) => i.type === "robot" && i.id !== g.id)) expect(rb.robot!.activeTool ?? null).toBeNull();
     
    expect(g.robot!.model.meshLinks).toBe(3);
  });

  it("with a robot given its base frame goes under that robot (follows the flange)", async () => {
    const e = await withMirror();
    const ur = (await e.run("library.load", { file: "UR5e.robot" })) as unknown as { id: string };
    const r = (await e.run("library.load", { file: "SCHUNK-PGN-plus-E-80-Gripper.robot", kind: "tool", robot: ur.id })) as unknown as { id: string };
    const base = e.ws.items[e.ws.items[r.id].parent!];
    expect(base.name).toBe("SCHUNK PGN-plus-E 80 Gripper Base");
    expect(base.parent).toBe(ur.id);
    expect(e.ws.items[ur.id].robot!.activeTool ?? null).toBeNull();
  });
});

 
 
describe.skipIf(!existsSync(path.join(MIRROR, "library-tools")))("library .tool files", () => {
  it("every mirrored .tool loads and attaches to the only robot as its active tool", { timeout: 120_000 }, async () => {
    const dir = path.join(MIRROR, "library-tools");
    const files = readdirSync(dir).filter((f) => f.endsWith(".tool"));
    expect(files.length).toBeGreaterThan(100);
    const failed: string[] = [];
    for (const f of files) {
      const e = await engine();
      const load = e.services.library!.load;
      e.services.library!.load = async (file, kind) => (file === f ? { bytes: new Uint8Array(readFileSync(path.join(dir, f))), url: `file://${f}` } : load(file, kind));
      const ur = (await e.run("library.load", { file: "UR5e.robot" })) as unknown as { id: string };
      const r = await e.tryRun("library.load", { file: f, kind: "tool" });
      const tool = r.ok ? e.ws.items[(r.result as { id: string }).id] : undefined;
      if (!tool || tool.type !== "tool" || tool.parent !== ur.id || e.ws.items[ur.id].robot!.activeTool !== tool.id) failed.push(`${f}: ${r.ok ? "not attached" : r.error}`);
    }
    expect(failed).toEqual([]);
  });
});

