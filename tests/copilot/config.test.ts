 
 
 
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import {
  copilotConnection,
  copilotInfo,
  guardConnection,
  knownSecrets,
  META_BASE_URL,
  modelInfo,
  providerOf,
  REASONING_LEVELS,
  samConnection,
  webSearchConnection,
} from "@/server/copilot/config";

const META = "meta-test-key-0123456789";
const OPENAI = "sk-test-key-0123456789";
const SETTINGS_KEY = "settings-key-0123456789";
const defaults = () => ({ ...DEFAULT_SETTINGS }) as Record<string, unknown>;

describe("Copilot connection", () => {
  it("defaults to Muse Spark 1.3 on Meta Model API with MODEL_API_KEY", () => {
    expect(DEFAULT_SETTINGS.RC_AGENT_BASE_URL).toBe(META_BASE_URL);
    expect(META_BASE_URL).toBe("https://api.meta.ai/v1");
    const c = copilotConnection(defaults(), { MODEL_API_KEY: META, OPENAI_API_KEY: OPENAI });
    expect(c).toMatchObject({ provider: "meta", providerLabel: "Meta Model API", model: "muse-spark-1.3", api: "chat_completions" });
    expect(c).toMatchObject({ apiKey: META, keySource: "env", keyEnv: "MODEL_API_KEY", ready: true, error: null, reasoning: "default" });
  });

  it("prefers the settings key, and uses OPENAI_API_KEY for other hosts", () => {
    expect(copilotConnection({ ...defaults(), RC_AGENT_API_KEY: SETTINGS_KEY }, { MODEL_API_KEY: META })).toMatchObject({ apiKey: SETTINGS_KEY, keySource: "settings" });
    const openai = copilotConnection({ ...defaults(), RC_AGENT_BASE_URL: "https://api.openai.com/v1", RC_AGENT_MODEL: "gpt-5.1" }, { MODEL_API_KEY: META, OPENAI_API_KEY: OPENAI });
    expect(openai).toMatchObject({ provider: "openai", apiKey: OPENAI, keyEnv: "OPENAI_API_KEY", keySource: "env" });
  });

  it("names the variable to set when a hosted endpoint has no key; local endpoints need none", () => {
    const c = copilotConnection(defaults(), {});
    expect(c).toMatchObject({ ready: false, keySource: "none", apiKey: "" });
    expect(c.error).toMatch(/MODEL_API_KEY/);
    expect(copilotConnection({ ...defaults(), RC_AGENT_BASE_URL: "https://api.openai.com/v1" }, {}).error).toMatch(/OPENAI_API_KEY/);
    const local = copilotConnection({ ...defaults(), RC_AGENT_BASE_URL: "http://localhost:11434/v1", RC_AGENT_MODEL: "gemma4:12b-mlx" }, {});
    expect(local).toMatchObject({ provider: "ollama", ready: true, error: null });
  });

  it("detects providers by host and labels the Muse models", () => {
    expect(providerOf("https://api.meta.ai/v1")).toBe("meta");
    expect(providerOf("https://api.openai.com/v1")).toBe("openai");
    expect(providerOf("https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(providerOf("http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(providerOf("http://localhost:8000/v1")).toBe("custom");
    expect(providerOf("https://api.meta.ai.evil.example/v1")).toBe("custom");
    expect(providerOf("https://evil.example/api.meta.ai/v1")).toBe("custom");
    expect(modelInfo("muse-spark-1.3")).toEqual({ id: "muse-spark-1.3", label: "Muse Spark 1.3", vendor: "Meta" });
    expect(modelInfo("muse-wonder-1.0")).toEqual({ id: "muse-wonder-1.0", label: "Muse Wonder", vendor: "Meta" });
    expect(modelInfo("muse-spark-1.2").label).toBe("Muse Spark 1.2");
    expect(modelInfo("muse-spark-1.1").label).toBe("Muse Spark 1.1");
    expect(modelInfo("muse-spark-1.3-contributor").label).toBe("Muse Spark 1.3 Contributor");
     
    expect(modelInfo("meta-models/muse-spark-open-1026")).toMatchObject({ vendor: "Meta" });
    expect(modelInfo("gpt-5.1")).toEqual({ id: "gpt-5.1", label: "gpt-5.1", vendor: null });
  });

  it("offers Meta's reasoning levels (no 'none': Muse Spark rejects it)", () => {
    expect([...REASONING_LEVELS]).toEqual(["default", "minimal", "low", "medium", "high", "xhigh", "max"]);
    expect(copilotConnection({ ...defaults(), RC_AGENT_REASONING: "xhigh" }, { MODEL_API_KEY: META }).reasoning).toBe("xhigh");
    expect(copilotConnection({ ...defaults(), RC_AGENT_REASONING: "none" }, { MODEL_API_KEY: META }).reasoning).toBe("default");
  });

  it("guard, web search (Muse Spark 1.2, the fastest) and SAM run on Meta with the Copilot's key or MODEL_API_KEY", () => {
    expect(guardConnection(defaults(), { MODEL_API_KEY: META })).toEqual({ enabled: true, baseURL: META_BASE_URL, apiKey: META, model: "muse-spark-1.2" });
    expect(guardConnection({ ...defaults(), RC_AGENT_API_KEY: SETTINGS_KEY }, {})?.apiKey).toBe(SETTINGS_KEY);
     
    const openai = { ...defaults(), RC_AGENT_BASE_URL: "https://api.openai.com/v1", RC_AGENT_API_KEY: SETTINGS_KEY };
    expect(guardConnection(openai, { MODEL_API_KEY: META })).toMatchObject({ baseURL: META_BASE_URL, apiKey: META });
    expect(guardConnection(openai, { OPENAI_API_KEY: OPENAI })).toBeNull();
    expect(guardConnection({ ...defaults(), RC_AGENT_GUARD: false }, { MODEL_API_KEY: META })?.enabled).toBe(false);
    expect(webSearchConnection(defaults(), { MODEL_API_KEY: META })).toEqual({ enabled: true, ready: true, baseURL: META_BASE_URL, apiKey: META, model: "muse-spark-1.2" });
    expect(webSearchConnection({ ...defaults(), RC_AGENT_WEB_SEARCH: false }, { MODEL_API_KEY: META })).toMatchObject({ enabled: false, ready: true });
    expect(webSearchConnection(defaults(), {})).toMatchObject({ enabled: false, ready: false, apiKey: "" });
    expect(webSearchConnection(openai, { OPENAI_API_KEY: OPENAI })).toMatchObject({ enabled: false, apiKey: "" });
    expect(samConnection(defaults(), { MODEL_API_KEY: META })).toEqual({ enabled: true, ready: true, baseURL: META_BASE_URL, apiKey: META, model: "sam-3.1" });
    expect(samConnection({ ...defaults(), RC_AGENT_SAM: false }, { MODEL_API_KEY: META })).toMatchObject({ enabled: false, ready: true });
    expect(samConnection(defaults(), {})).toMatchObject({ enabled: false, ready: false });
  });

  it("info describes provider, model, guard, web search and SAM without any key value", () => {
    const env = { MODEL_API_KEY: META, OPENAI_API_KEY: OPENAI };
    const settings = { ...defaults(), RC_AGENT_API_KEY: SETTINGS_KEY, RC_AGENT_REASONING: "medium" };
    const info = copilotInfo(settings, env);
    expect(info).toEqual({
      provider: { id: "meta", label: "Meta Model API", baseURL: META_BASE_URL },
      model: { id: "muse-spark-1.3", label: "Muse Spark 1.3", vendor: "Meta" },
      ready: true,
      keySource: "settings",
      keyEnv: "MODEL_API_KEY",
      reasoning: "medium",
      webSearch: { provider: "Meta search", enabled: true, ready: true },
      guard: { enabled: true, ready: true, provider: "Meta Model API", model: { id: "muse-spark-1.2", label: "Muse Spark 1.2" } },
      sam: { enabled: true, ready: true, model: { id: "sam-3.1", label: "SAM 3.1" } },
      byok: false,
    });
    const text = JSON.stringify(info);
    for (const secret of [META, OPENAI, SETTINGS_KEY]) expect(text).not.toContain(secret);
    expect(copilotInfo(defaults(), {})).toMatchObject({ ready: false, keySource: "none", guard: { ready: false, model: null }, webSearch: { enabled: false }, sam: { enabled: false } });
    expect(copilotInfo(defaults(), {}).error).toMatch(/MODEL_API_KEY/);
    expect(copilotInfo({ ...defaults(), RC_AGENT_REASONING: "extreme" }, env).reasoning).toBe("default");
  });

  it("lists every configured key so web queries cannot leak them", () => {
    const secrets = knownSecrets({ ...defaults(), RC_AGENT_API_KEY: SETTINGS_KEY }, { MODEL_API_KEY: META, OPENAI_API_KEY: OPENAI, PATH: "/usr/bin" });
    expect(secrets.sort()).toEqual([META, OPENAI, SETTINGS_KEY].sort());
  });
});
