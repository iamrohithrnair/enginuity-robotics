// Builds provider-specific decision payloads and normalizes structured answers.
 
 
 

import "server-only";
import { randomBytes } from "node:crypto";
import {
  decisionProvider,
  type DecisionAnswer,
  type DecisionAskRequest,
  type DecisionImageMode,
  type DecisionQuestion,
  type DecisionWire,
} from "@/engine/decisions";
import type { StoredProfile } from "./profiles";

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function wireOf(p: StoredProfile): DecisionWire {
  return p.provider === "custom" ? (p.wire ?? "systemone") : decisionProvider(p.provider).wire;
}

export function imageModeOf(p: StoredProfile): DecisionImageMode {
  if (p.provider === "custom") return wireOf(p) === "openai" ? "openai-parts" : "state-parts";
  return decisionProvider(p.provider).imageMode;
}

 
export function endpointOf(p: StoredProfile): string {
  const info = decisionProvider(p.provider);
  if (p.provider === "azure") {
    const base = (p.baseUrl ?? "").replace(/\/+$/, "");
    return base.endsWith("/providers/microsoft/v1/systemone") ? base : `${base}/providers/microsoft/v1/systemone`;
  }
  if (p.provider === "cloudflare") {
    if (p.baseUrl) return p.baseUrl;
    return info.endpoint.replace("{accountId}", encodeURIComponent(p.accountId ?? "")).replace("{model}", encodeURIComponent(p.model));
  }
  return (p.baseUrl || info.endpoint).replace(/\/+$/, "");
}

 
export function composeText(req: DecisionAskRequest): string {
  const parts: string[] = [];
  if (req.text?.trim()) parts.push(req.text.trim());
  if (req.state !== undefined) parts.push(`State (JSON):\n${JSON.stringify(req.state)}`);
  return parts.join("\n\n") || "(no input)";
}

 
export function composeState(req: DecisionAskRequest, mode: DecisionImageMode, placeholders: string[] = []): unknown {
  const text = req.text?.trim();
  const images = req.images ?? [];
  if (images.length && mode === "state-parts") {
     
    const arr: unknown[] = [];
    if (text) arr.push(text);
    if (req.state !== undefined) arr.push(req.state);
    for (const url of images) arr.push({ type: "image_url", image_url: { url } });
    return arr;
  }
  if (images.length && mode === "assets") {
     
    const out: Record<string, unknown> = {};
    if (text) out.notes = text;
    if (req.state !== undefined) out.station = req.state;
    out.images = placeholders;
    return out;
  }
  if (text && req.state !== undefined) return { notes: text, station: req.state };
  if (req.state !== undefined) return req.state;
  return text ?? "";
}

function dataUrlParts(url: string): { mime: string; base64: string } {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (!m) throw new Error("Images must be base64 data URLs (data:image/png;base64,…)");
  return { mime: m[1].toLowerCase(), base64: m[2] };
}

 
const optionText = (o: { value: string; description?: string }) => o.description?.trim() || o.value;
 
const levelText = (l: { label: string; description?: string }) => (l.description?.trim() ? `${l.label}: ${l.description.trim()}` : l.label);

export function systemOneQuestions(questions: DecisionQuestion[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of questions) {
    if (q.type === "yesno") {
      const crit = q.yes?.trim() && q.no?.trim() ? { criteria: { true: q.yes.trim(), false: q.no.trim() } } : {};
      out[q.name] = { type: "noul", instructions: q.instructions, ...crit };
    } else if (q.type === "choice") {
      out[q.name] = { type: "choice", instructions: q.instructions, criteria: Object.fromEntries((q.options ?? []).map((o) => [o.value, optionText(o)])) };
    } else if (q.type === "score") {
      out[q.name] = { type: "score", instructions: q.instructions, criteria: (q.levels ?? []).map(levelText) };
    } else {
      out[q.name] = { type: "box", instructions: q.instructions };
    }
  }
  return out;
}

 
export function buildSystemOneRequest(p: StoredProfile, req: DecisionAskRequest, key: string | undefined): HttpRequest {
  const info = decisionProvider(p.provider);
  const mode = imageModeOf(p);
  const images = req.images ?? [];
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (key) {
    if (info.auth === "api-key") headers["api-key"] = key;
    else headers.authorization = `Bearer ${key}`;
  }
   
  const body: Record<string, unknown> = { model: p.model };
  let placeholders: string[] = [];
  if (images.length && mode === "assets") {
    placeholders = images.map(() => `img-${randomBytes(6).toString("hex")}`);
    body.assets = Object.fromEntries(
      images.map((url, i) => {
        const { mime, base64 } = dataUrlParts(url);
        return [placeholders[i], { type: "image", format: mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1], data_base64: base64 }];
      }),
    );
    headers["TypeSafe-Danger-Zone-Images"] = "true";
  }
  if (mode === "assets" && req.questions.some((q) => q.type === "box")) headers["TypeSafe-Danger-Zone-Images"] = "true";
  body.state = composeState(req, mode, placeholders);
  body.questions = systemOneQuestions(req.questions);
  if (images.length && mode === "images-array") body.images = images;
  return { url: endpointOf(p), headers, body };
}

 
export function buildOpenAIBody(p: StoredProfile, req: DecisionAskRequest): Record<string, unknown> {
  const text = composeText(req);
  const images = req.images ?? [];
  const input = images.length
    ? [{ role: "user", content: [{ type: "input_text", text }, ...images.map((image_url) => ({ type: "input_image", image_url }))] }]
    : text;
  const questions = req.questions.map((q) => {
    if (q.type === "yesno") {
      const crit = [q.yes?.trim() ? `Yes means: ${q.yes.trim()}` : "", q.no?.trim() ? `No means: ${q.no.trim()}` : ""].filter(Boolean).join(" ");
      return { type: "predicate", name: q.name, instructions: crit ? `${q.instructions}\n${crit}` : q.instructions };
    }
    if (q.type === "choice") return { type: "choice", name: q.name, instructions: q.instructions, choices: (q.options ?? []).map((o) => ({ value: o.value, ...(o.description?.trim() ? { description: o.description.trim() } : {}) })) };
    if (q.type === "score") return { type: "score", name: q.name, instructions: q.instructions, levels: (q.levels ?? []).map((l) => ({ label: l.label, ...(l.description?.trim() ? { description: l.description.trim() } : {}) })) };
    throw new Error(`Question "${q.name}": the OpenAI Decisions API has no Box questions`);
  });
  return { model: p.model, input, questions };
}

 

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

function nearestLevel(q: DecisionQuestion, score: number | undefined): string | undefined {
  const lv = q.levels ?? [];
  if (!lv.length || score === undefined) return undefined;
  return lv[Math.min(lv.length - 1, Math.max(0, Math.round(score)))].label;
}

 
export function systemOneBody(json: unknown): Record<string, unknown> {
  const j = (json ?? {}) as Record<string, unknown>;
  if (j.result && typeof j.result === "object" && !j.answers) return j.result as Record<string, unknown>;
  return j;
}

export function normalizeSystemOne(questions: DecisionQuestion[], json: unknown): DecisionAnswer[] {
  const body = systemOneBody(json);
  const answers = (body.answers ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return questions.map((q): DecisionAnswer => {
    const a = answers[q.name];
    if (!a || typeof a !== "object" || a.type === "refusal") return { name: q.name, type: "refusal" };
    const probs = (a.probabilities ?? {}) as Record<string, unknown>;
    switch (q.type) {
      case "yesno":
        return { name: q.name, type: "yesno", probability: num(a.noul ?? a.probability) };
      case "choice":
        return {
          name: q.name,
          type: "choice",
          choice: a.choice === undefined || a.choice === null ? undefined : String(a.choice),
          confidence: num(a.confidence),
          probabilities: (q.options ?? []).map((o) => ({ label: o.value, probability: num(probs[o.value]) ?? 0 })),
        };
      case "score": {
        const score = num(a.score);
        return {
          name: q.name,
          type: "score",
          score,
          level: nearestLevel(q, score),
          confidence: num(a.confidence),
          probabilities: (q.levels ?? []).map((l, i) => ({ label: l.label, probability: num(probs[String(i)]) ?? 0 })),
        };
      }
      case "box": {
        const b = (a.box ?? {}) as Record<string, unknown>;
        const box = { top: num(b.top), bottom: num(b.bottom), left: num(b.left), right: num(b.right) };
        const ok = Object.values(box).every((v) => v !== undefined);
        return { name: q.name, type: "box", confidence: num(a.confidence), box: ok ? (box as { top: number; bottom: number; left: number; right: number }) : undefined };
      }
    }
  });
}

 
export function normalizeOpenAI(questions: DecisionQuestion[], json: unknown): DecisionAnswer[] {
  const list = (((json ?? {}) as { answers?: unknown[] }).answers ?? []) as Record<string, unknown>[];
  return questions.map((q, i): DecisionAnswer => {
    const a = list.find((x) => x && x.name === q.name) ?? list[i];
    if (!a || a.type === "refusal") return { name: q.name, type: "refusal" };
    if (q.type === "yesno") return { name: q.name, type: "yesno", probability: num(a.probability) };
    if (q.type === "choice") {
      const probs = (a.probabilities ?? []) as { value?: unknown; probability?: unknown }[];
      return {
        name: q.name,
        type: "choice",
        choice: a.choice === undefined || a.choice === null ? undefined : String(a.choice),
        confidence: num(a.confidence),
        probabilities: (q.options ?? []).map((o) => ({ label: o.value, probability: num(probs.find((x) => String(x.value) === o.value)?.probability) ?? 0 })),
      };
    }
    const probs = (a.probabilities ?? []) as { label?: unknown; value?: unknown; probability?: unknown }[];
    const score = num(a.score);
    return {
      name: q.name,
      type: "score",
      score,
      level: nearestLevel(q, score),
      confidence: num(a.confidence),
      probabilities: (q.levels ?? []).map((l, k) => ({ label: l.label, probability: num((probs.find((x) => num(x.value) === k) ?? probs.find((x) => x.label === l.label))?.probability) ?? 0 })),
    };
  });
}

export function usageOf(json: unknown): { inputTokens?: number; outputTokens?: number; cost?: number } | undefined {
  const u = (systemOneBody(json).usage ?? (json as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;
  if (!u) return undefined;
  return { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens), cost: num(u.cost) };
}

 
export function errorMessage(status: number, body: unknown, provider: string): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  const cf = Array.isArray(b.errors) ? (b.errors[0] as Record<string, unknown> | undefined)?.message : undefined;
  const detail = typeof b.detail === "string" ? b.detail : Array.isArray(b.detail) ? (b.detail as Record<string, unknown>[]).map((d) => d.msg).join("; ") : undefined;
  const msg = (typeof err === "string" ? err : (err?.message as string | undefined)) ?? (cf as string | undefined) ?? detail ?? (typeof b.message === "string" ? b.message : "");
  const why =
    status === 401 || status === 403
      ? "the API key was rejected"
      : status === 402
        ? "the account has no credits left"
        : status === 404
          ? "endpoint or model not found"
          : status === 413
            ? "the request is too large"
            : status === 422
              ? "the model or a question is not supported"
              : status === 429
                ? "rate limited"
                : status >= 500
                  ? "the provider failed"
                  : "invalid request";
  return `${provider}: ${why} (HTTP ${status})${msg ? ` — ${msg}` : ""}`;
}
