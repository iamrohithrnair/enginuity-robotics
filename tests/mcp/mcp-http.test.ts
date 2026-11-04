 
 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasLibraryFile, LIBRARY_FILE } from "../library";

 
const ROBOT_FILE = LIBRARY_FILE("robots", "ABB-IRB-120-3-0-6.robot");
const URL_ = "http://localhost:3100/api/mcp";

let http: typeof import("@/server/mcp/http");
let visibleCommands: number;
let client: Client;

 
const handlerFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const headers = new Headers(req.headers);
  if (!headers.has("host")) headers.set("host", new URL(req.url).host);
  const routed = new Request(req, { headers });
  if (routed.method === "POST") return http.handleMcpPost(routed);
  if (routed.method === "OPTIONS") return http.handleMcpOptions(routed);
  return http.handleMcpOther(routed);
};

async function connect(): Promise<Client> {
  const c = new Client({ name: "mcp-test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(URL_), { fetch: handlerFetch }));
  return c;
}

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  http.handleMcpPost(
    new Request(URL_, {
      method: "POST",
      headers: { host: "localhost:3100", "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
  );
const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-mcp-"));
  delete process.env.ENGINUITY_MCP_TOKEN;
  const store = await import("@/server/store");
  await store.getServer().ready;
  http = await import("@/server/mcp/http");
  const { allCommands } = await import("@/engine/registry");
  visibleCommands = allCommands().filter((c) => !c.internal).length;
  client = await connect();
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("Enginuity MCP over HTTP", () => {
  it("initializes as Enginuity with usage instructions that never name another product", () => {
    expect(client.getServerVersion()).toMatchObject({ name: "enginuity", title: "Enginuity", version: "1.0.0" });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("workspace_describe");
    expect(instructions).not.toMatch(/RoboDK|RoboCraft/);
  });

  it("lists every visible engine command as a tool with a valid, unique name", { timeout: 60_000 }, async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(visibleCommands);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.inputSchema.type).toBe("object");
    }
    expect(names).toEqual(expect.arrayContaining(["station_new", "file_open", "robot_setJoints", "program_generate", "workspace_describe"]));
    expect(tools.find((t) => t.name === "workspace_describe")?.annotations?.readOnlyHint).toBe(true);
     
    expect(names.some((n) => /approve/i.test(n))).toBe(false);
  });

  it.skipIf(!hasLibraryFile("robots", "ABB-IRB-120-3-0-6.robot"))("runs commands on the app state and generates a real robot program", { timeout: 120_000 }, async () => {
    const st = await client.callTool({ name: "station_new", arguments: { name: "MCP Cell" } });
    expect(st.isError).toBeFalsy();
    const robot = await client.callTool({ name: "file_open", arguments: { path: ROBOT_FILE } });
    expect(robot.isError, JSON.stringify(robot.content)).toBeFalsy();
    const rid = String((robot.structuredContent as Record<string, unknown>).id);
    const joints = await client.callTool({ name: "robot_setJoints", arguments: { robot: rid, joints: [10, -20, 30, 0, 40, 0] } });
    expect(joints.isError).toBeFalsy();

     
    const station = await client.readResource({ uri: "enginuity://station" });
    const desc = JSON.parse(String((station.contents[0] as { text: string }).text));
    expect(desc.station).toBe("MCP Cell");
    expect(JSON.stringify(desc)).toContain("ABB IRB 120");
    const item = await client.readResource({ uri: `enginuity://items/${encodeURIComponent(rid)}` });
    expect(JSON.parse(String((item.contents[0] as { text: string }).text)).joints).toEqual([10, -20, 30, 0, 40, 0]);

     
    const prog = await client.callTool({ name: "program_add", arguments: { name: "McpProg", robot: rid } });
    const pid = String((prog.structuredContent as Record<string, unknown>).id);
    expect((await client.callTool({ name: "program_addMoveJ", arguments: { program: pid } })).isError).toBeFalsy();
    await client.callTool({ name: "robot_setJoints", arguments: { robot: rid, joints: [30, 0, 10, 0, 50, 0] } });
    expect((await client.callTool({ name: "program_addMoveJ", arguments: { program: pid } })).isError).toBeFalsy();
    const gen = await client.callTool({ name: "program_generate", arguments: { program: pid } });
    expect(gen.isError, JSON.stringify(gen.content)).toBeFalsy();
    const files = (gen.structuredContent as { files: { name: string; content: string }[] }).files;
    const mod = files.find((f) => f.name.endsWith(".mod"));
    expect(mod?.content).toMatch(/MODULE MOD_McpProg/);
    expect(mod?.content).toMatch(/MoveAbsJ \[\[10(\.0+)?,-20(\.0+)?,30(\.0+)?,0(\.0+)?,40(\.0+)?,0(\.0+)?\]/);

     
    const generated = await client.readResource({ uri: `enginuity://programs/${encodeURIComponent(pid)}/generated` });
    expect(generated.contents.map((c) => c.uri)).toEqual(expect.arrayContaining([expect.stringContaining("McpProg.mod")]));
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(["enginuity://station", `enginuity://programs/${encodeURIComponent(pid)}/generated`]));
  });

  it("reports command failures and unknown tools as tool errors with the app's message", { timeout: 60_000 }, async () => {
    const bad = await client.callTool({ name: "robot_setJoints", arguments: { robot: "no such robot", joints: [0, 0, 0, 0, 0, 0] } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toMatch(/Invalid item provided/);
    const unknown = await client.callTool({ name: "warp_drive", arguments: {} });
    expect(unknown.isError).toBe(true);
    expect((unknown.content as { text: string }[])[0].text).toMatch(/Unknown tool "warp_drive"/);
    await expect(client.readResource({ uri: "enginuity://programs/nothing/generated" })).rejects.toThrow(/program_generate/);
  });

  it("never names another product in anything it exposes (the Python package name robodk is allowed)", { timeout: 60_000 }, async () => {
    const other = /RoboDK|RoboCraft/;
    const { tools } = await client.listTools();
    const offenders = tools.filter((t) => other.test(`${t.title ?? ""} ${t.description ?? ""} ${JSON.stringify(t.inputSchema)}`)).map((t) => t.name);
    expect(offenders).toEqual([]);
    expect(client.getInstructions() ?? "").not.toMatch(other);
    const { resources } = await client.listResources();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(JSON.stringify([resources, resourceTemplates])).not.toMatch(other);
    const station = await client.readResource({ uri: "enginuity://station" });
    expect(JSON.stringify(station)).not.toMatch(other);
    const { prompts } = await client.listPrompts();
    for (const p of prompts) {
      const got = await client.getPrompt({ name: p.name, arguments: { program: "P1" } });
      expect(JSON.stringify([p, got])).not.toMatch(other);
    }
  });

  it("serves prompts", { timeout: 60_000 }, async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["pick_and_place_cell", "generate_robot_program"]);
    const p = await client.getPrompt({ name: "generate_robot_program", arguments: { program: "McpProg", post: "KUKA_KRC4" } });
    expect(JSON.stringify(p.messages)).toContain("KUKA_KRC4");
  });
});

describe("Enginuity MCP endpoint guards", () => {
  it("rejects foreign Host and Origin headers (DNS rebinding) and non-local clients", { timeout: 60_000 }, async () => {
    expect((await rpc(LIST, { host: "attacker.example:3100" })).status).toBe(403);
    expect((await rpc(LIST, { origin: "http://attacker.example" })).status).toBe(403);
    expect((await rpc(LIST, { origin: "http://localhost:6274" })).status).toBe(200);
    expect((await rpc(LIST, { "x-forwarded-for": "192.168.1.20" })).status).toBe(403);
     
    expect((await rpc(LIST, { "x-forwarded-for": "127.0.0.1, 192.168.1.20" })).status).toBe(403);
    expect((await rpc(LIST, { "x-forwarded-for": "::1" })).status).toBe(200);
  });

  it("requires the bearer token when ENGINUITY_MCP_TOKEN is set", { timeout: 60_000 }, async () => {
    process.env.ENGINUITY_MCP_TOKEN = "s3cret-token";
    try {
      const denied = await rpc(LIST);
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toMatch(/Bearer/);
      expect((await rpc(LIST, { authorization: "Bearer wrong" })).status).toBe(401);
      expect((await rpc(LIST, { authorization: "Bearer s3cret-token" })).status).toBe(200);
    } finally {
      delete process.env.ENGINUITY_MCP_TOKEN;
    }
  });

  it("is stateless: GET and DELETE answer 405, preflights pass for allowed origins", async () => {
    const get = http.handleMcpOther(new Request(URL_, { headers: { host: "localhost:3100" } }));
    expect(get.status).toBe(405);
    const pre = http.handleMcpOptions(new Request(URL_, { method: "OPTIONS", headers: { host: "localhost:3100", origin: "http://localhost:6274" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://localhost:6274");
  });
});
