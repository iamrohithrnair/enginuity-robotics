"use client";
// Adds physics controls and body-mode actions to application menus.

 
 
 

import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import type { BodyMode } from "@/engine/physics/types";
import { contributeItemMenu, contributeMainMenu } from "../menuContrib";
import { PhysicsGlyph } from "../physics/PhysicsGlyph";
import { openPhysicsPanel, startPhysicsClient } from "../physics/store";

if (typeof window !== "undefined") startPhysicsClient();

const physicsOn = () => useRC.getState().settings.RC_PHYSICS === true;

contributeMainMenu(
  "Tools",
  () => [
    { label: "Physics", icon: <PhysicsGlyph />, checked: physicsOn(), onSelect: () => void cmd("physics.enable", { on: !physicsOn() }) },
    { label: "Settle Physics", disabled: !physicsOn(), onSelect: () => void cmd("physics.settle", { maxSeconds: 5 }) },
    { label: "Reset Physics Poses", disabled: !physicsOn(), onSelect: () => void cmd("physics.reset") },
    { label: "Physics Settings…", onSelect: () => openPhysicsPanel() },
  ],
  70,
);

const MODES: { mode: BodyMode; label: string }[] = [
  { mode: "auto", label: "Auto" },
  { mode: "dynamic", label: "Dynamic" },
  { mode: "static", label: "Static" },
];

contributeItemMenu((ws, item, selection) => {
  if (item.type !== "object") return [];
   
  const targets = selection.includes(item.id) ? selection.filter((id) => ws.items[id]?.type === "object") : [item.id];
  const current = item.physics?.body ?? "auto";
  return [
    {
      label: "Physics Body",
      icon: <PhysicsGlyph />,
      submenu: [
        ...MODES.map(({ mode, label }) => ({ label, checked: current === mode, onSelect: () => void cmd("object.setPhysics", { items: targets, body: mode }) })),
        { separator: true },
        { label: "Physics Settings…", onSelect: () => openPhysicsPanel() },
      ],
    },
  ];
}, 70);
