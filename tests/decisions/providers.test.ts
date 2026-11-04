 
 
 
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DecisionQuestion } from "@/engine/decisions";

process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-decisions-"));

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
type Reply = { status?: number; headers?: Record<string, string>; json: unknown } | ((seen: Seen, n: number) => { status?: number; headers?: Record<string, string>; json: unknown });

let server: Server;
let base = "";
let replies: Reply[] = [];
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : {} };
      seen.push(s);
      const r = replies.length > 1 ? replies.shift()! : replies[0];
      const out = typeof r === "function" ? r(s, seen.length) : r;
      res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.headers ?? {}) });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  seen.length = 0;
  replies = [];
});

const mod = async () => {
  const profiles = await import("@/server/decisions/profiles");
  const client = await import("@/server/decisions/client");
  const wire = await import("@/server/decisions/wire");
  return { ...profiles, ...client, ...wire };
};

 
const TICKET: DecisionQuestion[] = [
  { name: "is_bug", type: "yesno", instructions: "Is the customer reporting a software defect?", yes: "The customer describes broken or unexpected product behavior.", no: "The customer is asking a question or requesting a feature." },
  { name: "team", type: "choice", instructions: "Which team should own this ticket?", options: [{ value: "account", description: "Login, permissions, or profile issues." }, { value: "frontend", description: "Rendering, layout, or browser compatibility issues." }, { value: "payments", description: "Checkout, billing, or payment processing issues." }] },
  { name: "urgency", type: "score", instructions: "How urgent is this ticket?", levels: [{ label: "Can wait for the next release" }, { label: "Should be fixed this week" }, { label: "Blocking revenue right now" }] },
];
const TICKET_ANSWERS = {
  answers: {
    is_bug: { noul: 0.96, type: "noul" },
    team: { choice: "payments", confidence: 0.75, probabilities: { account: 0, frontend: 0.16, payments: 0.84 }, type: "choice" },
    urgency: { confidence: 0.99, legend: { "0": "Can wait for the next release", "1": "Should be fixed this week", "2": "Blocking revenue right now" }, probabilities: { "0": 0, "1": 0.01, "2": 0.99 }, score: 1.99, type: "score" },
  },
  id: "gen-dec-1789738314-X5e5eKGQdvR9rblyX250",
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  usage: { cost: 0.000019992, input_tokens: 476, output_tokens: 70 },
};
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("OpenRouter Decisions API (System One schema)", () => {
  it("sends model, state and a questions map with noul/choice/score criteria, and reads the answers map", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "Jev via OpenRouter", provider: "openrouter", model: "typesafe/jev-1.14", baseUrl: `${base}/api/alpha/decisions`, makeDefault: true });
    m.setProfileKey(p.id, "sk-or-test");
    replies = [{ json: TICKET_ANSWERS }];
    const r = await m.decide({ questions: TICKET, text: "My checkout page shows a blank screen after I click Pay. I have tried two browsers.", state: { customer_tier: "enterprise" } });
    const req = seen[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/api/alpha/decisions");
    expect(req.headers.authorization).toBe("Bearer sk-or-test");
    expect(req.body.model).toBe("typesafe/jev-1.14");
    expect(req.body.state).toEqual({ notes: "My checkout page shows a blank screen after I click Pay. I have tried two browsers.", station: { customer_tier: "enterprise" } });
    expect(req.body.questions).toEqual({
      is_bug: { type: "noul", instructions: "Is the customer reporting a software defect?", criteria: { true: "The customer describes broken or unexpected product behavior.", false: "The customer is asking a question or requesting a feature." } },
      team: { type: "choice", instructions: "Which team should own this ticket?", criteria: { account: "Login, permissions, or profile issues.", frontend: "Rendering, layout, or browser compatibility issues.", payments: "Checkout, billing, or payment processing issues." } },
      urgency: { type: "score", instructions: "How urgent is this ticket?", criteria: ["Can wait for the next release", "Should be fixed this week", "Blocking revenue right now"] },
    });
    expect(r.model).toBe("typesafe/jev-1.13-20260917");
    expect(r.id).toBe("gen-dec-1789738314-X5e5eKGQdvR9rblyX250");
    expect(r.usage).toEqual({ inputTokens: 476, outputTokens: 70, cost: 0.000019992 });
    expect(r.answers[0]).toEqual({ name: "is_bug", type: "yesno", probability: 0.96 });
    expect(r.answers[1]).toEqual({ name: "team", type: "choice", choice: "payments", confidence: 0.75, probabilities: [{ label: "account", probability: 0 }, { label: "frontend", probability: 0.16 }, { label: "payments", probability: 0.84 }] });
    expect(r.answers[2]).toMatchObject({ name: "urgency", type: "score", score: 1.99, level: "Blocking revenue right now", confidence: 0.99 });
    expect(r.answers[2].probabilities?.map((x) => x.probability)).toEqual([0, 0.01, 0.99]);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("puts images in the state array as image_url parts with base64 data URLs", async () => {
    const m = await mod();
    m.findProfile("Jev via OpenRouter");
    replies = [{ json: { model: "typesafe/jev-1.14-20261014", answers: { duplicate: { type: "noul", noul: 1 }, statement: { type: "box", box: { top: 0.15, bottom: 0.85, left: 0.56, right: 0.97 }, confidence: 0.82 } }, usage: { input_tokens: 900, output_tokens: 20 } } }];
    const r = await m.decide({ profile: "Jev via OpenRouter", text: "Ticket: I think I was charged twice this month, screenshot attached.", images: [PNG], questions: [{ name: "duplicate", type: "yesno", instructions: "Does the screenshot show the same charge listed twice?" }, { name: "statement", type: "box", instructions: "the white card statement, including its border" }] });
    expect(seen[0].body.state).toEqual(["Ticket: I think I was charged twice this month, screenshot attached.", { type: "image_url", image_url: { url: PNG } }]);
    expect(seen[0].body.questions).toMatchObject({ statement: { type: "box", instructions: "the white card statement, including its border" } });
    expect(r.answers[1]).toEqual({ name: "statement", type: "box", confidence: 0.82, box: { top: 0.15, bottom: 0.85, left: 0.56, right: 0.97 } });
  });

  it("refuses Box questions for models without them, and images for text-only models, before calling", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "MSFT via OpenRouter", provider: "openrouter", model: "microsoft/microsoft-decision-1", baseUrl: `${base}/api/alpha/decisions` });
    m.setProfileKey(p.id, "sk-or-test");
    await expect(m.decide({ profile: p.id, images: [PNG], questions: [{ name: "x", type: "yesno", instructions: "?" }] })).rejects.toThrow(/text and JSON only/);
    await expect(m.decide({ profile: p.id, questions: [{ name: "b", type: "box", instructions: "the part" }] })).rejects.toThrow(/Box questions need Jev 1.14/);
    expect(seen).toHaveLength(0);
  });

  it("explains provider errors (401, 402) with the provider's message and does not retry them", async () => {
    const m = await mod();
    replies = [{ status: 401, json: { error: { code: 401, message: "Missing Authentication header" } } }];
    await expect(m.decide({ profile: "Jev via OpenRouter", questions: [TICKET[0]] })).rejects.toThrow("OpenRouter: the API key was rejected (HTTP 401) — Missing Authentication header");
    expect(seen).toHaveLength(1);
    replies = [{ status: 402, json: { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/credits" } } }];
    await expect(m.decide({ profile: "Jev via OpenRouter", questions: [TICKET[0]] })).rejects.toThrow(/no credits left \(HTTP 402\)/);
  });
});

describe("TypeSafe System One API (Jev direct)", () => {
  it("sends images as assets with placeholders and the TypeSafe-Danger-Zone-Images header", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "Jev direct", provider: "typesafe", model: "jev-1.14.0", baseUrl: `${base}/v1/systemone` });
    process.env.TYPESAFE_API_KEY = "ts-env-key";
    expect(m.listProfiles().find((x) => x.id === p.id)).toMatchObject({ keySource: "env", keyEnv: "TYPESAFE_API_KEY", ready: true });
    replies = [{ json: { model: "jev-1.14.0", answers: { person_present: { type: "noul", noul: 0.12 } }, usage: { input_tokens: 300, output_tokens: 10 } } }];
    const r = await m.decide({ profile: "Jev direct", images: [PNG], questions: [{ name: "person_present", type: "yesno", instructions: "Is there a person in the image?" }] });
    const req = seen[0];
    expect(req.url).toBe("/v1/systemone");
    expect(req.headers.authorization).toBe("Bearer ts-env-key");
    expect(req.headers["typesafe-danger-zone-images"]).toBe("true");
    const assets = req.body.assets as Record<string, { type: string; format: string; data_base64: string }>;
    const keys = Object.keys(assets);
    expect(keys).toHaveLength(1);
    expect(assets[keys[0]]).toEqual({ type: "image", format: "png", data_base64: PNG.split(",")[1] });
    expect(req.body.state).toEqual({ images: [keys[0]] });
    expect(r.answers[0]).toEqual({ name: "person_present", type: "yesno", probability: 0.12 });
    delete process.env.TYPESAFE_API_KEY;
  });
});

describe("Perplexity Decisions API (Decider)", () => {
  it("POSTs /v1/decisions with a Bearer key and retries 429 after Retry-After", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "Decider", provider: "perplexity", model: "pplx-decider-v1.2", baseUrl: `${base}/v1/decisions` });
    m.setProfileKey(p.id, "pplx-test");
    replies = [
      { status: 429, headers: { "retry-after": "0" }, json: { error: { message: "Rate limit exceeded", type: "rate_limit" } } },
      { json: { model: "pplx-decider-v1.2", answers: { sentiment: { type: "choice", choice: "mixed", probabilities: { positive: 0.1, mixed: 0.8, negative: 0.1 }, confidence: 0.7 } }, usage: { input_tokens: 80, output_tokens: 0 } } },
    ];
    const r = await m.decide({ profile: "Decider", text: "The headphones sound great, but the battery stopped charging after two weeks.", questions: [{ name: "sentiment", type: "choice", instructions: "What is the overall sentiment of the review?", options: [{ value: "positive", description: "Mostly satisfied" }, { value: "mixed", description: "Praise and complaints in one review" }, { value: "negative", description: "Mostly dissatisfied" }] }] });
    expect(seen.map((s) => s.url)).toEqual(["/v1/decisions", "/v1/decisions"]);
    expect(seen[1].headers.authorization).toBe("Bearer pplx-test");
    expect(seen[1].body.state).toBe("The headphones sound great, but the battery stopped charging after two weeks.");
    expect(r.answers[0]).toMatchObject({ type: "choice", choice: "mixed", confidence: 0.7 });
  });
});

describe("Cloudflare Workers AI (Clef)", () => {
  it("builds the account/model URL, sends model and images, and unwraps the REST `result`", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "Clef", provider: "cloudflare", model: "clef", accountId: "acc123" });
    m.setProfileKey(p.id, "cf-token");
    expect(m.endpointOf(m.findProfile(p.id))).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/cloudflare/clef");
    m.saveProfile({ id: p.id, baseUrl: `${base}/client/v4/accounts/acc123/ai/run/@cf/cloudflare/clef` });
    replies = [{ json: { result: { model: "clef", answers: { urgent: { type: "noul", noul: 0.91 }, severity: { type: "score", score: 2.6, legend: { "0": "No impact", "1": "Minor", "2": "Major", "3": "Critical" }, probabilities: { "0": 0, "1": 0.05, "2": 0.3, "3": 0.65 }, confidence: 0.6 } }, usage: { input_tokens: 40, output_tokens: 0 } }, success: true, errors: [], messages: [] } }];
    const r = await m.decide({ profile: "Clef", text: "Checkout has been failing for every customer for the last hour.", images: [PNG], questions: [{ name: "urgent", type: "yesno", instructions: "Is this support request urgent?" }, { name: "severity", type: "score", instructions: "How severe is the customer impact?", levels: [{ label: "No impact" }, { label: "Minor" }, { label: "Major" }, { label: "Critical" }] }] });
    expect(seen[0].url).toBe("/client/v4/accounts/acc123/ai/run/@cf/cloudflare/clef");
    expect(seen[0].headers.authorization).toBe("Bearer cf-token");
    expect(seen[0].body).toMatchObject({ model: "clef", state: "Checkout has been failing for every customer for the last hour.", images: [PNG] });
    expect(r.answers[0].probability).toBe(0.91);
    expect(r.answers[1]).toMatchObject({ score: 2.6, level: "Critical", confidence: 0.6 });
  });

  it("reports success:false errors from Cloudflare", async () => {
    const m = await mod();
    replies = [{ json: { result: null, success: false, errors: [{ code: 5006, message: "Error: oneOf at '/questions/x' not met" }], messages: [] } }];
    await expect(m.decide({ profile: "Clef", questions: [{ name: "x", type: "yesno", instructions: "?" }] })).rejects.toThrow("Cloudflare Workers AI: Error: oneOf at '/questions/x' not met");
  });
});

describe("Microsoft Foundry (Microsoft-Decision-1)", () => {
  it("POSTs <endpoint>/providers/microsoft/v1/systemone with the api-key header and the deployment as model", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "MSFT Foundry", provider: "azure", model: "pi-decision-1", baseUrl: base });
    m.setProfileKey(p.id, "az-key");
    replies = [{ json: { model: "microsoft-decision-1", answers: { promises_refund: { type: "noul", noul: 0.97 } }, usage: { input_tokens: 30, output_tokens: 1 } } }];
    const r = await m.decide({ profile: "MSFT Foundry", text: "I refunded your $200. You don't need to contact billing.", questions: [{ name: "promises_refund", type: "yesno", instructions: "Does this reply promise the customer a refund?", yes: "Commits to returning money", no: "Makes no commitment about money" }] });
    expect(seen[0].url).toBe("/providers/microsoft/v1/systemone");
    expect(seen[0].headers["api-key"]).toBe("az-key");
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].body).toEqual({ model: "pi-decision-1", state: "I refunded your $200. You don't need to contact billing.", questions: { promises_refund: { type: "noul", instructions: "Does this reply promise the customer a refund?", criteria: { true: "Commits to returning money", false: "Makes no commitment about money" } } } });
    expect(r.model).toBe("microsoft-decision-1");
  });
});

describe("OpenAI Decisions API (official SDK) and the Vercel AI Gateway", () => {
  it("sends input and a questions array (predicate/choice/score) and maps answers in order, including refusals", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "Luna", provider: "openai", model: "gpt-6-luna", baseUrl: `${base}/v1` });
    m.setProfileKey(p.id, "sk-openai-test");
    replies = [
      {
        json: {
          model: "gpt-6-luna",
          answers: [
            { type: "predicate", name: "damaged", probability: 0.08 },
            { type: "choice", name: "department", choice: "billing", confidence: 0.93, probabilities: [{ value: "billing", probability: 0.95 }, { value: "technical", probability: 0.02 }, { value: "shipping", probability: 0.01 }, { value: "other", probability: 0.02 }] },
            { type: "refusal", name: "severity" },
          ],
          usage: { input_tokens: 51, input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 }, output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 51 },
        },
      },
    ];
    const r = await m.decide({
      profile: "Luna",
      text: "I was charged twice for my order.",
      images: [PNG],
      questions: [
        { name: "damaged", type: "yesno", instructions: "Does the product have visible damage?", yes: "Cracks, tears or dents", no: "Intact" },
        { name: "department", type: "choice", instructions: "Which department should handle this complaint?", options: [{ value: "billing", description: "Payments, invoices, and refunds." }, { value: "technical", description: "Problems using the product." }, { value: "shipping", description: "Delivery and tracking." }, { value: "other", description: "Requests outside these categories." }] },
        { name: "severity", type: "score", instructions: "How severe is this issue?", levels: [{ label: "Cosmetic", description: "Appearance only; no lost functionality." }, { label: "Workaround available" }, { label: "Fully blocked" }] },
      ],
    });
    const req = seen[0];
    expect(req.url).toBe("/v1/decisions");
    expect(req.headers.authorization).toBe("Bearer sk-openai-test");
    expect(req.body.model).toBe("gpt-6-luna");
    expect(req.body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "I was charged twice for my order." }, { type: "input_image", image_url: PNG }] }]);
    expect(req.body.questions).toEqual([
      { type: "predicate", name: "damaged", instructions: "Does the product have visible damage?\nYes means: Cracks, tears or dents No means: Intact" },
      { type: "choice", name: "department", instructions: "Which department should handle this complaint?", choices: [{ value: "billing", description: "Payments, invoices, and refunds." }, { value: "technical", description: "Problems using the product." }, { value: "shipping", description: "Delivery and tracking." }, { value: "other", description: "Requests outside these categories." }] },
      { type: "score", name: "severity", instructions: "How severe is this issue?", levels: [{ label: "Cosmetic", description: "Appearance only; no lost functionality." }, { label: "Workaround available" }, { label: "Fully blocked" }] },
    ]);
    expect(r.answers[0]).toEqual({ name: "damaged", type: "yesno", probability: 0.08 });
    expect(r.answers[1]).toMatchObject({ choice: "billing", confidence: 0.93 });
    expect(r.answers[1].probabilities?.[0]).toEqual({ label: "billing", probability: 0.95 });
    expect(r.answers[2]).toEqual({ name: "severity", type: "refusal" });
  });

  it("maps score answers by level index (Vercel AI Gateway's OpenAI-compatible endpoint)", async () => {
    const m = await mod();
    const p = m.saveProfile({ name: "Gateway", provider: "vercel", model: "openai/gpt-6-luna-decisions", baseUrl: `${base}/v1` });
    m.setProfileKey(p.id, "vck-test");
    replies = [{ json: { model: "openai/gpt-6-luna-decisions", answers: [{ type: "score", name: "severity", score: 1.4, confidence: 0.7, probabilities: [{ label: "Cosmetic", value: 0, probability: 0.1 }, { label: "Workaround available", value: 1, probability: 0.4 }, { label: "Fully blocked", value: 2, probability: 0.5 }] }], usage: { input_tokens: 9, output_tokens: 0 } } }];
    const r = await m.decide({ profile: "Gateway", text: "Export fails in Safari but works in Chrome.", questions: [{ name: "severity", type: "score", instructions: "How severe is this issue?", levels: [{ label: "Cosmetic" }, { label: "Workaround available" }, { label: "Fully blocked" }] }] });
    expect(seen[0].url).toBe("/v1/decisions");
    expect(seen[0].body.input).toBe("Export fails in Safari but works in Chrome.");
    expect(r.answers[0]).toMatchObject({ score: 1.4, level: "Workaround available", probabilities: [{ label: "Cosmetic", probability: 0.1 }, { label: "Workaround available", probability: 0.4 }, { label: "Fully blocked", probability: 0.5 }] });
  });
});

describe("profiles", () => {
  it("never expose keys, and a custom endpoint works without one", async () => {
    const m = await mod();
    const pub = m.listProfiles();
    expect(JSON.stringify(pub)).not.toMatch(/sk-or-test|sk-openai-test|pplx-test|cf-token|az-key/);
    expect(pub.every((p) => !("apiKey" in p))).toBe(true);
    const c = m.saveProfile({ name: "Local Clef", provider: "custom", wire: "systemone", model: "clef", baseUrl: `${base}/v1/systemone` });
    expect(m.listProfiles().find((x) => x.id === c.id)).toMatchObject({ ready: true, keySource: "none" });
    replies = [{ json: { model: "clef", answers: { ok: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 0 } } }];
    await m.decide({ profile: "Local Clef", questions: [{ name: "ok", type: "yesno", instructions: "?" }] });
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("time out with a clear message", async () => {
    const m = await mod();
     
    const hang = createServer(() => undefined);
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
    const p = m.saveProfile({ name: "Hang", provider: "custom", wire: "systemone", model: "x", baseUrl: `http://127.0.0.1:${(hang.address() as AddressInfo).port}/v1/systemone` });
    await expect(m.decide({ profile: p.id, timeoutMs: 1000, questions: [{ name: "ok", type: "yesno", instructions: "?" }] })).rejects.toThrow("Custom endpoint: no answer within 1 s");
    hang.closeAllConnections();
    await new Promise<void>((r) => hang.close(() => r()));
  });
});
