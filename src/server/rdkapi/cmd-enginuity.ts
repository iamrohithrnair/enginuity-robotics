// Bridges API message-box requests to browser dialogs and text prompts.
 
 
 
 
 
 
 
 

import { getServer } from "@/server/store";
import { def } from "./context";

def("MB_Dialog", "LLS", async (c) => {
  const title = await c.r.line();
  const message = await c.r.line();
  const n = await c.r.int();
  const buttons: string[] = [];
  for (let i = 0; i < Math.max(0, n); i++) buttons.push(await c.r.line());
  const withInput = (await c.r.int()) !== 0;
  const initial = await c.r.line();
  if (!buttons.length) buttons.push("OK");
  const s = getServer();
  const fallback = { button: buttons[buttons.length - 1], text: initial };
  let answer = fallback;
  if (s.flags.Popups !== "0") {
    if (withInput && s.services.prompt) answer = await s.services.prompt(message, buttons, title, initial);
    else if (s.services.ask) answer = { button: await s.services.ask(message, buttons, title), text: initial };
  }
  c.w.line(answer.button).line(withInput ? answer.text : "");
});
