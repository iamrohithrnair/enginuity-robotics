 
 
 
 
import { describe, expect, it } from "vitest";
import { buildIntermediate, generationSettings } from "@/engine/commands/generate";
import { fmtF6, headerExtras, isPostParam, ownAxesTypes, passesPulses, postParams } from "@/engine/postHeader";
import { postFileName, postPick, storedPostName } from "@/engine/posts";
import type { PostService } from "@/engine/posts";
import { engine, hasLibraryFile } from "../helpers";

const id = (r: unknown) => (r as { id: string }).id;
const settings = (extra: Record<string, number> = {}) => generationSettings({ ...extra });
const ctorLine = (text: string) => text.split("\r\n").find((l) => l.startsWith("r = RobotPost("))!;

async function load(file: string) {
  const e = await engine();
  await e.run("library.load", { file });
  const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
  const prog = id(await e.run("program.add", { name: "Prog1", robot: robot.id }));
  await e.run("program.addMoveJ", { program: prog, joints: robot.robot!.joints.slice() });
  return { e, robot, prog };
}

describe("WP-F2 number and pose formats of the optional arguments", () => {
  it("QString::number(v,'f',6) (FUN_10048310c, FUN_1005a3c2c)", () => {
    expect(fmtF6(1024)).toBe("1024.000000");
    expect(fmtF6(1213.63)).toBe("1213.630000");
    expect(fmtF6(-1149.155556)).toBe("-1149.155556");
    expect(fmtF6(-1e-9)).toBe("-0.000000");
    expect(fmtF6(0)).toBe("0.000000");
  });

  it("post_* parameters: name starts with post_ (any case) and is [a-zA-Z0-9_]+ (FUN_1000de1a4)", () => {
    expect(isPostParam("post_mode")).toBe(true);
    expect(isPostParam("POST_Mode2")).toBe(true);
    expect(isPostParam("post-mode")).toBe(false);
    expect(isPostParam("mode")).toBe(false);
    const pp = postParams([
      ["post_ip", new TextEncoder().encode("10.0.0.5")],
      ["other", new Uint8Array([1])],
      ["post_raw", new Uint8Array([0, 255])],
    ]);
    expect(pp.pre).toEqual(["import base64", "post_ip = base64.b64decode(b'MTAuMC4wLjU=')", "post_raw = base64.b64decode(b'AP8=')"]);
    expect(pp.args).toBe(", post_ip=post_ip, post_raw=post_raw");
    expect(postParams([["x", new Uint8Array([1])]])).toEqual({ pre: [], args: "" });
  });
});

describe("WP-F2 pulses_x_deg (FUN_100482ae0, FUN_100482e9c)", () => {
  const rd = (header?: number[]) => ({ model: { nq: 6, joints: [] }, header }) as never;
  it("robots named Motoman / Yaskawa (anywhere) or GSK / Epson / CLOOS (at the start), ignoring case", () => {
    expect(passesPulses("Yaskawa Motoman GP8", rd())).toBe(true);
    expect(passesPulses("my motoman cell", rd())).toBe(true);
    expect(passesPulses("GSK RB03A1", rd())).toBe(true);
    expect(passesPulses("epson C4", rd())).toBe(true);
    expect(passesPulses("CLOOS Romat 310", rd())).toBe(true);
    expect(passesPulses("Robot Epson", rd())).toBe(false);
    expect(passesPulses("ABB IRB 120", rd())).toBe(false);
  });
  it("or the legacy Motoman post id (header cell (3,2) within 0.5 of 3.4)", () => {
    const h = new Array(4000).fill(0);
    h[2] = 20;
    h[3 * 20 + 2] = 3;
    expect(passesPulses("Robot", rd(h))).toBe(true);
    h[3 * 20 + 2] = 500;
    expect(passesPulses("Robot", rd(h))).toBe(false);
  });
});

describe("WP-F2 post picker (FUN_10042c810, DialogPickItem)", () => {
   
  const posts = ["Post_Generic", "ABB_RAPID_IRC5", "KUKA_KRC4", "abb_custom"].map((name) => ({ name, path: `/posts/${name}.py` }));
  it("title, label, entries by name ignoring case with '_' shown as ' ', tooltips", () => {
    const pick = postPick("KUKA KR 6", "KUKA_KRC4", posts);
    expect(pick.title).toBe("Select one item");
    expect(pick.label).toBe("Select a Post Processor for the robot KUKA KR 6");
    expect(pick.items.map((i) => i.text)).toEqual(["abb custom", "ABB RAPID IRC5", "KUKA KRC4", "Post Generic"]);
    expect(pick.items[1].tooltip).toBe("Post processor file: /posts/ABB_RAPID_IRC5.py");
    expect(pick.selected).toBe(2);
  });
  it("nothing preselected when the robot's post is missing or empty", () => {
    expect(postPick("R", "Techman", posts).selected).toBe(-1);
    expect(postPick("R", "", posts).selected).toBe(-1);
  });
  it("file names RoboDK rejects get a warning", () => {
    const pick = postPick("R", "", [{ name: "My-Post", path: "x" }, { name: "2nd", path: "y" }]);
    expect(pick.items.find((i) => i.name === "My-Post")!.tooltip).toBe("The post processor file name should only have alphanumeric characters or underscore characters");
    expect(pick.items.find((i) => i.name === "2nd")!.tooltip).toBe("The post processor file name should not start with a number");
  });
  it("stored names: ' ' → '_' and .py removed (FUN_10048d24c); generation names: specials → '_' (FUN_1000e4c30)", () => {
    expect(storedPostName("KUKA KRC4.py")).toBe("KUKA_KRC4");
    expect(postFileName("My-Post.v2")).toBe("My_Post_v2");
    expect(postFileName("Fanuc_R30i")).toBe("Fanuc_R30i");
  });
});

describe.skipIf(!hasLibraryFile("robots", "Epson-G1-171S.robot"))("WP-F2 axes_type of the robot's own axes (FUN_1004828cc)", () => {
  it("a SCARA's linear J3 is 'L' (never 'T', which marks synchronized linear axes)", async () => {
    const { e, robot, prog } = await load("Epson-G1-171S.robot");
    expect(ownAxesTypes(robot.robot!)).toEqual(["'R'", "'R'", "'L'", "'R'"]);
    const ctor = ctorLine(buildIntermediate(e.ws, prog, { settings: settings() }).text);
    expect(ctor).toContain("axes_type=['R','R','L','R']");
     
    expect(ctor).toContain(", pulses_x_deg=[0.000000,0.000000,0.000000,0.000000])");
  });
});

describe.skipIf(!hasLibraryFile("robots", "Yaskawa-Motoman-GP8.robot"))("WP-F2 optional RobotPost arguments in RoboDK's order", () => {
  it("pulses_x_deg from header column 49, then lines_x_prog, then post_* parameters", async () => {
    const { e, robot, prog } = await load("Yaskawa-Motoman-GP8.robot");
    const h = robot.robot!.header!;
    const want = Array.from({ length: 6 }, (_, j) => fmtF6(h[49 * 20 + j]));
    expect(want[0]).toBe("1024.000000");
    const text = buildIntermediate(e.ws, prog, { settings: settings({ ProgMaxLines: 5 }), postParams: [["post_cell", new TextEncoder().encode("A")]] }).text;
    const ctor = ctorLine(text);
    expect(ctor.endsWith(`, pulses_x_deg=[${want.join(",")}], lines_x_prog=5, post_cell=post_cell)`)).toBe(true);
    const lines = text.split("\r\n");
    const at = lines.indexOf(ctor);
    expect(lines.slice(at - 3, at)).toEqual(["print('Total instructions: 1')", "import base64", "post_cell = base64.b64decode(b'QQ==')"]);
  });

  it("a robot not named for pulses passes none", async () => {
    const { e, robot } = await load("Yaskawa-Motoman-GP8.robot");
    await e.run("item.rename", { item: robot.id, name: "Welder" });
    const warnings: string[] = [];
    expect(headerExtras(e.ws, e.ws.items[robot.id], { maxLines: -1, warnings }).args).toBe("");
  });
});

describe.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("WP-F2 a missing post at generation (FUN_1005a47f0)", () => {
   
  function fakePosts(answer: (req: { label: string; items: { name: string }[]; selected: number }) => string | null) {
    const asked: { label: string; items: { name: string }[]; selected: number }[] = [];
    const svc: PostService = {
      folder: () => "/user/posts",
      list: async () => ["ABB_RAPID_IRC5", "KUKA_KRC4", "Post_Generic"].map((name) => ({ name, kind: "builtin" as const, base: null, author: null, needsApproval: false, robots: 0 })),
      get: async () => {
        throw new Error("unused");
      },
      template: async () => "",
      save: async () => {
        throw new Error("unused");
      },
      remove: () => {},
      approve: () => {},
      pick: async (req) => {
        asked.push(req);
        return answer(req);
      },
    };
    return { svc, asked };
  }

  it("from the window: the picker opens, the chosen post is stored on the robot and used", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
    await e.run("robot.setPostProcessor", { robot: robot.id, post: "Techman" });
    const prog = id(await e.run("program.add", { name: "Prog1", robot: robot.id }));
    await e.run("program.addMoveJ", { program: prog, joints: [0, -10, 20, 0, 30, 0] });
    const { svc, asked } = fakePosts((req) => req.items[1].name);
    e.services.posts = svc;
    let used = "";
    e.services.post = async (req) => {
      used = req.post;
      return { ok: true, files: [], log: "" };
    };
    await e.run("program.generate", { program: prog }, "ui");
    expect(asked).toHaveLength(1);
    expect(asked[0].label).toBe(`Select a Post Processor for the robot ${robot.name}`);
    expect(asked[0].selected).toBe(-1);
    expect(used).toBe("KUKA_KRC4");
    expect(e.ws.items[robot.id].robot!.postProcessor).toBe("KUKA_KRC4");
  });

  it("Cancel keeps the robot's post; the agent gets no window and is told about post.choose", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
    await e.run("robot.setPostProcessor", { robot: robot.id, post: "" });
    const prog = id(await e.run("program.add", { name: "Prog1", robot: robot.id }));
    await e.run("program.addMoveJ", { program: prog, joints: [0, -10, 20, 0, 30, 0] });
    const { svc, asked } = fakePosts(() => null);
    e.services.posts = svc;
    e.services.post = async () => ({ ok: true, files: [], log: "" });
    await expect(e.run("program.generate", { program: prog }, "ui")).rejects.toThrow(/Select a Post Processor for the robot/);
    expect(asked).toHaveLength(1);
    await expect(e.run("program.generate", { program: prog }, "agent")).rejects.toThrow(/post\.choose/);
    expect(asked).toHaveLength(1);
    expect(e.ws.items[robot.id].robot!.postProcessor).toBe("");
     
    const list = (await e.run("post.pickList", { robot: robot.id }, "agent")) as unknown as { items: { text: string }[] };
    expect(list.items.map((i) => i.text)).toEqual(["ABB RAPID IRC5", "KUKA KRC4", "Post Generic"]);
    await e.run("post.choose", { robot: robot.id, post: "KUKA KRC4" }, "agent");
    expect(e.ws.items[robot.id].robot!.postProcessor).toBe("KUKA_KRC4");
    await expect(e.run("post.choose", { robot: robot.id, post: "Techman" }, "agent")).rejects.toThrow(/not available/);
  });

  it("with no window connected the picker is not shown (answered like Cancel)", async () => {
    const e = await engine();
    await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
    const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
    await e.run("robot.setPostProcessor", { robot: robot.id, post: "Leantec" });
    const prog = id(await e.run("program.add", { name: "Prog1", robot: robot.id }));
    await e.run("program.addMoveJ", { program: prog, joints: [0, -10, 20, 0, 30, 0] });
    const { svc, asked } = fakePosts(() => "KUKA_KRC4");
    e.services.posts = svc;
    e.services.view = { clients: () => 0, screenshot: async () => ({ path: "", width: 0, height: 0 }) };
    let used = "";
    e.services.post = async (req) => {
      used = req.post;
      return { ok: false, files: [], log: "", error: "not found" };
    };
    await expect(e.run("program.generate", { program: prog }, "ui")).rejects.toThrow();
    expect(asked).toHaveLength(0);
    expect(used).toBe("Leantec");
  });

});

describe("WP-F2 pose_turntable / pose_rail of a synchronized robot (FUN_100486230, FUN_100486654)", () => {
  const RY90 = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
  const RYM90 = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
  it("turntable base w.r.t. the rail's base, robot w.r.t. the rail carriage, both after robot_ptr", async () => {
    const e = await engine();
    const rail = id(await e.run("mechanism.build", { type: 4, name: "Rail", lower: [-3000], upper: [3000], base: RY90, tool: RYM90 }));
    const arm = id(await e.run("mechanism.build", { type: 7, name: "Arm", params: [400, 180, 0, 600, 120, 620, 115], parent: rail }));
    const table = id(await e.run("mechanism.build", { type: 1, name: "Table", lower: [-360], upper: [360] }));
     
    await e.run("item.setPose", { item: e.ws.items[rail].parent!, pose: [1, 0, 0, 0, 0, 1, 0, 500, 0, 0, 1, 0, 0, 0, 0, 1], relativeTo: "station" });
    await e.run("item.setPose", { item: e.ws.items[table].parent!, pose: [1, 0, 0, 1100, 0, 1, 0, -900, 0, 0, 1, 0, 0, 0, 0, 1], relativeTo: "station" });
    await e.run("robot.syncAxes", { robot: arm, axes: [rail, table] });
    await e.run("robot.setJoints", { robot: rail, joints: [700] });
    const prog = id(await e.run("program.add", { name: "P", robot: arm }));
    await e.run("program.addMoveJ", { program: prog, joints: [0, -10, 20, 0, 30, 0] });
    const ctor = ctorLine(buildIntermediate(e.ws, prog, { settings: settings() }).text);
    expect(ctor).toContain("axes_type=['R','R','R','R','R','R','T','J']");
    expect(ctor).toMatch(/robot_ptr=\d+, pose_turntable=p\(1100\.000000,-1400\.000000,0\.000000,0\.000000,-?0\.000000,0\.000000\), pose_rail=p\(0\.000000,0\.000000,0\.000000,0\.000000,-?0\.000000,0\.000000\)\)$/);
     
    await e.run("robot.syncAxes", { robot: arm, axes: [] });
    expect(ctorLine(buildIntermediate(e.ws, prog, { settings: settings() }).text)).not.toContain("pose_");
  });
});
