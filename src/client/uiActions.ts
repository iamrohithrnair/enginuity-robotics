// Routes named actions to browser handlers or engine commands.
"use client";

 
 
 
 

import { actionParams, findAction, type ActionDef } from "@/engine/actions";
import { cmd, setStatus } from "./api";
import { useRC } from "./store";

type Handler = () => unknown;

const handlers = new Map<string, Handler>();

 
export function registerUiAction(name: string, fn: Handler) {
  handlers.set(name.toLowerCase(), fn);
}

export const hasUiAction = (name: string) => handlers.has(name.toLowerCase());

 
export async function runAction(name: string): Promise<void> {
  const h = handlers.get(name.toLowerCase());
  if (h) {
    await h();
    return;
  }
  const a = findAction(name);
  if (!a) return setStatus(`Unknown action ${name}`);
  await runBinding(a);
}

async function runBinding(a: ActionDef) {
  if (a.noop) return;
  if (a.command) {
    const ws = useRC.getState().ws;
    if (!ws) return;
    await cmd(a.command, actionParams(a, ws));
    return;
  }
   
   
  await cmd("view.action", { name: a.name });
}





export async function runForwardedAction(name: string) {
  const h = handlers.get(name.toLowerCase());
  if (h) await h();
  else {
    const a = findAction(name);
    setStatus(a ? (a.unavailable ?? `${a.text} is not available in Enginuity`) : `Unknown action ${name}`);
  }
}
