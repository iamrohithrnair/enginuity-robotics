 
 
 
 
 
 
 

import "server-only";
import { Agent, OpenAIProvider, Runner, setTracingDisabled, tool, type AgentInputItem, type ModelSettings } from "@openai/agents";
import OpenAI from "openai";
import { Agent as HttpAgent, fetch as httpFetch } from "undici";
import { z } from "zod";
import { allCommands } from "@/engine/registry";
import { scriptRunView, type ScriptItemRef, type ScriptRunResult } from "@/engine/scripts";
import { copilotConnection, copilotInfo, guardConnection, knownSecrets, samConnection, webSearchConnection, type CopilotInfo } from "./copilot/config";
import {
  checkScope,
  classifyYesNo,
  gateCommand,
  newConversationWebState,
  newTurnState,
  SECURITY_INSTRUCTIONS,
  type ConversationWebState,
  type GuardConfig,
  type TurnState,
} from "./copilot/guardrails";
import { buildPhotoTools, MAX_IMAGES_PER_CONVERSATION, PHOTO_TOOL_COMMANDS, photoInstructions, userContent, type ChatImage } from "./copilot/vision";
import { buildWebTools, WEB_INSTRUCTIONS, WEB_TOOL_COMMANDS } from "./copilot/websearch";
import { getServer, run } from "./store";

setTracingDisabled(true);

export const toolName = (cmd: string) => cmd.replace(/\./g, "_");

const INSTRUCTIONS = `You are Enginuity Copilot, an expert robot simulation and offline-programming assistant built into
Enginuity. You operate the application ONLY through the provided tools — every tool is an Enginuity command, the same
ones the menus and shortcuts use — and through Enginuity scripts (script_run), which run on those same commands.

Working rules:
- Start by calling workspace_describe to see the station, unless you already know it.
- Robots come from the online robot library: use library_search (filters: brand, type, axes, payload, reach), then
  library_load with the exact "file" value (e.g. "UR5e.robot"). Loading creates "<robot> Base" + the robot.
- Units: millimetres and degrees. Poses are xyzrpw = [x, y, z, rx, ry, rz] with pose = transl·rotz(rz)·roty(ry)·rotx(rx).
- Typical program flow: program_add → program_addInstruction (speed/rounding) → move the robot (robot_setJoints,
  robot_moveTo or robot_jogCartesian) → program_addMoveJ / program_addMoveL (each teaches a target at the current
  robot position when no target is given) → program_update to validate → program_run to simulate →
  program_generate to produce controller code.
- program_run starts the simulation and returns immediately; call sim_status to see whether it is still busy.
  program_update returns [valid instructions, time s, distance mm, ratio (1 ok, 0 unreachable), message].
- Enginuity conventions: default names are "Frame N", "Target N", "ProgN"; new frames are placed 1 m apart along Y;
  deleting a robot alone in its base frame deletes the frame; visibility is per item.
- After building something, verify it (program_update, item_info, collision_check) and report concrete numbers.
- Tool names use underscores exactly as listed (e.g. workspace_describe, robot_setJoints). Never invent tool names.
- If a tool returns an error, read the message, fix the cause and retry instead of giving up.
- Keep answers short; use bullet lists for results. Never invent items that do not exist.
- Talk about Enginuity only: never mention other robot simulators or offline-programming products to the user (robot
  makers and their robots, tools and controllers are fine). The one exception: when the user
  asks about running existing Python scripts written for the robolink API, you may say that Enginuity runs them
  unchanged with its own Python API (the \`enginuity\` package ships with Enginuity; nothing needs to be installed).

NVIDIA SimReady assets (props for the cell):
- Enginuity can bring in 2,677 NVIDIA SimReady assets: OpenUSD props such as boxes, pallets, crates, bins, conveyors,
  racks, carts, trolleys, workbenches, tools, food and medical equipment (CC BY 4.0). Find them with simready_search
  (query and/or category), then call simready_load with the exact "id" it returned; the result gives the object's size
  in mm, so you can place it sensibly with an xyzrpw pose.
- Assets download on first use: load only what the user asked for or clearly needs. Robots still come from
  library_search / library_load.

Scripts (script_run) for batch work:
- Use ONE script for repetitive or multi-step batch work: grids and pallets of targets, programs with many instructions,
  several programs or robots, sweeps over joints or poses, checking or generating many programs. Use the individual
  tools for single actions (load one robot, add one target, move a joint, answer a question about the station).
- Write JavaScript with the Enginuity script API described in the script_run tool (script_reference has examples):
  RDK.AddFrame/AddTarget/AddProgram/ItemList, robot.MoveJ/MoveL/Pose/SolveIK, prog.MoveJ/MoveL/setSpeed/setDO/Update,
  transl/rotx/roty/rotz/Offset/RelTool, poses as Mat with A.mul(B). Calls are synchronous; there is no import, file
  system or network access. Give each script a short descriptive name.
- Keep scripts simple and complete: plain for loops, poses built as Mat (transl(x, y, z).mul(rotx(pi))), only names
  from the reference, balanced brackets. Place every new frame with a pose and build its targets relative to it.
  Validate with prog.Update() and print() the numbers you will report.
- For controller code use the real post processors: prog.MakeProgram(), or RDK.setRunMode(RUNMODE_MAKE_ROBOTPROG),
  RDK.ProgramStart(name, "", post, robot), robot moves, then RDK.Finish().
- script_run returns the printed log, any error with its line number, the items created/changed/deleted and the
  generated files; the whole run is one undo step. A run that fails is undone automatically (reverted: true), so fix
  the reported line and run the whole script again. Errors name the API function that is wrong and suggest the right one.
- Scripts run without asking because they can only do what your tools can do. Python programs and post processors you
  write still need the user's approval before they run.

Decision models (typed judgements in well under a second):
- decision_profiles lists the decision models the user set up (OpenAI GPT-6 Luna, TypeSafe Jev, Microsoft-Decision-1,
  Cloudflare Clef, Perplexity Decider…). If none is ready, ask the user to add one in Copilot ▸ Decision models. You can
  never see or set API keys.
- decision_ask answers yesno (probability of yes), choice (one option, a probability per option), score (a level of an
  ordered rubric) and box (where something is in an image, Jev 1.14) questions. Use it whenever a step needs a judgement
  rather than arithmetic: classify a part or situation, choose among candidate robots, targets or programs, check a
  condition before acting (is the gripper above the part? is the cell clear?), rate a result. Put the facts in "text",
  set includeStation for robots, joints, TCP positions, objects and IOs, and image "view" to show the 3D view. Ask
  several questions in one call. Act on the answer and report it with its probability; below about 0.7, say the
  decision is uncertain or ask the user before doing anything irreversible.
- For decisions while a program runs, use program_addDecision: a question, an input template ({{IO_1}}, {{robot.tcp}},
  {{robot.joints}}, station parameters), and actions per outcome (continue, stop, call or start a program, setIO,
  setVar, message). Every run asks the model again; the answer lands in a station parameter (storeAs) and its
  probability in <storeAs>_P. instruction_editDecision changes one; decision_test checks a model's key and settings.`;

 
function identity(info: CopilotInfo) {
  const model = info.model.vendor && !info.model.label.startsWith(info.model.vendor) ? `${info.model.vendor} ${info.model.label}` : info.model.label;
  const extras = [info.webSearch.enabled ? "web research uses Meta search grounding" : "", info.sam.enabled ? "objects in attached photos are found with Meta's SAM 3.1" : ""].filter(Boolean);
  return `\n\nIdentity (say this only when the user asks which model, provider or search you use): you are powered by ${model} running on ${info.provider.label}${extras.length ? `; ${extras.join("; ")}` : ""}.`;
}

interface Conversation {
  history: AgentInputItem[];
  updated: number;
   
  web?: ConversationWebState;
   
  images?: ChatImage[];
}

declare global {
  var __robocraftChats: Map<string, Conversation> | undefined;
}
const chats = (globalThis.__robocraftChats ??= new Map());

function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...schema };
  delete rest.$schema;
  if (rest.type !== "object") return { type: "object", properties: {}, additionalProperties: true };
  return rest;
}






const HIDDEN_PARAMS: Record<string, string[]> = { "script.run": ["keepOnError", "run"] };

function hideParams(cmd: string, schema: Record<string, unknown>) {
  const hidden = HIDDEN_PARAMS[cmd];
  if (!hidden || !schema.properties) return schema;
  const properties = { ...(schema.properties as Record<string, unknown>) };
  for (const k of hidden) delete properties[k];
  return { ...schema, properties };
}

const stationName = (id: string | null | undefined) => (id ? (getServer().ws.items[id]?.name ?? id) : "(none)");






export interface StationGuard {
  station: string | null;
}

export function buildTools(onEvent: (e: Record<string, unknown>) => void, guard?: StationGuard, turn?: TurnState) {
  return allCommands()
    .filter((c) => !c.internal)
    .map((c) =>
      tool({
        name: toolName(c.name),
        description: `${c.title}. ${c.description}${c.shortcut ? ` (shortcut ${c.shortcut})` : ""}`,
        parameters: hideParams(c.name, stripSchema(z.toJSONSchema(c.schema, { unrepresentable: "any", io: "input" }) as Record<string, unknown>)) as never,
        strict: false,
        async execute(args: unknown) {
          const params = { ...((args ?? {}) as Record<string, unknown>) };
          for (const k of HIDDEN_PARAMS[c.name] ?? []) delete params[k];
           
          if (turn) {
            const gate = gateCommand({ name: c.name, readonly: c.readonly, undoable: c.undoable, category: c.category, detached: c.detached }, params, turn);
            if (!gate.allowed) {
              onEvent(gate.event);
              onEvent({ type: "tool_result", tool: c.name, ok: false, error: gate.error });
              return `ERROR: ${gate.error}`;
            }
          }
           
          if (c.name === "settings.set" && /^RC_AGENT_/i.test(String(params.key ?? ""))) {
            const error = `${String(params.key)} is a Copilot connection setting; only the user can change it in Options ▸ Copilot.`;
            onEvent({ type: "tool_result", tool: c.name, ok: false, error });
            return `ERROR: ${error}`;
          }
           
          const res = await run(c.name, params, "agent", guard ? { station: guard.station } : {});
          if (res.code === "station_changed") {
            const now = stationName(getServer().ws.activeStation);
            const error = `${res.error} while you were working. Stop and ask the user before doing anything on "${now}".`;
            onEvent({ type: "tool_result", tool: c.name, ok: false, error });
            return `ERROR: ${error}`;
          }
           
          if (guard) guard.station = getServer().ws.activeStation ?? null;
           
          const decision = res.ok && (c.name === "decision.ask" || c.name === "decision.test") ? res.result : undefined;
           
          const script = res.ok && c.name === "script.run" ? (res.result as ScriptRunResult) : undefined;
          onEvent({
            type: "tool_result",
            tool: c.name,
            ok: res.ok && (script?.ok ?? true),
            error: res.error ?? script?.error?.message ?? null,
            ...(decision ? { decision } : {}),
            ...(script ? { script: scriptRunView(script, typeof (args as { code?: unknown })?.code === "string" ? (args as { code: string }).code : null) } : {}),
          });
          if (!res.ok) return `ERROR: ${res.error}`;
          const text = JSON.stringify(script ? scriptForModel(script) : (res.result ?? { ok: true }));
          return text.length > 12000 ? `${text.slice(0, 12000)}… (truncated)` : text;
        },
      }),
    );
}

const refNames = (list: ScriptItemRef[], max: number) =>
  list.length > max ? [...list.slice(0, max).map((i) => `${i.name} (${i.type})`), `… ${list.length - max} more`] : list.map((i) => `${i.name} (${i.type})`);

 
function scriptForModel(r: ScriptRunResult) {
  const logs = r.logs.length > 160 ? [...r.logs.slice(0, 40), `… ${r.logs.length - 140} lines …`, ...r.logs.slice(-100)] : r.logs;
  const preview = r.generated.length <= 3;
  return {
    ok: r.ok,
    name: r.name,
    ...(r.error ? { error: { message: r.error.message, line: r.error.line, column: r.error.column, source: r.error.source } } : {}),
    logs,
    ...(r.result !== undefined ? { result: r.result } : {}),
    calls: r.calls,
    ms: r.ms,
    created: refNames(r.created, 60),
    changed: refNames(r.changed, 60),
    deleted: refNames(r.deleted, 60),
    generated: r.generated.map((g) => ({
      program: g.program,
      post: g.post,
      files: g.files.map((f, i) => ({ name: f.name, path: f.path, bytes: f.bytes, ...(preview && i === 0 && f.content ? { preview: f.content.slice(0, 1200) } : {}) })),
    })),
    undo: r.undo,
    ...(r.reverted ? { reverted: true } : {}),
  };
}

 
export function agentConfig() {
  return copilotConnection();
}







function modelSettings(cfg: ReturnType<typeof agentConfig>): ModelSettings {
  const settings: ModelSettings = {};
  if (cfg.reasoning !== "default") settings.reasoning = { effort: cfg.reasoning as never };
  return settings;
}

const commandForTool = () => new Map(allCommands().map((c) => [toolName(c.name), c.name]));

 
interface TurnStats {
  started: number;
  firstOutputMs: number | null;
  requests: number;
  tools: number;
  toolsBytes: number;
  requestBytes: number;
  reasoningEffort: string | null;
}






const modelDispatcher = new HttpAgent({ headersTimeout: 0, bodyTimeout: 0 });






const compatFetch =
  (stats?: TurnStats): typeof fetch =>
  async (input, init) => {
    if (init?.body && typeof init.body === "string" && init.body.includes('"messages"')) {
      try {
        const body = JSON.parse(init.body) as { messages?: { content?: unknown }[]; tools?: unknown[]; reasoning_effort?: unknown };
        for (const m of body.messages ?? []) if (m.content === null || m.content === undefined) m.content = "";
        init = { ...init, body: JSON.stringify(body) };
        if (stats) {
          if (!stats.requests++) stats.toolsBytes = body.tools ? JSON.stringify(body.tools).length : 0;
          stats.tools = body.tools?.length ?? 0;
          stats.requestBytes = (init.body as string).length;
          stats.reasoningEffort = typeof body.reasoning_effort === "string" ? body.reasoning_effort : null;
        }
      } catch {
         
      }
    }
    return httpFetch(input as Parameters<typeof httpFetch>[0], { ...init, dispatcher: modelDispatcher } as Parameters<typeof httpFetch>[1]) as unknown as Promise<Response>;
  };

 
const withoutReasoning = (history: AgentInputItem[]) => history.filter((i) => (i as { type?: string }).type !== "reasoning");





export function pairedHistory(history: AgentInputItem[]): AgentInputItem[] {
  const item = (i: AgentInputItem) => i as { type?: string; callId?: string };
  const answered = new Set(history.filter((i) => item(i).type === "function_call_result").map((i) => item(i).callId));
  return history.filter((i) => item(i).type !== "function_call" || answered.has(item(i).callId));
}

 
function lastAssistantText(history: AgentInputItem[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i] as { role?: string; content?: unknown };
    if (m.role !== "assistant") continue;
    const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((c: { text?: unknown }) => (typeof c?.text === "string" ? c.text : "")).join("") : "";
    if (text.trim()) return text.slice(-1500);
  }
  return "";
}

const assistantMessage = (text: string) => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }) as AgentInputItem;

 
const ABOUT_COPILOT =
  /\b(which|what)\b[^?.!]{0,40}\b(model|llm|ai|provider|engine|search|cloud)\b[^?.!]{0,40}\b(you|your|copilot)\b|\bwho (made|built|powers|runs) (you|the copilot)\b|\b(are you|you're) (powered|running|built|hosted)\b/i;





let guardWoken = 0;
export function wakeGuard() {
  const cfg = guardConnection();
  if (!cfg?.enabled || Date.now() - guardWoken < 120_000) return;
  guardWoken = Date.now();
  void classifyYesNo({ ...cfg, timeoutMs: 60_000 }, "Answer with one word: yes or no.", "Is a robot arm a machine?").catch(() => null);
}

export async function* chat(
  conversationId: string,
  message: string,
   
  scope: { settings?: Record<string, unknown>; env?: Record<string, string | undefined> } = {},
   
  images: ChatImage[] = [],
): AsyncGenerator<Record<string, unknown>> {
  const stats: TurnStats = { started: Date.now(), firstOutputMs: null, requests: 0, tools: 0, toolsBytes: 0, requestBytes: 0, reasoningEffort: null };
  await getServer().ready;
  const cfg = copilotConnection(scope.settings, scope.env);
  const info = copilotInfo(scope.settings, scope.env);
  yield { type: "meta", ...info };
  if (cfg.error) {
    yield { type: "error", message: info.error ?? cfg.error };
    return;
  }
  const conv: Conversation = chats.get(conversationId) ?? { history: [], updated: Date.now() };
  const web = (conv.web ??= newConversationWebState());
   
  const photos = [...(conv.images ?? []).filter((p) => !images.some((n) => n.id === p.id)), ...images].slice(-MAX_IMAGES_PER_CONVERSATION);
  const turn = newTurnState();
  const sam = samConnection(scope.settings, scope.env, cfg);
  const userTurn = { role: "user", content: userContent(message, images, sam.enabled) } as AgentInputItem;
  const done = () => {
    const { started, ...rest } = stats;
    return { type: "done", stats: { ms: Date.now() - started, ...rest } };
  };
   
  const guardCfg: GuardConfig | null = guardConnection(scope.settings, scope.env, cfg);
   
  const scopeCfg: GuardConfig | null = guardCfg ?? (getServer().services.settings.RC_AGENT_GUARD === false ? null : { enabled: true, baseURL: "", apiKey: "", model: "" });
  if (scopeCfg?.enabled) {
    const scope = await checkScope(scopeCfg, message, lastAssistantText(conv.history)).catch(() => ({ allowed: true as const, probability: null, event: undefined, reply: undefined }));
    if (!scope.allowed && !(scope.event?.kind === "scope" && message.length <= 160 && ABOUT_COPILOT.test(message))) {
      const reply = scope.reply || "I can only help with robot cells, robot programming and Enginuity.";
      if (scope.event) yield scope.event;
      yield { type: "text", delta: reply };
      chats.set(conversationId, { history: [...conv.history, userTurn, assistantMessage(reply)], updated: Date.now(), web, images: photos });
      yield done();
      return;
    }
  }
  const queue: Record<string, unknown>[] = [];
  const push = (e: Record<string, unknown>) => queue.push(e);
  const search = webSearchConnection(scope.settings, scope.env, cfg);
  const tools = [
    ...buildTools(push, { station: getServer().ws.activeStation ?? null }, turn),
    ...(search.enabled
      ? buildWebTools({ baseURL: search.baseURL, apiKey: search.apiKey, model: search.model, guard: guardCfg, knownSecrets: knownSecrets(scope.settings, scope.env) }, turn, web, push)
      : []),
    ...(sam.enabled ? buildPhotoTools({ baseURL: sam.baseURL, apiKey: sam.apiKey, model: sam.model }, () => photos, push) : []),
  ];
  const instructions = `${INSTRUCTIONS}\n\n${photoInstructions(sam.enabled)}\n\n${SECURITY_INSTRUCTIONS}${search.enabled ? `\n\n${WEB_INSTRUCTIONS}` : ""}${identity(info)}`;
  const agent = new Agent({ name: "Enginuity Copilot", instructions, model: cfg.model, tools, modelSettings: modelSettings(cfg) });
  const client = new OpenAI({ apiKey: cfg.apiKey || "not-needed", baseURL: cfg.baseURL, fetch: compatFetch(stats) });
  const provider = new OpenAIProvider({ openAIClient: client as never, useResponses: cfg.api === "responses" });
  const runner = new Runner({ modelProvider: provider, tracingDisabled: true });
  let input: AgentInputItem[] = [...pairedHistory(conv.history), userTurn];
  const names = commandForTool();
  for (const [t, cmd] of Object.entries({ ...WEB_TOOL_COMMANDS, ...PHOTO_TOOL_COMMANDS })) names.set(t, cmd);
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcome = yield* runOnce(runner, agent, input, queue, names, stats);
    if (outcome.ok) {
      chats.set(conversationId, { history: pairedHistory(withoutReasoning(outcome.history)), updated: Date.now(), web, images: photos });
      yield done();
      return;
    }
     
    if (/Tool .* not found/i.test(outcome.error) && attempt < 2) {
      input = [
        ...pairedHistory(outcome.history.length ? outcome.history : input),
        { role: "user", content: `(Enginuity) ${outcome.error}. Use one of the exact tool names, e.g. ${[...names.keys()].slice(0, 12).join(", ")}…` } as AgentInputItem,
      ];
      continue;
    }
    yield { type: "error", message: outcome.error };
    return;
  }
}

async function* runOnce(
  runner: Runner,
  agent: Agent,
  input: AgentInputItem[],
  queue: Record<string, unknown>[],
  names: Map<string, string>,
  stats?: TurnStats,
): AsyncGenerator<Record<string, unknown>, { ok: true; history: AgentInputItem[] } | { ok: false; error: string; history: AgentInputItem[] }> {
  let result;
  let texted = false;
  const firstOutput = () => {
    if (stats && stats.firstOutputMs === null) stats.firstOutputMs = Date.now() - stats.started;
  };
  try {
    result = await runner.run(agent, input, { stream: true, maxTurns: 60 });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), history: [] };
  }
  try {
    for await (const ev of result) {
      while (queue.length) yield queue.shift()!;
      if (ev.type === "raw_model_stream_event") {
        const d = ev.data as { type?: string; delta?: string };
         
        const delta = texted ? d.delta : d.delta?.replace(/^\s+/, "");
        if (d.type === "output_text_delta" && delta) {
          firstOutput();
          texted = true;
          yield { type: "text", delta };
        }
      } else if (ev.type === "run_item_stream_event") {
        const item = ev.item as { type: string; rawItem?: { name?: string; arguments?: string; callId?: string } };
        if (ev.name === "tool_called" && item.rawItem?.name) {
          firstOutput();
          const name = names.get(item.rawItem.name) ?? item.rawItem.name;
          let args: unknown = item.rawItem.arguments;
          try {
            args = JSON.parse(String(item.rawItem.arguments ?? "{}"));
          } catch {
             
          }
          yield { type: "tool_call", tool: name, args };
        }
      }
    }
    await result.completed;
    while (queue.length) yield queue.shift()!;
    return { ok: true, history: result.history };
  } catch (err) {
    while (queue.length) yield queue.shift()!;
    let history: AgentInputItem[] = [];
    try {
      history = result.history;
    } catch {
       
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err), history };
  }
}

export function resetChat(conversationId: string) {
  chats.delete(conversationId);
}
