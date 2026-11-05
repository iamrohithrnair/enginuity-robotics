// Registers decision-model profiles, queries and program instruction commands.
import { z } from "zod";
import {
  answerSummary,
  DECISION_TEST_REQUEST,
  decisionInstructionName,
  decisionOutcome,
  decisionTemplateVars,
  defaultDecision,
  fillDecisionTemplate,
  outcomeKeys,
  questionKey,
  stationStateForDecision,
  validateQuestions,
  type DecisionInstruction,
  type DecisionQuestion,
  type DecisionResult,
} from "../decisions";
import { requireRef } from "../dispatch";
import { CommandError, defineCommand, ItemRef, type CmdCtx } from "../registry";
import { assertProgramEditable } from "./instructions";
import { addInstruction, instructionSelectedIn, requireProgram } from "./programs";

 
 
 

const QuestionSchema = z.object({
  name: z.string().min(1).max(100).describe('Answer key, e.g. "part_ok" (letters, digits, _ . -)'),
  type: z.enum(["yesno", "choice", "score", "box"]).describe("yesno: probability of yes; choice: one of `options`; score: a level of `levels` (lowest first); box: where something is in the image (Jev 1.14 only)"),
  instructions: z.string().min(1).describe("The question the model answers, e.g. 'Is the part seated in the fixture?'"),
  options: z.array(z.object({ value: z.string().min(1), description: z.string().optional() })).optional().describe("choice: 2+ options"),
  levels: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).optional().describe("score: 2+ levels, lowest first"),
  yes: z.string().optional().describe("yesno: what a yes means (optional)"),
  no: z.string().optional().describe("yesno: what a no means (optional)"),
});

const ActionSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("continue") }),
  z.object({ do: z.literal("stop") }),
  z.object({ do: z.literal("call"), program: z.string().min(1).describe("program name, run synchronously like a Program Call") }),
  z.object({ do: z.literal("start"), program: z.string().min(1).describe("program name, started in parallel") }),
  z.object({ do: z.literal("setIO"), io: z.string().min(1), value: z.string() }),
  z.object({ do: z.literal("setVar"), name: z.string().min(1).describe("station parameter"), value: z.string() }),
  z.object({ do: z.literal("message"), text: z.string() }),
]);

const ImageSchema = z.enum(["none", "view", "camera"]).describe("image sent with the question: none, the current 3D view, or a camera item");

function decisions(ctx: Pick<CmdCtx, "services">) {
  const d = ctx.services.decisions;
  if (!d) throw new CommandError("Decision models are only available on the Enginuity server");
  return d;
}

 
function cleanQuestions(questions: DecisionQuestion[]): DecisionQuestion[] {
  const seen = new Set<string>();
  return questions.map((q, i) => {
    let name = questionKey(q.name, `q${i + 1}`);
    while (seen.has(name)) name = `${name}_${i + 1}`;
    seen.add(name);
    return { ...q, name, instructions: q.instructions.trim() };
  });
}

 
function checkQuestion(q: DecisionQuestion) {
  const errs = validateQuestions([q], { images: true, box: true, maxQuestions: 1, maxOptions: 255, maxLevels: 255, maxImages: 1 }, q.type === "box" ? 1 : 0);
  if (errs.length) throw new CommandError(errs.join(" "));
}

function summarize(r: DecisionResult) {
  return { ...r, summary: r.answers.map((a) => `${a.name}: ${answerSummary(a)}`) };
}

defineCommand({
  name: "decision.profiles",
  title: "Decision Models",
  description:
    "List the decision models set up in Enginuity (OpenAI Decisions / GPT-6 Luna, Jev, Microsoft-Decision-1, Clef, Perplexity Decider…): name, provider, model, whether it is the default and ready (key and settings present), and what it supports (images, box questions, limits). Keys are never shown.",
  category: "query",
  readonly: true,
  undoable: false,
  spec: "RC-DECISION",
  schema: z.object({}),
  run(ctx) {
    const profiles = decisions(ctx).profiles();
    return { profiles, default: profiles.find((p) => p.isDefault)?.name ?? null };
  },
});

defineCommand({
  name: "decision.saveProfile",
  title: "Save Decision Model",
  description:
    "Add or update a decision-model profile: provider (openai, openrouter, typesafe, perplexity, cloudflare, azure, vercel, custom), model id, optional endpoint/base URL, Cloudflare account id, custom wire schema, and whether it becomes the default. API keys cannot be set here; the user adds them in Decision models. The Copilot may only make an existing profile the default ({ id, makeDefault: true }).",
  category: "settings",
  undoable: false,
  spec: "RC-DECISION",
  schema: z.object({
    id: z.string().optional().describe("profile id to update; omit to add a new profile"),
    name: z.string().optional(),
    provider: z.enum(["openai", "openrouter", "typesafe", "perplexity", "cloudflare", "azure", "vercel", "custom"]).optional(),
    model: z.string().optional(),
    baseUrl: z.string().optional().describe("base URL (OpenAI schema) or endpoint (System One schema); Foundry: your resource endpoint"),
    accountId: z.string().optional().describe("Cloudflare account id"),
    wire: z.enum(["systemone", "openai"]).optional().describe("custom endpoints: request schema"),
    makeDefault: z.boolean().optional(),
  }),
  run(ctx, p) {
     
    if (ctx.origin === "agent") {
      const onlyDefault = p.id !== undefined && Object.entries(p).every(([k, v]) => k === "id" || k === "makeDefault" || v === undefined);
      if (!onlyDefault) throw new CommandError("Decision models are set up by the user in Copilot ▸ Decision models; the Copilot can only choose the default (id + makeDefault).");
    }
    let profile;
    try {
      profile = decisions(ctx).saveProfile(p);
    } catch (err) {
      throw new CommandError(err instanceof Error ? err.message : String(err));
    }
    ctx.services.emit?.({ type: "decision-profiles" });
    return profile;
  },
});

defineCommand({
  name: "decision.deleteProfile",
  title: "Delete Decision Model",
  description: "Remove a decision-model profile (by id or name), including its saved key.",
  category: "settings",
  undoable: false,
  spec: "RC-DECISION",
  schema: z.object({ profile: z.string().min(1) }),
  run(ctx, p) {
    if (ctx.origin === "agent") throw new CommandError("Decision models are removed by the user in Copilot ▸ Decision models.");
    const d = decisions(ctx);
    const target = d.profiles().find((x) => x.id === p.profile || x.name === p.profile);
    if (!target) throw new CommandError(`Unknown decision model "${p.profile}"`);
    d.deleteProfile(target.id);
    ctx.services.emit?.({ type: "decision-profiles" });
    return { deleted: target.name };
  },
});

defineCommand({
  name: "decision.ask",
  title: "Ask Decision Model",
  description:
    "Ask a decision model typed questions and get probabilities back in ~0.1–1 s: yesno (probability of yes), choice (one of your options, with a probability per option), score (a level on an ordered rubric) or box (where something is in an image, Jev 1.14). Input: free text, optionally the station state (robots, joints, TCP positions, objects, IOs) and an image of the 3D view or a camera. Use it for fast judgements while automating robot work: classify, route, check a condition, pick among candidates. Uses the default decision model unless `profile` names another.",
  category: "tools",
  readonly: true,
  undoable: false,
  spec: "RC-DECISION",
  schema: z.object({
    questions: z.array(QuestionSchema).min(1),
    text: z.string().optional().describe("the situation to judge, in words"),
    includeStation: z.boolean().default(false).describe("add the station state as JSON"),
    image: ImageSchema.default("none"),
    camera: ItemRef.optional().describe("camera item when image = camera"),
    profile: z.string().optional().describe("decision model name or id; default when omitted"),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  }),
  async run(ctx, p) {
    const d = decisions(ctx);
    const questions = cleanQuestions(p.questions as DecisionQuestion[]);
    const images: string[] = [];
    try {
      if (p.image === "view") images.push(await d.snapshot!({ view: true }));
      else if (p.image === "camera") {
        if (p.camera === undefined) throw new Error("name the camera item for the image");
        images.push(await d.snapshot!({ camera: requireRef(ctx.ws, p.camera).id }));
      }
    } catch (err) {
      throw new CommandError(`Cannot capture the image: ${err instanceof Error ? err.message : String(err)}`);
    }
    let result: DecisionResult;
    try {
      result = await d.ask({ profile: p.profile, questions, text: p.text, state: p.includeStation ? stationStateForDecision(ctx.ws) : undefined, images, timeoutMs: p.timeoutMs });
    } catch (err) {
      throw new CommandError(err instanceof Error ? err.message : String(err));
    }
    ctx.services.emit?.({ type: "decision", source: ctx.origin, questions, result });
    return summarize(result);
  },
});

defineCommand({
  name: "decision.test",
  title: "Test Decision Model",
  description: "Send a sample robot question (is a grasp good enough, and what to do next) to a decision model and report latency and probabilities, to check its key and settings.",
  category: "tools",
  readonly: true,
  undoable: false,
  spec: "RC-DECISION",
  schema: z.object({ profile: z.string().optional() }),
  async run(ctx, p) {
    let result: DecisionResult;
    try {
      result = await decisions(ctx).ask({ ...DECISION_TEST_REQUEST, profile: p.profile });
    } catch (err) {
      throw new CommandError(err instanceof Error ? err.message : String(err));
    }
    ctx.services.emit?.({ type: "decision", source: "test", questions: DECISION_TEST_REQUEST.questions, result });
    return summarize(result);
  },
});

const DecisionFields = {
  question: QuestionSchema.optional(),
  input: z.string().optional().describe("text template: {{IO_1}}, {{MY_PARAM}} (station parameters), {{robot.joints}}, {{robot.tcp}}, {{robot.name}}, {{program.name}}"),
  includeState: z.boolean().optional().describe("send the station state as JSON (default true)"),
  image: ImageSchema.optional(),
  camera: ItemRef.nullable().optional(),
  profile: z.string().nullable().optional().describe("decision model name or id; default model when null"),
  threshold: z.number().min(0).max(1).optional().describe("yesno: probability needed for yes; box: confidence needed for found (default 0.5)"),
  outcomes: z.record(z.string(), z.array(ActionSchema)).optional().describe('actions per outcome: "yes"/"no", an option value, a level label, "found"/"not found", and "error" when onError = branch'),
  onError: z.enum(["stop", "branch"]).optional().describe("if the model fails or refuses: stop the program, or run the 'error' outcome"),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  storeAs: z.string().optional().describe("station parameter that receives the answer (and <name>_P its probability)"),
};

 
function mergeDecision(ctx: CmdCtx, base: DecisionInstruction, p: Partial<Record<keyof typeof DecisionFields, unknown>>): DecisionInstruction {
  const next: DecisionInstruction = { ...base };
  if (p.question) {
    const q = cleanQuestions([p.question as DecisionQuestion])[0];
    checkQuestion(q);
    if (next.storeAs === base.question.name) next.storeAs = q.name;
    next.question = q;
  }
  if (p.input !== undefined) next.input = String(p.input);
  if (p.includeState !== undefined) next.includeState = Boolean(p.includeState);
  if (p.image !== undefined) next.image = p.image as DecisionInstruction["image"];
  if (p.camera !== undefined) next.camera = p.camera === null ? null : requireRef(ctx.ws, p.camera as string | number).id;
  if (p.profile !== undefined) {
    if (p.profile === null || p.profile === "") next.profile = null;
    else {
      const prof = ctx.services.decisions?.profiles().find((x) => x.id === p.profile || x.name === p.profile);
      if (!prof) throw new CommandError(`Unknown decision model "${String(p.profile)}"`);
      next.profile = prof.id;
    }
  }
  if (p.threshold !== undefined) next.threshold = Number(p.threshold);
  if (p.onError !== undefined) next.onError = p.onError as DecisionInstruction["onError"];
  if (p.timeoutMs !== undefined) next.timeoutMs = Number(p.timeoutMs);
  if (p.storeAs !== undefined) next.storeAs = questionKey(String(p.storeAs), next.question.name);
  if (next.image === "camera" && !next.camera) throw new CommandError("Select the camera that takes the decision image");
  const keys = [...outcomeKeys(next.question), "error"];
  const given = (p.outcomes ?? {}) as DecisionInstruction["outcomes"];
  for (const k of Object.keys(given)) if (!keys.includes(k)) throw new CommandError(`"${k}" is not an outcome of this question. Outcomes: ${keys.join(", ")}`);
  next.outcomes = Object.fromEntries(keys.map((k) => [k, given[k] ?? next.outcomes[k] ?? (k === "error" ? [{ do: "stop" as const }] : [{ do: "continue" as const }])]));
  return next;
}

defineCommand({
  name: "program.addDecision",
  title: "Add Decision Instruction",
  description:
    "Insert a Decision instruction into a program. When the program runs, Enginuity asks the decision model the question (with the input text, the station state and optionally an image), stores the answer in station parameters, and runs the actions of the outcome: continue, stop, call or start a program, set an IO, set a station variable or show a message. Inserted after the selected instruction, else at the end.",
  category: "program",
  spec: "RC-DECISION",
  schema: z.object({
    program: ItemRef.optional(),
    after: ItemRef.optional().describe("insert after this instruction"),
    ...DecisionFields,
    question: QuestionSchema,
  }),
  run(ctx, p) {
    const prog = requireProgram(ctx.ws, p.program);
    assertProgramEditable(ctx.ws, prog);
    const base = defaultDecision(cleanQuestions([p.question as DecisionQuestion])[0]);
    const decision = mergeDecision(ctx, { ...base, question: base.question }, { ...p, question: p.question });
    const after = p.after !== undefined ? requireRef(ctx.ws, p.after).id : undefined;
    const hadReference = after !== undefined || instructionSelectedIn(ctx.ws, prog);
    const ins = addInstruction(ctx.ws, ctx.tx, prog, { kind: "decision", decision }, after);
     
    if (hadReference) ctx.tx.setMeta("selection", [ins.id]);
    ctx.undoLabel = null;
    return { id: ins.id, name: ins.name, program: prog.name, outcomes: Object.keys(decision.outcomes) };
  },
});

defineCommand({
  name: "instruction.editDecision",
  title: "Edit Decision Instruction",
  description: "Change a Decision instruction: its question, input, image, decision model, threshold, outcome actions, error policy, timeout or result parameter. Omitted fields keep their value.",
  category: "program",
  spec: "RC-DECISION",
  schema: z.object({ instruction: ItemRef, ...DecisionFields }),
  run(ctx, p) {
    const it = requireRef(ctx.ws, p.instruction);
    if (it.instruction?.kind !== "decision" || !it.instruction.decision) throw new CommandError(`${it.name} is not a Decision instruction`);
    const prog = it.parent ? ctx.ws.items[it.parent] : undefined;
    if (prog) assertProgramEditable(ctx.ws, prog);
    const decision = mergeDecision(ctx, it.instruction.decision, p);
    ctx.tx.set(it.id, { instruction: { ...it.instruction, decision }, name: decisionInstructionName(decision) });
    ctx.undoLabel = `Modify: ${decisionInstructionName(decision)}`;
    return { id: it.id, name: decisionInstructionName(decision), decision };
  },
});

defineCommand({
  name: "instruction.testDecision",
  title: "Test Decision Instruction",
  description:
    "Ask a Decision instruction's question now, with the inputs it would send at this point (filled template, station state, image), without running its actions or writing station parameters. Returns the answer, the probabilities and the outcome it would take.",
  category: "program",
  readonly: true,
  undoable: false,
  spec: "RC-DECISION",
  schema: z.object({ instruction: ItemRef }),
  async run(ctx, p) {
    const it = requireRef(ctx.ws, p.instruction);
    const d = it.instruction?.kind === "decision" ? it.instruction.decision : undefined;
    if (!d) throw new CommandError(`${it.name} is not a Decision instruction`);
    const prog = it.parent ? ctx.ws.items[it.parent] : undefined;
    const robotId = prog?.program?.robot;
    const robot = robotId ? ctx.ws.items[robotId] : undefined;
    const text = fillDecisionTemplate(d.input ?? "", decisionTemplateVars(ctx.ws, { program: prog, instruction: it, robot }));
    const state = d.includeState ? stationStateForDecision(ctx.ws, { program: prog, instruction: it }) : undefined;
    const svc = decisions(ctx);
    const images: string[] = [];
    try {
      if (d.image === "view") images.push(await svc.snapshot!({ view: true }));
      else if (d.image === "camera") {
        if (!d.camera) throw new Error("no camera is selected");
        images.push(await svc.snapshot!({ camera: d.camera }));
      }
    } catch (err) {
      throw new CommandError(`Cannot capture the image: ${err instanceof Error ? err.message : String(err)}`);
    }
    let result: DecisionResult;
    try {
      result = await svc.ask({ profile: d.profile, questions: [d.question], text, state, images, timeoutMs: d.timeoutMs });
    } catch (err) {
      throw new CommandError(err instanceof Error ? err.message : String(err));
    }
    const outcome = decisionOutcome(d, result.answers[0]);
    ctx.services.emit?.({ type: "decision", source: "test", instruction: it.name, question: d.question, result, outcome });
    return { ...summarize(result), outcome, input: { text, station: state !== undefined, images: images.length } };
  },
});
