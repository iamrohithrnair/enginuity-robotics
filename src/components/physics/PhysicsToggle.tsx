"use client";

 
 

import { useEffect } from "react";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import { PhysicsGlyph } from "./PhysicsGlyph";
import { PhysicsPanel } from "./PhysicsPanel";
import { openPhysicsPanel, startPhysicsClient, usePhysics } from "./store";

export default function PhysicsToggle() {
  const on = useRC((s) => s.settings.RC_PHYSICS === true);
  const moving = usePhysics((s) => (s.state?.enabled ? s.state.counts.awake : 0));
  useEffect(() => startPhysicsClient(), []);
  const tip = on
    ? `Physics on${moving ? ` (${moving} moving)` : ""}: click to switch off (objects then stay where they are). Right-click for settings.`
    : "Physics off: objects stay where they are placed. Click to let released parts fall, settle and be pushed by robots. Right-click for settings.";
  return (
    <>
      <button
        className={`g-btn icon ghost ${on ? "active" : ""}`}
        aria-pressed={on}
        aria-label="Physics"
        title={tip}
        onClick={() => void cmd("physics.enable", { on: !on })}
        onContextMenu={(e) => {
          e.preventDefault();
          openPhysicsPanel(!usePhysics.getState().panel);
        }}
      >
        <PhysicsGlyph />
      </button>
      <PhysicsPanel />
    </>
  );
}
