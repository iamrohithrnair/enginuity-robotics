import { connection } from "next/server";
import { getServer } from "@/server/store";
import { publicSettings } from "@/server/util";

 
 
export async function GET() {
  await connection();
  const s = getServer();
  await s.ready;
  return Response.json({ ws: s.ws, undo: s.undo.active(s.ws).list(), settings: publicSettings(s.services.settings) });
}
