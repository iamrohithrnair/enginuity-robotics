"use client";

 
 

import { registerUiAction } from "@/client/uiActions";
import { Icon } from "../icons";
import { contributeItemMenu, contributeMainMenu } from "../menuContrib";
import { openScriptEditor } from "../scripts/uiStore";

registerUiAction("rc.newScript", () => openScriptEditor(null));

contributeMainMenu("Program", () => [{ label: "New Script…", icon: <Icon.Script />, onSelect: () => openScriptEditor(null) }], 65);

contributeItemMenu((_ws, item) => {
  if (item.type !== "script") return [];
  return [
    { label: "Run Script", icon: <Icon.Play />, onSelect: () => openScriptEditor(item.id, { run: true }) },
    { label: "Edit Script…", icon: <Icon.Code />, onSelect: () => openScriptEditor(item.id) },
  ];
}, 10);
