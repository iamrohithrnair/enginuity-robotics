// Verifies stdio bridge errors explain how to reach or start the app.
 
 
import { createServer } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

 
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

describe("stdio bridge without a running app", () => {
  it("names the port it uses, the command that serves the app there, and ENGINUITY_URL", { timeout: 60_000 }, async () => {
    const port = await closedPort();
    const base = `http://127.0.0.1:${port}`;
    const client = new Client({ name: "mcp-bridge-down", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT, "scripts/enginuity-mcp.mjs")],
        env: { ...process.env, ENGINUITY_URL: base } as Record<string, string>,
        stderr: "pipe",
      }),
    );
    try {
      const err = await client.listTools().then(
        () => null,
        (e: unknown) => String(e instanceof Error ? e.message : e),
      );
      expect(err).toContain(`Enginuity is not reachable at ${base}`);
      expect(err).toContain(`Start the Enginuity app on port ${port} (in its folder: npx next dev -p ${port})`);
      expect(err).toContain("point this bridge at the address where it runs with the ENGINUITY_URL environment variable");
      expect(err).toContain("ENGINUITY_URL=http://localhost:3000 for a plain npm run dev");
      expect(err).not.toContain("(in its folder: npm run dev)");
    } finally {
      await client.close();
    }
  });
});
