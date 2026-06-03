import { randomUUID } from "crypto";
import type { EvalReport, EvalOptions } from "./types.js";
import { EVAL_TASKS, getTasksByType } from "./tasks.js";
import { runTask } from "./runner.js";
import { buildSummary } from "./report.js";

export async function runHarness(opts: EvalOptions): Promise<EvalReport> {
  const tasks = opts.taskFilter?.length
    ? getTasksByType(opts.taskFilter)
    : EVAL_TASKS;

  if (tasks.length === 0) {
    throw new Error(`No tasks match filter: ${opts.taskFilter?.join(", ")}`);
  }

  const modeLabel =
    opts.mode === "baseline" ? "baseline only" :
    opts.mode === "optimized" ? "optimized only" :
    "baseline + optimized";
  console.log(
    `\n\x1b[1mEval Harness\x1b[0m — ${tasks.length} task(s) — ${modeLabel}`
  );
  console.log(`Provider: ${opts.provider}  Model: ${opts.model}  Judge: ${opts.judgeEnabled ? "enabled" : "heuristic"}\n`);

  const results = [];

  for (const task of tasks) {
    process.stdout.write(`  Running: ${task.name} … `);
    const t0 = Date.now();

    try {
      const result = await runTask(task, opts);
      results.push(result);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if (opts.mode === "baseline" && result.baseline) {
        console.log(`\x1b[32m✓\x1b[0m  (${elapsed}s)  prompt tokens: ${result.baseline.usage.promptTokens}  quality: ${result.baseline.qualityScore}`);
      } else if (opts.mode === "optimized" && result.optimized) {
        console.log(`\x1b[32m✓\x1b[0m  (${elapsed}s)  prompt tokens: ${result.optimized.usage.promptTokens}  quality: ${result.optimized.qualityScore}`);
      } else {
        console.log(
          `\x1b[32m✓\x1b[0m  (${elapsed}s)  tokens: ${result.baseline?.usage.promptTokens} → ${result.optimized?.usage.promptTokens}  savings: ${result.tokenSavingsPct > 0 ? "+" : ""}${result.tokenSavingsPct.toFixed(1)}%  quality: ${result.baseline?.qualityScore} → ${result.optimized?.qualityScore}`
        );
      }
    } catch (err) {
      console.log(`\x1b[31m✗\x1b[0m  ${(err as Error).message}`);
    }
  }

  const summary = buildSummary(results, opts.mode);

  const report: EvalReport = {
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    provider: opts.provider,
    model: opts.model,
    judgeEnabled: opts.judgeEnabled,
    mode: opts.mode,
    results,
    summary,
  };

  return report;
}
