#!/usr/bin/env node
// Bridges MCP stdio clients to the running app's Streamable HTTP endpoint.
 
 
 
 
 
 
 
 

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.ENGINUITY_URL || "http://localhost:3100").replace(/\/+$/, "");
const ENDPOINT = new URL(`${BASE}/api/mcp`);
const TOKEN = process.env.ENGINUITY_MCP_TOKEN?.trim();
const VERSION = "1.0.0";

 
const PORT = ENDPOINT.port || (ENDPOINT.protocol === "https:" ? "443" : "80");
const START = PORT === "3000" ? "npm run dev" : `npx next dev -p ${PORT}`;
const ELSEWHERE = PORT === "3000" ? "" : " (for example ENGINUITY_URL=http://localhost:3000 for a plain npm run dev)";

const notRunning = (err) =>
  `Enginuity is not reachable at ${BASE} (${err?.message ?? err}). Start the Enginuity app on port ${PORT} ` +
  `(in its folder: ${START}), or point this bridge at the address where it runs with the ENGINUITY_URL ` +
  `environment variable${ELSEWHERE}.`;

 
let upstream = null;

function connectUpstream() {
  upstream ??= (async () => {
    const client = new Client({ name: "enginuity-stdio-bridge", version: VERSION });
    const transport = new StreamableHTTPClientTransport(ENDPOINT, {
      requestInit: { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} },
    });
    await client.connect(transport);
    return client;
  })().catch((err) => {
    upstream = null;
    throw new McpError(ErrorCode.InternalError, notRunning(err));
  });
  return upstream;
}

 
async function forward(fn) {
  let client = await connectUpstream();
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof McpError && err.code !== ErrorCode.ConnectionClosed && err.code !== ErrorCode.RequestTimeout) throw err;
    upstream = null;
    client = await connectUpstream();
    return fn(client);
  }
}

async function main() {
   
  let instructions = "Enginuity tools act on the running Enginuity app. If a call reports that Enginuity is not reachable, ask the user to start it.";
  try {
    const client = await Promise.race([connectUpstream(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))]);
    instructions = client.getInstructions() ?? instructions;
  } catch (err) {
    process.stderr.write(`[enginuity-mcp] ${err?.message ?? err}\n`);
  }

  const server = new Server(
    { name: "enginuity", title: "Enginuity", version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, (req) => forward((c) => c.listTools(req.params)));
  server.setRequestHandler(CallToolRequestSchema, (req) => forward((c) => c.callTool(req.params)));
  server.setRequestHandler(ListResourcesRequestSchema, (req) => forward((c) => c.listResources(req.params)));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) => forward((c) => c.listResourceTemplates(req.params)));
  server.setRequestHandler(ReadResourceRequestSchema, (req) => forward((c) => c.readResource(req.params)));
  server.setRequestHandler(ListPromptsRequestSchema, (req) => forward((c) => c.listPrompts(req.params)));
  server.setRequestHandler(GetPromptRequestSchema, (req) => forward((c) => c.getPrompt(req.params)));

  const stdio = new StdioServerTransport();
  stdio.onclose = () => process.exit(0);
  await server.connect(stdio);
  process.stderr.write(`[enginuity-mcp] serving Enginuity at ${BASE} over stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`[enginuity-mcp] ${err?.stack ?? err}\n`);
  process.exit(1);
});
