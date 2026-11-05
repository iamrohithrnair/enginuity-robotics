// Verifies wheel and drag navigation, camera rotations, and view-pose conversions.
 
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { dragZoomStep, PRESETS, classicOp, rotateRate, viewPoseOf, w2t, wheelStep } from "@/components/viewport/navMath";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { near } from "../helpers";

const S = { ...DEFAULT_SETTINGS };
const custom = { mid: "Rotate", right: "Pan" };
const none = { shift: false, cmd: false };

describe("wheel zoom (R-IM-18)", () => {
  it("moves 1.5 % of the picked distance per degree: 22.5 % per 15° notch", () => {
    expect(wheelStep(15, 1, S)).toBeCloseTo(0.225, 9);
    expect(wheelStep(-15, 2, S)).toBeCloseTo(-0.45, 9);
  });
  it("moves 20 mm per degree when nothing is picked", () => {
    expect(wheelStep(15, null, S)).toBeCloseTo(0.3, 9);
  });
  it("clamps a step to ±5 m", () => {
    expect(wheelStep(15, 100, S)).toBe(5);
    expect(wheelStep(-15, 100, S)).toBe(-5);
  });
  it("applies the zoom speed ratio and the fixed zoom speed", () => {
    expect(wheelStep(15, 1, { ...S, Mouse3D_SpeedZoom: 2 })).toBeCloseTo(0.45, 9);
    expect(wheelStep(15, 1, { ...S, Mouse3D_ZoomSpeed: 2 })).toBeCloseTo(0.6, 9);
  });
});

describe("drag zoom and rotation (R-IM-19)", () => {
  it("zooms depth × dy × 0.005, ±5 m, or 20 mm/px without a pick", () => {
    expect(dragZoomStep(10, 2)).toBeCloseTo(0.1, 9);
    expect(dragZoomStep(10, null)).toBeCloseTo(0.2, 9);
    expect(dragZoomStep(1000, 10)).toBe(5);
  });
  it("rotates 0.004 rad/px aligned (turntable) or 0.2°/px free (trackball)", () => {
    expect(rotateRate(true, 1)).toBe(0.004);
    expect(rotateRate(false, 1)).toBeCloseTo((0.2 * Math.PI) / 180, 12);
    expect(rotateRate(true, 2)).toBe(0.008);
  });
});

describe("mouse operations of the navigation types (R-IM-15)", () => {
  it("Classic (0): left = View menu operation, ⇧ zoom, ⌘⇧ rotate; right rotates; middle pans", () => {
    expect(classicOp(0, "left", none, "select", custom)).toBe("select");
    expect(classicOp(0, "left", none, "pan", custom)).toBe("pan");
    expect(classicOp(0, "left", { shift: true, cmd: false }, "select", custom)).toBe("zoom");
    expect(classicOp(0, "left", { shift: true, cmd: true }, "select", custom)).toBe("rotate");
    expect(classicOp(0, "right", none, "select", custom)).toBe("rotate");
    expect(classicOp(0, "middle", none, "select", custom)).toBe("pan");
  });
  it("No Selection still picks like Select", () => {
    expect(classicOp(0, "left", none, "none", custom)).toBe("select");
  });
  it("other CAD styles", () => {
    expect(classicOp(1, "right", none, "select", custom)).toBe("pan");  
    expect(classicOp(1, "middle", none, "select", custom)).toBe("rotate");
    expect(classicOp(2, "right", { shift: true, cmd: false }, "select", custom)).toBe("pan");  
    expect(classicOp(2, "right", { shift: false, cmd: true }, "select", custom)).toBe("zoom");
    expect(classicOp(3, "left", none, "select", custom)).toBe("rotate");  
    expect(classicOp(5, "right", none, "select", custom)).toBe("pan");  
    expect(classicOp(6, "middle", { shift: true, cmd: false }, "select", custom)).toBe("zoom");  
    expect(classicOp(7, "right", none, "select", { mid: "Rotate", right: "Zoom" })).toBe("zoom");  
    expect(classicOp(7, "middle", none, "select", { mid: "Pan", right: "Zoom" })).toBe("pan");
  });
});

describe("ViewPose (G_ViewPose / EVENT_3DVIEW_MOVED)", () => {
  it("rows are the camera axes in station coordinates and t = −R·p", () => {
    const { z, y } = PRESETS.iso;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.005, 200);
    cam.position.copy(w2t(z).normalize().multiplyScalar(2));  
    cam.up.copy(w2t(y));
    cam.lookAt(0, 0, 0);
    const vp = viewPoseOf(cam);
    const n = Math.hypot(...z);
    for (let i = 0; i < 3; i++) {
      expect(near(vp[8 + i], z[i] / n, 1e-3)).toBe(true);
      expect(near(vp[4 + i], y[i], 2e-3)).toBe(true);
    }
    expect(near(vp[3], 0, 1e-6) && near(vp[7], 0, 1e-6)).toBe(true);
    expect(near(vp[11], -2000, 1e-3)).toBe(true);
    expect(vp.slice(12)).toEqual([0, 0, 0, 1]);
  });

  it("the top view looks down with station −X up the screen", () => {
    const { z, y } = PRESETS.top;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.005, 200);
    cam.position.copy(w2t(z).multiplyScalar(3));
    cam.up.copy(w2t(y));
    cam.lookAt(0, 0, 0);
    const vp = viewPoseOf(cam);
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
    expect([vp[8], vp[9], vp[10]].map(r6)).toEqual([0, 0, 1]);
    expect([vp[4], vp[5], vp[6]].map(r6)).toEqual([-1, 0, 0]);
  });
});
