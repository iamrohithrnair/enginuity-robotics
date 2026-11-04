 
 
 
 
 
 
 

import "server-only";
import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ABOUT } from "@/engine/about";
import { allCommands, type CommandDef } from "@/engine/registry";
import "@/engine/commands";
import { getServer, run } from "../store";

 
export const mcpToolName = (command: string) => command.replace(/\./g, "_").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

export const MCP_INSTRUCTIONS = `Enginuity is a robot simulation and offline-programming app. Every tool is an Enginuity command
(the same ones its menus, shortcuts and Copilot use) and runs in the open app: changes show up live in its 3D view and
can be undone there.

- Start with workspace_describe to see the active station (robots, tools, frames, targets, programs, selection).
  The resource enginuity://station returns the same summary; enginuity://items/{id} details one item.
- Robots, tools and example cells come from the built-in robot library: library_search (brand, type, axes, payload,
  reach), then library_load with the exact "file" value (e.g. "UR5e.robot"). A robot loads under "<robot> Base".
- Units are millimetres and degrees. Poses are xyzrpw = [x, y, z, rx, ry, rz] with pose = transl·rotz·roty·rotx.
- Program flow: program_add → program_addMoveJ / program_addMoveL (teach at the robot's current position, or pass a
  target) → program_update to validate (returns [valid instructions, time s, distance mm, ratio, message]) →
  program_run to simulate (returns at once; poll sim_status) → program_generate for real controller code
  (the files come back in the result and stay readable at enginuity://programs/{id}/generated).
- For repetitive or batch jobs (grids of targets, palletizing, many programs) prefer one script_run call when that
  tool is available: a sandboxed script with a robolink-style API (RDK.AddTarget, prog.MoveL, prog.MakeProgram…).
- Python programs and post processors written by an agent wait until the user approves the exact code in the
  Enginuity window; tell the user when a run is pending approval.
- A tool error carries Enginuity's message: read it, fix the cause and retry. Check results with program_update,
  item_info and collision_check, and report concrete numbers.`;

function inputSchemaOf(c: CommandDef): Tool["inputSchema"] {
  const schema = { ...(z.toJSONSchema(c.schema, { unrepresentable: "any", io: "input" }) as Record<string, unknown>) };
  delete schema.$schema;
  if (schema.type !== "object") return { type: "object", additionalProperties: true };
  return schema as Tool["inputSchema"];
}

interface Catalog {
  tools: Tool[];
   
  commandOf: Map<string, string>;
}

 
export function toolCatalog(): Catalog {
  const tools: Tool[] = [];
  const commandOf = new Map<string, string>();
  for (const c of allCommands().filter((c) => !c.internal)) {
    let name = mcpToolName(c.name);
    for (let i = 2; commandOf.has(name); i++) name = `${mcpToolName(c.name).slice(0, 60)}_${i}`;
    commandOf.set(name, c.name);
    const destructive = !c.readonly && /(^|\.)(delete|remove|close|reset|clear)/i.test(c.name);
    tools.push({
      name,
      title: c.title,
      description: `${c.title}. ${c.description}${c.shortcut ? ` (shortcut ${c.shortcut})` : ""}`,
      inputSchema: inputSchemaOf(c),
      annotations: { title: c.title, readOnlyHint: !!c.readonly, destructiveHint: destructive, openWorldHint: false },
    });
  }
  return { tools, commandOf };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const MAX_TEXT = 200_000;

function toolResult(result: unknown): CallToolResult {
  const json = JSON.stringify(result ?? { ok: true });
  const text = json.length > MAX_TEXT ? `${json.slice(0, MAX_TEXT)}… (truncated; ${json.length} characters)` : json;
  return { content: [{ type: "text", text }], structuredContent: isRecord(result) ? result : { result: result ?? null } };
}

function toolError(message: string, code?: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }], structuredContent: { error: message, ...(code ? { code } : {}) } };
}

 

interface Generated {
  program: string;
  programId: string | null;
  post: string;
  at: string;
  files: { name: string; content: string }[];
}

declare global {
  var __enginuityMcpGenerated: Map<string, Generated> | undefined;
}

 
function generatedPrograms(): Map<string, Generated> {
  if (globalThis.__enginuityMcpGenerated) return globalThis.__enginuityMcpGenerated;
  const map = new Map<string, Generated>();
  globalThis.__enginuityMcpGenerated = map;
  const s = getServer();
  s.listeners.add((e) => {
    if (e.type !== "program-generated") return;
    const name = String(e.program);
    const stationId = s.ws.activeStation;
    const prog = Object.values(s.ws.items).find((i) => i.type === "program" && i.name === name && (!stationId || stationOf(i.id) === stationId));
    const rec: Generated = { program: name, programId: prog?.id ?? null, post: String(e.post), at: new Date().toISOString(), files: (e.files as Generated["files"]) ?? [] };
    if (prog) map.set(prog.id, rec);
    map.set(`name:${name}`, rec);
  });
  return map;
}

function stationOf(id: string): string | null {
  const ws = getServer().ws;
  let cur = ws.items[id];
  while (cur?.parent) cur = ws.items[cur.parent];
  return cur?.type === "station" ? cur.id : null;
}

 

const STATION_URI = "enginuity://station";
const SCREENSHOT_URI = "enginuity://view/screenshot";

async function readResource(uri: string) {
  if (uri === STATION_URI) {
    const res = await run("workspace.describe", {}, "agent");
    if (!res.ok) throw new McpError(ErrorCode.InternalError, res.error ?? "Could not describe the station");
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res.result, null, 1) }] };
  }
  const item = /^enginuity:\/\/items\/(.+)$/.exec(uri);
  if (item) {
    const res = await run("item.info", { item: decodeURIComponent(item[1]), depth: 1 }, "agent");
    if (!res.ok) throw new McpError(ErrorCode.InvalidParams, res.error ?? "Unknown item");
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res.result, null, 1) }] };
  }
  const gen = /^enginuity:\/\/programs\/([^/]+)\/generated$/.exec(uri);
  if (gen) {
    const key = decodeURIComponent(gen[1]);
    const ws = getServer().ws;
    const byName = Object.values(ws.items).find((i) => i.type === "program" && i.name === key);
    const rec = generatedPrograms().get(key) ?? (byName ? generatedPrograms().get(byName.id) : undefined) ?? generatedPrograms().get(`name:${key}`);
    if (!rec) throw new McpError(ErrorCode.InvalidParams, `No generated program for "${key}" yet: call program_generate first`);
    return {
      contents: rec.files.map((f) => ({ uri: `${uri}/${encodeURIComponent(f.name)}`, mimeType: "text/plain", text: f.content })),
      _meta: { program: rec.program, post: rec.post, generatedAt: rec.at },
    };
  }
  if (uri === SCREENSHOT_URI) {
    const res = await run("view.screenshot", { file: "mcp-snapshot.png" }, "agent");
    if (!res.ok) throw new McpError(ErrorCode.InternalError, res.error ?? "Screenshot failed");
    const r = (res.result ?? {}) as Record<string, unknown>;
    const file = String(r.path ?? r.file ?? "");
    const { screenshotPath } = await import("../viewbridge");
    const png = readFileSync(file.startsWith("/") ? file : screenshotPath(file));
    return { contents: [{ uri, mimeType: "image/png", blob: png.toString("base64") }] };
  }
  throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
}

 

const PROMPTS = [
  {
    name: "pick_and_place_cell",
    title: "Build a pick-and-place cell",
    description: "Load a robot and a gripper from the library, add a part and a pick and a place target, build and check a program.",
    arguments: [
      { name: "robot", description: "Robot model, e.g. UR5e", required: false },
      { name: "gripper", description: "Gripper or tool, e.g. RobotiQ 2F-85", required: false },
    ],
    text: (a: Record<string, string>) =>
      `In Enginuity, build a pick-and-place cell with ${a.robot || "a UR5e"} and ${a.gripper || "a two-finger gripper"}: ` +
      "load both from the library, add a box-shaped part on the floor within reach, teach an approach, a pick and a place target, " +
      "create a program that moves approach → pick → retreat → place with sensible speeds, validate it with program_update, " +
      "simulate it with program_run, and report cycle time and any unreachable points.",
  },
  {
    name: "generate_robot_program",
    title: "Generate controller code",
    description: "Validate a program and generate real controller code with a post processor.",
    arguments: [
      { name: "program", description: "Program name", required: true },
      { name: "post", description: "Post processor, e.g. ABB_RAPID_IRC5, KUKA_KRC4, Universal_Robots (default: the robot's)", required: false },
    ],
    text: (a: Record<string, string>) =>
      `In Enginuity, validate the program "${a.program}" with program_update, fix any unreachable moves, then generate it with ` +
      `program_generate${a.post ? ` using the post processor ${a.post}` : ""} and show me the generated files.`,
  },
] as const;

 

 
export function createMcpServer(): Server {
  const server = new Server(
    { name: "enginuity", title: ABOUT.product, version: ABOUT.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS },
  );
  generatedPrograms();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolCatalog().tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { commandOf } = toolCatalog();
    const command = commandOf.get(req.params.name);
    if (!command) return toolError(`Unknown tool "${req.params.name}". Call tools/list for the available Enginuity tools.`);
    const res = await run(command, req.params.arguments ?? {}, "agent");
    return res.ok ? toolResult(res.result) : toolError(res.error ?? "The command failed", res.code);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const ws = getServer().ws;
    const programs = [...generatedPrograms().entries()]
      .filter(([key, rec]) => !key.startsWith("name:") && ws.items[key] && rec.programId === key)
      .map(([id, rec]) => ({ uri: `enginuity://programs/${encodeURIComponent(id)}/generated`, name: `generated-${rec.program}`, title: `${rec.program} (${rec.post})`, mimeType: "text/plain" }));
    return {
      resources: [
        { uri: STATION_URI, name: "station", title: "Active station", description: "Summary of the active station: tree, robots, targets, programs, selection, simulation state.", mimeType: "application/json" },
        { uri: SCREENSHOT_URI, name: "view-screenshot", title: "3D view snapshot", description: "PNG of the 3D view (needs an Enginuity window open in a browser).", mimeType: "image/png" },
        ...programs,
      ],
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      { uriTemplate: "enginuity://items/{id}", name: "item", title: "Station item", description: "One item by id or name: pose, joints, children, type-specific data.", mimeType: "application/json" },
      { uriTemplate: "enginuity://programs/{id}/generated", name: "generated-program", title: "Generated program files", description: "The files of the last program_generate for a program (id or name).", mimeType: "text/plain" },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => readResource(req.params.uri));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: [...args] })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = PROMPTS.find((x) => x.name === req.params.name);
    if (!p) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${req.params.name}`);
    const args = (req.params.arguments ?? {}) as Record<string, string>;
    return { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(args) } }] };
  });

  return server;
}
