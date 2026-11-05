// Binds program menu actions and reveals selected items in the tree.
 
 
 
 

import { z } from "zod";
import { bindAction, selectedProgram } from "../actions";
import { requireRef } from "../dispatch";
import { defineCommand, ItemRef, status } from "../registry";
import type { Workspace } from "../types";

 
function programsToGenerate(ws: Workspace) {
  const ids = ws.selection.filter((id) => ws.items[id]?.type === "program" || ws.items[id]?.type === "python");
  const p = selectedProgram(ws);
  if (!ids.length && p) ids.push(p);
  return { programs: ids };
}

 
bindAction("actionGenerate_program_fast", { command: "program.generateMany", params: programsToGenerate });
 
bindAction("actionGenerate_program", { ui: true });
 
bindAction("actionAdd_Event", { ui: true });
 
bindAction("actionAdd_Robot_Change", { ui: true });
 
bindAction("actionPreview_Targets", { ui: true });
 
bindAction("actionChange_target_configuration", { ui: true });
bindAction("action-AddPython", { command: "python.add" });
 
bindAction("actionRun_Script", { ui: true });
bindAction("actionRun_last_Script", { command: "python.runLastScript" });

 
defineCommand({
  name: "view.reveal",
  title: "Reveal in the Tree",
  description: "Show an item in the station tree (F8): select it, expand its parents and scroll to it. Without item, the selected item ('Nothing selected' when there is none).",
  category: "view",
  undoable: false,
  spec: "R-TREE-23",
  schema: z.object({ item: ItemRef.optional() }),
  run(ctx, p) {
    const { ws, tx, services } = ctx;
    const id = p.item !== undefined ? requireRef(ws, p.item).id : ws.selection[0];
    if (!id || !ws.items[id]) {
      status(ctx, "Nothing selected");
      return { revealed: false };
    }
    tx.setMeta("selection", [id]);
    services.emit?.({ type: "reveal", item: id });
    ctx.undoLabel = null;
    return { revealed: true, item: ws.items[id].name };
  },
});
