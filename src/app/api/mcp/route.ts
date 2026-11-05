// Dispatches MCP HTTP requests and preflight responses.
import { connection } from "next/server";
import { handleMcpOptions, handleMcpOther, handleMcpPost } from "@/server/mcp/http";

 
 

export async function POST(request: Request) {
  return handleMcpPost(request);
}

export async function GET(request: Request) {
  await connection();
  return handleMcpOther(request);
}

export async function DELETE(request: Request) {
  return handleMcpOther(request);
}

export async function OPTIONS(request: Request) {
  return handleMcpOptions(request);
}
