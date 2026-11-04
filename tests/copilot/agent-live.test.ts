 
 
 
 
 
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIVE = process.env.META_LIVE === "1";
if (LIVE && existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-copilot-live-"));
process.env.ROBOCRAFT_API = "0";

type Ev = Record<string, unknown> & { type: string };

async function turn(conversation: string, message: string, images: { id: string; name: string; dataUrl: string; width?: number; height?: number }[] = []) {
  const { chat } = await import("@/server/agent");
  const events: Ev[] = [];
  const t0 = Date.now();
  for await (const e of chat(conversation, message, {}, images)) events.push(e as Ev);
  const text = events.filter((e) => e.type === "text").map((e) => String(e.delta)).join("");
  return { events, text, ms: Date.now() - t0 };
}

 
describe("Copilot tool gate", () => {
  it("refuses settings.set of RC_AGENT_* keys with a guardrail event and an error result", async () => {
    const { RunContext } = await import("@openai/agents");
    const { getServer } = await import("@/server/store");
    const { buildTools } = await import("@/server/agent");
    const { newTurnState } = await import("@/server/copilot/guardrails");
    await getServer().ready;
    const events: Record<string, unknown>[] = [];
    const tools = buildTools((e) => events.push(e), undefined, newTurnState()) as unknown as { name: string; invoke: (ctx: InstanceType<typeof RunContext>, input: string) => Promise<string> }[];
    const set = tools.find((t) => t.name === "settings_set")!;
    const out = await set.invoke(new RunContext(), JSON.stringify({ key: "RC_AGENT_BASE_URL", value: "http://evil.example" }));
    expect(out).toMatch(/^ERROR: /);
    expect(getServer().services.settings.RC_AGENT_BASE_URL).not.toBe("http://evil.example");
    expect(events[0]).toMatchObject({ type: "guardrail", kind: "gate", action: "blocked", tool: "settings.set" });
    expect(events[1]).toMatchObject({ type: "tool_result", tool: "settings.set", ok: false });
  });
});

describe.skipIf(!LIVE)("Copilot on Meta Model API (live)", () => {
  it("answers with tools on Muse Spark 1.3 and keeps the conversation", async () => {
    const first = await turn("live", "What is in my station right now?");
    const meta = first.events[0];
    expect(meta).toMatchObject({ type: "meta", provider: { id: "meta", label: "Meta Model API" }, model: { label: "Muse Spark 1.3", vendor: "Meta" }, ready: true });
    expect(JSON.stringify(meta)).not.toContain(String(process.env.MODEL_API_KEY));
    expect(first.events.some((e) => e.type === "error")).toBe(false);
    expect(first.events.some((e) => e.type === "tool_call" && e.tool === "workspace.describe")).toBe(true);
    expect(first.text.length).toBeGreaterThan(0);
    expect(first.events.at(-1)).toMatchObject({ type: "done" });

    const second = await turn("live", "Is there a robot in it? Answer in one sentence.");
    expect(second.events.some((e) => e.type === "error")).toBe(false);
    expect(second.text.length).toBeGreaterThan(0);
    expect(second.events.at(-1)).toMatchObject({ type: "done" });
    console.log(`live turns: ${first.ms} ms, ${second.ms} ms`, first.events.at(-1)?.stats);
  }, 240_000);

  it("reads an attached photo and finds objects in it with SAM 3.1", async () => {
    const { readFileSync } = await import("node:fs");
    const dataUrl = `data:image/png;base64,${readFileSync("examples/conveyor-pick-place/thumbnail.png").toString("base64")}`;
    const photo = await turn(
      "live-photo",
      "Describe this work area in two sentences, then use photo_findObjects to locate the robot arm and the conveyor. Don't change the station.",
      [{ id: "photo-1", name: "cell.png", dataUrl }],
    );
    expect(photo.events.some((e) => e.type === "error")).toBe(false);
    const sam = photo.events.find((e) => e.type === "tool_result" && e.tool === "photo.findObjects") as { ok?: boolean; photo?: { objects: { label: string; boxes: unknown[] }[] } } | undefined;
    expect(sam?.ok).toBe(true);
    expect(sam?.photo?.objects.some((o) => o.boxes.length > 0)).toBe(true);
    expect(photo.text.length).toBeGreaterThan(0);
    console.log(`live photo turn: ${photo.ms} ms`, JSON.stringify(sam?.photo?.objects.map((o) => [o.label, o.boxes.length])), photo.events.at(-1)?.stats);
  }, 240_000);
});
