 
 
 
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { RunContext } from "@openai/agents";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-decision-agent-"));

let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "local-jev", answers: { clear: { type: "noul", noul: 0.97 } }, usage: { input_tokens: 5, output_tokens: 0 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/systemone`;
  const { getServer, run } = await import("@/server/store");
  await getServer().ready;
  const r = await run("decision.saveProfile", { name: "Local", provider: "custom", wire: "systemone", model: "local-jev", baseUrl: endpoint, makeDefault: true }, "ui");
  expect(r.ok).toBe(true);
}, 60_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Copilot decision tools", () => {
  it("are tools with typed parameters, and no tool accepts or returns an API key", async () => {
    const { buildTools } = await import("@/server/agent");
    const tools = buildTools(() => undefined) as unknown as { name: string; parameters: Record<string, unknown> }[];
    const names = tools.map((t) => t.name);
    for (const n of ["decision_ask", "decision_profiles", "decision_test", "decision_saveProfile", "decision_deleteProfile", "program_addDecision", "instruction_editDecision", "instruction_testDecision"]) expect(names).toContain(n);
    const ask = tools.find((t) => t.name === "decision_ask")!;
    const props = (ask.parameters as { properties: Record<string, { type?: string; items?: { properties?: Record<string, unknown> } }> }).properties;
    expect(props.questions.type).toBe("array");
    expect(Object.keys(props.questions.items!.properties!)).toEqual(expect.arrayContaining(["name", "type", "instructions", "options", "levels"]));
    for (const t of tools) expect(JSON.stringify(t.parameters)).not.toMatch(/apiKey|api_key/i);
  });

  it("decision_ask runs the decision and streams the result to the chat", async () => {
    const { buildTools } = await import("@/server/agent");
    const events: Record<string, unknown>[] = [];
    const tools = buildTools((e) => events.push(e)) as unknown as { name: string; invoke: (ctx: RunContext, input: string) => Promise<string> }[];
    const ask = tools.find((t) => t.name === "decision_ask")!;
    const out = await ask.invoke(new RunContext(), JSON.stringify({ text: "Nobody is inside the fence and the light curtain is clear.", questions: [{ name: "clear", type: "yesno", instructions: "Is the cell clear to start the robot?" }] }));
    const parsed = JSON.parse(out) as { summary: string[]; profile: { name: string } };
    expect(parsed.summary).toEqual(["clear: yes (p 0.97)"]);
    expect(parsed.profile.name).toBe("Local");
    const ev = events.at(-1)!;
    expect(ev).toMatchObject({ type: "tool_result", tool: "decision.ask", ok: true });
    expect((ev.decision as { answers: { probability: number }[] }).answers[0].probability).toBe(0.97);
  });

  it("the agent instructions tell the Copilot when to use decision models", async () => {
    const src = (await import("node:fs")).readFileSync(path.resolve(__dirname, "../../src/server/agent.ts"), "utf8");
    expect(src).toContain("decision_ask answers yesno");
    expect(src).toContain("program_addDecision");
    expect(src).toContain("You can\n  never see or set API keys");
  });
});
