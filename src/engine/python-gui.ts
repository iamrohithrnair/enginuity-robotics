// Detects tkinter scripts and reports unavailable desktop GUI support.
 
 
 

 
export function desktopGuiMessage(name: string, code: string): string | null {
  if (!/^[ \t]*(?:from[ \t]+(?:tkinter|Tkinter)\b|import[ \t]+(?:tkinter|Tkinter)\b)/m.test(code)) return null;
  return `${name} was not started: it opens a desktop window (tkinter), which Enginuity cannot show in the browser. Use the Enginuity dialogs (mbox, InputDialog) instead.`;
}
