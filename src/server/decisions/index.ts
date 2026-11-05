// Attaches decision profiles, provider calls and image snapshots to services.
 
 

import "server-only";
import type { Services } from "@/engine/registry";
import { decide } from "./client";
import "./executor";
import { deleteProfile, listProfiles, saveProfile } from "./profiles";
import { snapshot } from "./snapshot";

export function attachDecisionServices(s: Services) {
  s.decisions = {
    profiles: () => listProfiles(),
    saveProfile: (p) => saveProfile(p),
    deleteProfile: (id) => deleteProfile(id),
    ask: (req) => decide(req),
    snapshot: (src) => snapshot(src),
  };
}

 
 
const existing = (globalThis as { __robocraft?: { services: Services } }).__robocraft;
if (existing) attachDecisionServices(existing.services);
