// Exposes server trace output paths.
import { connection } from "next/server";
import { getServer } from "@/server/store";
import { tracePaths } from "@/server/trace";

 
 
export async function GET() {
  await connection();
  await getServer().ready;
  return Response.json({ paths: tracePaths() });
}
