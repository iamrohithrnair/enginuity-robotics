// Verifies robot workspace envelopes, frame visibility, and parameter exports.
 
 
 
 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findAction } from "@/engine/actions";
import { kinematicsTable, robotShowFrames } from "@/engine/commands/robot-display";
import { fk, linkFrames } from "@/engine/kinematics";
import { layoutText, parseLayout } from "@/engine/layout";
import { DEG, eye, mul, rotx, rotz, transl, type Mat } from "@/engine/math";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import { angleDelta, treeSizes, zoomTree } from "@/engine/treeSize";
import { ENVELOPE_CONTOUR, ENVELOPE_J1_STEPS, envelopeIndices, j23Boundary, resampleClosed, workspaceEnvelope } from "@/engine/workspaceEnvelope";
import { engine, ROOT } from "../helpers";

const id = (r: unknown) => (r as { id: string }).id;

async function withRobot() {
  const e = await engine();
  const robot = id(await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" }));
  return { e, robot, m: () => e.ws.items[robot].robot!.model };
}

describe("workspace envelope (FUN_1007065ec: 3 × 61 × 73 grid)", () => {
  it("sweeps joint 1 in 61 steps and the J2/J3 boundary in 73 points, joints 4–6 at zero", async () => {
    const { m } = await withRobot();
    const model = m();
    const env = workspaceEnvelope(model, 2, eye(), eye());
    expect([env.rows, env.cols]).toEqual([ENVELOPE_J1_STEPS, ENVELOPE_CONTOUR]);
    expect([ENVELOPE_J1_STEPS, ENVELOPE_CONTOUR]).toEqual([61, 73]);
    const [lo, hi] = [model.userLower, model.userUpper];
     
    const span = Math.min(360, hi[0] - lo[0]);
    const q = [(lo[0] + hi[0]) / 2 - span / 2, lo[1], lo[2], 0, 0, 0];
    const f = fk(model, q);
    expect(Array.from(env.points.slice(0, 3))).toEqual([f[3], f[7], f[11]].map((v) => Math.fround(v)));
    expect(envelopeIndices(env).length).toBe((61 - 1) * (73 - 1) * 6);
  });

  it("wrist centre mode uses the frame after joint 5; tool mode adds the tool", async () => {
    const { m } = await withRobot();
    const model = m();
    const tool = transl(0, 0, 150);
    const wc = workspaceEnvelope(model, 1, eye(), eye());
    const tl = workspaceEnvelope(model, 3, eye(), tool);
    const q = [workspaceEnvelope(model, 2, eye(), eye()) && (model.userLower[0] + model.userUpper[0]) / 2 - Math.min(360, model.userUpper[0] - model.userLower[0]) / 2, model.userLower[1], model.userLower[2], 0, 0, 0];
    const w = linkFrames(model, q)[5];
    expect(Array.from(wc.points.slice(0, 3))).toEqual([w[3], w[7], w[11]].map((v) => Math.fround(v)));
    const t = mul(fk(model, q), tool);
    expect(Array.from(tl.points.slice(0, 3))).toEqual([t[3], t[7], t[11]].map((v) => Math.fround(v)));
  });

  it("the boundary is the J2/J3 limit rectangle, or the limit polygon of coupled robots", () => {
    const rect = j23Boundary({ userLower: [-180, -100, -50], userUpper: [180, 100, 70], polygon: [] } as never);
    expect(rect).toHaveLength(73);
    expect(rect[0]).toEqual([-100, -50]);
    expect(rect[72]).toEqual([-100, -50]);
    expect(rect).toContainEqual([100, -50]);
    const poly = j23Boundary({ userLower: [], userUpper: [], polygon: [[-100, 313], [-100, 0], [145, -245], [145, 68], [-100, 313]] } as never);
    expect(poly[0]).toEqual([-100, 313]);
    expect(resampleClosed([[0, 0], [10, 0]], 3)).toEqual([[0, 0], [10, 0], [0, 0]]);
  });

  it("robot.showWorkspace keeps the mode the 3D view draws (ShowWorkspace 0…3)", async () => {
    const { e, robot } = await withRobot();
    expect((await e.run("robot.showWorkspace", { robot, mode: 1 })).label).toBe("Show for wrist center");
    expect(e.ws.items[robot].params?.ShowWorkspace).toBe("1");
  });
});

describe("Show Frames (FormRobot FUN_1000518fc / FUN_100051690)", () => {
  it("defaults: Tool Frame, Ref. Frame and Robot Flange on, link frames off", async () => {
    const { e, robot } = await withRobot();
    expect(robotShowFrames(e.ws.items[robot])).toEqual({ links: [], tool: true, ref: true, flange: true });
  });

  it("checks link frames Base (0)…n and All/None checks or clears every box", async () => {
    const { e, robot } = await withRobot();
    expect(await e.run("robot.showFrames", { robot, links: [3, 0, 3], flange: false })).toMatchObject({ links: [0, 3], tool: true, ref: true, flange: false });
    expect(await e.run("robot.showFrames", { robot, all: true })).toMatchObject({ links: [0, 1, 2, 3, 4, 5, 6], tool: true, ref: true, flange: true });
    expect(await e.run("robot.showFrames", { robot, all: false })).toMatchObject({ links: [], tool: false, ref: false, flange: false });
    expect(e.ws.items[robot].params).toMatchObject({ ShowLinkFrames: "", ShowToolFrame: "0", ShowRefFrame: "0", ShowFlange: "0" });
  });
});

describe("Robot Parameters (FUN_10003de40, D-28 FUN_10003d354, D-32 DialogExportDH)", () => {
  it("Joint Senses: values split on ; , tab space or new line; -1 inverts; limits follow", async () => {
    const { e, robot, m } = await withRobot();
    const before = m().joints[0];
    const r = await e.run("robot.setSenses", { robot, senses: "-1;1,1\t1 1\n1" });
    expect((r as unknown as { senses: number[] }).senses).toEqual([-1, 1, 1, 1, 1, 1, 0]);
    expect(m().map[0]).toBe(-1);
    expect([m().joints[0].lower, m().joints[0].upper]).toEqual([-before.upper, -before.lower]);
    expect((await e.tryRun("robot.setSenses", { robot, senses: "1 1" })).error).toBe("Provide 6 values: Set the robot axis senses, in order: +1 (default) or -1 (inverted).");
  });

  it("a 7th value couples axes 2 and 3 and builds the J2–J3 polygon from the current limits; 0 clears it", async () => {
    const { e, robot, m } = await withRobot();
    const [l2, h2, l3, h3] = [m().userLower[1], m().userUpper[1], m().userLower[2], m().userUpper[2]];
    await e.run("robot.setSenses", { robot, senses: [1, 1, 1, 1, 1, 1, -1] });
    expect(m().map[2 * 6 + 1]).toBe(-1);
    expect(m().polygon).toEqual([[l2, l3], [h2, l3], [h2, h3], [l2, h3], [l2, l3]]);
    await e.run("robot.setSenses", { robot, senses: [1, 1, 1, 1, 1, 1, 0] });
    expect(m().polygon).toEqual([]);
  });

  it("Export Table: DHM rows, and DH rows that rebuild the same kinematics", async () => {
    const { e, robot, m } = await withRobot();
    const r = (await e.run("robot.exportKinematics", { robot })) as unknown as { rows: number[][]; text: string; kinematics: string };
    expect(r.kinematics).toBe("Nominal");
    expect(r.rows).toEqual(m().joints.map((j) => [j.alpha / DEG, j.a, j.theta / DEG, j.d]));
    expect(r.text.split("\n")).toHaveLength(6);
     
    const dhm = kinematicsTable(m(), "DHM");
    const dh = kinematicsTable(m(), "DH");
    const q = [10, -20, 30, 40, -50, 60];
    let a: Mat = eye();
    dhm.forEach(([al, aa, th, d], i) => (a = mul(a, mul(mul(rotx(al * DEG), transl(aa, 0, 0)), mul(rotz((th + q[i]) * DEG), transl(0, 0, d))))));
    let b: Mat = mul(rotx(dhm[0][0] * DEG), transl(dhm[0][1], 0, 0));
    dh.forEach(([d, th, aa, al], i) => (b = mul(b, mul(mul(rotz((th + q[i]) * DEG), transl(0, 0, d)), mul(transl(aa, 0, 0), rotx(al * DEG))))));
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 6));
  });

  it("paste data replaces the DHM table and checks the size", async () => {
    const { e, robot, m } = await withRobot();
    const text = (await e.run("robot.exportKinematics", { robot })).text as string;
    const edited = text.replace(/^(\S+)\t(\S+)/, "$1\t5");
    await e.run("robot.pasteKinematics", { robot, text: edited });
    expect(m().joints[0].a).toBe(5);
    expect((await e.tryRun("robot.pasteKinematics", { robot, text: "1 2 3" })).error).toBe("Invalid size: provide a 6x4 matrix of values");
  });
});

describe("station tree size (R-SCREEN-1, B-KEY-10)", () => {
  it("width follows TreeSizePercent when TreeSizePercentSet is on", () => {
    expect(treeSizes({}).width).toBe("clamp(250px, 17vw, 340px)");
    expect(treeSizes({ TreeSizePercentSet: true, TreeSizePercent: 20 }).width).toBe("max(180px, 20vw)");
    expect([DEFAULT_SETTINGS.TreeSizePercentSet, DEFAULT_SETTINGS.TreeSizePercent]).toEqual([false, 20]);
  });

  it("⌘/Ctrl + wheel changes text and icons by angleDelta/80 per step", () => {
    expect(angleDelta(-100, 0)).toBe(120);
    expect(angleDelta(3, 1)).toBe(-120);
    expect(zoomTree({}, 120)).toEqual({ TreeTextSize: 14, TreeIconSize: 16.5 });
    expect(zoomTree({ TreeTextSize: 8, TreeIconSize: 10 }, -240)).toEqual({ TreeTextSize: 8, TreeIconSize: 10 });
    expect(treeSizes({ TreeTextSize: 20, TreeIconSize: 30 }).row).toBe(44);
  });
});

describe("window layout (R-PERSIST-6)", () => {
  it("round-trips the saved layout and ignores invalid text", () => {
    const l = { toolbar: "Complete", treeInside: false, treeVisible: true, rightPanel: "chat" as const };
    expect(parseLayout(layoutText(l))).toEqual(l);
    expect(parseLayout("")).toBeNull();
    expect(parseLayout('{"toolbar":"Nope","treeInside":true,"treeVisible":true,"rightPanel":"chat"}')).toBeNull();
    expect(DEFAULT_SETTINGS.RC_LAYOUT).toBe("");
  });
});

describe("camera saved with the station (R-PERSIST-9)", () => {
  it("Save writes the view pose on the station; opening the file restores it in the views", async () => {
    const e = await engine();
    const saved: unknown[] = [];
    const pose = [1, 0, 0, -10, 0, 1, 0, -20, 0, 0, 1, -3000, 0, 0, 0, 1];
    e.services.view = { clients: () => 1, screenshot: async () => ({ path: "", width: 0, height: 0 }), pose: () => pose };
    e.services.files = { saveStation: async (_n, d) => (saved.push(d), "/st/a.rcstation.json"), loadStation: async () => saved[0], listStations: async () => [] };
    await e.run("station.save", {});
    const data = saved[0] as { items: { params?: Record<string, string> }[] };
    expect(data.items[0].params?.ViewPose).toBe(pose.join(","));
    expect(e.ws.items[e.ws.activeStation!].params?.ViewPose).toBeUndefined();
    await e.run("station.open", { path: "/st/a.rcstation.json" });
    await new Promise((r) => setTimeout(r, 700));
    expect(e.events.some((ev) => ev.type === "view" && ev.action === "pose" && JSON.stringify(ev.pose) === JSON.stringify(pose))).toBe(true);
  });
});

describe("Options dialog fields (globalform retranslateUi)", () => {
  const src = readFileSync(path.join(ROOT, "src", "components", "SettingsDialog.tsx"), "utf8");
  it("has the motion keys with RoboDK's labels and choices", () => {
    expect(src).toContain('num("ToleranceSmoothMove", "Angle tolerance for smooth movements (deg)")');
    expect(src).toContain('label: "Move time calculation (linear vs. joint speed)"');
    for (const l of ["Strictest constraint", "Linear constrained", "Joint constrained", "Linear for MoveL, Joint for MoveJ", "Shortest time"]) expect(src).toContain(`"${l}"`);
    expect(src).toContain('label: "Action when importing a STEP file (object vs. assembly)"');
    for (const l of ["Ask", "Load as one object", "Load as assembly"]) expect(src).toContain(`"${l}"`);
    expect(src).toContain('bool("TreeSizePercentSet", "Set tree size as a % of the screen")');
  });

  it("every setting with an effect in Enginuity has a field; the rest are API-only or internal", () => {
    const inDialog = new Set([...src.matchAll(/(?:num|bool)\("([A-Za-z0-9_]+)"/g), ...src.matchAll(/key: "([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
     
     
    const noField = new Set([
      "Mouse3D_ClickMid", "Mouse3D_ClickRight", "Shortcuts", "RC_NAV_STYLE", "ShowTextObjectOnly", "RC_API_PORT", "PathWebLib", "WebLibExternal2",
      "RC_MACHINING_DEFAULTS", "RC_LAYOUT", "ProgMoveJType", "ProgMoveLType", "ProgMoveCType", "ProgInlineSubprogs", "Default_GhostRobot_MS",
      "PARAM_MM_STEP_COLLISION", "PARAM_DEG_STEP_COLLISION", "POINT_STYLE", "SizePoints", "TexturesShow", "ShowToolbarText", "MAX_DECIMALS_XYZ", "MAX_DECIMALS_WPR",
      "Generate_Subprogs", "Hide_ProgramGen_Popup", "MoveL_Split_Deg", "MoveJ_Split_Deg", "MoveC_Split_Deg", "MoveC_Split_MM", "Collision_Collide_OneStop", "AUTO_FIT_NEW", "ShowRef_NewReferences",
    ]);
    const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => !inDialog.has(k) && !noField.has(k));
    expect(missing).toEqual([]);
  });
});

describe("actions (action registry)", () => {
  it("Export Simulation, Make a Demo Station and Draw Curve on Part open their views; Sensor View does nothing", () => {
    expect(findAction("actionExport_3D_Simulation")).toMatchObject({ ui: true, shortcut: "Ctrl+E" });
    expect(findAction("actionExport_3D_Simulation")!.unavailable).toBeUndefined();
    expect(findAction("actionMake_demo_station")).toMatchObject({ ui: true });
    expect(findAction("actionDraw_curve_on_part")).toMatchObject({ ui: true });
    expect(findAction("actionSensor_View")).toMatchObject({ noop: true });
  });

  it("TriggerAction of Sensor View answers OK and changes nothing", async () => {
    const e = await engine();
    const rev = e.ws.rev;
    expect(await e.run("view.action", { name: "actionSensor_View" })).toMatchObject({ reply: "OK" });
    expect(e.ws.rev).toBe(rev);
  });
});
