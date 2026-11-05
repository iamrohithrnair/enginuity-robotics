"use client";
// Mounts decision dialogs and connects server decision events to UI state.

import { useEffect } from "react";
import { onServerEvent } from "@/client/api";
import type { DecisionQuestion, DecisionResult } from "@/engine/decisions";
import DecidePlayground from "./DecidePlayground";
import DecisionModelsDialog from "./DecisionModelsDialog";
import { logDecision, refreshProfiles } from "./uiStore";

 
export default function DecisionsHost() {
  useEffect(() => {
    void refreshProfiles();
    return onServerEvent((e) => {
      if (e.type === "decision-profiles" || e.type === "snapshot") void refreshProfiles();
      else if (e.type === "decision")
        logDecision({
          at: Date.now(),
          source: String(e.source ?? ""),
          program: e.program as string | undefined,
          instruction: e.instruction as string | undefined,
          question: e.question as DecisionQuestion | undefined,
          questions: e.questions as DecisionQuestion[] | undefined,
          result: e.result as DecisionResult | undefined,
          outcome: e.outcome as string | null | undefined,
          error: e.error as string | undefined,
        });
    });
  }, []);
  return (
    <>
      <DecisionModelsDialog />
      <DecidePlayground />
    </>
  );
}
