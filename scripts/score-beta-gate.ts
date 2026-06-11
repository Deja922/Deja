#!/usr/bin/env node
/**
 * score-beta-gate.ts
 * Read an EvalReport or LongSessionReport JSON and print pass/fail for each
 * beta-gate metric defined in docs/beta-gate.md.
 *
 * Usage:
 *   npx tsx scripts/score-beta-gate.ts <report.json>
 *   node dist/scripts/score-beta-gate.js <report.json>
 */

import { readFileSync } from "fs";
import type { EvalReport, EvalResult } from "../src/eval/types.js";
import type { LongSessionReport, SessionRound } from "../src/eval/long-session/types.js";

// ── thresholds (from docs/beta-gate.md) ─────────────────────────────────────
const THRESHOLDS = {
  compressionSuccessRate: { min: 97,  unit: "%",  cmp: "gte" },
  offTopicRate:           { max: 2,   unit: "%",  cmp: "lte" },
  repetitionRate:         { max: 3,   unit: "%",  cmp: "lte" },
  autoBypassRate:         { max: 15,  unit: "%",  cmp: "lte" },
  tokenSavingsRate:       { min: 30,  unit: "%",  cmp: "gte" },
  latencyOverheadMs:      { max: 800, unit: "ms", cmp: "lte" },
} as const;

function pct(n: number): string { return n.toFixed(1) + "%"; }
function ms(n: number): string  { return Math.round(n) + " ms"; }

function pass(label: string, value: string, threshold: string): void {
  console.log(`  ✓  PASS  ${label.padEnd(32)} ${value.padStart(8)}  (threshold: ${threshold})`);
}
function fail(label: string, value: string, threshold: string): void {
  console.log(`  ✗  FAIL  ${label.padEnd(32)} ${value.padStart(8)}  (threshold: ${threshold})`);
}
function na(label: string, reason: string): void {
  console.log(`  -  N/A   ${label.padEnd(32)}           (${reason})`);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── EvalReport scorer ────────────────────────────────────────────────────────
function scoreEvalReport(report: EvalReport): void {
  const results = report.results;
  const optimized = results.filter(r => r.optimized);
  const total = optimized.length;
  if (!total) { console.error("No optimized results found in report."); process.exit(1); }

  // Metric 1: compression success — no pipelineStats failure proxy; treat
  // any result where optimized.response is non-empty as success.
  const successes = optimized.filter(r => r.optimized.response?.trim().length > 0).length;
  const m1 = (successes / total) * 100;
  m1 >= THRESHOLDS.compressionSuccessRate.min
    ? pass("Compression success rate", pct(m1), "≥97%")
    : fail("Compression success rate", pct(m1), "≥97%");

  // Metric 2: off-topic — only meaningful when judge is enabled; heuristic quality ≠ off-topic
  if (report.judgeEnabled) {
    const offTopic = optimized.filter(r => r.optimized.qualityScore < 4).length;
    const m2 = (offTopic / total) * 100;
    m2 <= THRESHOLDS.offTopicRate.max
      ? pass("Off-topic / wrong-answer rate", pct(m2), "≤2%")
      : fail("Off-topic / wrong-answer rate", pct(m2), "≤2%");
  } else {
    na("Off-topic / wrong-answer rate", "requires --judge flag; heuristic qualityScore ≠ off-topic");
  }

  // Metric 3: repetition — no dedicated field in EvalReport
  na("Repetition rate", "no repetition field in EvalReport; requires LongSessionReport + manual review");

  // Metric 4: auto-bypass — check for explicit bypass:true in pipelineStats
  const withStats = optimized.filter(r => r.pipelineStats);
  const hasBypassField = withStats.some(r => "bypass" in (r.pipelineStats as Record<string, unknown>));
  if (hasBypassField) {
    const autoBypass = withStats.filter(r => (r.pipelineStats as Record<string, unknown>)["bypass"] === true).length;
    const m4 = (autoBypass / withStats.length) * 100;
    m4 <= THRESHOLDS.autoBypassRate.max
      ? pass("Auto-bypass trigger rate", pct(m4), "≤15%")
      : fail("Auto-bypass trigger rate", pct(m4), "≤15%");
  } else {
    na("Auto-bypass trigger rate", "no bypass field in pipelineStats; eval harness runs pipeline directly");
  }

  // Metric 5: token savings
  const m5 = report.summary.avgTokenSavingsPct;
  m5 >= THRESHOLDS.tokenSavingsRate.min
    ? pass("Token savings rate", pct(m5), "≥30%")
    : fail("Token savings rate", pct(m5), "≥30%");

  // Metric 6: latency overhead — median(optimized - baseline) for paired results
  const paired = results.filter(r => r.baseline && r.optimized);
  if (paired.length) {
    const deltas = paired.map(r => r.optimized.latencyMs - r.baseline.latencyMs);
    const m6 = median(deltas);
    m6 <= THRESHOLDS.latencyOverheadMs.max
      ? pass("Compression latency overhead", ms(m6), "≤800ms")
      : fail("Compression latency overhead", ms(m6), "≤800ms");
  } else {
    na("Compression latency overhead", "no paired baseline+optimized results");
  }
}

// ── LongSessionReport scorer ─────────────────────────────────────────────────
function scoreLongSessionReport(report: LongSessionReport): void {
  const opt = report.optimized;
  const base = report.baseline;
  const rounds = opt.rounds;
  const total = rounds.length;
  if (!total) { console.error("No optimized rounds found in report."); process.exit(1); }

  // Metric 1: compression success — rounds without protocolError
  const errors = opt.protocolErrors ?? 0;
  const m1 = ((total - errors) / total) * 100;
  m1 >= THRESHOLDS.compressionSuccessRate.min
    ? pass("Compression success rate", pct(m1), "≥97%")
    : fail("Compression success rate", pct(m1), "≥97%");

  // Metric 2: off-topic — only meaningful when judge is enabled
  if (report.judgeEnabled) {
    const offTopic = rounds.filter(r => r.qualityScore < 4).length;
    const m2 = (offTopic / total) * 100;
    m2 <= THRESHOLDS.offTopicRate.max
      ? pass("Off-topic / wrong-answer rate", pct(m2), "≤2%")
      : fail("Off-topic / wrong-answer rate", pct(m2), "≤2%");
  } else {
    na("Off-topic / wrong-answer rate", "requires --judge flag; heuristic qualityScore ≠ off-topic");
  }

  // Metric 3: repetition — avgRedundancyRate measures history redundancy, not output repetition
  na("Repetition rate", "avgRedundancyRate ≠ output repetition; requires LLM judge or manual review");

  // Metric 4: auto-bypass — check for explicit bypass:true in pipelineStats
  const withStats = rounds.filter(r => r.pipelineStats);
  const hasBypassField = withStats.some(r => "bypass" in (r.pipelineStats as Record<string, unknown>));
  if (hasBypassField) {
    const autoBypass = withStats.filter(r => (r.pipelineStats as Record<string, unknown>)["bypass"] === true).length;
    const m4 = (autoBypass / withStats.length) * 100;
    m4 <= THRESHOLDS.autoBypassRate.max
      ? pass("Auto-bypass trigger rate", pct(m4), "≤15%")
      : fail("Auto-bypass trigger rate", pct(m4), "≤15%");
  } else {
    na("Auto-bypass trigger rate", "no bypass field in pipelineStats; eval harness runs pipeline directly");
  }

  // Metric 5: token savings
  const m5 = report.summary.avgTokenSavingsPct;
  m5 >= THRESHOLDS.tokenSavingsRate.min
    ? pass("Token savings rate", pct(m5), "≥30%")
    : fail("Token savings rate", pct(m5), "≥30%");

  // Metric 6: latency overhead — median(optimized - baseline) paired by turnId
  const baseMap = new Map(base.rounds.map(r => [r.turnId, r.latencyMs]));
  const deltas = rounds
    .filter(r => baseMap.has(r.turnId))
    .map(r => r.latencyMs - baseMap.get(r.turnId)!);
  if (deltas.length) {
    const m6 = median(deltas);
    m6 <= THRESHOLDS.latencyOverheadMs.max
      ? pass("Compression latency overhead", ms(m6), "≤800ms")
      : fail("Compression latency overhead", ms(m6), "≤800ms");
  } else {
    na("Compression latency overhead", "no paired baseline rounds");
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const file = process.argv[2];
if (!file) {
  console.error("Usage: score-beta-gate <report.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;

console.log();
console.log("  Deja Beta Gate — Score Report");
console.log(`  File      : ${file}`);
console.log(`  Run ID    : ${raw["runId"] ?? "n/a"}`);
console.log(`  Timestamp : ${raw["timestamp"] ?? "n/a"}`);
console.log();

if (Array.isArray(raw["results"])) {
  console.log("  Report type: EvalReport\n");
  scoreEvalReport(raw as unknown as EvalReport);
} else if (raw["baseline"] && raw["optimized"]) {
  console.log("  Report type: LongSessionReport\n");
  scoreLongSessionReport(raw as unknown as LongSessionReport);
} else {
  console.error("Unrecognised report format. Expected EvalReport or LongSessionReport.");
  process.exit(1);
}

console.log();
