 
 
 
 
 
 
 
 
 
 
 
 
 

import type { Item, Workspace } from "@/engine/types";
import { descendants } from "@/engine/workspace";

 
export function splitPythonCall(text: string): { name: string; args: string[] } {
  const open = text.indexOf("(");
  if (open < 0) return { name: text, args: [] };
  return { name: text.slice(0, open), args: text.slice(open + 1).replace(/\)/g, "").split(",") };
}

 
export function pythonCallArgs(raw: string[], caller?: Item | null): string[] {
  return raw.map((a) => {
    const v = a.trim();
    if (caller && v === "item.ptr") return String(caller.handle);
    if (caller && v === "item.name") return caller.name;
    return v;
  });
}

 
export function findPythonForCall(ws: Workspace, text: string, caller?: Item | null): Item | undefined {
  const { name } = splitPythonCall(text);
  if (!name) return undefined;
  const parent = caller?.parent ? ws.items[caller.parent] : undefined;
  if (parent?.type === "folder") {
    for (const id of parent.children) {
      const it = ws.items[id];
      if (it?.type === "python" && it.name === name) return it;
    }
  }
   
   
  let st = caller ? caller.id : ws.activeStation;
  while (st && ws.items[st] && ws.items[st].type !== "station") st = ws.items[st].parent ?? null;
  const pool = st && ws.items[st] ? descendants(ws, st) : Object.values(ws.items);
  const want = name.trim();
  return pool.find((it) => it.type === "python" && it.name.trim() === want && text.startsWith(it.name));
}
