// Verifies post-processor discovery, customization, approval gating, and program generation.
 
 
 
 
 
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { allCommands } from "@/engine/registry";
import { engine } from "../helpers";

let mod: typeof import("@/server/post");
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "rc-wpf-posts-"));
  process.env.ROBOCRAFT_DATA_DIR = dir;
  mod = await import("@/server/post");
});

const id = (r: unknown) => (r as { id: string }).id;
type Gen = { files: { name: string; content: string }[] };

async function station() {
  const e = await engine();
  e.services.post = mod.generateProgram;
  e.services.posts = mod.createPostService();
  await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" });
  const robot = Object.values(e.ws.items).find((i) => i.type === "robot")!;
  const prog = id(await e.run("program.add", { name: "Prog1", robot: robot.id }));
  await e.run("program.addMoveJ", { program: prog, joints: [0, -10, 20, 0, 30, 0] });
  return { e, robot, prog };
}

describe("B-PROG-28 post processors", () => {
  it("post.list returns the built-in posts by controller post name with their library robot counts", async () => {
    const { e } = await station();
    const r = (await e.run("post.list", {}, "agent")) as unknown as { folder: string; posts: { name: string; kind: string; robots: number }[]; unavailable: { name: string }[] };
    expect(r.folder).toBe(path.join(dir, "posts", "user"));
    const byName = Object.fromEntries(r.posts.map((p) => [p.name, p]));
    for (const n of ["ABB_RAPID_IRC5", "KUKA_KRC2", "Fanuc_RJ3", "Motoman", "Kawasaki", "Post_Generic", "Universal_Robots", "Staubli_VAL3", "Precise"]) expect(byName[n]?.kind).toBe("builtin");
    expect(byName.Post_Generic.robots).toBe(144);
     
    for (const n of ["Universal_Robots_URP", "Techman", "Omron", "AUBO", "Hans", "Kassow", "KUKA_KRC5", "Denso_RC9"]) expect(byName[n]?.kind).toBe("builtin");
    expect(byName.Techman.robots).toBe(30);
    expect(r.unavailable.map((u) => u.name)).toContain("Leantec");
    expect(r.unavailable.map((u) => u.name)).not.toContain("Techman");
    expect(r.unavailable.map((u) => u.name)).not.toContain("Kawasaki");
  });

  it("post.get shows a built-in post's code and customizable variables", async () => {
    const { e } = await station();
    const r = (await e.run("post.get", { name: "Kawasaki" })) as unknown as { kind: string; file: string; source: string; variables: Record<string, unknown> };
    expect(r.kind).toBe("builtin");
    expect(r.file).toBe("kawasaki.py");
    expect(r.source).toContain("class Kawasaki(RobotPost):");
    expect(r.variables.PROG_EXT).toBe("pg");
  });

  it("a post customized from a base post is saved in data/posts/user and generates programs", async () => {
    const { e, prog } = await station();
    const saved = (await e.run("post.save", { name: "MyKawasaki", base: "Kawasaki" }, "ui")) as unknown as { file: string; needsApproval: boolean; base: string };
    expect(saved.file).toBe(path.join(dir, "posts", "user", "MyKawasaki.py"));
    expect(saved.needsApproval).toBe(false);
    expect(saved.base).toBe("Kawasaki");
    const src = readFileSync(saved.file, "utf8");
    expect(src).toContain("from Kawasaki import RobotPost as BasePost");
    expect(src).toContain("class RobotPost(BasePost):");
    await e.run("post.save", { name: "MyKawasaki", source: src.replace("PROG_EXT = 'pg'", "PROG_EXT = 'as'") }, "ui");
    const gen = (await e.run("program.generate", { program: prog, post: "MyKawasaki" })) as unknown as Gen;
    expect(gen.files.map((f) => f.name)).toEqual(["Prog1.as"]);
    expect(gen.files[0].content).toContain(".PROGRAM Prog1()");
    const listed = (await e.run("post.list", {})) as unknown as { posts: { name: string; kind: string; base: string }[] };
    expect(listed.posts.find((p) => p.name === "MyKawasaki")).toMatchObject({ kind: "user", base: "Kawasaki" });
  });

  it("a post written by the Copilot does not run until the user approves that exact code", async () => {
    const { e, prog } = await station();
    const src = (await mod.createPostService().template("AgentPost", "Kawasaki")).replace("PROG_EXT = 'pg'", "PROG_EXT = 'ag'");
    const saved = (await e.run("post.save", { name: "AgentPost", source: src }, "agent")) as unknown as { needsApproval: boolean };
    expect(saved.needsApproval).toBe(true);
    expect(e.events.some((x) => x.type === "post-confirm" && x.name === "AgentPost")).toBe(true);
    const refused = await e.tryRun("program.generate", { program: prog, post: "AgentPost" });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("was written by the Copilot");
    const info = (await e.run("post.get", { name: "AgentPost" })) as unknown as { hash: string; author: string; needsApproval: boolean };
    expect(info).toMatchObject({ author: "agent", needsApproval: true });
     
    expect((await e.tryRun("post.approve", { name: "AgentPost", hash: info.hash }, "agent")).error).toContain("Only the user can approve");
    expect((await e.tryRun("post.approve", { name: "AgentPost", hash: info.hash }, "api")).ok).toBe(false);
    expect((await e.tryRun("post.approve", { name: "AgentPost", hash: "0".repeat(64) }, "ui")).error).toContain("changed since it was shown");
    await e.run("post.approve", { name: "AgentPost", hash: info.hash }, "ui");
    const gen = (await e.run("program.generate", { program: prog, post: "AgentPost" })) as unknown as Gen;
    expect(gen.files.map((f) => f.name)).toEqual(["Prog1.ag"]);
     
    await e.run("post.save", { name: "AgentPost", source: src + "\n# changed\n" }, "agent");
    expect((await e.tryRun("program.generate", { program: prog, post: "AgentPost" })).ok).toBe(false);
     
    writeFileSync(path.join(dir, "posts", "user", "AgentPost.py"), src);
    expect((await e.tryRun("program.generate", { program: prog, post: "AgentPost" })).ok).toBe(false);
    expect(allCommands().find((c) => c.name === "post.approve")?.internal).toBe(true);
  });

  it("names, built-in posts and invalid code are refused like RoboDK's naming rule; delete removes user posts only", async () => {
    const { e } = await station();
    expect((await e.tryRun("post.save", { name: "My Post", base: "Kawasaki" }, "ui")).error).toContain("Make sure to not use spaces, dashes or special characters");
    expect((await e.tryRun("post.save", { name: "kuka_krc4", base: "KUKA_KRC4" }, "ui")).error).toContain("is one of Enginuity's post processors");
    expect((await e.tryRun("post.save", { name: "Broken", source: "class RobotPost(:\n" }, "ui")).error).toContain("SyntaxError");
    expect((await e.tryRun("post.save", { name: "NoBase", base: "Nope" }, "ui")).error).toContain("Unknown post processor Nope");
    expect((await e.tryRun("post.save", { name: "Empty" }, "ui")).error).toContain("Give the post's source or the base post processor");
    await e.run("post.save", { name: "Tmp", base: "Motoman" }, "ui");
    expect(existsSync(path.join(dir, "posts", "user", "Tmp.py"))).toBe(true);
    await e.run("post.delete", { name: "Tmp" }, "ui");
    expect(existsSync(path.join(dir, "posts", "user", "Tmp.py"))).toBe(false);
    expect((await e.tryRun("post.delete", { name: "Motoman" }, "ui")).error).toContain("is not a user post processor");
  });

  it("applyToRobots makes every robot of the station use the new post", async () => {
    const { e, robot } = await station();
    const r = (await e.run("post.save", { name: "MyAbb", base: "ABB_RAPID_IRC5", applyToRobots: true }, "ui")) as unknown as { robots: string[] };
    expect(r.robots).toEqual([robot.name]);
    expect(e.ws.items[robot.id].robot?.postProcessor).toBe("MyAbb");
  });
});

describe("POST-GENERATE: posts that write a project folder", () => {
  it("Precise writes Project<prog>/Main.gpl, GModule.gpo and Project.gpr under the programs folder", async () => {
    const { e, prog } = await station();
    const gen = (await e.run("program.generate", { program: prog, post: "Precise" })) as unknown as { files: { name: string; path: string; content: string }[] };
    expect(gen.files.map((f) => f.name).sort()).toEqual(["ProjectProg1/GModule.gpo", "ProjectProg1/Main.gpl", "ProjectProg1/Project.gpr"]);
    for (const f of gen.files) {
      expect(f.path).toBe(path.join(dir, "programs", ...f.name.split("/")));
      expect(readFileSync(f.path, "utf8")).toBe(f.content);
    }
    expect(gen.files.find((f) => f.name.endsWith("Main.gpl"))!.content).toContain("Move.Loc(Loc1, prof1)");
  });
});

describe("POST-SELECT: a robot whose default post Enginuity does not include", () => {
  it("generation fails naming the missing post and the nearest available ones, never with another post", async () => {
    const { e, robot, prog } = await station();
     
    await e.run("robot.setPostProcessor", { robot: robot.id, post: "Rokae_RL" });
    const listing = () => (existsSync(path.join(dir, "programs")) ? readdirSync(path.join(dir, "programs")).sort() : []);
    const before = listing();
    const r = await e.tryRun("program.generate", { program: prog });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Select a Post Processor for the robot ABB IRB 120-3/0.6 (post processor Rokae_RL was not found)");
    expect(r.error).toContain("Enginuity does not include the post processor Rokae_RL. Nearest available: Rokae.");
    expect(listing()).toEqual(before);  

    await e.run("robot.setPostProcessor", { robot: robot.id, post: "Leantec" });
    expect((await e.tryRun("program.generate", { program: prog })).error).toContain("Nearest available: Post_Generic (a generic program to adapt by hand).");
  });

  it("post.list reports every unavailable library default post with its nearest posts", async () => {
    const { e } = await station();
    const r = (await e.run("post.list", {}, "agent")) as unknown as { posts: { name: string }[]; unavailable: { name: string; robots: number; nearest: string[] }[] };
    const byName = Object.fromEntries(r.unavailable.map((u) => [u.name, u]));
    expect(byName.Denso_RC9).toBeUndefined();
    expect(byName.Rokae_RL.nearest).toEqual(["Rokae"]);
    expect(byName.Comau_MyCo.nearest).toEqual(["Comau_C5G"]);
    expect(byName.Leantec).toEqual({ name: "Leantec", robots: 16, nearest: ["Post_Generic"] });
    const names = new Set(r.posts.map((p) => p.name));
    for (const u of r.unavailable) for (const n of u.nearest) expect(names.has(n)).toBe(true);
  });
});
