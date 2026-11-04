import { connection } from "next/server";
import { applySettings } from "@/engine/commands/settings";
import { byok } from "@/server/copilot/config";
import { getServer } from "@/server/store";
import { publicSettings } from "@/server/util";

 
 
 
export async function GET() {
   
  await connection();
  const s = getServer();
  await s.ready;
  return Response.json(publicSettings(s.services.settings));
}

export async function POST(request: Request) {
  const s = getServer();
  await s.ready;
  const body = (await request.json().catch(() => ({}))) as Record<string, string | number | boolean>;
   
  const hosted = byok();
  const values = Object.fromEntries(
    Object.entries(body).filter(([k, v]) => typeof k === "string" && k.length <= 64 && !(/KEY|TOKEN|SECRET/i.test(k) && (hosted || v === "••••" || v === undefined)) && !(hosted && k === "RC_AGENT_BASE_URL")),
  );
  let message: string | undefined;
  try {
    message = applySettings(s.services, values).message;
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  return Response.json(message ? { ...publicSettings(s.services.settings), _message: message } : publicSettings(s.services.settings));
}
