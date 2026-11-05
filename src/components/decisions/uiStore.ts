"use client";
// Manages decision dialogs, profile keys, request execution, and result logs.

 
 

import { create } from "zustand";
import { cmd, cmdx } from "@/client/api";
import type { DecisionProfilePublic, DecisionQuestion, DecisionResult } from "@/engine/decisions";

export interface DecisionLogEntry {
  at: number;
  source: string;
  program?: string;
  instruction?: string;
  questions?: DecisionQuestion[];
  question?: DecisionQuestion;
  result?: DecisionResult;
  outcome?: string | null;
  error?: string;
}

interface DecisionsUI {
  dialog: null | "models" | "playground";
   
  selected: string | null;
  profiles: DecisionProfilePublic[];
  loaded: boolean;
  log: DecisionLogEntry[];
}

export const useDecisions = create<DecisionsUI>(() => ({ dialog: null, selected: null, profiles: [], loaded: false, log: [] }));

export async function refreshProfiles() {
  const r = await cmd<{ profiles: DecisionProfilePublic[] }>("decision.profiles", {}, { quiet: true });
  if (r) useDecisions.setState({ profiles: r.profiles, loaded: true });
  return r?.profiles ?? [];
}

export function openDecisionModels(selected?: string | null) {
  const st = useDecisions.getState();
  useDecisions.setState({ dialog: "models", selected: selected ?? st.selected ?? st.profiles.find((p) => p.isDefault)?.id ?? null });
  void refreshProfiles().then((ps) => {
    const cur = useDecisions.getState().selected;
    if (cur !== "new" && !ps.some((p) => p.id === cur)) useDecisions.setState({ selected: ps.find((p) => p.isDefault)?.id ?? (ps.length ? ps[0].id : "new") });
  });
}

export function openDecidePlayground() {
  useDecisions.setState({ dialog: "playground" });
  void refreshProfiles();
}

export const closeDecisionDialogs = () => useDecisions.setState({ dialog: null });

export function logDecision(e: DecisionLogEntry) {
  useDecisions.setState((s) => ({ log: [e, ...s.log].slice(0, 50) }));
}

 
export async function saveProfileKey(profile: string, apiKey: string | null) {
  const res = await fetch("/api/decisions/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, apiKey }) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  await refreshProfiles();
}

 
export async function runDecision<T>(name: string, params: Record<string, unknown>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const r = await cmdx<T>(name, params);
  return r.ok ? { ok: true, result: r.result as T } : { ok: false, error: r.error ?? "failed" };
}
