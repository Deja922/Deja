import type { Context } from "@/types/index.js";
import type { ComparisonReport, RunResult } from "./types.js";

// ── ANSI colours ─────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  white: "\x1b[37m",
};

function pad(s: string | number, n: number): string {
  return String(s).slice(0, n).padEnd(n);
}

function charCount(ctx: Context): number {
  return (
    ctx.messages.reduce((s, m) => s + m.content.length, 0) +
    (ctx.systemPrompt?.length ?? 0)
  );
}

function fmtNum(n: number, decimals = 0): string {
  return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
}

function printRow(
  label: string,
  base: number,
  opt: number,
  lowerIsBetter: boolean,
  decimals = 0
): void {
  const isOptBetter = lowerIsBetter ? opt < base : opt > base;
  const optColor = isOptBetter ? c.green : opt === base ? c.white : c.yellow;

  const deltaPct =
    ((lowerIsBetter ? base - opt : opt - base) / Math.max(base, 1)) * 100;
  const deltaStr =
    Math.abs(deltaPct) > 0.5
      ? ` (${deltaPct > 0 ? "-" : "+"}${Math.abs(deltaPct).toFixed(0)}%)`
      : "";

  console.log(
    `${c.cyan}║${c.reset} ${pad(label, 16)} ${c.cyan}║${c.reset} ` +
      `${pad(fmtNum(base, decimals), 16)} ${c.cyan}║${c.reset} ` +
      `${optColor}${pad(fmtNum(opt, decimals) + deltaStr, 14)}${c.reset} ${c.cyan}║${c.reset}`
  );
}

function printSingleRow(label: string, value: number, decimals = 0): void {
  console.log(
    `${c.cyan}║${c.reset} ${pad(label, 16)} ${c.cyan}║${c.reset} ` +
      `${pad(fmtNum(value, decimals), 33)} ${c.cyan}║${c.reset}`
  );
}

function printResponse(label: string, response: string): void {
  const bar = "─".repeat(Math.max(0, 44 - label.length));
  console.log(`\n${c.bold}── ${label} Response ${bar}${c.reset}`);
  console.log(
    c.dim +
      response.slice(0, 600) +
      (response.length > 600 ? "\n… (truncated)" : "") +
      c.reset
  );
}

export function printReport(report: ComparisonReport): void {
  const { baseline, optimized } = report;

  console.log(
    `\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}║       Context Engine — Comparison Report             ║${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}╠══════════════════╦══════════════════╦════════════════╣${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}║${c.reset} ${pad("Metric", 16)} ${c.cyan}║${c.reset} ${pad("Baseline", 16)} ${c.cyan}║${c.reset} ${pad("Optimized", 14)} ${c.cyan}║${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}╠══════════════════╬══════════════════╬════════════════╣${c.reset}`
  );

  if (baseline && optimized) {
    printRow("Input tokens",  baseline.usage.promptTokens,     optimized.usage.promptTokens,     true);
    printRow("Prompt chars",  charCount(baseline.inputContext), charCount(optimized.outputContext),true);
    printRow("Output tokens", baseline.usage.completionTokens, optimized.usage.completionTokens, false);
    printRow("Latency (ms)",  baseline.latencyMs,               optimized.latencyMs,              true);
    printRow("Quality score", baseline.qualityScore,            optimized.qualityScore,           false, 1);
  } else {
    const r = (baseline ?? optimized)!;
    printSingleRow("Input tokens",  r.usage.promptTokens);
    printSingleRow("Output tokens", r.usage.completionTokens);
    printSingleRow("Latency (ms)",  r.latencyMs);
    printSingleRow("Quality score", r.qualityScore, 1);
    if (optimized?.pipelineStats) {
      const s = optimized.pipelineStats;
      printSingleRow("Msgs dropped",   s.messagesDropped);
      printSingleRow("Msgs summarized",s.messagesSummarized);
      printSingleRow("Memory hits",    s.memoryHits);
    }
  }

  console.log(
    `${c.bold}${c.cyan}╠══════════════════╩══════════════════╩════════════════╣${c.reset}`
  );

  if (baseline && optimized && report.tokenSavingsPct !== undefined) {
    const savings = report.tokenSavingsPct;
    const qDelta = report.qualityDelta ?? 0;
    const savingsColor = savings > 0 ? c.green : c.red;
    const qualColor = qDelta >= -0.5 ? c.green : c.yellow;
    const line =
      `  Token savings: ${savingsColor}${savings.toFixed(1)}%${c.reset}` +
      `   Quality delta: ${qualColor}${qDelta >= 0 ? "+" : ""}${qDelta.toFixed(1)}${c.reset}`;
    console.log(`${c.bold}${c.cyan}║${c.reset}${line}${" ".repeat(11)}${c.bold}${c.cyan}║${c.reset}`);
  }

  console.log(
    `${c.bold}${c.cyan}╚══════════════════════════════════════════════════════╝${c.reset}`
  );

  if (baseline) printResponse("Baseline", baseline.response);
  if (optimized) printResponse("Optimized", optimized.response);
}
