"use client";
// Persists inspector pose-format preferences in browser storage.

import { create } from "zustand";
import { DEFAULT_POSE_FORMAT, type PoseFormatId } from "@/engine/poseFormats";

 
 

const KEY = "robocraft.poseFormat";

function initial(): PoseFormatId {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return (v as PoseFormatId | null) ?? DEFAULT_POSE_FORMAT;
  } catch {
    return DEFAULT_POSE_FORMAT;
  }
}

export const usePanelPrefs = create<{ poseFormat: PoseFormatId; setPoseFormat(f: PoseFormatId): void }>((set) => ({
  poseFormat: initial(),
  setPoseFormat(f) {
    try {
      localStorage.setItem(KEY, f);
    } catch {
       
    }
    set({ poseFormat: f });
  },
}));
