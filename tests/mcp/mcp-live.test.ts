// Exercises live MCP tool discovery, stdio robot-program generation, and offline diagnostics.
 
 
 
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const BASE = (process.env.ENGINUITY_MCP_LIVE_URL ?? "http://localhost:3200").replace(/\/+$/, "");

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/commands`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}
const live = await reachable();

type Structured = Record<string, unknown>;
const structured = (r: unknown) => (r as { structuredContent: Structured }).structuredContent;

describe.skipIf(!live)(`Enginuity MCP on a running app (${BASE})`, () => {
  it("serves every visible command over Streamable HTTP", { timeout: 60_000 }, async () => {
    const client = new Client({ name: "mcp-live-http", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`)));
    try {
      const commands = (await (await fetch(`${BASE}/api/commands`)).json()) as unknown[];
      const { tools } = await client.listTools();
      expect(tools.length).toBe(commands.length);
      const d = await client.callTool({ name: "workspace_describe", arguments: {} });
      expect(d.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });

  it("drives the app end to end through the stdio bridge and generates a real UR program", { timeout: 180_000 }, async () => {
    const client = new Client({ name: "mcp-live-stdio", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT, "scripts/enginuity-mcp.mjs")],
        env: { ...process.env, ENGINUITY_URL: BASE } as Record<string, string>,
        stderr: "pipe",
      }),
    );
     
    const name = `MCP stdio ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let sid: string | undefined;
    try {
      expect(client.getServerVersion()?.name).toBe("enginuity");
      expect((await client.listTools()).tools.length).toBeGreaterThan(100);
      const st = await client.callTool({ name: "station_new", arguments: { name } });
      expect(st.isError, JSON.stringify(st.content)).toBeFalsy();
      sid = String(structured(st).id);
      const robot = await client.callTool({ name: "library_load", arguments: { file: "UR5e.robot", parent: sid } });
      expect(robot.isError, JSON.stringify(robot.content)).toBeFalsy();
      const rid = String(structured(robot).id);
      await client.callTool({ name: "robot_setJoints", arguments: { robot: rid, joints: [0, -90, -90, 0, 90, 0] } });
      const prog = await client.callTool({ name: "program_add", arguments: { name: "StdioProg", robot: rid } });
      const pid = String(structured(prog).id);
       
      expect((await client.callTool({ name: "program_addMoveJ", arguments: { program: pid } })).isError).toBeFalsy();
      await client.callTool({ name: "robot_setJoints", arguments: { robot: rid, joints: [30, -80, -100, -10, 90, 0] } });
      expect((await client.callTool({ name: "program_addMoveJ", arguments: { program: pid } })).isError).toBeFalsy();
      const described = await client.callTool({ name: "workspace_describe", arguments: { station: sid } });
      expect(structured(described).station).toBe(name);
      expect(JSON.stringify(structured(described))).toMatch(/Target 1/);
      const robotItem = JSON.parse(String(((await client.readResource({ uri: `enginuity://items/${encodeURIComponent(rid)}` })).contents[0] as { text: string }).text));
      expect(robotItem.joints).toEqual([30, -80, -100, -10, 90, 0]);

      const upd = await client.callTool({ name: "program_update", arguments: { program: pid } });
      expect(upd.isError, JSON.stringify(upd.content)).toBeFalsy();
      const gen = await client.callTool({ name: "program_generate", arguments: { program: pid } });
      expect(gen.isError, JSON.stringify(gen.content)).toBeFalsy();
      const files = (structured(gen).files as { name: string; content: string }[]) ?? [];
      const script = files.find((f) => f.name.endsWith(".script"));
      expect(script?.content).toMatch(/def StdioProg\(\):/);
      expect(script?.content).toMatch(/movej\(/);
      const generated = await client.readResource({ uri: `enginuity://programs/${encodeURIComponent(pid)}/generated` });
      expect(generated.contents.length).toBeGreaterThan(0);
    } finally {
      if (sid) await client.callTool({ name: "station_close", arguments: { station: sid, ifUnsaved: "discard" } }).catch(() => undefined);
      await client.close();
    }
  });

  it("tells the agent to start Enginuity when it is not running", { timeout: 60_000 }, async () => {
    const client = new Client({ name: "mcp-live-down", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT, "scripts/enginuity-mcp.mjs")],
        env: { ...process.env, ENGINUITY_URL: "http://127.0.0.1:9" } as Record<string, string>,
        stderr: "pipe",
      }),
    );
    try {
      await expect(client.listTools()).rejects.toThrow(/Enginuity is not reachable at http:\/\/127\.0\.0\.1:9.*Start the Enginuity app/);
    } finally {
      await client.close();
    }
  });
});
