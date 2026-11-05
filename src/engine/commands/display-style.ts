// Registers object display-string parsing and style updates.
 
 
 

import { z } from "zod";
import { requireRef } from "../dispatch";
import { parseDisplayString } from "../displayString";
import { CommandError, defineCommand, ItemRef } from "../registry";

defineCommand({
  name: "object.setDisplay",
  title: "Object Display String",
  description:
    "Set how an object's curves and points are drawn with a Display string (as Item.setValue(\"Display\", …)): space-separated LINEW=<curve width px>, POINTSIZE=<point size px; > 0 shows the points>, COLOR=<#RRGGBB or colour name, case-sensitive key>, PARTICLE=SPHERE(r,facets) / CUBE(x,y,z) drawn at every point. Each call starts from the defaults (an empty string restores them).",
  category: "item",
  spec: "S_Gen_Str Display (FUN_1004b1a48)",
  schema: z.object({ item: ItemRef, value: z.string() }),
  run({ ws, tx }, p) {
    const it = requireRef(ws, p.item);
    if (it.type !== "object" && it.type !== "tool") throw new CommandError(`Unknown property for ${it.name}`);
    const style = parseDisplayString(p.value);
    tx.set(it.id, { params: { ...(it.params ?? {}), Display: p.value }, ...(it.object ? { object: { ...it.object, display: style } } : {}) });
    return { item: it.name, display: style };
  },
});
