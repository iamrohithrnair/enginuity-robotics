 
 
 
 

import "server-only";
import { physicsRuntime, setPhysicsHost } from "@/engine/physics/runtime";
import { exclusive, type ServerState } from "./store";

export function attachPhysics(state: ServerState) {
  setPhysicsHost(state.services, {
    schedule: (fn) => exclusive(fn),
    subscribe: (fn) => {
      state.listeners.add(fn);
      return () => void state.listeners.delete(fn);
    },
  });
  const rt = physicsRuntime(state.services, state.ws);
  void state.ready.then(() => rt.ensure()).catch(() => undefined);
}
