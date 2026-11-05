"use client";
// Manages browser API keys, model metadata, and Copilot readiness state.

 
 
 

import { useEffect, useState } from "react";
import { useRC } from "@/client/store";

export type ProviderId = "meta" | "openai" | "openrouter" | "ollama" | "custom";

export interface AgentInfo {
  provider: { id: ProviderId; label: string; baseURL: string };
  model: { id: string; label: string; vendor: string | null };
  ready: boolean;
  keySource: "settings" | "env" | "none";
  keyEnv?: string;
  reasoning?: string;
  webSearch: { provider: string; enabled: boolean; ready: boolean };
  guard: { enabled: boolean; ready: boolean; provider: string; model: { id: string; label: string } | null };
   
  sam: { enabled: boolean; ready: boolean; model: { id: string; label: string } };
   
  byok?: boolean;
   
  derived?: boolean;
}

 
 
const KEYS = "enginuity.copilot.keys";
export type BrowserKeys = { meta: string };
export function browserKeys(): BrowserKeys {
  try {
    const saved = JSON.parse(localStorage.getItem(KEYS) ?? "{}") as Partial<BrowserKeys>;
    return { meta: typeof saved.meta === "string" ? saved.meta : "" };
  } catch {
    return { meta: "" };
  }
}
export function saveBrowserKeys(k: BrowserKeys) {
  localStorage.setItem(KEYS, JSON.stringify({ meta: k.meta.trim() }));
  window.dispatchEvent(new Event(KEYS));
}
export function keyHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const k = browserKeys();
  return k.meta ? { "x-meta-key": k.meta } : {};
}

export interface WebResult {
  title?: string;
  url: string;
  score?: number | null;
   
  cited?: boolean;
   
  flagged?: boolean | string[];
}
 
export interface WebInfo {
  provider: string;
  query?: string;
  url?: string;
  answer?: string | null;
  results: WebResult[];
  blocked?: number;
  ms?: number;
}
export interface Guardrail {
  kind: "scope" | "web" | "injection" | "gate";
  action: "blocked" | "redacted" | "warned";
  message?: string;
  tool?: string;
  probability?: number;
}

 
export const META_BLUE = "#0866FF";

export const PROVIDERS: { id: ProviderId; label: string; baseURL: string; keyEnv?: string }[] = [
  { id: "meta", label: "Meta Model API", baseURL: "https://api.meta.ai/v1", keyEnv: "MODEL_API_KEY" },
  { id: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  { id: "ollama", label: "Ollama (local)", baseURL: "http://localhost:11434/v1" },
  { id: "openrouter", label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
  { id: "custom", label: "Custom", baseURL: "" },
];

 
export const META_MODELS = [
  { id: "muse-spark-1.3", label: "Muse Spark 1.3", blurb: "fast agentic reasoning" },
  { id: "muse-wonder-1.0", label: "Muse Wonder", blurb: "most capable, slower" },
  { id: "muse-spark-1.2", label: "Muse Spark 1.2", blurb: "previous Spark" },
  { id: "muse-spark-1.1", label: "Muse Spark 1.1", blurb: "first Spark" },
  { id: "muse-spark-1.3-contributor", label: "Muse Spark 1.3 Contributor", blurb: "lowest price, content may train Meta models" },
];
export const DEFAULT_MODEL = META_MODELS[0].id;
 
export const DEFAULT_GUARD_MODEL = "muse-spark-1.2";
 
export const GUARD_MODELS = META_MODELS.filter((m) => m.id.startsWith("muse-spark-"));

export function providerOf(baseURL: string): ProviderId {
  const u = baseURL.toLowerCase();
  if (u.includes("api.meta.ai")) return "meta";
  if (u.includes("api.openai.com")) return "openai";
  if (u.includes("openrouter.ai")) return "openrouter";
  if (u.includes(":11434") || u.includes("ollama")) return "ollama";
  return "custom";
}

export function modelLabel(id: string): string {
  const known = META_MODELS.find((m) => m.id.toLowerCase() === id.toLowerCase());
  return known ? known.label : id.split("/").pop() || id || "Model";
}

export const vendorOf = (id: string): string | null => (/(^|\/)(meta[/-])?muse[-_]/i.test(id) ? "Meta" : null);

export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^\w+:\/\//, "").split("/")[0];
  }
}

 
export function flag(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === "") return fallback;
  return v === true || v === 1 || v === "true" || v === "1";
}

function derive(s: Record<string, unknown>): AgentInfo {
  const baseURL = String(s.RC_AGENT_BASE_URL ?? "");
  const id = providerOf(baseURL);
  const preset = PROVIDERS.find((p) => p.id === id)!;
  const label = id === "custom" ? hostOf(baseURL) || "Custom endpoint" : preset.label;
  const model = String(s.RC_AGENT_MODEL ?? "");
  const guardModel = String(s.RC_AGENT_GUARD_MODEL || DEFAULT_GUARD_MODEL);
  return {
    provider: { id, label, baseURL },
    model: { id: model, label: modelLabel(model), vendor: vendorOf(model) },
    ready: true,
    keySource: s.RC_AGENT_API_KEY ? "settings" : "env",
    keyEnv: preset.keyEnv,
    webSearch: { provider: "Meta search", enabled: flag(s.RC_AGENT_WEB_SEARCH, true), ready: true },
    guard: { enabled: flag(s.RC_AGENT_GUARD, true), ready: true, provider: "Meta Model API", model: { id: guardModel, label: modelLabel(guardModel) } },
    sam: { enabled: flag(s.RC_AGENT_SAM, true), ready: true, model: { id: "sam-3.1", label: "SAM 3.1" } },
    derived: true,
  };
}

 
export function toAgentInfo(raw: unknown): AgentInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AgentInfo> & { type?: string };
  if (!r.model?.id && !r.provider?.id) return null;
  const d = derive(useRC.getState().settings);
  const modelId = r.model?.id ?? d.model.id;
  return {
    provider: { ...d.provider, ...r.provider },
    model: { id: modelId, label: r.model?.label || modelLabel(modelId), vendor: r.model?.vendor !== undefined ? r.model.vendor : vendorOf(modelId) },
    ready: r.ready ?? true,
    keySource: r.keySource ?? d.keySource,
    keyEnv: r.keyEnv ?? d.keyEnv,
    reasoning: r.reasoning,
    webSearch: { ...d.webSearch, ...r.webSearch },
    guard: { ...d.guard, ...r.guard },
    sam: { ...d.sam, ...r.sam },
    byok: r.byok,
  };
}

 
export function notReadyReason(info: AgentInfo): string | null {
  if (info.ready) return null;
  if (info.byok) return "Enter your Meta Model API key below to start";
  if (info.keySource === "none") return info.keyEnv ? `Add ${info.keyEnv} to .env.local or an API key in Options` : "Add an API key in Options ▸ Copilot";
  return "Check the endpoint and model in Options ▸ Copilot";
}

 
export function useAgentInfo(): [AgentInfo | null, (info: AgentInfo) => void] {
  const settings = useRC((s) => s.settings);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const agentKey = JSON.stringify(
    Object.entries(settings)
      .filter(([k]) => k.startsWith("RC_AGENT"))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
   
  const [keysRev, setKeysRev] = useState(0);
  useEffect(() => {
    const bump = () => setKeysRev((n) => n + 1);
    window.addEventListener(KEYS, bump);
    return () => window.removeEventListener(KEYS, bump);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const ctl = new AbortController();
    fetch("/api/agent", { signal: ctl.signal, cache: "no-store", headers: keyHeaders() })
      .then(async (r) => (r.ok ? toAgentInfo(await r.json()) : null))
      .catch(() => null)
      .then((got) => {
        if (!cancelled) setInfo(got ?? derive(useRC.getState().settings));
      });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [agentKey, keysRev]);
  return [info, setInfo];
}

 
let pendingTab: string | null = null;
export function openOptionsTab(tab = "Copilot") {
  pendingTab = tab;
  useRC.setState({ settingsOpen: true });
}
 
export const peekOptionsTab = () => pendingTab;
export function clearOptionsTab() {
  pendingTab = null;
}
