"use client";

 
 

import { cmd } from "@/client/api";
import { contributeItemMenu } from "../menuContrib";

const MODES = ["Do not show", "Show for wrist center", "Show for robot flange", "Show for current tool"];

contributeItemMenu((ws, item) => {
  if (item.type !== "robot") return [];
  const mode = item.params?.ShowWorkspace !== undefined ? Number(item.params.ShowWorkspace) : ws.view?.workspace ? 2 : 0;
  return [
    {
      label: "Workspace",
      submenu: MODES.map((label, i) => ({ label, checked: mode === i, onSelect: () => void cmd("robot.showWorkspace", { robot: item.id, mode: i }) })),
    },
  ];
}, 60);
