// Registers post-processor storage, approval and robot assignment commands.
 
 
 
 
 
 
 
 
 
 

import { z } from "zod";
import { LIBRARY_DEFAULT_POSTS, nearestPosts, postPick, storedPostName, type PostPick, type PostService } from "../posts";
import { CommandError, defineCommand, ItemRef, type CmdCtx } from "../registry";
import { requireRobot } from "./robot";
import { descendants } from "../workspace";
import { activeStationId } from "./items";

function service(ctx: CmdCtx): PostService {
  const s = ctx.services.posts;
  if (!s) throw new CommandError("Post processors are managed on the server");
  return s;
}

 
async function call<T>(f: () => T | Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw new CommandError(e instanceof Error ? e.message : String(e));
  }
}

const Name = z.string().min(1).describe("post processor name (file name without .py), e.g. KUKA_KRC4");

defineCommand({
  name: "post.list",
  title: "List Post Processors",
  description:
    "List the post processors programs can be generated with: Enginuity's built-in posts (named after the controller, such as ABB_RAPID_IRC5, KUKA_KRC2, Fanuc_RJ3, Motoman, Universal_Robots), " +
    "with how many library robots use each by default, and the user's own posts from Program ▸ Add/Edit Post Processor. " +
    "Also lists the library's default posts Enginuity does not provide, each with the nearest available posts: generation with a missing post fails with a message naming it and those posts (it never switches post on its own). " +
    "Use a name with program.generate (post) or robot.setPostProcessor.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "B-PROG-28",
  schema: z.object({}),
  async run(ctx) {
    const posts = await call(() => service(ctx).list());
    const have = new Set(posts.map((p) => p.name.toLowerCase()));
    const names = posts.map((p) => p.name);
    const unavailable = Object.entries(LIBRARY_DEFAULT_POSTS)
      .filter(([n]) => !have.has(n.toLowerCase()))
      .map(([name, robots]) => ({ name, robots, nearest: nearestPosts(name, names) }));
    return { folder: service(ctx).folder(), posts, unavailable };
  },
});

defineCommand({
  name: "post.get",
  title: "Show Post Processor",
  description: "Read the Python source of a post processor (built-in posts are read-only; user posts also report who wrote them and whether they wait for the user's approval).",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "B-PROG-28",
  schema: z.object({ name: Name }),
  run: (ctx, p) => call(() => service(ctx).get(p.name)),
});

defineCommand({
  name: "post.save",
  title: "Save Post Processor",
  description:
    "Create or update a user post processor in data/posts/user. Give `source` (Python: `from <BasePost> import RobotPost as BasePost` and `class RobotPost(BasePost):` overriding variables or methods), " +
    "or only `base` to start from the built-in post's customizable variables. Names: letters, digits and _ only, not a built-in post's name. " +
    "`applyToRobots` makes every robot of the station use it. Posts written by the Copilot do not run until the user approves them in Add/Edit Post Processor.",
  category: "program",
  undoable: false,
  spec: "B-PROG-28",
  schema: z.object({
    name: Name,
    source: z.string().optional().describe("full Python source of the post"),
    base: z.string().optional().describe("built-in post to customize when no source is given"),
    applyToRobots: z.boolean().default(false).describe("use this post for every robot of the active station"),
  }),
  async run(ctx, p) {
    const svc = service(ctx);
    if (p.source === undefined && !p.base) throw new CommandError("Give the post's source or the base post processor to customize");
    const source = p.source ?? (await call(() => svc.template(p.name, p.base!)));
     
    const author = ctx.origin === "agent" || ctx.origin === "api" ? "agent" : "user";
    const saved = await call(() => svc.save(p.name, source, author));
    let robots: string[] = [];
    if (p.applyToRobots) {
      const station = activeStationId(ctx.ws);
      robots = (station ? descendants(ctx.ws, station) : []).filter((i) => i.type === "robot" && i.robot).map((r) => {
        ctx.tx.set(r.id, { robot: { ...r.robot!, postProcessor: saved.name } });
        return r.name;
      });
    }
    if (saved.needsApproval) ctx.services.emit?.({ type: "post-confirm", name: saved.name, hash: saved.hash });
    return { name: saved.name, file: saved.file, base: saved.base, needsApproval: saved.needsApproval, robots };
  },
});

defineCommand({
  name: "post.delete",
  title: "Delete Post Processor",
  description: "Delete a user post processor from data/posts/user (built-in posts cannot be deleted).",
  category: "program",
  undoable: false,
  spec: "B-PROG-28",
  schema: z.object({ name: Name }),
  async run(ctx, p) {
    await call(() => service(ctx).remove(p.name));
    return { deleted: p.name };
  },
});

defineCommand({
  name: "post.approve",
  title: "Approve Post Processor",
  description: "Approve the exact code of a user post processor written by the Copilot so programs can be generated with it (the user, in the post editor).",
  category: "program",
  undoable: false,
  spec: "B-PROG-28",
   
  internal: true,
  schema: z.object({ name: Name, hash: z.string().describe("sha256 of the code shown to the user (post.get)") }),
  async run(ctx, p) {
    if (ctx.origin !== "ui") throw new CommandError("Only the user can approve a post processor, from the Enginuity window");
    await call(() => service(ctx).approve(p.name, p.hash));
    return { approved: p.name };
  },
});

 
async function pickEntries(svc: PostService): Promise<{ name: string; path: string }[]> {
  const posts = await call(() => svc.list());
  return posts.map((p) => ({ name: p.name, path: p.kind === "user" ? `${svc.folder()}/${p.name}.py` : `python/robocraft_post (built-in ${p.name})` }));
}

 
export async function postPickFor(ctx: CmdCtx, robot: { name: string; robot?: { postProcessor: string } }): Promise<PostPick> {
  return postPick(robot.name, robot.robot?.postProcessor ?? "", await pickEntries(service(ctx)));
}

 
export async function postAvailable(ctx: CmdCtx, post: string): Promise<string | null> {
  if (!post) return null;
  const want = post.toLowerCase();
  const hit = (await call(() => service(ctx).list())).find((p) => p.name.toLowerCase() === want);
  return hit ? hit.name : null;
}

defineCommand({
  name: "post.pickList",
  title: "Post Processor Picker",
  description:
    "What the post processor picker shows for a robot (the 'Select one item' window that opens when a robot's post processor is missing at generation): " +
    "the label 'Select a Post Processor for the robot <robot>', every available post (shown with spaces for underscores, sorted by name) and the preselected entry (the robot's current post, -1 when it is missing). " +
    "Choose one with post.choose.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "POST-PickList (FUN_10042c810)",
  schema: z.object({ robot: ItemRef.optional() }),
  async run(ctx, p) {
    const r = requireRobot(ctx.ws, p.robot);
    return await postPickFor(ctx, r);
  },
});

defineCommand({
  name: "post.choose",
  title: "Choose Post Processor",
  description:
    "Pick the post processor a robot generates programs with, from post.pickList / post.list (the answer to the post processor picker). " +
    "Use it when program.generate reports 'Select a Post Processor for the robot … was not found': the robot keeps the chosen post for later generations. " +
    "Spaces in the name are read as underscores; a trailing .py is removed.",
  category: "program",
  undoable: false,
  spec: "POST-PickList (FUN_10003ae74, FUN_10048d24c)",
  schema: z.object({ robot: ItemRef.optional(), post: z.string().min(1).describe("post processor name, e.g. KUKA_KRC4 or 'KUKA KRC4'") }),
  async run(ctx, p) {
    const r = requireRobot(ctx.ws, p.robot);
    const name = await postAvailable(ctx, storedPostName(p.post));
    if (!name) throw new CommandError(`The post processor ${storedPostName(p.post)} is not available. See post.pickList for the available posts.`);
    ctx.tx.set(r.id, { robot: { ...r.robot!, postProcessor: name } });
    return { robot: r.name, post: name };
  },
});
