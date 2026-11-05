"use client";
// Adds recent-file and backup recovery actions to the File menu.

 

import { openPathUI, recoverBackupUI, useFileDialogs } from "@/client/fileActions";
import { contributeMainMenu } from "../menuContrib";

contributeMainMenu(
  "File",
  () => {
    const recent = useFileDialogs.getState().recent;
    return [
      {
        label: "Open recent",
        submenu: recent.length ? recent.map((p, i) => ({ label: `${i + 1} - ${p}`, onSelect: () => void openPathUI(p) })) : [{ label: "No recent files", disabled: true }],
      },
      { label: "Recover Auto Backup...", onSelect: () => void recoverBackupUI() },
    ];
  },
  10,
);
