 
 
 
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { hasLibraryFile, LIBRARY_FILE } from "../helpers";
import { TestClient } from "./client";

const FILE = "CAM-Contouring-Machining.rdk";
let server: RdkApiServer;
let c: TestClient;

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-wpk2-api-"));
  const { getServer } = await import("@/server/store");
  await getServer().ready;
  const { startRdkApiServer } = await import("@/server/rdkapi/server");
  server = await startRdkApiServer({ ports: [0], log: () => undefined });
  c = await TestClient.connect(server.port);
  await c.handshake();
}, 60_000);

afterAll(async () => {
  c?.close();
  await server?.close();
});

describe("G_DataParam of an opened .rdk station", () => {
  it.skipIf(!hasLibraryFile("stations", FILE))("answers the stored bytes; an unknown name answers no bytes", async () => {
    const { run } = await import("@/server/store");
    await run("station.openRdk", { base64: readFileSync(LIBRARY_FILE("stations", FILE)).toString("base64") }, "system");
    c.send((w) => w.line("G_DataParam").line("Scale-Object-Settings"));
    const data = await c.r.bytes();
    expect((await c.status()).code).toBe(0);
    expect(data.length).toBe(55);
    c.send((w) => w.line("G_DataParam").line("No such parameter"));
    expect((await c.r.bytes()).length).toBe(0);
    expect((await c.status()).code).toBe(0);
  });
});
