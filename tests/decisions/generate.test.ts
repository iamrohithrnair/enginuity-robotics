 
 
import { describe, expect, it } from "vitest";
import { buildIntermediate, generationSettings } from "@/engine/commands/generate";
import { decisionPostComment } from "@/engine/decisions";
import { engine } from "../helpers";

describe("Decision instructions in generated programs", () => {
  it("become a RunMessage comment that names the question", async () => {
    const e = await engine();
    const robot = (await e.run("library.load", { file: "ABB-IRB-120-3-0-6.robot" })) as unknown as { id: string };
    const prog = (await e.run("program.add", { name: "PickPlace", robot: robot.id })) as unknown as { id: string };
    await e.run("program.addInstruction", { program: prog.id, kind: "pause", pauseMs: 500 });
    const d = (await e.run("program.addDecision", { program: prog.id, question: { name: "part_ok", type: "yesno", instructions: "Is the part seated in the fixture?" } })) as unknown as { id: string };
    expect(decisionPostComment(e.ws.items[d.id])).toBe("Decision part_ok (yes/no) runs in Enginuity: Is the part seated in the fixture?");
    const text = buildIntermediate(e.ws, prog.id, { settings: generationSettings(e.services.settings) }).text;
    expect(text).toContain('r.RunMessage(r"""Decision part_ok (yes/no) runs in Enginuity: Is the part seated in the fixture?""",True)');
  });
});
