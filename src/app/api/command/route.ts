// Executes a UI command and returns its result.
import { run } from "@/server/store";

export async function POST(request: Request) {
  let body: { name?: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name) return Response.json({ ok: false, error: "Missing command name" }, { status: 400 });
  const res = await run(body.name, body.params ?? {}, "ui");
  return Response.json(
    { ok: res.ok, result: res.result ?? null, error: res.error ?? null, code: res.code ?? null, rev: res.patch?.rev ?? null },
    { status: res.ok ? 200 : 422 },
  );
}
