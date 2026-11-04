 
 
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "@/engine/dispatch";
import type { ScriptLimits } from "@/server/scripts/sandbox";
import { engine } from "../helpers";

export async function scripted(opts: { limits?: Partial<ScriptLimits>; posts?: boolean } = {}) {
  const e = await engine();
  if (opts.posts) {
     
    process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "mb-scripts-"));
    const { generateProgram, createPostService } = await import("@/server/post");
    e.services.post = generateProgram;
    e.services.posts = createPostService();
  }
  const { createScriptService } = await import("@/server/scripts");
  const scripts = createScriptService({
    call: (name, params, macro, station) => dispatch(e.ws, e.undo.group.active(e.ws), e.services, name, params, "agent", { macro, station }),
    workspace: () => e.ws,
    limits: opts.limits,
  });
  e.services.scripts = scripts;
  const run = (code: string, name = "Test", opts: { keepOnError?: boolean } = {}) => scripts.run({ code, name, origin: "ui", ...opts });
  return { e, scripts, run };
}
