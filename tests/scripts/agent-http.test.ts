// Verifies streamed OpenAI-compatible tool calls execute on the engine and feed the conversation.
 
 
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-agent-http-"));
process.env.OPENAI_API_KEY = "local";

type Message = { role: string; content?: unknown; tool_calls?: unknown[] };
const requests: { messages: Message[]; stream: boolean; tools: number }[] = [];
let server: Server;

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "local-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

async function body(req: IncomingMessage) {
  let s = "";
  for await (const c of req) s += c;
  return JSON.parse(s) as { messages: Message[]; stream?: boolean; tools?: unknown[] };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const b = await body(req);
    requests.push({ messages: b.messages, stream: !!b.stream, tools: b.tools?.length ?? 0 });
    const first = requests.length === 1;
     
    if (first) await new Promise((r) => setTimeout(r, 1500));
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (first) {
      res.write(chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "workspace_describe", arguments: "" } }] }));
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }));
      res.write(chunk({}, "tool_calls"));
    } else {
      res.write(chunk({ role: "assistant", content: "The station " }));
      res.write(chunk({ content: "is empty." }));
      res.write(chunk({}, "stop"));
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { getServer, run } = await import("@/server/store");
  await getServer().ready;
  const port = (server.address() as AddressInfo).port;
  for (const [key, value] of [
    ["RC_AGENT_BASE_URL", `http://127.0.0.1:${port}/v1`],
    ["RC_AGENT_MODEL", "local-test"],
    ["RC_AGENT_API", "chat_completions"],
  ])
    expect((await run("settings.set", { key, value }, "system")).ok).toBe(true);
}, 60_000);

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Copilot over an OpenAI-compatible server", () => {
  it("streams a tool call, runs it on the engine and streams the reply", { timeout: 60_000 }, async () => {
    const { chat } = await import("@/server/agent");
    const events: Record<string, unknown>[] = [];
    for await (const e of chat("http-test", "What is in the station?")) events.push(e);

    expect(events.find((e) => e.type === "error")).toBeUndefined();
     
    expect(events.some((e) => e.type === "tool_call" && e.tool === "workspace.describe")).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && e.tool === "workspace.describe" && e.ok === true)).toBe(true);
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("The station is empty.");
    expect(events.at(-1)?.type).toBe("done");

     
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.stream && r.tools > 100)).toBe(true);
     
     
    const second = requests[1].messages;
    const call = second.find((m) => m.role === "assistant" && m.tool_calls);
    expect(call?.content).toBe("");
    expect(second.some((m) => m.role === "tool")).toBe(true);
  });
});
