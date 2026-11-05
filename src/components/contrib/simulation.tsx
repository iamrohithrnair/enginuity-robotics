"use client";
// Applies server sequence previews and Python path traces to viewport state.

 
 
 

import { onServerEvent } from "@/client/api";
import { useRC } from "@/client/store";

let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

onServerEvent((e) => {
  if (e.type === "show-sequence") {
    if (sequenceTimer) clearTimeout(sequenceTimer);
    sequenceTimer = null;
    const joints = Array.isArray(e.joints) ? (e.joints as number[][]) : [];
     
    useRC.setState({ preview: joints.length ? { robot: String(e.robot), joints } : null });
    const ms = Number(e.timeoutMs);
    if (joints.length && ms > 0) sequenceTimer = setTimeout(() => useRC.setState({ preview: null }), ms);
  } else if (e.type === "python-path") {
    const key = `python:${String(e.item)}`;
    const poses = Array.isArray(e.points) ? (e.points as number[][]) : [];
    useRC.setState((s) => {
      const trace = { ...s.trace };
      if (poses.length) trace[key] = poses;
      else delete trace[key];
      return { trace };
    });
  }
});
