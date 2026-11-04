 
 
 
 
 
 

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

function extraHosts(): string[] {
  return (process.env.ENGINUITY_MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

 
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.replace(/:\d+$/, "");
}

const isLoopbackAddress = (a: string) => /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/i.test(a.trim());

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function tokenMatches(header: string | null, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

 
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
    vary: "Origin",
  };
}

 
export function guard(req: Request, checkToken = true): Response | null {
  const token = process.env.ENGINUITY_MCP_TOKEN?.trim();
  const allowed = new Set([...LOOPBACK_HOSTS, ...extraHosts()]);
  const host = req.headers.get("host");
  if (!host || !allowed.has(hostName(host))) return jsonRpcError(403, "Forbidden: the Enginuity MCP endpoint only accepts requests addressed to this computer (localhost)");
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let ok = false;
    try {
      ok = allowed.has(new URL(origin).hostname.toLowerCase()) || allowed.has(`[${new URL(origin).hostname.toLowerCase()}]`);
    } catch {
      ok = false;
    }
    if (!ok) return jsonRpcError(403, `Forbidden: origin ${origin} is not allowed to use the Enginuity MCP endpoint`);
  }
   
  const chain = (req.headers.get("x-forwarded-for") ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  if (chain.some((a) => !isLoopbackAddress(a)) && !(token && extraHosts().length)) {
    return jsonRpcError(403, "Forbidden: the Enginuity MCP endpoint only accepts connections from this computer (set ENGINUITY_MCP_TOKEN and ENGINUITY_MCP_ALLOWED_HOSTS to allow others)");
  }
  if (checkToken && token && !tokenMatches(req.headers.get("authorization"), token)) {
    return jsonRpcError(401, "Unauthorized: send the Enginuity MCP token as 'Authorization: Bearer <token>'", { "www-authenticate": 'Bearer realm="enginuity"' });
  }
  return null;
}

 
export async function handleMcpPost(req: Request): Promise<Response> {
  const denied = guard(req);
  if (denied) return denied;
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(req.headers.get("origin")))) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } finally {
     
    void server.close();
  }
}

 
export function handleMcpOther(req: Request): Response {
  const denied = guard(req);
  if (denied) return denied;
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: the Enginuity MCP endpoint is stateless; send JSON-RPC requests with POST" }, id: null }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST, OPTIONS", ...corsHeaders(req.headers.get("origin")) },
  });
}

 
export function handleMcpOptions(req: Request): Response {
   
  const denied = guard(req, false);
  if (denied) return denied;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
