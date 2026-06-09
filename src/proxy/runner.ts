import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Context, Message, PipelineConfig } from "@/types/index.js";
import { Pipeline, loadConfig } from "@/core/index.js";
import { MemoryStore } from "@/memory/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";
import { createProvider } from "./provider-factory.js";
import { scoreQuality } from "./quality.js";
import { RunLogger } from "./logger.js";
import { printReport } from "./report.js";
import type { RunOptions, RunResult, ComparisonReport } from "./types.js";

export async function runProxy(
  prompt: string,
  opts: Partial<RunOptions> = {}
): Promise<ComparisonReport> {
  const options: RunOptions = {
    mode: "both",
    maxTokens: 8000,
    targetTokens: 4000,
    memoryEnabled: true,
    provider: "claude",
    model: "claude-sonnet-4-6",
    logDir: join(homedir(), ".context-engine", "logs"),
    ...opts,
  };

  const runId = randomUUID();
  const timestamp = new Date().toISOString();

  // Build initial context from prompt + optional history file
  const inputContext = buildContext(prompt, options.contextFile);

  const report: ComparisonReport = { runId, timestamp, prompt };

  if (options.mode === "baseline" || options.mode === "both") {
    report.baseline = await runBaseline(prompt, inputContext, options);
  }

  if (options.mode === "optimized" || options.mode === "both") {
    report.optimized = await runOptimized(prompt, inputContext, options);
  }

  // Compute comparison metrics
  if (report.baseline && report.optimized) {
    const baseIn = report.baseline.usage.promptTokens;
    const optIn = report.optimized.usage.promptTokens;
    report.tokenSavingsPct = ((baseIn - optIn) / Math.max(baseIn, 1)) * 100;
    report.qualityDelta = report.optimized.qualityScore - report.baseline.qualityScore;
  }

  // Persist log
  const logger = new RunLogger(options.logDir);
  const logPath = logger.save(report);

  // Print to console (report always goes to stdout — it's invoked directly by the user)
  printReport(report);
  process.stderr.write(`[deja] log saved → ${logPath}\n`);

  return report;
}

// ── baseline ─────────────────────────────────────────────────────────────

async function runBaseline(
  prompt: string,
  inputContext: Context,
  opts: RunOptions
): Promise<RunResult> {
  const provider = createProvider(opts.provider, opts.model);

  const t0 = Date.now();
  const response = await provider.send({
    context: inputContext,
    maxTokens: 1024,
  });
  const latencyMs = Date.now() - t0;

  return {
    mode: "baseline",
    inputContext,
    outputContext: inputContext,
    response: response.content,
    usage: response.usage,
    qualityScore: scoreQuality(prompt, response.content),
    latencyMs,
  };
}

// ── optimized ────────────────────────────────────────────────────────────

async function runOptimized(
  prompt: string,
  inputContext: Context,
  opts: RunOptions
): Promise<RunResult> {
  const config: PipelineConfig = await loadConfig({
    maxTokens: opts.maxTokens,
    targetTokens: opts.targetTokens,
    memoryEnabled: opts.memoryEnabled,
  });

  const pipeline = new Pipeline();
  const pipelineResult = await pipeline.run(inputContext, config);
  const optimizedContext = pipelineResult.context;

  const provider = createProvider(opts.provider, opts.model);

  const t0 = Date.now();
  const response = await provider.send({
    context: optimizedContext,
    maxTokens: 1024,
  });
  const latencyMs = Date.now() - t0;

  return {
    mode: "optimized",
    inputContext,
    outputContext: optimizedContext,
    response: response.content,
    usage: {
      ...response.usage,
      // Use actual pipeline-estimated tokens as prompt count (more accurate for mock)
      promptTokens: estimateTokens(optimizedContext),
    },
    pipelineStats: pipelineResult.stats,
    qualityScore: scoreQuality(prompt, response.content),
    latencyMs,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function buildContext(prompt: string, contextFile?: string): Context {
  const userMessage: Message = {
    id: randomUUID(),
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  };

  if (contextFile) {
    try {
      const history = JSON.parse(readFileSync(contextFile, "utf-8")) as Context;
      return {
        ...history,
        messages: [...history.messages, userMessage],
      };
    } catch {
      console.warn(`⚠  Could not load context file: ${contextFile}`);
    }
  }

  return { messages: [userMessage] };
}
