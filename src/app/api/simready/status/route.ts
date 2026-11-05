// Reports current SimReady asset preparation status.
import { connection } from "next/server";
import { simready } from "@/server/simready";

 
export async function GET() {
  await connection();
  return Response.json(simready().status());
}
