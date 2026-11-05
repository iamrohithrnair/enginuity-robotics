// Sends decision-provider requests with response normalization and retries.
 
 
 
 

import "server-only";
import OpenAI from "openai";
import { decisionProvider, profileCapabilities, validateQuestions, type DecisionAskRequest, type DecisionResult } from "@/engine/decisions";
import { findProfile, resolveKey, type StoredProfile } from "./profiles";
import { buildOpenAIBody, buildSystemOneRequest, endpointOf, errorMessage, normalizeOpenAI, normalizeSystemOne, systemOneBody, usageOf, wireOf } from "./wire";

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

 
function retryDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const s = Number(retryAfter);
    if (Number.isFinite(s)) return Math.min(10000, Math.max(0, s * 1000));
    const t = Date.parse(retryAfter);
    if (Number.isFinite(t)) return Math.min(10000, Math.max(0, t - Date.now()));
  }
  return 500 * 2 ** attempt;
}

const retryable = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

async function postSystemOne(p: StoredProfile, req: DecisionAskRequest, key: string | undefined, timeoutMs: number): Promise<unknown> {
  const http = buildSystemOneRequest(p, req, key);
  const providerLabel = decisionProvider(p.provider).label;
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(http.url, { method: "POST", headers: http.headers, body: JSON.stringify(http.body), signal: ac.signal });
    } catch (err) {
      clearTimeout(timer);
      lastError = ac.signal.aborted ? `${providerLabel}: no answer within ${Math.round(timeoutMs / 1000)} s` : `${providerLabel}: cannot reach ${new URL(http.url).host} (${err instanceof Error ? err.message : String(err)})`;
      if (attempt < MAX_RETRIES && !ac.signal.aborted) {
        await sleep(retryDelay(attempt, null));
        continue;
      }
      throw new Error(lastError);
    }
    clearTimeout(timer);
    const text = await res.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = { message: text.slice(0, 300) };
    }
    if (res.ok) {
       
      const b = (body ?? {}) as { success?: boolean; errors?: { message?: string }[] };
      if (b.success === false) throw new Error(`${providerLabel}: ${b.errors?.map((e) => e.message).join("; ") || "request failed"}`);
      if (!systemOneBody(body).answers) throw new Error(`${providerLabel}: the response has no answers`);
      return body;
    }
    lastError = errorMessage(res.status, body, providerLabel);
    if (attempt < MAX_RETRIES && retryable(res.status)) {
      await sleep(retryDelay(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error(lastError);
}

async function postOpenAI(p: StoredProfile, req: DecisionAskRequest, key: string | undefined, timeoutMs: number): Promise<unknown> {
  const client = new OpenAI({ apiKey: key || "not-needed", baseURL: endpointOf(p), timeout: timeoutMs, maxRetries: MAX_RETRIES });
  const label = decisionProvider(p.provider).label;
  try {
    return await client.decisions.create(buildOpenAIBody(p, req) as unknown as OpenAI.DecisionCreateParams);
  } catch (err) {
    if (err instanceof OpenAI.APIError && typeof err.status === "number") throw new Error(errorMessage(err.status, err.error ?? { message: err.message }, label));
    if (err instanceof OpenAI.APIConnectionTimeoutError) throw new Error(`${label}: no answer within ${Math.round(timeoutMs / 1000)} s`);
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

 
export async function decide(req: DecisionAskRequest): Promise<DecisionResult> {
  const p = findProfile(req.profile ?? null);
  const info = decisionProvider(p.provider);
  const errs = validateQuestions(req.questions, profileCapabilities(p), req.images?.length ?? 0);
  if (errs.length) throw new Error(errs.join(" "));
  if (info.needs.includes("accountId") && !p.accountId) throw new Error(`${p.name}: set the Cloudflare account id in Decision models.`);
  if (info.needs.includes("endpoint") && !p.baseUrl) throw new Error(`${p.name}: set the endpoint URL in Decision models.`);
  const { key } = resolveKey(p);
  if (!key && p.provider !== "custom") throw new Error(`${p.name} has no API key. Add it in Decision models, or set ${info.keyEnv.join(" or ")} on the server.`);
  const timeoutMs = Math.min(120000, Math.max(1000, req.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const t0 = Date.now();
  const wire = wireOf(p);
  const json = wire === "openai" ? await postOpenAI(p, req, key, timeoutMs) : await postSystemOne(p, req, key, timeoutMs);
  const latencyMs = Date.now() - t0;
  const answers = wire === "openai" ? normalizeOpenAI(req.questions, json) : normalizeSystemOne(req.questions, json);
  const body = wire === "openai" ? ((json ?? {}) as Record<string, unknown>) : systemOneBody(json);
  const outer = (json ?? {}) as Record<string, unknown>;
  return {
    id: typeof outer.id === "string" ? outer.id : typeof body.id === "string" ? body.id : undefined,
    profile: { id: p.id, name: p.name, provider: p.provider, model: p.model },
    model: typeof body.model === "string" ? body.model : p.model,
    answers,
    latencyMs,
    usage: usageOf(json),
  };
}
