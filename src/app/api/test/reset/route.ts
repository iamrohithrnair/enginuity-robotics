import { getServer, run } from "@/server/store";
import { createWorkspace } from "@/engine/workspace";

 
export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ROBOCRAFT_TEST !== "1") {
    return Response.json({ error: "disabled" }, { status: 404 });
  }
  const s = getServer();
  await s.ready;
  const fresh = createWorkspace();
  for (const k of Object.keys(s.ws) as (keyof typeof s.ws)[]) delete (s.ws as unknown as Record<string, unknown>)[k];
  Object.assign(s.ws, fresh);
  s.undo.clearAll();
   
  s.runner?.stopAll();
  for (const k of Object.keys(s.flags)) delete s.flags[k];
  s.flags.Popups = "1";
  await run("station.new", {}, "system");
  s.undo.clearAll();
  s.services.emit?.({ type: "snapshot", ws: s.ws });
  return Response.json({ ok: true });
}
