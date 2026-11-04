 
 
 

import { getServer } from "../store";

type Settings = Record<string, unknown>;
type Env = Record<string, string | undefined>;

export const META_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.3";
 
export const DEFAULT_GUARD_MODEL = "muse-spark-1.2";




export const DEFAULT_SEARCH_MODEL = "muse-spark-1.2";
 
export const SAM_MODEL = "sam-3.1";
 
export const META_KEY_ENV = "MODEL_API_KEY";

export type ProviderId = "meta" | "openai" | "openrouter" | "ollama" | "custom";
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  meta: "Meta Model API",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  custom: "Custom endpoint",
};





export const REASONING_LEVELS = ["default", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];

const MODEL_LABELS: Record<string, string> = {
  "muse-spark-1.3": "Muse Spark 1.3",
  "muse-spark-1.3-contributor": "Muse Spark 1.3 Contributor",
  "muse-spark-1.2": "Muse Spark 1.2",
  "muse-spark-1.2-contributor": "Muse Spark 1.2 Contributor",
  "muse-spark-1.1": "Muse Spark 1.1",
  "muse-wonder-1.0": "Muse Wonder",
};

const SECRET = /KEY|TOKEN|SECRET/i;
const currentSettings = (): Settings => getServer().services.settings;







export const byok = (env: Env = process.env) => env.ENGINUITY_BYOK === "1";

 
export function requestScope(headers: Headers, env: Env = process.env): { settings: Settings; env: Env } {
  if (!byok(env)) return { settings: currentSettings(), env };
  const rest = Object.fromEntries(Object.entries(env).filter(([k]) => !/(API_KEY|_TOKEN|_SECRET)$/i.test(k)));
  const header = (name: string) => (headers.get(name) ?? "").trim().slice(0, 512);
  return {
    settings: { ...currentSettings(), RC_AGENT_BASE_URL: META_BASE_URL, RC_AGENT_API_KEY: header("x-meta-key") },
    env: rest,
  };
}
const on = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

function parseURL(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

 
export function isLocalEndpoint(baseURL: string): boolean {
  const h = parseURL(baseURL)?.hostname.replace(/^\[|\]$/g, "").toLowerCase() ?? "";
  return (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1" || h === "0.0.0.0" || h === "host.docker.internal" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function providerOf(baseURL: string): ProviderId {
  const u = parseURL(baseURL);
  const h = u?.hostname.toLowerCase() ?? "";
  if (h === "api.meta.ai") return "meta";
  if (/(^|\.)openai\.com$/.test(h)) return "openai";
  if (/(^|\.)openrouter\.ai$/.test(h)) return "openrouter";
  if (u && isLocalEndpoint(baseURL) && u.port === "11434") return "ollama";
  return "custom";
}

 
const isMuse = (id: string) => /^(meta[/-])?muse[-_]/i.test(id) || /(^|\/)muse-/i.test(id);

export function modelInfo(id: string): { id: string; label: string; vendor: "Meta" | null } {
  const label = MODEL_LABELS[id.toLowerCase()];
  return { id, label: label ?? id, vendor: label || isMuse(id) ? "Meta" : null };
}

export const reasoningOf = (v: unknown): Reasoning => (REASONING_LEVELS.includes(v as Reasoning) ? (v as Reasoning) : "default");

export interface CopilotConnection {
  provider: ProviderId;
  providerLabel: string;
  baseURL: string;
  model: string;
  api: "chat_completions" | "responses";
  apiKey: string;
  keySource: "settings" | "env" | "none";
   
  keyEnv: string;
  reasoning: Reasoning;
  ready: boolean;
   
  error: string | null;
}





export function copilotConnection(settings: Settings = currentSettings(), env: Env = process.env): CopilotConnection {
  const baseURL = String(settings.RC_AGENT_BASE_URL || env.OPENAI_BASE_URL || META_BASE_URL).trim();
  const model = String(settings.RC_AGENT_MODEL || env.ROBOCRAFT_MODEL || DEFAULT_MODEL).trim();
  const provider = providerOf(baseURL);
  const keyEnv = provider === "meta" ? META_KEY_ENV : "OPENAI_API_KEY";
  const fromSettings = String(settings.RC_AGENT_API_KEY ?? "").trim();
  const fromEnv = String(env[keyEnv] ?? "").trim();
  const apiKey = fromSettings || fromEnv;
  const keySource = fromSettings ? "settings" : fromEnv ? "env" : "none";
  const ready = Boolean(apiKey) || isLocalEndpoint(baseURL);
  const error = ready
    ? null
    : `No API key for ${PROVIDER_LABELS[provider]} (${baseURL}). Set ${keyEnv} in the Enginuity server's environment (e.g. .env.local) or add an API key in Options ▸ Copilot.`;
  return {
    provider,
    providerLabel: PROVIDER_LABELS[provider],
    baseURL,
    model,
    api: settings.RC_AGENT_API === "responses" ? "responses" : "chat_completions",
    apiKey,
    keySource,
    keyEnv,
    reasoning: reasoningOf(settings.RC_AGENT_REASONING),
    ready,
    error,
  };
}





function metaEndpoint(conn: CopilotConnection, env: Env): { baseURL: string; apiKey: string } | null {
  const onMeta = conn.provider === "meta" && Boolean(conn.apiKey);
  const apiKey = onMeta ? conn.apiKey : String(env[META_KEY_ENV] ?? "").trim();
  if (!apiKey) return null;
  return { baseURL: onMeta ? conn.baseURL : META_BASE_URL, apiKey };
}

 
export interface GuardConnection {
  enabled: boolean;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

 
export function guardConnection(settings: Settings = currentSettings(), env: Env = process.env, conn = copilotConnection(settings, env)): GuardConnection | null {
  const meta = metaEndpoint(conn, env);
  if (!meta) return null;
  return { enabled: on(settings.RC_AGENT_GUARD ?? true), ...meta, model: String(settings.RC_AGENT_GUARD_MODEL || DEFAULT_GUARD_MODEL).trim() };
}

export interface MetaToolConnection {
  enabled: boolean;
  ready: boolean;
  baseURL: string;
  apiKey: string;
  model: string;
}

 
export function webSearchConnection(settings: Settings = currentSettings(), env: Env = process.env, conn = copilotConnection(settings, env)): MetaToolConnection {
  const meta = metaEndpoint(conn, env);
  return { enabled: on(settings.RC_AGENT_WEB_SEARCH ?? true) && Boolean(meta), ready: Boolean(meta), baseURL: meta?.baseURL ?? META_BASE_URL, apiKey: meta?.apiKey ?? "", model: DEFAULT_SEARCH_MODEL };
}

 
export function samConnection(settings: Settings = currentSettings(), env: Env = process.env, conn = copilotConnection(settings, env)): MetaToolConnection {
  const meta = metaEndpoint(conn, env);
  return { enabled: on(settings.RC_AGENT_SAM ?? true) && Boolean(meta), ready: Boolean(meta), baseURL: meta?.baseURL ?? META_BASE_URL, apiKey: meta?.apiKey ?? "", model: SAM_MODEL };
}

 
export function knownSecrets(settings: Settings = currentSettings(), env: Env = process.env): string[] {
  const values = [
    ...Object.entries(settings).filter(([k, v]) => SECRET.test(k) && typeof v === "string").map(([, v]) => v as string),
    ...Object.entries(env).filter(([k, v]) => /(API_KEY|_TOKEN|_SECRET)$/i.test(k) && typeof v === "string").map(([, v]) => v as string),
  ];
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length >= 8))];
}

export interface CopilotInfo {
  provider: { id: ProviderId; label: string; baseURL: string };
  model: { id: string; label: string; vendor: "Meta" | null };
  ready: boolean;
  keySource: "settings" | "env" | "none";
  keyEnv: string;
  reasoning: Reasoning;
  webSearch: { provider: "Meta search"; enabled: boolean; ready: boolean };
  guard: { enabled: boolean; ready: boolean; provider: "Meta Model API"; model: { id: string; label: string } | null };
   
  sam: { enabled: boolean; ready: boolean; model: { id: string; label: string } };
   
  byok: boolean;
  error?: string;
}

 
export function copilotInfo(settings: Settings = currentSettings(), env: Env = process.env): CopilotInfo {
  const conn = copilotConnection(settings, env);
  const guard = guardConnection(settings, env, conn);
  const web = webSearchConnection(settings, env, conn);
  const sam = samConnection(settings, env, conn);
  const guardModel = guard ? modelInfo(guard.model) : null;
  return {
    provider: { id: conn.provider, label: conn.providerLabel, baseURL: conn.baseURL },
    model: modelInfo(conn.model),
    ready: conn.ready,
    keySource: conn.keySource,
    keyEnv: conn.keyEnv,
    reasoning: conn.reasoning,
    webSearch: { provider: "Meta search", enabled: web.enabled, ready: web.ready },
    guard: { enabled: Boolean(guard?.enabled), ready: Boolean(guard), provider: "Meta Model API", model: guardModel ? { id: guardModel.id, label: guardModel.label } : null },
    sam: { enabled: sam.enabled, ready: sam.ready, model: { id: SAM_MODEL, label: "SAM 3.1" } },
    byok: byok(env),
    ...(byok(env) && !conn.ready ? { error: "Enter your Meta Model API key in the Copilot panel to start." } : conn.error ? { error: conn.error } : {}),
  };
}
