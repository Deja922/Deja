import { randomUUID } from "crypto";
import type { LongSessionReport, LongSessionResult, LongEvalOptions } from "./types.js";
import { getTurns } from "./turns.js";
import { runSession } from "./session.js";
import { buildLongSummary, buildSingleModeSummary } from "./report.js";

export async function runLongHarness(opts: LongEvalOptions): Promise<LongSessionReport> {
  const workflow = opts.workflow ?? "coding";
  const turns = getTurns(opts.numRounds, workflow);
  const mode = opts.mode ?? "both";

  console.log(`\n\x1b[1mLong-Session Eval Harness\x1b[0m — ${turns.length} rounds — ${workflow} workflow — ${mode === "both" ? "baseline + optimized" : mode + " only"}`);
  console.log(`Provider: ${opts.provider}  Model: ${opts.model}  Judge: ${opts.judgeEnabled ? "Claude Haiku" : "heuristic"}\n`);

  let baseline: LongSessionResult | undefined;
  let optimized: LongSessionResult | undefined;

  if (mode === "baseline" || mode === "both") {
    console.log(`\x1b[2mRunning BASELINE session...\x1b[0m`);
    baseline = await runSession(turns, "baseline", workflow, opts);
  }

  if (mode === "optimized" || mode === "both") {
    console.log(`\x1b[2mRunning OPTIMIZED session...\x1b[0m`);
    optimized = await runSession(turns, "optimized", workflow, opts);
  }

  // For single-mode runs, create a stub for the missing side so the report
  // type is satisfied; the report printer checks mode and skips comparison.
  const stub: LongSessionResult = {
    mode: mode === "baseline" ? "optimized" : "baseline",
    rounds: [],
    metrics: {
      avgRedundancyRate: 0, memoryRetentionScore: 0, reasoningDrift: 0,
      totalPromptTokens: 0, totalCompletionTokens: 0,
      tokenGrowthCurve: [], qualityCurve: [],
    },
    protocolErrors: 0,
  };

  const finalBaseline = baseline ?? stub;
  const finalOptimized = optimized ?? stub;

  const summary = mode === "both"
    ? buildLongSummary(finalBaseline, finalOptimized, turns)
    : buildSingleModeSummary(mode === "baseline" ? finalBaseline : finalOptimized, mode, turns.length);

  const report: LongSessionReport = {
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    provider: opts.provider,
    model: opts.model,
    judgeEnabled: opts.judgeEnabled,
    numRounds: turns.length,
    baseline: finalBaseline,
    optimized: finalOptimized,
    summary,
  };

  return report;
}
