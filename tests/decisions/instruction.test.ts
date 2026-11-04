 
 
 
 
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stationParams } from "@/engine/stationParams";

process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rc-decision-run-"));

type Reply = { status: number; json: unknown };
let reply: Reply = { status: 200, json: {} };
const requests: Record<string, unknown>[] = [];
let decisionServer: Server;
let endpoint = "";

let run: typeof import("@/server/store").run;
let getServer: typeof import("@/server/store").getServer;
const events: { type: string; [k: string]: unknown }[] = [];

const noul = (p: number): Reply => ({ status: 200, json: { model: "local-jev", answers: { part_ok: { type: "noul", noul: p } }, usage: { input_tokens: 120, output_tokens: 0 } } });

async function cmd(name: string, params: Record<string, unknown> = {}) {
  const r = await run(name, params, "ui");
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result as Record<string, unknown>;
}

async function runToEnd(program: string) {
  await cmd("program.run", { program });
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 30));
  while ((getServer().ws.busy?.length || getServer().ws.running) && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 20));
}

beforeAll(async () => {
  decisionServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw || "{}"));
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((r) => decisionServer.listen(0, "127.0.0.1", () => r()));
  endpoint = `http://127.0.0.1:${(decisionServer.address() as AddressInfo).port}/v1/systemone`;
  const store = await import("@/server/store");
  run = store.run;
  getServer = store.getServer;
  await getServer().ready;
  getServer().flags.Popups = "0";
  const emit = getServer().services.emit;
  getServer().services.emit = (e) => {
    events.push(e);
    emit?.(e);
  };
  await cmd("decision.saveProfile", { name: "Local Jev", provider: "custom", wire: "systemone", model: "local-jev", baseUrl: endpoint, makeDefault: true });
  await cmd("program.add", { name: "Accept" });
  await cmd("program.addInstruction", { program: "Accept", kind: "io", ioMode: "set", ioName: "7", ioValue: "1" });
  await cmd("program.add", { name: "Main" });
  await cmd("station.setParam", { key: "FORCE", value: "38" });
}, 60_000);

afterAll(() => new Promise<void>((r) => decisionServer.close(() => r())));

describe("Decision instruction at run time", () => {
  let decisionId = "";

  it("is inserted with the default model, its outcomes and a tree name", async () => {
    const r = await cmd("program.addDecision", {
      program: "Main",
      question: { name: "part_ok", type: "yesno", instructions: "Is the grasp good enough to continue?" },
      input: "Grip force {{FORCE}} N",
      outcomes: { yes: [{ do: "setVar", name: "RESULT", value: "good" }, { do: "call", program: "Accept" }], no: [{ do: "setVar", name: "RESULT", value: "bad" }, { do: "stop" }] },
    });
    decisionId = String(r.id);
    expect(r.name).toBe("Decision: part_ok");
    expect(r.outcomes).toEqual(["yes", "no", "error"]);
    await cmd("program.addInstruction", { program: "Main", kind: "io", ioMode: "set", ioName: "9", ioValue: "1" });
    const it = getServer().ws.items[decisionId];
    expect(it.instruction?.decision).toMatchObject({ profile: null, includeState: true, threshold: 0.5, onError: "stop", storeAs: "part_ok", timeoutMs: 15000 });
  });

  it("asks the model with the filled template and station state, stores the answer and runs the yes branch", async () => {
    reply = noul(0.93);
    await runToEnd("Main");
    const sent = requests.at(-1)!;
    expect(sent.model).toBe("local-jev");
    expect(sent.questions).toEqual({ part_ok: { type: "noul", instructions: "Is the grasp good enough to continue?" } });
    const state = sent.state as { notes: string; station: { program: string; instruction: string; parameters: Record<string, string> } };
    expect(state.notes).toBe("Grip force 38 N");
    expect(state.station).toMatchObject({ program: "Main", instruction: "Decision: part_ok" });
    expect(state.station.parameters.FORCE).toBe("38");
    const params = stationParams(getServer().ws);
    expect(params.part_ok).toBe("1");
    expect(params.part_ok_P).toBe("0.93");
    expect(params.RESULT).toBe("good");
    expect(params.IO_7).toBe("1");  
    expect(params.IO_9).toBe("1");  
    const ev = events.filter((e) => e.type === "decision").at(-1)!;
    expect(ev).toMatchObject({ source: "program", program: "Main", instruction: "Decision: part_ok", outcome: "yes" });
  });

  it("takes the no branch below the threshold and stops the program there", async () => {
    await cmd("station.setParam", { key: "IO_9", value: "0" });
    reply = noul(0.2);
    await runToEnd("Main");
    const params = stationParams(getServer().ws);
    expect(params.part_ok).toBe("0");
    expect(params.part_ok_P).toBe("0.2");
    expect(params.RESULT).toBe("bad");
    expect(params.IO_9).toBe("0");  
  });

  it("uses the edited threshold", async () => {
    await cmd("instruction.editDecision", { instruction: decisionId, threshold: 0.15 });
    reply = noul(0.2);
    await runToEnd("Main");
    expect(stationParams(getServer().ws).RESULT).toBe("good");
    await cmd("instruction.editDecision", { instruction: decisionId, threshold: 0.5 });
  });

  it("stops the program with the provider error when onError is stop", async () => {
    await cmd("station.setParam", { key: "RESULT", value: "untouched" });
    await cmd("station.setParam", { key: "IO_9", value: "0" });
    reply = { status: 500, json: { error: { message: "model overloaded" } } };
    await runToEnd("Main");
    expect(stationParams(getServer().ws).RESULT).toBe("untouched");
    expect(stationParams(getServer().ws).IO_9).toBe("0");
    const ev = events.filter((e) => e.type === "decision").at(-1)!;
    expect(String(ev.error)).toContain("Custom endpoint: the provider failed (HTTP 500) — model overloaded");
  }, 20_000);

  it("runs the error branch when onError is branch", async () => {
    await cmd("instruction.editDecision", { instruction: decisionId, onError: "branch", outcomes: { error: [{ do: "setVar", name: "RESULT", value: "fallback" }] } });
    reply = { status: 500, json: { error: { message: "model overloaded" } } };
    await runToEnd("Main");
    expect(stationParams(getServer().ws).RESULT).toBe("fallback");
    expect(stationParams(getServer().ws).part_ok).toBe("error");
    expect(stationParams(getServer().ws).IO_9).toBe("1");  
  }, 20_000);

  it("tests an instruction without running its actions or writing parameters", async () => {
    await cmd("station.setParam", { key: "RESULT", value: "kept" });
    reply = noul(0.88);
    const r = await cmd("instruction.testDecision", { instruction: decisionId });
    expect(r.outcome).toBe("yes");
    expect(r.input).toEqual({ text: "Grip force 38 N", station: true, images: 0 });
    expect(stationParams(getServer().ws).RESULT).toBe("kept");
    expect(stationParams(getServer().ws).part_ok).toBe("error");
  });

  it("refuses to change a locked program with RoboDK's message (R-ERR-27)", async () => {
    const main = Object.values(getServer().ws.items).find((i) => i.type === "program" && i.name === "Main")!;
    getServer().ws.items[main.id].program = { ...main.program, locked: true };
    const r = await run("instruction.editDecision", { instruction: decisionId, threshold: 0.6 }, "ui");
    const add = await run("program.addDecision", { program: "Main", question: { name: "x", type: "yesno", instructions: "?" } }, "ui");
    getServer().ws.items[main.id].program = { ...getServer().ws.items[main.id].program, locked: false };
    expect(r.error).toBe("The program Main is running or it is locked and it can't be modified.");
    expect(add.error).toBe("The program Main is running or it is locked and it can't be modified.");
  });

  it("rejects outcomes the question cannot produce", async () => {
    const r = await run("instruction.editDecision", { instruction: decisionId, outcomes: { maybe: [{ do: "stop" }] } }, "ui");
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"maybe" is not an outcome of this question. Outcomes: yes, no, error');
  });
});

describe("camera images (WP-D's software-rendered 2D camera)", () => {
  let cameraId = "";
  const isPngPart = (v: unknown) => {
    const part = v as { type?: string; image_url?: { url?: string } };
    return part?.type === "image_url" && /^data:image\/png;base64,iVBORw0KGgo/.test(part.image_url?.url ?? "");
  };

  it("decision.ask renders the camera and sends its PNG as an image part, never returning it to the caller", async () => {
    const frame = await cmd("item.addFrame", { name: "Camera mount" });
    const cam = await cmd("camera.add", { attachTo: frame.id, params: "SIZE=64x48 Closed" });
    cameraId = String(cam.id);
    reply = { status: 200, json: { model: "local-jev", answers: { part_seen: { type: "noul", noul: 0.4 } }, usage: { input_tokens: 300, output_tokens: 0 } } };
    const r = await run("decision.ask", { text: "Camera over the fixture", image: "camera", camera: cameraId, questions: [{ name: "part_seen", type: "yesno", instructions: "Is a part visible in the image?" }] }, "agent");
    expect(r.ok).toBe(true);
    const state = requests.at(-1)!.state as unknown[];
    expect(Array.isArray(state)).toBe(true);
    expect(state[0]).toBe("Camera over the fixture");
    expect(state.filter(isPngPart)).toHaveLength(1);
    expect(JSON.stringify(r.result)).not.toContain("base64");
  });

  it("a Decision instruction with a camera image sends the picture taken when the program reaches it", async () => {
    const list = Object.values(getServer().ws.items).filter((i) => i.instruction?.kind === "decision");
    const d = list[0];
    await cmd("instruction.editDecision", { instruction: d.id, image: "camera", camera: cameraId, onError: "stop" });
    reply = noul(0.9);
    await runToEnd("Main");
    const state = requests.at(-1)!.state as unknown[];
    expect(state.filter(isPngPart)).toHaveLength(1);
    expect(state[0]).toBe("Grip force 38 N");
    expect(stationParams(getServer().ws).part_ok).toBe("1");
  });
});

describe("decision commands for the Copilot", () => {
  it("decision.ask cleans question names, adds the station state on request and returns summaries", async () => {
    reply = { status: 200, json: { model: "local-jev", answers: { reachable: { type: "noul", noul: 0.71 }, Which_bin: { type: "choice", choice: "bin_b", probabilities: { bin_a: 0.2, bin_b: 0.8 }, confidence: 0.6 } }, usage: { input_tokens: 10, output_tokens: 0 } } };
    const r = await run("decision.ask", { text: "Part is 400 mm wide", includeStation: true, questions: [{ name: "reachable", type: "yesno", instructions: "Can the robot reach the part?" }, { name: "Which bin?", type: "choice", instructions: "Which bin?", options: [{ value: "bin_a" }, { value: "bin_b" }] }] }, "agent");
    expect(r.ok).toBe(true);
    const sent = requests.at(-1)!;
    expect(Object.keys(sent.questions as object)).toEqual(["reachable", "Which_bin"]);
    expect((sent.state as { notes: string }).notes).toBe("Part is 400 mm wide");
    expect((r.result as { summary: string[] }).summary).toEqual(["reachable: yes (p 0.71)", "Which_bin: bin_b (0.80)"]);
  });

  it("decision.profiles never returns keys; the agent can pick the default but not add endpoints or keys", async () => {
    const r = await run("decision.profiles", {}, "agent");
    expect(JSON.stringify(r.result)).not.toMatch(/apiKey/);
    const bad = await run("decision.saveProfile", { name: "x", provider: "custom", baseUrl: "http://example.invalid/collect", apiKey: "sk-leak" } as Record<string, unknown>, "agent");
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("the Copilot can only choose the default");
    expect((await run("decision.deleteProfile", { profile: "Local Jev" }, "agent")).ok).toBe(false);
    const ui = await run("decision.saveProfile", { name: "Second", provider: "openrouter", model: "typesafe/jev-1.14", apiKey: "sk-leak" } as Record<string, unknown>, "ui");
     
    expect((ui.result as { keySource: string }).keySource).not.toBe("profile");
    const id = (ui.result as { id: string }).id;
    const pick = await run("decision.saveProfile", { id, makeDefault: true }, "agent");
    expect(pick.ok).toBe(true);
    expect((pick.result as { isDefault: boolean }).isDefault).toBe(true);
  });
});
