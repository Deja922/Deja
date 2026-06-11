#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Command } from "commander";
import { runLongHarness } from "@/eval/long-session/harness.js";
import { printLongReport } from "@/eval/long-session/report.js";
import type { LongEvalOptions } from "@/eval/long-session/types.js";

const program = new Command();

program
  .name("long-eval")
  .description("Long-session Eval — 20-round coding session, baseline vs Context Engine")
  .option("-p, --provider <name>", "Provider: claude | openai | mock", "claude")
  .option("-m, --model <name>", "Model name", "claude-sonnet-4-6")
  .option("--mode <mode>", "Run mode: baseline | optimized | both", "both")
  .option("--max-tokens <n>", "Max tokens for pipeline", "8000")
  .option("--target-tokens <n>", "Target tokens after compression", "4500")
  .option("--rounds <n>", "Number of rounds to run (max 60, default 20)", "20")
  .option("--workflow <name>", "Workflow: coding | planning | agent", "coding")
  .option("--dataset <name>", "Turn dataset: loop (cycling standard turns) | realistic", "loop")
  .option("--judge", "Use Claude Haiku to judge output quality", false)
  .option("-o, --output <path>", "Save full report as JSON")
  .option("-v, --verbose", "Print each round's response snippet", false)
  .parse(process.argv);

const raw = program.opts<{
  provider: string;
  model: string;
  mode: string;
  maxTokens: string;
  targetTokens: string;
  rounds: string;
  workflow: string;
  dataset: string;
  judge: boolean;
  output?: string;
  verbose: boolean;
}>();

const opts: LongEvalOptions & { dataset: "loop" | "realistic" } = {
  provider: raw.provider as LongEvalOptions["provider"],
  model: raw.model,
  mode: (raw.mode as LongEvalOptions["mode"]) ?? "both",
  maxTokens: parseInt(raw.maxTokens, 10),
  targetTokens: parseInt(raw.targetTokens, 10),
  numRounds: Math.min(60, Math.max(1, parseInt(raw.rounds, 10))),
  workflow: (["coding", "planning", "agent"].includes(raw.workflow) ? raw.workflow : "coding") as "coding" | "planning" | "agent",
  dataset: raw.dataset === "realistic" ? "realistic" : "loop",
  judgeEnabled: raw.judge,
  ...(raw.output !== undefined ? { outputFile: raw.output } : {}),
  verbose: raw.verbose,
};

(async () => {
  try {
    process.stdout.write("\n");

    const report = await runLongHarness(opts);

    printLongReport(report, opts.mode);

    // Auto-save JSON
    const logDir = join(homedir(), ".context-engine", "long-eval-logs");
    mkdirSync(logDir, { recursive: true });
    const autoPath = join(logDir, `long-eval-${report.runId.slice(0, 8)}.json`);
    writeFileSync(autoPath, JSON.stringify(report, null, 2));
    console.log(`\x1b[2mAuto-saved → ${autoPath}\x1b[0m\n`);

    if (opts.outputFile) {
      writeFileSync(opts.outputFile, JSON.stringify(report, null, 2));
      console.log(`Report saved → ${opts.outputFile}\n`);
    }

    if (opts.verbose) {
      console.log(`\x1b[1m  Round Responses (baseline)\x1b[0m\n`);
      for (const r of report.baseline.rounds) {
        console.log(`  [Round ${r.turnId} — ${r.topic}]`);
        console.log(`  ${r.response.slice(0, 200).replace(/\n/g, "\n  ")}…\n`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error(`\x1b[31mLong-eval failed:\x1b[0m ${(err as Error).message}`);
    if (raw.verbose) console.error((err as Error).stack);
    process.exit(1);
  }
})();
