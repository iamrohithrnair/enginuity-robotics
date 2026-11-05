// Verifies per-station API parameter tables and built-in path parameter precedence.
 
 
 
 
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RdkApiServer } from "@/server/rdkapi/server";
import { TestClient } from "./client";

let server: RdkApiServer;
let c: TestClient;

beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mb-params-api-"));
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

async function setParam(name: string, value: string) {
  c.send((w) => w.line("S_Param").line(name).line(value));
  expect((await c.status()).code).toBe(0);
}
async function getParam(name: string): Promise<string | null> {
  c.send((w) => w.line("G_Param").line(name));
  const line = await c.r.line();
  const st = await c.status();
  if (st.code === 2) {
    expect(line).toBe(`UNKNOWN ${name}`);
    expect(st.msg).toBe(`Invalid/unknown parameter to get: ${name}`);
    return null;
  }
  expect(st.code).toBe(0);
  return line;
}

describe("G_Param / S_Param per station", () => {
  it("each station answers with its own table; another station's names are unknown", async () => {
    c.send((w) => w.line("G_ActiveStn"));
    const a = await c.item();
    expect((await c.status()).code).toBe(0);
    await setParam("WPW_A", "1");
    c.send((w) => w.line("NewStation").line("WPW station B"));
    await c.item();
    expect((await c.status()).code).toBe(0);
    expect(await getParam("WPW_A")).toBeNull();
    await setParam("WPW_B", "2");
    c.send((w) => w.line("S_ActiveStn").handle(a.handle));
    expect((await c.status()).code).toBe(0);
    expect(await getParam("WPW_A")).toBe("1");
    expect(await getParam("WPW_B")).toBeNull();
  });

  it("an empty value removes an existing parameter; a new name with an empty value is kept", async () => {
    await setParam("WPW_E", "5");
    expect(await getParam("WPW_E")).toBe("5");
    await setParam("WPW_E", "");
    expect(await getParam("WPW_E")).toBeNull();
    await setParam("WPW_N", "");
    expect(await getParam("WPW_N")).toBe("");
  });

  it("built-in names answer before the station's own table", async () => {
    await setParam("PATH_DESKTOP", "not the desktop");
    expect(await getParam("PATH_DESKTOP")).toBe(path.join(os.homedir(), "Desktop"));
  });
});
