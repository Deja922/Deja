#!/usr/bin/env node
import { writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Command } from "commander";
import { runHarness } from "@/eval/harness.js";
import { printReport, printVerbose } from "@/eval/report.js";
import type { EvalOptions } from "@/eval/types.js";

const program = new Command();

program
  .name("eval")
  .description("Eval Harness — compare baseline vs Context Engine across 5 task types")
  .option("-t, --task <types...>",
    "Filter tasks by type (coding planning reasoning summarization agent_workflow)",
    []
  )
  .option("--mode <mode>", "Run mode: baseline | optimized | both", "both")
  .option("-p, --provider <name>", "Provider: claude | openai | mock", "claude")
  .option("-m, --model <name>", "Model name", "claude-sonnet-4-6")
  .option("--max-tokens <n>", "Max tokens for Context Engine pipeline", "8000")
  .option("--target-tokens <n>", "Target tokens after compression", "3000")
  .option("--judge", "Use Claude Haiku to judge output quality (costs extra API calls)", false)
  .option("-o, --output <path>", "Save full report as JSON to this path")
  .option("-v, --verbose", "Print full response text and score breakdowns", false)
  .parse(process.argv);

const raw = program.opts<{
  task: string[];
  mode: string;
  provider: string;
  model: string;
  maxTokens: string;
  targetTokens: string;
  judge: boolean;
  output?: string;
  verbose: boolean;
}>();

const opts: EvalOptions = {
  taskFilter: raw.task.length > 0 ? (raw.task as EvalOptions["taskFilter"]) : undefined,
  provider: raw.provider as EvalOptions["provider"],
  model: raw.model,
  maxTokens: parseInt(raw.maxTokens, 10),
  targetTokens: parseInt(raw.targetTokens, 10),
  judgeEnabled: raw.judge,
  outputFile: raw.output,
  verbose: raw.verbose,
  mode: (raw.mode as EvalOptions["mode"]) ?? "both",
};

(async () => {
  try {
    const report = await runHarness(opts);

    printReport(report);

    if (opts.verbose) {
      printVerbose(report);
    }

    // Auto-save JSON log
    const logDir = join(homedir(), ".context-engine", "eval-logs");
    const autoPath = join(logDir, `eval-${report.runId.slice(0, 8)}.json`);
    try {
      const { mkdirSync } = await import("fs");
      mkdirSync(logDir, { recursive: true });
      writeFileSync(autoPath, JSON.stringify(report, null, 2));
      console.log(`\x1b[2mAuto-saved → ${autoPath}\x1b[0m\n`);
    } catch {
      // non-fatal
    }

    // Explicit output path
    if (opts.outputFile) {
      writeFileSync(opts.outputFile, JSON.stringify(report, null, 2));
      console.log(`Report saved → ${opts.outputFile}\n`);
    }

    process.exit(0);
  } catch (err) {
    console.error(`\x1b[31mEval failed:\x1b[0m ${(err as Error).message}`);
    if (raw.verbose) console.error((err as Error).stack);
    process.exit(1);
  }
})();
