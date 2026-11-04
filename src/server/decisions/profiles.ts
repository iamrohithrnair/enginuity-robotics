 
 
 
 

import "server-only";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  decisionProvider,
  profileCapabilities,
  type DecisionProfile,
  type DecisionProfilePublic,
  type DecisionProviderId,
  type DecisionWire,
} from "@/engine/decisions";
import { DATA_DIR } from "../store";

export interface StoredProfile extends DecisionProfile {
  apiKey?: string;
}

interface ProfileFile {
  version: 1;
  defaultId: string | null;
  profiles: StoredProfile[];
}

const PROVIDERS: DecisionProviderId[] = ["openai", "openrouter", "typesafe", "perplexity", "cloudflare", "azure", "vercel", "custom"];

const file = () => path.join(DATA_DIR, "decision-models.json");

 
function seed(): ProfileFile {
  const profiles: StoredProfile[] = [];
  for (const id of PROVIDERS) {
    const info = decisionProvider(id);
    if (id === "custom" || !info.keyEnv.some((k) => process.env[k])) continue;
    if (info.needs.includes("endpoint")) continue;
    if (info.needs.includes("accountId") && !process.env.CLOUDFLARE_ACCOUNT_ID) continue;
    profiles.push({ id: newId(), name: `${info.models.find((m) => m.id === info.defaultModel)?.label ?? info.defaultModel} · ${info.label}`, provider: id, model: info.defaultModel, accountId: id === "cloudflare" ? process.env.CLOUDFLARE_ACCOUNT_ID : undefined });
  }
  return { version: 1, defaultId: profiles[0]?.id ?? null, profiles };
}

function newId() {
  return `dm_${randomBytes(6).toString("hex")}`;
}

export function readProfiles(): ProfileFile {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<ProfileFile>;
    const profiles = Array.isArray(raw.profiles) ? raw.profiles.filter((p) => p && typeof p.id === "string" && PROVIDERS.includes(p.provider)) : [];
    const defaultId = profiles.some((p) => p.id === raw.defaultId) ? (raw.defaultId as string) : (profiles[0]?.id ?? null);
    return { version: 1, defaultId, profiles };
  } catch {
    if (existsSync(file())) return { version: 1, defaultId: null, profiles: [] };
    const seeded = seed();
    if (seeded.profiles.length) writeProfiles(seeded);
    return seeded;
  }
}

function writeProfiles(data: ProfileFile) {
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(file(), 0o600);
  } catch {
     
  }
}

 
export function resolveKey(p: StoredProfile): { key: string | undefined; source: DecisionProfilePublic["keySource"]; env?: string } {
  if (p.apiKey) return { key: p.apiKey, source: "profile" };
  for (const env of decisionProvider(p.provider).keyEnv) if (process.env[env]) return { key: process.env[env], source: "env", env };
  return { key: undefined, source: "none" };
}

export function publicProfile(p: StoredProfile, defaultId: string | null): DecisionProfilePublic {
  const info = decisionProvider(p.provider);
  const k = resolveKey(p);
  const missing: string[] = [];
  if (!p.model) missing.push("model");
  if (info.needs.includes("accountId") && !p.accountId) missing.push("account id");
  if (info.needs.includes("endpoint") && !p.baseUrl) missing.push("endpoint URL");
   
  if (!k.key && p.provider !== "custom") missing.push(info.keyLabel);
  const { apiKey: _secret, ...rest } = p;
  void _secret;
  return {
    ...rest,
    isDefault: p.id === defaultId,
    keySource: k.source,
    keyEnv: k.env ?? info.keyEnv[0],
    ready: missing.length === 0,
    missing,
    capabilities: profileCapabilities(p),
  };
}

export function listProfiles(): DecisionProfilePublic[] {
  const data = readProfiles();
  return data.profiles.map((p) => publicProfile(p, data.defaultId));
}

 
export function findProfile(ref?: string | null): StoredProfile {
  const data = readProfiles();
  if (!data.profiles.length) throw new Error("No decision model is set up. Open Copilot ▸ Decision models (or Tools ▸ Decision Models…) and add one.");
  if (!ref) return data.profiles.find((p) => p.id === data.defaultId) ?? data.profiles[0];
  const p = data.profiles.find((x) => x.id === ref) ?? data.profiles.find((x) => x.name === ref) ?? data.profiles.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!p) throw new Error(`Unknown decision model "${ref}". Available: ${data.profiles.map((x) => x.name).join(", ")}`);
  return p;
}

export function saveProfile(input: Partial<DecisionProfile> & { name?: string; makeDefault?: boolean }): DecisionProfilePublic {
  const data = readProfiles();
  const existing = input.id ? data.profiles.find((p) => p.id === input.id) : undefined;
  if (input.id && !existing) throw new Error(`Unknown decision model id ${input.id}`);
  const provider = (input.provider ?? existing?.provider ?? "openrouter") as DecisionProviderId;
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown decision provider "${provider}"`);
  const info = decisionProvider(provider);
  const model = (input.model ?? existing?.model ?? info.defaultModel).trim();
  const name = (input.name ?? existing?.name ?? `${info.models.find((m) => m.id === model)?.label ?? model} · ${info.label}`).trim();
  if (!name) throw new Error("A decision model needs a name");
  if (data.profiles.some((p) => p.name === name && p.id !== existing?.id)) throw new Error(`A decision model named "${name}" already exists`);
  const baseUrl = input.baseUrl !== undefined ? input.baseUrl.trim() || undefined : existing?.baseUrl;
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error("The endpoint must start with http:// or https://");
  const next: StoredProfile = {
    id: existing?.id ?? newId(),
    name,
    provider,
    model,
    baseUrl,
    accountId: input.accountId !== undefined ? input.accountId.trim() || undefined : existing?.accountId,
    wire: provider === "custom" ? ((input.wire ?? existing?.wire ?? "systemone") as DecisionWire) : undefined,
    apiKey: existing?.apiKey,
  };
  data.profiles = existing ? data.profiles.map((p) => (p.id === next.id ? next : p)) : [...data.profiles, next];
  if (input.makeDefault || !data.defaultId) data.defaultId = next.id;
  writeProfiles(data);
  return publicProfile(next, data.defaultId);
}

export function deleteProfile(id: string): boolean {
  const data = readProfiles();
  const before = data.profiles.length;
  data.profiles = data.profiles.filter((p) => p.id !== id);
  if (data.profiles.length === before) return false;
  if (data.defaultId === id) data.defaultId = data.profiles[0]?.id ?? null;
  writeProfiles(data);
  return true;
}

 
export function setProfileKey(id: string, key: string | null) {
  const data = readProfiles();
  const p = data.profiles.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown decision model id ${id}`);
  const k = key?.trim();
  if (k) p.apiKey = k;
  else delete p.apiKey;
  writeProfiles(data);
  return publicProfile(p, data.defaultId);
}
