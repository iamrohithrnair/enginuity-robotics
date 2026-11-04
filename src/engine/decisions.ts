 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { fk } from "./kinematics";
import { mul } from "./math";
import { stationParams } from "./stationParams";
import type { Item, Workspace } from "./types";
import { absPose, descendants, stationOf, toolPose } from "./workspace";

 



export type DecisionQuestionType = "yesno" | "choice" | "score" | "box";

export interface DecisionOption {
  value: string;
  description?: string;
}

export interface DecisionLevel {
  label: string;
  description?: string;
}

export interface DecisionQuestion {
   
  name: string;
  type: DecisionQuestionType;
  instructions: string;
   
  options?: DecisionOption[];
   
  levels?: DecisionLevel[];
   
  yes?: string;
  no?: string;
}

export interface DecisionAnswer {
  name: string;
  type: DecisionQuestionType | "refusal";
   
  probability?: number;
   
  choice?: string;
   
  score?: number;
   
  level?: string;
   
  confidence?: number;
   
  probabilities?: { label: string; probability: number }[];
   
  box?: { top: number; bottom: number; left: number; right: number };
}

export interface DecisionResult {
   
  id?: string;
  profile: { id: string; name: string; provider: DecisionProviderId; model: string };
   
  model: string;
  answers: DecisionAnswer[];
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
}

export interface DecisionAskRequest {
   
  profile?: string | null;
  questions: DecisionQuestion[];
   
  text?: string;
   
  state?: unknown;
   
  images?: string[];
  timeoutMs?: number;
}

 
export const DECISION_TEST_REQUEST: Omit<DecisionAskRequest, "profile"> = {
  text: "A collaborative robot just closed its gripper on a part. The gripper reports a grip force of 38 N (nominal 40 N), the part sensor is on, and the vision check measured the part 2 mm off-center (tolerance 3 mm).",
  questions: [
    { name: "grasp_ok", type: "yesno", instructions: "Is the grasp good enough to continue the program?" },
    {
      name: "next_step",
      type: "choice",
      instructions: "What should the robot do next?",
      options: [
        { value: "continue", description: "Move the part to the place position" },
        { value: "regrasp", description: "Open the gripper and pick the part again" },
        { value: "alarm", description: "Stop and call an operator" },
      ],
    },
  ],
};

 

export type DecisionProviderId = "openai" | "openrouter" | "typesafe" | "perplexity" | "cloudflare" | "azure" | "vercel" | "custom";
export type DecisionWire = "openai" | "systemone";


export type DecisionImageMode = "openai-parts" | "state-parts" | "assets" | "images-array" | "none";

export interface DecisionModelInfo {
  id: string;
  label: string;
  images?: boolean;
  box?: boolean;
  note?: string;
}

export interface DecisionProviderInfo {
  id: DecisionProviderId;
  label: string;
  wire: DecisionWire;
  

  endpoint: string;
  models: DecisionModelInfo[];
  defaultModel: string;
   
  keyEnv: string[];
  keyLabel: string;
   
  needs: ("accountId" | "endpoint")[];
   
  auth: "bearer" | "api-key";
  imageMode: DecisionImageMode;
  maxQuestions: number;
  maxOptions: number;
  maxLevels: number;
  maxImages: number;
  docs: string;
  blurb: string;
}

export const DECISION_PROVIDERS: DecisionProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    wire: "openai",
    endpoint: "https://api.openai.com/v1",
    models: [{ id: "gpt-6-luna", label: "GPT-6 Luna", images: true }],
    defaultModel: "gpt-6-luna",
    keyEnv: ["OPENAI_API_KEY"],
    keyLabel: "OpenAI API key",
    needs: [],
    auth: "bearer",
    imageMode: "openai-parts",
    maxQuestions: 200,
    maxOptions: 255,
    maxLevels: 255,
    maxImages: 128,
    docs: "https://developers.openai.com/api/docs/guides/decisions",
    blurb: "Decisions API: predicate, choice and score questions over text and images.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    wire: "systemone",
    endpoint: "https://openrouter.ai/api/alpha/decisions",
    models: [
      { id: "typesafe/jev-1.14", label: "Jev 1.14 (TypeSafe)", images: true, box: true },
      { id: "~typesafe/jev-latest", label: "Jev latest (TypeSafe)", images: true },
      { id: "microsoft/microsoft-decision-1", label: "Microsoft-Decision-1", note: "text and JSON only" },
      { id: "perplexity/pplx-decider-v1.2", label: "Decider v1.2 (Perplexity)", images: true },
      { id: "perplexity/pplx-decider-flash-v1.2", label: "Decider Flash v1.2 (Perplexity)", images: true },
      { id: "cloudflare/clef", label: "Clef (Cloudflare)", images: true },
      { id: "cloudflare/clef-flash", label: "Clef Flash (Cloudflare)", images: true },
      { id: "openai/gpt-6-luna-decisions", label: "GPT-6 Luna Decisions (OpenAI)", images: true },
    ],
    defaultModel: "typesafe/jev-1.14",
    keyEnv: ["OPENROUTER_API_KEY"],
    keyLabel: "OpenRouter API key",
    needs: [],
    auth: "bearer",
    imageMode: "state-parts",
    maxQuestions: 64,
    maxOptions: 255,
    maxLevels: 10,
    maxImages: 4,
    docs: "https://openrouter.ai/docs/guides/community/jev",
    blurb: "One key for Jev, Microsoft-Decision-1, Decider, Clef and GPT-6 Luna Decisions.",
  },
  {
    id: "typesafe",
    label: "TypeSafe",
    wire: "systemone",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    models: [
      { id: "jev-latest", label: "Jev latest", images: true },
      { id: "jev-1.14.0", label: "Jev 1.14", images: true, box: true },
      { id: "jev-preview", label: "Jev preview", images: true, box: true },
      { id: "jev-1.13.0", label: "Jev 1.13", images: true },
    ],
    defaultModel: "jev-1.14.0",
    keyEnv: ["TYPESAFE_API_KEY"],
    keyLabel: "TypeSafe API key",
    needs: [],
    auth: "bearer",
    imageMode: "assets",
    maxQuestions: 64,
    maxOptions: 255,
    maxLevels: 10,
    maxImages: 8,
    docs: "https://docs.typesafe.ai/api",
    blurb: "Jev direct from TypeSafe's System One API, including Box questions on images.",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    wire: "systemone",
    endpoint: "https://api.perplexity.ai/v1/decisions",
    models: [
      { id: "pplx-decider-v1.2", label: "Decider v1.2", images: true },
      { id: "pplx-decider-flash-v1.2", label: "Decider Flash v1.2", images: true },
      { id: "pplx-decider-latest", label: "Decider latest", images: true },
      { id: "pplx-decider-flash-latest", label: "Decider Flash latest", images: true },
    ],
    defaultModel: "pplx-decider-v1.2",
    keyEnv: ["PERPLEXITY_API_KEY"],
    keyLabel: "Perplexity API key",
    needs: [],
    auth: "bearer",
    imageMode: "state-parts",
    maxQuestions: 64,
    maxOptions: 255,
    maxLevels: 10,
    maxImages: 8,
    docs: "https://docs.perplexity.ai/docs/decisions/quickstart",
    blurb: "Decider v1.2 (27B) and Decider Flash, with images in the state.",
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    wire: "systemone",
    endpoint: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}",
    models: [
      { id: "clef", label: "Clef (27B)", images: true },
      { id: "clef-flash", label: "Clef Flash (9B)", images: true },
    ],
    defaultModel: "clef",
    keyEnv: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"],
    keyLabel: "Cloudflare API token",
    needs: ["accountId"],
    auth: "bearer",
    imageMode: "images-array",
    maxQuestions: 64,
    maxOptions: 255,
    maxLevels: 10,
    maxImages: 4,
    docs: "https://developers.cloudflare.com/workers-ai/models/clef/",
    blurb: "Clef and Clef Flash on your Cloudflare account; up to 4 images.",
  },
  {
    id: "azure",
    label: "Microsoft Foundry",
    wire: "systemone",
    endpoint: "{endpoint}/providers/microsoft/v1/systemone",
    models: [{ id: "microsoft-decision-1", label: "Microsoft-Decision-1 (your deployment name)", note: "text and JSON only" }],
    defaultModel: "microsoft-decision-1",
    keyEnv: ["AZURE_FOUNDRY_API_KEY", "AZURE_API_KEY"],
    keyLabel: "Foundry API key",
    needs: ["endpoint"],
    auth: "api-key",
    imageMode: "none",
    maxQuestions: 64,
    maxOptions: 255,
    maxLevels: 10,
    maxImages: 0,
    docs: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision",
    blurb: "Microsoft-Decision-1 deployed in your Foundry resource; the model is the deployment name.",
  },
  {
    id: "vercel",
    label: "Vercel AI Gateway",
    wire: "openai",
    endpoint: "https://ai-gateway.vercel.sh/v1",
    models: [
      { id: "openai/gpt-6-luna-decisions", label: "GPT-6 Luna Decisions", images: true },
      { id: "typesafe-ai/jev-1.14.0", label: "Jev 1.14 (TypeSafe)", images: true },
    ],
    defaultModel: "openai/gpt-6-luna-decisions",
    keyEnv: ["AI_GATEWAY_API_KEY"],
    keyLabel: "AI Gateway API key",
    needs: [],
    auth: "bearer",
    imageMode: "openai-parts",
    maxQuestions: 200,
    maxOptions: 255,
    maxLevels: 255,
    maxImages: 128,
    docs: "https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-decisions",
    blurb: "OpenAI-compatible /v1/decisions on Vercel's gateway.",
  },
  {
    id: "custom",
    label: "Custom endpoint",
    wire: "systemone",
    endpoint: "http://localhost:8000/v1/systemone",
    models: [],
    defaultModel: "",
    keyEnv: [],
    keyLabel: "API key (optional)",
    needs: ["endpoint"],
    auth: "bearer",
    imageMode: "state-parts",
    maxQuestions: 64,
    maxOptions: 255,
    maxLevels: 10,
    maxImages: 4,
    docs: "https://docs.typesafe.ai/api",
    blurb: "Any server speaking the System One (Jev) or OpenAI Decisions schema, e.g. self-hosted Clef or Decider weights.",
  },
];

export const decisionProvider = (id: string): DecisionProviderInfo => DECISION_PROVIDERS.find((p) => p.id === id) ?? DECISION_PROVIDERS[DECISION_PROVIDERS.length - 1];

 
export const DECISION_PRESETS: { id: string; title: string; subtitle: string; provider: DecisionProviderId; model: string }[] = [
  { id: "openai-luna", title: "GPT-6 Luna", subtitle: "OpenAI Decisions API", provider: "openai", model: "gpt-6-luna" },
  { id: "openrouter-jev", title: "Jev 1.14", subtitle: "TypeSafe via OpenRouter", provider: "openrouter", model: "typesafe/jev-1.14" },
  { id: "openrouter-msft", title: "Microsoft-Decision-1", subtitle: "via OpenRouter", provider: "openrouter", model: "microsoft/microsoft-decision-1" },
  { id: "openrouter-decider", title: "Decider v1.2", subtitle: "Perplexity via OpenRouter", provider: "openrouter", model: "perplexity/pplx-decider-v1.2" },
  { id: "openrouter-clef", title: "Clef", subtitle: "Cloudflare via OpenRouter", provider: "openrouter", model: "cloudflare/clef" },
  { id: "perplexity-decider", title: "Decider v1.2", subtitle: "Perplexity API", provider: "perplexity", model: "pplx-decider-v1.2" },
  { id: "perplexity-flash", title: "Decider Flash", subtitle: "Perplexity API", provider: "perplexity", model: "pplx-decider-flash-v1.2" },
  { id: "cloudflare-clef", title: "Clef", subtitle: "Cloudflare Workers AI", provider: "cloudflare", model: "clef" },
  { id: "cloudflare-flash", title: "Clef Flash", subtitle: "Cloudflare Workers AI", provider: "cloudflare", model: "clef-flash" },
  { id: "typesafe-jev", title: "Jev 1.14", subtitle: "TypeSafe API", provider: "typesafe", model: "jev-1.14.0" },
  { id: "azure-msft", title: "Microsoft-Decision-1", subtitle: "Microsoft Foundry", provider: "azure", model: "microsoft-decision-1" },
  { id: "vercel-luna", title: "GPT-6 Luna Decisions", subtitle: "Vercel AI Gateway", provider: "vercel", model: "openai/gpt-6-luna-decisions" },
  { id: "custom", title: "Custom endpoint", subtitle: "System One or OpenAI schema", provider: "custom", model: "" },
];

 

export interface DecisionProfile {
  id: string;
  name: string;
  provider: DecisionProviderId;
  model: string;
   
  baseUrl?: string;
   
  accountId?: string;
   
  wire?: DecisionWire;
}

 
export interface DecisionProfilePublic extends DecisionProfile {
  isDefault: boolean;
   
  keySource: "profile" | "env" | "none";
  keyEnv?: string;
   
  ready: boolean;
  missing: string[];
  capabilities: { images: boolean; box: boolean; maxQuestions: number; maxOptions: number; maxLevels: number; maxImages: number };
}

export function profileCapabilities(p: DecisionProfile): DecisionProfilePublic["capabilities"] {
  const info = decisionProvider(p.provider);
  const m = info.models.find((x) => x.id === p.model);
  const images = info.imageMode !== "none" && (m ? m.images !== false && !!m.images : p.provider === "custom");
  const box = !!m?.box || (p.provider === "custom" && (p.wire ?? "systemone") === "systemone" && /jev-(1\.14|preview)/.test(p.model));
  return { images, box, maxQuestions: info.maxQuestions, maxOptions: info.maxOptions, maxLevels: info.maxLevels, maxImages: images ? info.maxImages : 0 };
}

 
export interface DecisionServices {
  profiles(): DecisionProfilePublic[];
  saveProfile(p: Partial<DecisionProfile> & { name?: string; makeDefault?: boolean }): DecisionProfilePublic;
  deleteProfile(id: string): boolean;
  ask(req: DecisionAskRequest): Promise<DecisionResult>;
   
  snapshot?(source: { view: true } | { camera: string }): Promise<string>;
}

 

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

 
export function questionKey(text: string, fallback = "q"): string {
  const k = text
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return k || fallback;
}

 
export function validateQuestions(questions: DecisionQuestion[], caps: DecisionProfilePublic["capabilities"], imageCount = 0): string[] {
  const errs: string[] = [];
  if (!questions.length) errs.push("Ask at least one question.");
  if (questions.length > caps.maxQuestions) errs.push(`This model accepts at most ${caps.maxQuestions} questions per request.`);
  const seen = new Set<string>();
  for (const q of questions) {
    const label = `Question "${q.name}"`;
    if (!NAME_RE.test(q.name)) errs.push(`${label}: names use letters, digits, "_", "." and "-" (max 100 characters).`);
    if (seen.has(q.name)) errs.push(`${label} is asked twice; names must be unique.`);
    seen.add(q.name);
    if (!q.instructions.trim()) errs.push(`${label} has no instructions.`);
    if (q.type === "choice") {
      const opts = q.options ?? [];
      if (opts.length < 2) errs.push(`${label}: a choice needs at least 2 options.`);
      if (opts.length > caps.maxOptions) errs.push(`${label}: at most ${caps.maxOptions} options.`);
      if (new Set(opts.map((o) => o.value)).size !== opts.length) errs.push(`${label}: option values must be unique.`);
      if (opts.some((o) => !o.value.trim())) errs.push(`${label}: an option has no value.`);
    } else if (q.type === "score") {
      const lv = q.levels ?? [];
      if (lv.length < 2) errs.push(`${label}: a score needs at least 2 levels.`);
      if (lv.length > caps.maxLevels) errs.push(`${label}: at most ${caps.maxLevels} levels.`);
      if (lv.some((l) => !l.label.trim())) errs.push(`${label}: a level has no label.`);
    } else if (q.type === "box") {
      if (!caps.box) errs.push(`${label}: Box questions need Jev 1.14 (TypeSafe or OpenRouter).`);
      if (!imageCount) errs.push(`${label}: a Box question needs an image.`);
    }
  }
  if (imageCount > caps.maxImages) errs.push(caps.maxImages ? `This model accepts at most ${caps.maxImages} images.` : "This model reads text and JSON only; remove the image.");
  return errs;
}

 

export type DecisionAction =
  | { do: "continue" }
  | { do: "stop" }
  | { do: "call"; program: string }
  | { do: "start"; program: string }
  | { do: "setIO"; io: string; value: string }
  | { do: "setVar"; name: string; value: string }
  | { do: "message"; text: string };

 
export interface DecisionInstruction {
   
  profile: string | null;
  question: DecisionQuestion;
   
  input: string;
   
  includeState: boolean;
   
  image: "none" | "view" | "camera";
  camera?: string | null;
   
  threshold: number;
   
  outcomes: Record<string, DecisionAction[]>;
   
  onError: "stop" | "branch";
  timeoutMs: number;
   
  storeAs: string;
}

export function defaultDecision(question?: Partial<DecisionQuestion>): DecisionInstruction {
  const q: DecisionQuestion = {
    name: question?.name ?? "part_ok",
    type: question?.type ?? "yesno",
    instructions: question?.instructions ?? "Is the part correctly placed and ready to be picked?",
    options: question?.options,
    levels: question?.levels,
    yes: question?.yes,
    no: question?.no,
  };
  return {
    profile: null,
    question: q,
    input: "",
    includeState: true,
    image: "none",
    camera: null,
    threshold: 0.5,
    outcomes: Object.fromEntries(outcomeKeys(q).map((k) => [k, [{ do: "continue" } as DecisionAction]])),
    onError: "stop",
    timeoutMs: 15000,
    storeAs: q.name,
  };
}

 
export function outcomeKeys(q: DecisionQuestion): string[] {
  switch (q.type) {
    case "yesno":
      return ["yes", "no"];
    case "choice":
      return (q.options ?? []).map((o) => o.value);
    case "score":
      return (q.levels ?? []).map((l) => l.label);
    case "box":
      return ["found", "not found"];
  }
}

 
export function decisionOutcome(d: Pick<DecisionInstruction, "question" | "threshold">, a: DecisionAnswer): string | null {
  if (a.type === "refusal") return null;
  switch (d.question.type) {
    case "yesno":
      return (a.probability ?? 0) >= d.threshold ? "yes" : "no";
    case "choice":
      return a.choice ?? null;
    case "score": {
      const levels = d.question.levels ?? [];
      if (!levels.length || a.score === undefined) return a.level ?? null;
      const k = Math.min(levels.length - 1, Math.max(0, Math.round(a.score)));
      return levels[k].label;
    }
    case "box":
      return (a.confidence ?? 1) >= d.threshold ? "found" : "not found";
  }
}

 
export function decisionParams(d: Pick<DecisionInstruction, "question" | "storeAs" | "threshold">, a: DecisionAnswer): Record<string, string> {
  const key = d.storeAs || d.question.name;
  const p = (v: number | undefined) => (v === undefined ? "" : String(Math.round(v * 10000) / 10000));
  switch (a.type) {
    case "yesno":
      return { [key]: (a.probability ?? 0) >= d.threshold ? "1" : "0", [`${key}_P`]: p(a.probability) };
    case "choice":
      return { [key]: a.choice ?? "", [`${key}_P`]: p(a.probabilities?.find((x) => x.label === a.choice)?.probability ?? a.confidence) };
    case "score":
      return { [key]: p(a.score), [`${key}_P`]: p(a.confidence) };
    case "box":
      return { [key]: a.box ? JSON.stringify(a.box) : "", [`${key}_P`]: p(a.confidence) };
    default:
      return { [key]: "refused", [`${key}_P`]: "" };
  }
}

const TYPE_LABEL: Record<DecisionQuestionType, string> = { yesno: "yes/no", choice: "choice", score: "score", box: "box" };

 
export function decisionInstructionName(d: DecisionInstruction | undefined): string {
  return d ? `Decision: ${d.question.name}` : "Decision";
}

 
export function decisionPostComment(item: Item): string {
  const d = item.instruction?.decision;
  if (!d) return `${item.name} runs in Enginuity`;
  return `Decision ${d.question.name} (${TYPE_LABEL[d.question.type]}) runs in Enginuity: ${d.question.instructions}`.replace(/\s+/g, " ").slice(0, 200);
}

 
export function answerSummary(a: DecisionAnswer, threshold = 0.5): string {
  const f = (v?: number) => (v === undefined ? "?" : v.toFixed(2));
  switch (a.type) {
    case "yesno":
      return `${(a.probability ?? 0) >= threshold ? "yes" : "no"} (p ${f(a.probability)})`;
    case "choice":
      return `${a.choice} (${f(a.probabilities?.find((x) => x.label === a.choice)?.probability ?? a.confidence)})`;
    case "score":
      return `${a.level ?? "?"} (score ${f(a.score)})`;
    case "box":
      return a.box ? `box ${f(a.box.left)}–${f(a.box.right)} × ${f(a.box.top)}–${f(a.box.bottom)}` : "no box";
    default:
      return "refused";
  }
}

 

const r2 = (v: number) => Math.round(v * 100) / 100;

function tcpOf(ws: Workspace, robot: Item): number[] | null {
  if (!robot.robot) return null;
  try {
    const m = mul(mul(absPose(ws, robot.id), fk(robot.robot.model, robot.robot.joints)), toolPose(ws, robot.id));
    return [r2(m[3]), r2(m[7]), r2(m[11])];
  } catch {
    return null;
  }
}






export function stationStateForDecision(ws: Workspace, at?: { program?: Item; instruction?: Item }): Record<string, unknown> {
  const stationId = at?.program ? stationOf(ws, at.program.id)?.id ?? ws.activeStation : ws.activeStation;
  const station = stationId ? ws.items[stationId] : undefined;
  const items = station ? descendants(ws, station.id) : [];
  const pos = (it: Item) => {
    try {
      const m = absPose(ws, it.id);
      return [r2(m[3]), r2(m[7]), r2(m[11])];
    } catch {
      return null;
    }
  };
  const robots = items
    .filter((i) => i.type === "robot" && i.robot)
    .map((r) => ({
      name: r.name,
      joints: r.robot!.joints.map(r2),
      tool: r.robot!.activeTool && ws.items[r.robot!.activeTool] ? ws.items[r.robot!.activeTool].name : null,
      tcp_mm: tcpOf(ws, r),
    }));
  const objects = items
    .filter((i) => i.type === "object" || i.type === "frame" || i.type === "tool")
    .slice(0, 60)
    .map((o) => ({ name: o.name, type: o.type, parent: o.parent ? ws.items[o.parent]?.name ?? null : null, position_mm: pos(o), visible: o.visible }));
  return {
    station: station?.name ?? null,
    program: at?.program?.name ?? null,
    instruction: at?.instruction?.name ?? null,
    robots,
    objects,
    parameters: stationParams(ws),
  };
}

 
export function decisionTemplateVars(ws: Workspace, at?: { program?: Item; instruction?: Item; robot?: Item }): Record<string, string> {
  const vars: Record<string, string> = stationParams(ws);
  const station = ws.activeStation ? ws.items[ws.activeStation] : undefined;
  vars["station.name"] = station?.name ?? "";
  vars["program.name"] = at?.program?.name ?? "";
  vars["instruction.name"] = at?.instruction?.name ?? "";
  const robot = at?.robot;
  if (robot?.robot) {
    vars["robot.name"] = robot.name;
    vars["robot.joints"] = robot.robot.joints.map(r2).join(", ");
    vars["robot.tcp"] = (tcpOf(ws, robot) ?? []).join(", ");
  }
  vars.time = new Date().toISOString();
  return vars;
}

 
export function fillDecisionTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
