"use client";
// Registers decision-model menus and instruction editors.

 
 
 

import { cmdx, selectNow } from "@/client/api";
import { registerUiAction } from "@/client/uiActions";
import { useRC } from "@/client/store";
import type { Item } from "@/engine/types";
import DecisionInstructionEditor from "../decisions/DecisionInstructionEditor";
import { openDecidePlayground, openDecisionModels, useDecisions } from "../decisions/uiStore";
import { Icon } from "../icons";
import { registerInstructionEditor } from "../inspector/instructionEditors";
import { contributeItemMenu, contributeMainMenu } from "../menuContrib";

registerInstructionEditor("decision", DecisionInstructionEditor);

 
async function addDecisionUI(program?: Item) {
  const st = useRC.getState();
  if (!useDecisions.getState().profiles.length) openDecisionModels("new");
  const r = await cmdx<{ id: string; name: string }>("program.addDecision", {
    ...(program ? { program: program.id } : {}),
    question: { name: "grasp_ok", type: "yesno", instructions: "Is the part securely grasped and ready to be moved?" },
  });
  if (!r.ok || !r.result) {
    st.toast({ kind: "error", title: "Decision instruction", body: r.error ?? "failed" });
    return;
  }
  await selectNow([r.result.id]);
  st.toast({ kind: "success", title: "Decision instruction added", body: "Set its question and outcomes in the instruction panel." });
}

registerUiAction("rc.decisionModels", () => openDecisionModels());
registerUiAction("rc.decide", () => openDecidePlayground());
registerUiAction("rc.addDecision", () => addDecisionUI());

contributeMainMenu(
  "Program",
  () => [{ label: "Decision Instruction", icon: <Icon.Decision />, onSelect: () => void addDecisionUI() }],
  60,
);

contributeMainMenu(
  "Tools",
  () => [
    { label: "Decision Models…", icon: <Icon.Decision />, onSelect: () => openDecisionModels() },
    { label: "Decide…", onSelect: () => openDecidePlayground() },
  ],
  80,
);

contributeItemMenu((ws, item) => {
  const program = item.type === "program" ? item : item.type === "instruction" && item.parent ? ws.items[item.parent] : undefined;
  if (!program || program.type !== "program") return [];
  return [{ label: "Add Decision Instruction", icon: <Icon.Decision />, onSelect: () => void addDecisionUI(program) }];
}, 60);
