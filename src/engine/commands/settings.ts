import { z } from "zod";
import { DEFAULT_SETTINGS, SETTINGS_DOC } from "../settings";
import { CommandError, defineCommand, type Services } from "../registry";

const SECRET = /KEY|TOKEN|SECRET/i;

 
const KEEP_ON_RESET = /^RC_AGENT_/;

 
export function coerceSetting(key: string, value: unknown): number | string | boolean {
  const def = DEFAULT_SETTINGS[key];
  if (typeof def === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new CommandError(`${key} needs a number`);
    return n;
  }
  if (typeof def === "boolean") return value === true || value === "true" || value === 1 || value === "1";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : String(value);
}






export function applySettings(services: Services, values: Record<string, unknown>): { applied: Record<string, number | string | boolean>; message?: string } {
  if (!services.setSetting) throw new CommandError("Options can only be changed on the server");
  const applied: Record<string, number | string | boolean> = {};
  let message: string | undefined;
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined || key.length > 64) continue;
    if (SECRET.test(key) && raw === "••••") continue;
    let v = coerceSetting(key, raw);
    if (key === "UndoStackLimit") {
      v = Math.max(0, Math.round(Number(v)));
      if (v !== Number(services.settings.UndoStackLimit) && services.undo?.setLimit && !services.undo.setLimit(v)) {
        message = "Current buffer stack must be deleted to apply changes";
        continue;
      }
    }
    services.setSetting(key, v);
    applied[key] = v;
  }
  return { applied, message };
}

defineCommand({
  name: "settings.get",
  title: "Options",
  description: "Read application options (Shift+O). Returns all options with documentation, or a single key.",
  category: "settings",
  shortcut: "Shift+O",
  readonly: true,
  undoable: false,
  spec: "SET-OPTIONS",
  schema: z.object({ key: z.string().optional() }),
  run({ services }, p) {
    const safe = Object.fromEntries(Object.entries(services.settings).filter(([k]) => !SECRET.test(k)));
    if (p.key) return { [p.key]: safe[p.key] ?? null, doc: SETTINGS_DOC[p.key] ?? null };
    return { values: safe, docs: SETTINGS_DOC };
  },
});

defineCommand({
  name: "settings.set",
  title: "Change Option",
  description:
    "Change an application option (Tools ▸ Options). Values are coerced to the type of the default and saved. Changing the undo limit is refused while the active station has undo history ('Current buffer stack must be deleted to apply changes').",
  category: "settings",
  undoable: false,
  spec: "SET-OPTIONS, R-IM-33",
  schema: z.object({ key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
  run({ services }, p) {
    if (SECRET.test(p.key)) throw new CommandError("Secrets must be set from the Settings panel");
    const { applied, message } = applySettings(services, { [p.key]: p.value });
    if (message) throw new CommandError(message);
    return applied;
  },
});

defineCommand({
  name: "settings.reset",
  title: "Set default settings",
  description:
    "Options ▸ Set default settings: restore every option to its factory default at once, without confirmation (the Copilot connection settings are kept). The undo limit is restored only if the history is empty.",
  category: "settings",
  undoable: false,
  spec: "R-SLF-1",
  schema: z.object({}),
  run({ services }) {
    const defaults = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([k]) => !KEEP_ON_RESET.test(k)));
    const { applied, message } = applySettings(services, defaults);
    return { reset: Object.keys(applied).length, ...(message ? { message } : {}) };
  },
});
