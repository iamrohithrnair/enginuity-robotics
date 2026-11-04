 
 
 

import "server-only";
import { activeUndo, broadcast, exclusive, flushPatches, run, type ServerState } from "../store";
import { createScriptService } from ".";

export function attachScriptServices(state: ServerState) {
  state.services.scripts = createScriptService({
    call: (name, params, macro, station) => run(name, params, "agent", { macro, station }),
    workspace: () => state.ws,
    emit: (e) => state.services.emit?.(e),
    afterCommit: () => broadcast({ type: "undo", undo: activeUndo().list() }),
    flush: () => exclusive(flushPatches),
    revert: (revert) =>
      exclusive(() => {
        const patch = revert();
        if (!patch) return;
        state.ws.rev += 1;
        patch.rev = state.ws.rev;
        broadcast({ type: "patch", patch });
      }),
  });
}
