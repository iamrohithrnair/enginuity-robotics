// Verifies pose-format conversions, singularity round-trips, and pasted pose parsing.
import { describe, expect, it } from "vitest";
import { DEG, mulAll, rotx, roty, rotz, transl, type Mat } from "@/engine/math";
import { DEFAULT_POSE_FORMAT, POSE_FORMATS, formatToPose, parsePoseText, poseToFormat } from "@/engine/poseFormats";

const close = (a: number[], b: number[], tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

 
function samples(n: number): Mat[] {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const out: Mat[] = [];
  for (let i = 0; i < n; i++) out.push(mulAll(transl(rnd() * 900, rnd() * 900, rnd() * 900), rotz(rnd() * Math.PI), roty(rnd() * Math.PI), rotx(rnd() * Math.PI)));
  return out;
}

const singular: Mat[] = [
  mulAll(transl(1, 2, 3)),
  mulAll(roty(90 * DEG)),
  mulAll(roty(-90 * DEG)),
  mulAll(rotz(40 * DEG), roty(90 * DEG), rotx(25 * DEG)),
  mulAll(rotz(-70 * DEG), roty(-90 * DEG), rotx(15 * DEG)),
  mulAll(rotx(33 * DEG), roty(90 * DEG), rotz(12 * DEG)),
  mulAll(rotx(33 * DEG), roty(-90 * DEG), rotz(12 * DEG)),
  mulAll(rotz(20 * DEG), roty(180 * DEG), rotz(50 * DEG)),
  mulAll(rotz(20 * DEG), rotx(180 * DEG), rotz(50 * DEG)),
  mulAll(rotx(180 * DEG)),
  mulAll(roty(180 * DEG)),
  mulAll(rotz(180 * DEG)),
];

describe("pose formats (R-TREE-46)", () => {
  it("uses RoboDK's exact combo texts, ABB/KUKA/Nachi by default", () => {
    expect(POSE_FORMATS.map((f) => f.label)).toEqual([
      "[X,Y,Z]mm | Ro[X,Y ,Z  ]deg - Fanuc/Motoman",
      "[X,Y,Z]mm | Rot[X,Y',Z'']deg - Stäubli/Mecademic/Denso",
      "[X,Y,Z]mm | Rot[Z,Y',X'']deg - ABB/KUKA/Nachi",
      "[X,Y,Z]mm | Rot[u,v,w] deg   - UR (deg)",
      "[X,Y,Z]mm | Rot[u,v,w] rad   - UR (rad)",
      "[X,Y,Z]mm | Quaternion[q1-q4]- ABB RAPID",
      "[X,Y,Z]mm | Rot[Z,Y',Z'']deg - Adept/Comau/Kawasaki",
      "[X,Y,Z]mm | Rot[Z,X',Z'']deg - CATIA/SolidWorks",
      "[X,Y,Z]mm | Rot[Z,Y ,X  ]deg - Epson/CRS",
    ]);
    expect(DEFAULT_POSE_FORMAT).toBe("abb");
  });

  it("shows transl(100,200,300)·rotz(30°) as 100,200,300,30,0,0 in the default format", () => {
    const m = mulAll(transl(100, 200, 300), rotz(30 * DEG));
    expect(close(poseToFormat(m, "abb"), [100, 200, 300, 30, 0, 0])).toBe(true);
    expect(close(poseToFormat(m, "fanuc"), [100, 200, 300, 0, 0, 30])).toBe(true);
    expect(close(poseToFormat(m, "staubli"), [100, 200, 300, 0, 0, 30])).toBe(true);
    expect(close(poseToFormat(m, "epson"), [100, 200, 300, 30, 0, 0])).toBe(true);
    expect(close(poseToFormat(m, "zyz"), [100, 200, 300, 30, 0, 0])).toBe(true);
    expect(close(poseToFormat(m, "zxz"), [100, 200, 300, 30, 0, 0])).toBe(true);
    expect(close(poseToFormat(m, "ur-deg"), [100, 200, 300, 0, 0, 30])).toBe(true);
    expect(close(poseToFormat(m, "ur-rad"), [100, 200, 300, 0, 0, 30 * DEG])).toBe(true);
    expect(close(poseToFormat(m, "quat"), [100, 200, 300, Math.cos(15 * DEG), 0, 0, Math.sin(15 * DEG)])).toBe(true);
  });

  it("matches each convention's composition order", () => {
    const [a, b, c] = [10, 20, 30];
    const m = (...ms: Mat[]) => mulAll(transl(1, 2, 3), ...ms);
    expect(close(poseToFormat(m(rotz(c * DEG), roty(b * DEG), rotx(a * DEG)), "fanuc"), [1, 2, 3, a, b, c])).toBe(true);
    expect(close(poseToFormat(m(rotx(a * DEG), roty(b * DEG), rotz(c * DEG)), "staubli"), [1, 2, 3, a, b, c])).toBe(true);
    expect(close(poseToFormat(m(rotz(a * DEG), roty(b * DEG), rotx(c * DEG)), "abb"), [1, 2, 3, a, b, c])).toBe(true);
    expect(close(poseToFormat(m(rotz(a * DEG), roty(b * DEG), rotz(c * DEG)), "zyz"), [1, 2, 3, a, b, c])).toBe(true);
    expect(close(poseToFormat(m(rotz(a * DEG), rotx(b * DEG), rotz(c * DEG)), "zxz"), [1, 2, 3, a, b, c])).toBe(true);
    expect(close(poseToFormat(m(rotx(c * DEG), roty(b * DEG), rotz(a * DEG)), "epson"), [1, 2, 3, a, b, c])).toBe(true);
  });

  for (const f of POSE_FORMATS) {
    it(`${f.id}: pose → values → pose is lossless, also at gimbal lock`, () => {
      for (const pose of [...samples(200), ...singular]) {
        const values = poseToFormat(pose, f.id);
        expect(values.length).toBe(3 + f.rot.length);
        expect(close(formatToPose(values, f.id), pose, 1e-9)).toBe(true);
      }
    });
  }

  it("keeps quaternions normalised with q1 ≥ 0 and rotation vectors within π", () => {
    for (const pose of [...samples(100), ...singular]) {
      const q = poseToFormat(pose, "quat").slice(3);
      expect(Math.abs(Math.hypot(...q) - 1)).toBeLessThan(1e-12);
      expect(q[0]).toBeGreaterThanOrEqual(0);
      const rv = poseToFormat(pose, "ur-rad").slice(3);
      expect(Math.hypot(...rv)).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it("parses pasted values or a 4x4 matrix (R-IM-40)", () => {
    const m = mulAll(transl(100, 200, 300), rotz(30 * DEG));
    expect(close(parsePoseText("100, 200, 300, 30, 0, 0", "abb")!, m)).toBe(true);
    expect(close(parsePoseText(m.join(" "), "abb")!, m)).toBe(true);
    expect(parsePoseText("1 2 3", "abb")).toBeNull();
  });
});
