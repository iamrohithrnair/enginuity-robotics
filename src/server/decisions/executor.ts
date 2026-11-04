 
 
 
 
 
 
 
 
 
 

import "server-only";
import {
  answerSummary,
  decisionOutcome,
  decisionParams,
  decisionTemplateVars,
  fillDecisionTemplate,
  stationStateForDecision,
  type DecisionAction,
  type DecisionInstruction,
  type DecisionResult,
} from "@/engine/decisions";
import type { InstructionData } from "@/engine/types";
import { registerInstructionExecutor, type InstructionExecContext } from "../runner";
import { getServer } from "../store";
import { decide } from "./client";
import { snapshot } from "./snapshot";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function runActions(ctx: InstructionExecContext, actions: DecisionAction[]): Promise<"ok" | "stop" | "error"> {
  for (const a of actions) {
    if (ctx.stopped()) return "stop";
    switch (a.do) {
      case "continue":
        break;
      case "stop":
        ctx.status(`${ctx.program.name}: stopped by ${ctx.instruction.name}`);
        return "stop";
      case "call": {
        const r = await ctx.callProgram(a.program);
        if (r === "missing") {
          await ctx.ask(`${esc(ctx.instruction.name)}: program <b>${esc(a.program)}</b> does not exist.`, ["OK"], "Decision");
          return "error";
        }
        if (r === "stopped") return "stop";
        if (r === "error") return "error";
        break;
      }
      case "start":
        if (!ctx.startProgram(a.program)) {
          await ctx.ask(`${esc(ctx.instruction.name)}: program <b>${esc(a.program)}</b> does not exist.`, ["OK"], "Decision");
          return "error";
        }
        break;
      case "setIO":
        await ctx.setIO(a.io, a.value);
        break;
      case "setVar":
        await ctx.run("station.setParam", { key: a.name, value: a.value });
        break;
      case "message":
        ctx.status(`${ctx.program.name} message: ${a.text}`);
        break;
    }
  }
  return "ok";
}

 
export async function decisionInputs(ctx: Pick<InstructionExecContext, "ws" | "program" | "instruction" | "robot">, d: DecisionInstruction) {
  const vars = decisionTemplateVars(ctx.ws, { program: ctx.program, instruction: ctx.instruction, robot: ctx.robot });
  const text = fillDecisionTemplate(d.input ?? "", vars);
  const state = d.includeState ? stationStateForDecision(ctx.ws, { program: ctx.program, instruction: ctx.instruction }) : undefined;
  const images: string[] = [];
  if (d.image === "view") images.push(await snapshot({ view: true }));
  else if (d.image === "camera") {
    if (!d.camera) throw new Error("no camera is selected for the image");
    images.push(await snapshot({ camera: d.camera }));
  }
  return { text, state, images };
}

export async function executeDecision(ctx: InstructionExecContext, ins: InstructionData): Promise<"ok" | "stop" | "error"> {
  const d = ins.decision;
  const where = `${ctx.program.name}: ${ctx.instruction.name}`;
  if (!d) {
    await ctx.ask(`${esc(where)}: the decision is not defined.`, ["OK"], "Decision");
    return "error";
  }
  const emit = getServer().services.emit;
  let result: DecisionResult;
  try {
    const input = await decisionInputs(ctx, d);
    ctx.status(`${ctx.program.name}: asking the decision model — ${d.question.instructions}`, 30000);
    result = await decide({ profile: d.profile, questions: [d.question], ...input, timeoutMs: d.timeoutMs });
    if (result.answers[0]?.type === "refusal") throw new Error("the model declined to answer");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit?.({ type: "decision", source: "program", program: ctx.program.name, instruction: ctx.instruction.name, question: d.question, error: message });
    if (ctx.stopped()) return "stop";
    if (d.onError === "branch") {
      ctx.status(`${where} failed (${message}); running the error branch`);
      await ctx.run("station.setParam", { key: d.storeAs || d.question.name, value: "error" });
      return runActions(ctx, d.outcomes.error ?? []);
    }
    await ctx.ask(`<b>${esc(where)}</b> failed:<br>${esc(message)}<br><br>Program stopped.`, ["OK"], "Decision");
    return "error";
  }
  if (ctx.stopped()) return "stop";
  const answer = result.answers[0];
  const outcome = decisionOutcome(d, answer);
  for (const [key, value] of Object.entries(decisionParams(d, answer))) await ctx.run("station.setParam", { key, value });
  ctx.status(`${ctx.program.name}: ${d.question.name} → ${answerSummary(answer, d.threshold)} · ${result.profile.name} · ${result.latencyMs} ms`);
  emit?.({ type: "decision", source: "program", program: ctx.program.name, instruction: ctx.instruction.name, question: d.question, result, outcome });
  return runActions(ctx, outcome !== null ? (d.outcomes[outcome] ?? []) : []);
}

registerInstructionExecutor("decision", executeDecision);
