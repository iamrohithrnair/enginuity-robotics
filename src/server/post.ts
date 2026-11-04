 
 
 
 

 
 
 
 
 
 

import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DEFAULT_POSTS, POST_NAME_RE, missingPostMessage, type PostInfo, type PostPick, type PostService, type PostSource } from "@/engine/posts";
import type { PostRequest, PostResult } from "@/engine/registry";
import { postKinematics } from "@/engine/post-kinematics";
import { getServer } from "@/server/store";

const PY = process.env.ROBOCRAFT_PYTHON ?? "python3";
const CLI = path.join(  process.cwd(), "python", "robocraft_post", "cli.py");
const PROGRAMS_DIR = path.join(process.env.ROBOCRAFT_DATA_DIR ?? path.join(  process.cwd(), "data"), "programs");

interface CliFile {
  name: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

interface CliReply {
  ok: boolean;
  post?: string;
  total?: number | null;
  files: CliFile[];
  log: string;
  error?: string | null;
}

 
function outputDir(sub?: string): string {
  const clean = (sub ?? "")
    .split(/[\\/]+/)
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[^\w .()-]+/g, "_"))
    .join(path.sep);
  return clean ? path.join(PROGRAMS_DIR, clean) : PROGRAMS_DIR;
}

function runCli(input: string, args: string[]): Promise<{ code: number | null; out: string; err: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(PY, ["-I", CLI, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out, err, spawnError: e });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(input);
  });
}

export async function generateProgram(req: PostRequest): Promise<PostResult> {
  const program = req.program as { intermediate?: string; program?: string };
  if (!program?.intermediate) return { ok: false, files: [], log: "", error: "Nothing to generate" };
  const request: Record<string, unknown> = { intermediate: program.intermediate, post: req.post };
  const builtin = await builtinNames();
  const known = !req.post || builtin.some((b) => b.toLowerCase() === req.post!.toLowerCase());
  const user = known ? null : userPost(req.post!);
  if (user) {
    if (user.needsApproval) return { ok: false, files: [], log: "", error: approvalMessage(user.name) };
    request.user_post = { name: user.name, path: user.file };
  }
   
  try {
    const kin = postKinematics(program.intermediate, getServer().ws.items);
    if (kin.length) request.kinematics = kin;
  } catch {
     
  }
  const r = await runCli(JSON.stringify(request), []);
  if (r.spawnError) {
     
    return { ok: false, files: [], log: r.err, error: `Python has not been configured properly. (${r.spawnError.message})` };
  }
  let reply: CliReply;
  try {
    reply = JSON.parse(r.out) as CliReply;
  } catch {
    return { ok: false, files: [], log: r.err || r.out, error: `Post processor failed (exit ${r.code})` };
  }
   
  const stderr = r.err.trim();
  const log = [reply.log, stderr].filter(Boolean).join("\n");
  if (!reply.ok || stderr) {
    let error = reply.error ?? `Failed to generate program "${program.program ?? ""}" using the Post Processor "${req.post}"`;
     
    if (!known && !user && builtin.length) error += `\n${missingPostMessage(req.post!, [...builtin, ...userNames()])}`;
    return { ok: false, files: [], log, error: stderr ? `${error}\n${stderr}` : error };
  }
  const dir = outputDir(req.outDir);
  mkdirSync(dir, { recursive: true });
  const files = reply.files.map((f) => {
     
     
    const parts = f.name
      .split(/[\\/]+/)
      .filter((s) => s && s !== "." && s !== "..")
      .map((s) => s.replace(/[^\w .()-]+/g, "_"));
    const target = path.join(dir, ...(parts.length ? parts : ["_"]));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.encoding === "base64" ? Buffer.from(f.content, "base64") : f.content);
    return { name: f.name, content: f.content, encoding: f.encoding ?? "utf-8", path: target };
  });
  return { ok: true, files, log };
}

export async function listPostProcessors(): Promise<{ name: string; assumed: boolean }[]> {
  const r = await runCli("", ["--list"]);
  try {
    return JSON.parse(r.out);
  } catch {
    return [];
  }
}

 

let builtins: Promise<string[]> | null = null;

 
export function builtinNames(): Promise<string[]> {
  builtins ??= listPostProcessors().then((l) => {
    if (!l.length) builtins = null;  
    return l.map((p) => p.name);
  });
  return builtins;
}

const userDir = () => path.join(process.env.ROBOCRAFT_DATA_DIR ?? path.join(  process.cwd(), "data"), "posts", "user");
const consentFile = () => path.join(userDir(), ".consent.json");
type Consent = Record<string, { author: "user" | "agent"; approved: string | null }>;

export const postHash = (code: string) => createHash("sha256").update(code).digest("hex");

function readConsent(): Consent {
  try {
    return JSON.parse(readFileSync(consentFile(), "utf8")) as Consent;
  } catch {
    return {};
  }
}

function writeConsent(c: Consent) {
  mkdirSync(userDir(), { recursive: true });
  writeFileSync(consentFile(), JSON.stringify(c, null, 1));
}

const approvalMessage = (name: string) =>
  `The post processor ${name} was written by the Copilot. Review its code in Program ▸ Add/Edit Post Processor and approve it before generating programs with it.`;

 
function userPost(name: string) {
  const file = path.join(userDir(), `${name}.py`);
  if (!POST_NAME_RE.test(name) || !existsSync(file)) return null;
  const code = readFileSync(file, "utf8");
  const hash = postHash(code);
  const rec = readConsent()[name];
  const author = rec?.author ?? "user";
  const base = /^\s*from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\s+RobotPost\b/m.exec(code)?.[1] ?? null;
  return { name, file, code, hash, author, base, needsApproval: author === "agent" && rec?.approved !== hash };
}

function userNames(): string[] {
  if (!existsSync(userDir())) return [];
  return readdirSync(userDir())
    .filter((f) => f.endsWith(".py") && POST_NAME_RE.test(f.slice(0, -3)))
    .map((f) => f.slice(0, -3))
    .sort((a, b) => a.localeCompare(b));
}

async function cliJson<T>(args: string[], input = ""): Promise<T> {
  const r = await runCli(input, args);
  if (r.spawnError) throw new Error(`Python has not been configured properly. (${r.spawnError.message})`);
  try {
    return JSON.parse(r.out) as T;
  } catch {
    throw new Error(r.err.trim() || `Post processor tool failed (exit ${r.code})`);
  }
}

 
export function createPostService(emit?: (event: { type: string; [k: string]: unknown }) => void): PostService {
   
  const picks = new Map<string, (post: string | null) => void>();
  const pickEvents = new Map<string, { type: "post-pick"; id: string } & PostPick>();
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  function answer(id: string, post: string | null): boolean {
    const f = picks.get(id);
    if (!f) return false;
    picks.delete(id);
    pickEvents.delete(id);
    emit?.({ type: "post-pick-close", id });
    f(post);
    return true;
  }
  const checkName = async (name: string) => {
    if (!POST_NAME_RE.test(name)) fail(`Invalid post processor name "${name}". Make sure to not use spaces, dashes or special characters in your Post Processor file.`);
    if ((await builtinNames()).some((b) => b.toLowerCase() === name.toLowerCase()))
      fail(`${name} is one of Enginuity's post processors. Save the customized post processor under a new name.`);
  };
  return {
    folder: userDir,
    pick(req) {
      const id = `pick_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      return new Promise<string | null>((resolve) => {
        picks.set(id, resolve);
        if (!emit) return void answer(id, null);
        const ev = { type: "post-pick" as const, id, ...req };
        pickEvents.set(id, ev);
        emit(ev);
      });
    },
    answerPick: (id, post) => answer(id, post),
    pendingPicks: () => [...pickEvents.values()],
    async list() {
      const out: PostInfo[] = (await builtinNames()).map((name) => ({ name, kind: "builtin", base: null, author: null, needsApproval: false, robots: LIBRARY_DEFAULT_POSTS[name] ?? 0 }));
      for (const name of userNames()) {
        const u = userPost(name);
        if (u) out.push({ name, kind: "user", base: u.base, author: u.author, needsApproval: u.needsApproval, robots: 0 });
      }
      return out;
    },
    async get(name) {
      const u = (await builtinNames()).includes(name) ? null : userPost(name);
      if (u) return { name, kind: "user", file: `${name}.py`, source: u.code, base: u.base, author: u.author, needsApproval: u.needsApproval, hash: u.hash } satisfies PostSource;
      const r = await cliJson<{ ok: boolean; file?: string; source?: string; variables?: PostSource["variables"]; error?: string }>(["--source", name]);
      if (!r.ok) fail(`The post processor ${name} was not found`);
      return { name, kind: "builtin", file: r.file!, source: r.source!, variables: r.variables, base: null, author: null, needsApproval: false, hash: null };
    },
    async template(name, base) {
      await checkName(name);
      const r = await cliJson<{ ok: boolean; source?: string; error?: string }>(["--template", name, "--base", base]);
      if (!r.ok) fail(r.error ?? `Unknown post processor ${base}`);
      return r.source!;
    },
    async save(name, source, author) {
      await checkName(name);
      const check = await cliJson<{ ok: boolean; error: string | null; base: string | null }>(["--check"], source);
      if (!check.ok) fail(check.error ?? "Invalid post processor");
      mkdirSync(userDir(), { recursive: true });
      const file = path.join(userDir(), `${name}.py`);
      writeFileSync(file, source);
      const hash = postHash(source);
      const consent = readConsent();
      consent[name] = { author, approved: author === "user" ? hash : null };
      writeConsent(consent);
      return { name, file, base: check.base, needsApproval: author === "agent", hash };
    },
    remove(name) {
      const u = userPost(name);
      if (!u) fail(`${name} is not a user post processor (only posts in ${userDir()} can be deleted)`);
      rmSync(u!.file);
      const consent = readConsent();
      delete consent[name];
      writeConsent(consent);
    },
    approve(name, hash) {
      const u = userPost(name);
      if (!u) fail(`The post processor ${name} was not found`);
      if (u!.hash !== hash) fail(`The code of ${name} changed since it was shown; review it again before approving`);
      const consent = readConsent();
      consent[name] = { author: u!.author, approved: hash };
      writeConsent(consent);
    },
  };
}
