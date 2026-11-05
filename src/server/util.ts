// Masks credential-like settings before exposing them to clients.
export function publicSettings(settings: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, /KEY|TOKEN|SECRET/i.test(k) ? (v ? "••••" : "") : v]));
}
