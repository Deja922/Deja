import { randomUUID } from "crypto";
import type { Context, Message, PipelineConfig } from "@/types/index.js";
import { Pipeline, loadConfig } from "@/core/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";
import { createProvider } from "@/proxy/provider-factory.js";
import { scoreHeuristic, scoreWithJudge } from "./scorer.js";
import type { EvalTask, EvalResult, EvalOptions, ScoredOutput } from "./types.js";

export async function runTask(
  task: EvalTask,
  opts: EvalOptions
): Promise<EvalResult> {
  const context = buildContext(task);
  const mode = opts.mode ?? "both";

  let baseline: ScoredOutput | undefined;
  let optimized: ScoredOutput | undefined;

  if (mode === "both") {
    [baseline, optimized] = await Promise.all([
      runBaseline(task, context, opts),
      runOptimized(task, context, opts),
    ]);
  } else if (mode === "baseline") {
    baseline = await runBaseline(task, context, opts);
  } else {
    optimized = await runOptimized(task, context, opts);
  }

  const baseIn = baseline?.usage.promptTokens ?? 0;
  const optIn = optimized?.usage.promptTokens ?? 0;
  const tokenSavingsPct =
    baseline && optimized
      ? ((baseIn - optIn) / Math.max(baseIn, 1)) * 100
      : 0;

  return {
    taskId: task.id,
    taskType: task.type,
    taskName: task.name,
    baseline: baseline!,
    optimized: optimized!,
    tokenSavingsPct: round(tokenSavingsPct),
    qualityDelta:
      baseline && optimized
        ? round(optimized.qualityScore - baseline.qualityScore)
        : 0,
  };
}

// ── baseline ─────────────────────────────────────────────────────────────

async function runBaseline(
  task: EvalTask,
  context: Context,
  opts: EvalOptions
): Promise<ScoredOutput> {
  const provider = createProvider(opts.provider, opts.model);

  const t0 = Date.now();
  const response = await provider.send({ context, maxTokens: 1024 });
  const latencyMs = Date.now() - t0;

  const { score, breakdown } = scoreHeuristic(task, response.content);
  let judgeScore: number | undefined;
  if (opts.judgeEnabled) {
    judgeScore = await scoreWithJudge(task, response.content);
    breakdown.judgeScore = judgeScore;
  }

  const finalScore = judgeScore !== undefined
    ? round(score * 0.4 + judgeScore * 0.6)
    : score;

  return {
    response: response.content,
    usage: response.usage,
    qualityScore: finalScore,
    scoreBreakdown: breakdown,
    latencyMs,
  };
}

// ── optimized ────────────────────────────────────────────────────────────

async function runOptimized(
  task: EvalTask,
  context: Context,
  opts: EvalOptions
): Promise<ScoredOutput> {
  const config: PipelineConfig = await loadConfig({
    maxTokens: opts.maxTokens,
    targetTokens: opts.targetTokens,
    memoryEnabled: true,
  });

  const pipeline = new Pipeline();
  const pipelineResult = await pipeline.run(context, config);
  const optimizedContext = pipelineResult.context;

  const provider = createProvider(opts.provider, opts.model);

  const t0 = Date.now();
  const response = await provider.send({ context: optimizedContext, maxTokens: 1024 });
  const latencyMs = Date.now() - t0;

  const { score, breakdown } = scoreHeuristic(task, response.content);
  let judgeScore: number | undefined;
  if (opts.judgeEnabled) {
    judgeScore = await scoreWithJudge(task, response.content);
    breakdown.judgeScore = judgeScore;
  }

  const finalScore = judgeScore !== undefined
    ? round(score * 0.4 + judgeScore * 0.6)
    : score;

  return {
    response: response.content,
    usage: {
      ...response.usage,
      promptTokens: estimateTokens(optimizedContext),
    },
    qualityScore: finalScore,
    scoreBreakdown: breakdown,
    latencyMs,
  };
}

// ── context builder ───────────────────────────────────────────────────────

function buildContext(task: EvalTask): Context {
  const messages: Message[] = [];

  // Inject history so the compressor has real content to work on
  if (task.history) {
    for (const h of task.history) {
      messages.push({
        id: randomUUID(),
        role: h.role,
        content: h.content,
        timestamp: Date.now() - messages.length * 60_000,
      });
    }
  }

  // Final user prompt
  messages.push({
    id: randomUUID(),
    role: "user",
    content: task.prompt,
    timestamp: Date.now(),
  });

  return {
    messages,
    ...(task.systemPrompt !== undefined ? { systemPrompt: task.systemPrompt } : {}),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
