// Lists registered commands with their parameter schemas.
import { connection } from "next/server";
import { z } from "zod";
import { allCommands } from "@/engine/registry";
import "@/engine/commands";

 
export async function GET() {
   
  await connection();
  return Response.json(
    allCommands()
      .filter((c) => !c.internal)
      .map((c) => ({
      name: c.name,
      title: c.title,
      description: c.description,
      category: c.category,
      shortcut: c.shortcut ?? null,
      readonly: !!c.readonly,
      undoable: c.undoable !== false && !c.readonly,
      spec: c.spec ?? null,
      schema: z.toJSONSchema(c.schema, { unrepresentable: "any" }),
    })),
  );
}
