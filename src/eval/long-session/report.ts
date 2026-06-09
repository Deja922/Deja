import type {
  LongSessionReport,
  LongSessionResult,
  LongSessionSummary,
  TaskBreakdownEntry,
  TurnTopic,
  SessionRound,
} from "./types.js";
import type { LongSessionTurn } from "./types.js";

// ── public entry ──────────────────────────────────────────────────────────

export function printLongReport(report: LongSessionReport, mode = "both"): void {
  if (mode === "baseline") {
    printSingleModeReport(report.baseline, report);
    return;
  }
  if (mode === "optimized") {
    printSingleModeReport(report.optimized, report);
    return;
  }
  printTokenCurve(report);
  printRoundTable(report);
  printMetricsTable(report);
  printTaskBreakdown(report.summary.taskBreakdown);
  printVerdict(report);
}

// ── single-mode report ────────────────────────────────────────────────────

function printSingleModeReport(result: LongSessionResult, report: LongSessionReport): void {
  const label = result.mode === "baseline" ? "BASELINE (no Context Engine)" : "OPTIMIZED (with Context Engine)";
  const W = { round: 5, topic: 16, ptok: 9, ctok: 9, q: 7, lat: 9 };

  const top = `┌${"─".repeat(W.round+2)}┬${"─".repeat(W.topic+2)}┬${"─".repeat(W.ptok+2)}┬${"─".repeat(W.ctok+2)}┬${"─".repeat(W.q+2)}┬${"─".repeat(W.lat+2)}┐`;
  const mid = `├${"─".repeat(W.round+2)}┼${"─".repeat(W.topic+2)}┼${"─".repeat(W.ptok+2)}┼${"─".repeat(W.ctok+2)}┼${"─".repeat(W.q+2)}┼${"─".repeat(W.lat+2)}┤`;
  const bot = `└${"─".repeat(W.round+2)}┴${"─".repeat(W.topic+2)}┴${"─".repeat(W.ptok+2)}┴${"─".repeat(W.ctok+2)}┴${"─".repeat(W.q+2)}┴${"─".repeat(W.lat+2)}┘`;
  const row = (r: string, t: string, p: string, c: string, q: string, l: string) =>
    `│ ${rc(r,W.round)} │ ${lc(t,W.topic)} │ ${rc(p,W.ptok)} │ ${rc(c,W.ctok)} │ ${rc(q,W.q)} │ ${rc(l,W.lat)} │`;

  console.log(`\n\x1b[1m  LONG-SESSION EVAL — ${label}\x1b[0m  —  ${report.timestamp}`);
  console.log(`  Provider: ${report.provider}  Model: ${report.model}  Rounds: ${result.rounds.length}\n`);
  console.log(top);
  console.log(row("Round", "Topic", "Prompt T", "Compl T", "Quality", "Latency"));
  console.log(mid);

  let totalPrompt = 0, totalCompl = 0;
  for (const r of result.rounds) {
    totalPrompt += r.promptTokens;
    totalCompl += r.completionTokens;
    const isCheckpoint = [8, 12, 16, 20].includes(r.turnId);
    const roundLabel = isCheckpoint ? `${r.turnId}*` : String(r.turnId);
    console.log(row(roundLabel, r.topic.replace("_"," "), r.promptTokens.toString(), r.completionTokens.toString(), r.qualityScore.toFixed(1), `${r.latencyMs}ms`));
  }

  console.log(mid);
  const m = result.metrics;
  console.log(row("TOT", "", totalPrompt.toString(), totalCompl.toString(), avg(m.qualityCurve).toFixed(1), ""));
  console.log(bot);
  console.log(`  * = memory checkpoint round\n`);
  console.log(`  Total prompt tokens: \x1b[1m${totalPrompt.toLocaleString()}\x1b[0m   Completion tokens: \x1b[1m${totalCompl.toLocaleString()}\x1b[0m`);
  console.log(`  Avg quality: ${avg(m.qualityCurve).toFixed(1)}/10   Memory retention: ${m.memoryRetentionScore}/10   Reasoning stability: ${m.reasoningDrift}/10\n`);
}

// ── ASCII token growth curve ──────────────────────────────────────────────

function printTokenCurve(report: LongSessionReport): void {
  const baseCurve = report.baseline.metrics.tokenGrowthCurve;
  const optCurve = report.optimized.metrics.tokenGrowthCurve;
  const n = Math.min(baseCurve.length, optCurve.length);

  const maxTok = Math.max(...baseCurve, ...optCurve, 1);
  const HEIGHT = 10;
  const WIDTH = n;

  console.log(`\n\x1b[1m  Token Growth Curve\x1b[0m  (● baseline  ○ optimized)\n`);

  for (let row = HEIGHT; row >= 0; row--) {
    const threshold = (row / HEIGHT) * maxTok;
    const label = row % 2 === 0 ? String(Math.round(threshold)).padStart(5) : "     ";
    let line = `${label} ┤ `;
    for (let col = 0; col < WIDTH; col++) {
      const base = baseCurve[col] ?? 0;
      const opt = optCurve[col] ?? 0;
      const baseAbove = base >= threshold;
      const optAbove = opt >= threshold;
      if (baseAbove && optAbove) line += "\x1b[33m◉\x1b[0m ";  // overlap → yellow
      else if (baseAbove) line += "\x1b[31m●\x1b[0m ";          // baseline only → red
      else if (optAbove) line += "\x1b[32m○\x1b[0m ";           // optimized only → green
      else line += "  ";
    }
    console.log(line);
  }

  // x-axis
  const axis = "      └─" + "──".repeat(WIDTH);
  console.log(axis);
  const labels = "        " + [...Array(WIDTH)].map((_, i) => String(i + 1).padEnd(2)).join("");
  console.log(labels);
  console.log(`        Round →\n`);
}

// ── per-round table ───────────────────────────────────────────────────────

function printRoundTable(report: LongSessionReport): void {
  const W = { round: 5, topic: 16, btok: 9, otok: 9, sav: 8, bq: 7, oq: 7 };

  const top = `┌${"─".repeat(W.round + 2)}┬${"─".repeat(W.topic + 2)}┬${"─".repeat(W.btok + 2)}┬${"─".repeat(W.otok + 2)}┬${"─".repeat(W.sav + 2)}┬${"─".repeat(W.bq + 2)}┬${"─".repeat(W.oq + 2)}┐`;
  const mid = `├${"─".repeat(W.round + 2)}┼${"─".repeat(W.topic + 2)}┼${"─".repeat(W.btok + 2)}┼${"─".repeat(W.otok + 2)}┼${"─".repeat(W.sav + 2)}┼${"─".repeat(W.bq + 2)}┼${"─".repeat(W.oq + 2)}┤`;
  const bot = `└${"─".repeat(W.round + 2)}┴${"─".repeat(W.topic + 2)}┴${"─".repeat(W.btok + 2)}┴${"─".repeat(W.otok + 2)}┴${"─".repeat(W.sav + 2)}┴${"─".repeat(W.bq + 2)}┴${"─".repeat(W.oq + 2)}┘`;

  const row = (round: string, topic: string, btok: string, otok: string, sav: string, bq: string, oq: string) =>
    `│ ${rc(round, W.round)} │ ${lc(topic, W.topic)} │ ${rc(btok, W.btok)} │ ${rc(otok, W.otok)} │ ${rc(sav, W.sav)} │ ${rc(bq, W.bq)} │ ${rc(oq, W.oq)} │`;

  console.log(`\x1b[1m  Per-Round Comparison\x1b[0m\n`);
  console.log(top);
  console.log(row("Round", "Topic", "Base Tok", "Opt Tok", "Savings", "Base Q", "Opt Q"));
  console.log(mid);

  const n = Math.min(report.baseline.rounds.length, report.optimized.rounds.length);
  for (let i = 0; i < n; i++) {
    const b = report.baseline.rounds[i]!;
    const o = report.optimized.rounds[i]!;
    const savings = ((b.promptTokens - o.promptTokens) / Math.max(b.promptTokens, 1)) * 100;
    const savStr = savings > 0
      ? `\x1b[32m+${savings.toFixed(1)}%\x1b[0m`
      : savings < -0.5
      ? `\x1b[31m${savings.toFixed(1)}%\x1b[0m`
      : `${savings.toFixed(1)}%`;
    const isCheckpoint = [8, 12, 16, 20].includes(b.turnId);
    const roundLabel = isCheckpoint ? `\x1b[33m${b.turnId}*\x1b[0m` : String(b.turnId);

    console.log(
      `│ ${padColor(roundLabel, true, W.round + 2)} │ ${lc(b.topic.replace("_", " "), W.topic)} │ ${rc(b.promptTokens.toString(), W.btok)} │ ${rc(o.promptTokens.toString(), W.otok)} │ ${padColor(savStr, savings > 0, W.sav + 2)} │ ${rc(b.qualityScore.toFixed(1), W.bq)} │ ${rc(o.qualityScore.toFixed(1), W.oq)} │`
    );
  }

  console.log(mid);
  const bAvgTok = avg(report.baseline.rounds.map((r) => r.promptTokens));
  const oAvgTok = avg(report.optimized.rounds.map((r) => r.promptTokens));
  const bAvgQ = avg(report.baseline.rounds.map((r) => r.qualityScore));
  const oAvgQ = avg(report.optimized.rounds.map((r) => r.qualityScore));
  const avgSav = ((bAvgTok - oAvgTok) / Math.max(bAvgTok, 1)) * 100;
  console.log(row("AVG", "", bAvgTok.toFixed(0), oAvgTok.toFixed(0), `${avgSav > 0 ? "+" : ""}${avgSav.toFixed(1)}%`, bAvgQ.toFixed(1), oAvgQ.toFixed(1)));
  console.log(bot);
  console.log(`  \x1b[33m*\x1b[0m = memory checkpoint round\n`);
}

// ── metrics comparison table ──────────────────────────────────────────────

function printMetricsTable(report: LongSessionReport): void {
  const bm = report.baseline.metrics;
  const om = report.optimized.metrics;

  console.log(`\x1b[1m  Session Metrics\x1b[0m\n`);

  const rows: [string, string, string][] = [
    ["Total Prompt Tokens", bm.totalPromptTokens.toLocaleString(), om.totalPromptTokens.toLocaleString()],
    ["Avg Redundancy Rate", `${(bm.avgRedundancyRate * 100).toFixed(1)}%`, `${(om.avgRedundancyRate * 100).toFixed(1)}%`],
    ["Memory Retention", `${bm.memoryRetentionScore}/10`, `${om.memoryRetentionScore}/10`],
    ["Reasoning Drift (stability)", `${bm.reasoningDrift}/10`, `${om.reasoningDrift}/10`],
    ["Avg Quality", avg(bm.qualityCurve).toFixed(1), avg(om.qualityCurve).toFixed(1)],
  ];

  const W = { metric: 30, val: 14 };
  const top = `┌${"─".repeat(W.metric + 2)}┬${"─".repeat(W.val + 2)}┬${"─".repeat(W.val + 2)}┐`;
  const mid = `├${"─".repeat(W.metric + 2)}┼${"─".repeat(W.val + 2)}┼${"─".repeat(W.val + 2)}┤`;
  const bot = `└${"─".repeat(W.metric + 2)}┴${"─".repeat(W.val + 2)}┴${"─".repeat(W.val + 2)}┘`;

  console.log(top);
  console.log(`│ ${lc("Metric", W.metric)} │ ${lc("Baseline", W.val)} │ ${lc("Optimized", W.val)} │`);
  console.log(mid);
  for (const [metric, base, opt] of rows) {
    console.log(`│ ${lc(metric, W.metric)} │ ${rc(base, W.val)} │ ${rc(opt, W.val)} │`);
  }
  console.log(bot);
  console.log();
}

// ── task breakdown ────────────────────────────────────────────────────────

function printTaskBreakdown(breakdown: TaskBreakdownEntry[]): void {
  console.log(`\x1b[1m  Task Breakdown — Which Topics Benefit Most\x1b[0m\n`);
  const sorted = [...breakdown].sort((a, b) => b.avgSavingsPct - a.avgSavingsPct);
  for (const entry of sorted) {
    const bar = "█".repeat(Math.max(0, Math.round(entry.avgSavingsPct / 2)));
    const sign = entry.avgQualityDelta >= 0 ? "+" : "";
    console.log(
      `  ${entry.topic.replace("_", " ").padEnd(18)} ${bar.padEnd(25)} ${entry.avgSavingsPct > 0 ? "\x1b[32m" : "\x1b[31m"}${entry.avgSavingsPct > 0 ? "+" : ""}${entry.avgSavingsPct.toFixed(1)}%\x1b[0m savings   ΔQ: ${sign}${entry.avgQualityDelta.toFixed(1)}`
    );
  }
  console.log();
}

// ── verdict ───────────────────────────────────────────────────────────────

function printVerdict(report: LongSessionReport): void {
  const s = report.summary;
  console.log(`\x1b[1m  Final Verdict\x1b[0m\n`);
  console.log(`  ${s.verdict}`);
  console.log(`\n  Total tokens saved: \x1b[32m${s.totalTokenSaved.toLocaleString()}\x1b[0m  |  Avg savings: \x1b[32m${s.avgTokenSavingsPct > 0 ? "+" : ""}${s.avgTokenSavingsPct.toFixed(1)}%\x1b[0m  |  Peak savings: \x1b[32m+${s.peakTokenSavingsPct.toFixed(1)}%\x1b[0m`);
  console.log(`  Quality delta: ${s.qualityDelta >= 0 ? "\x1b[32m+" : "\x1b[31m"}${s.qualityDelta.toFixed(1)}\x1b[0m  |  Memory retention delta: ${s.memoryRetentionDelta >= 0 ? "\x1b[32m+" : "\x1b[31m"}${s.memoryRetentionDelta.toFixed(1)}\x1b[0m`);

  // Protocol error summary
  const bErrors = report.baseline.protocolErrors;
  const oErrors = report.optimized.protocolErrors;
  if (bErrors > 0 || oErrors > 0) {
    console.log(`  \x1b[31mProtocol errors: baseline=${bErrors} optimized=${oErrors}\x1b[0m`);
    for (const r of report.baseline.rounds) {
      if (r.protocolError) console.log(`    baseline round ${r.turnId}: ${r.protocolError}`);
    }
    for (const r of report.optimized.rounds) {
      if (r.protocolError) console.log(`    optimized round ${r.turnId}: ${r.protocolError}`);
    }
  } else {
    console.log(`  Protocol errors: \x1b[32m0\x1b[0m — no signature/thinking errors detected`);
  }
  console.log();
}

// ── summary builder ───────────────────────────────────────────────────────

export function buildLongSummary(
  baseline: LongSessionResult,
  optimized: LongSessionResult,
  turns: LongSessionTurn[]
): LongSessionSummary {
  const n = Math.min(baseline.rounds.length, optimized.rounds.length);

  const savingsPcts = baseline.rounds.slice(0, n).map((b, i) => {
    const o = optimized.rounds[i]!;
    return ((b.promptTokens - o.promptTokens) / Math.max(b.promptTokens, 1)) * 100;
  });

  const avgTokenSavingsPct = round2(avg(savingsPcts));
  const peakTokenSavingsPct = round2(Math.max(...savingsPcts, 0));
  const finalRoundSavingsPct = round2(savingsPcts[n - 1] ?? 0);
  const totalTokenSaved = baseline.metrics.totalPromptTokens - optimized.metrics.totalPromptTokens;

  const bAvgQ = round2(avg(baseline.rounds.map((r) => r.qualityScore)));
  const oAvgQ = round2(avg(optimized.rounds.map((r) => r.qualityScore)));
  const qualityDelta = round2(oAvgQ - bAvgQ);
  const memoryRetentionDelta = round2(
    optimized.metrics.memoryRetentionScore - baseline.metrics.memoryRetentionScore
  );

  const taskBreakdown = buildTaskBreakdown(baseline.rounds, optimized.rounds, turns);
  const verdict = buildVerdict(avgTokenSavingsPct, qualityDelta, memoryRetentionDelta, finalRoundSavingsPct, n, taskBreakdown);

  return {
    avgTokenSavingsPct,
    peakTokenSavingsPct,
    finalRoundSavingsPct,
    totalTokenSaved,
    qualityDelta,
    memoryRetentionDelta,
    verdict,
    taskBreakdown,
  };
}

function buildTaskBreakdown(
  baselineRounds: SessionRound[],
  optimizedRounds: SessionRound[],
  turns: LongSessionTurn[]
): TaskBreakdownEntry[] {
  const topics = [...new Set(turns.map((t) => t.topic))] as TurnTopic[];
  return topics.map((topic) => {
    const turnIds = turns.filter((t) => t.topic === topic).map((t) => t.id);
    const bRounds = (baselineRounds as SessionRound[]).filter((r) => turnIds.includes(r.turnId));
    const oRounds = (optimizedRounds as SessionRound[]).filter((r) => turnIds.includes(r.turnId));
    const savingsPcts = bRounds.map((b, i) => {
      const o = oRounds[i];
      return o ? ((b.promptTokens - o.promptTokens) / Math.max(b.promptTokens, 1)) * 100 : 0;
    });
    return {
      topic,
      avgSavingsPct: round2(avg(savingsPcts)),
      avgQualityDelta: round2(avg(oRounds.map((r) => r.qualityScore)) - avg(bRounds.map((r) => r.qualityScore))),
      rounds: bRounds.length,
    };
  });
}

function buildVerdict(
  avgSavings: number,
  qualityDelta: number,
  memoryDelta: number,
  finalSavings: number,
  n: number,
  breakdown: TaskBreakdownEntry[]
): string {
  const parts: string[] = [];

  if (finalSavings > 30) {
    parts.push(`Context Engine is highly effective in long sessions — by round ${n}, token savings reach ${finalSavings.toFixed(1)}%.`);
  } else if (finalSavings > 15) {
    parts.push(`Context Engine provides meaningful compression in long sessions (${finalSavings.toFixed(1)}% savings by final round).`);
  } else if (finalSavings > 5) {
    parts.push(`Context Engine provides modest compression (${finalSavings.toFixed(1)}% by final round). Increase session length or lower targetTokens for better results.`);
  } else {
    parts.push(`Token savings are minimal (${finalSavings.toFixed(1)}%). Context may be too short or targetTokens too high.`);
  }

  if (qualityDelta > 0.3) parts.push(`Quality improved (+${qualityDelta.toFixed(1)}) — compression is beneficial.`);
  else if (qualityDelta >= -0.5) parts.push(`Quality is neutral (Δ${qualityDelta.toFixed(1)}) — compression is safe.`);
  else parts.push(`Quality dropped (${qualityDelta.toFixed(1)}) — review compression aggressiveness.`);

  if (memoryDelta < -1) parts.push(`Memory retention degraded (${memoryDelta.toFixed(1)}) — compression is dropping important context.`);
  else if (memoryDelta >= 0) parts.push(`Memory retention maintained.`);

  const bestTopic = [...breakdown].sort((a, b) => b.avgSavingsPct - a.avgSavingsPct)[0];
  const worstTopic = [...breakdown].sort((a, b) => a.avgSavingsPct - b.avgSavingsPct)[0];
  if (bestTopic && bestTopic.avgSavingsPct > 5) {
    parts.push(`Best compression: ${bestTopic.topic.replace("_", " ")} (+${bestTopic.avgSavingsPct.toFixed(1)}%).`);
  }
  if (worstTopic && worstTopic.avgSavingsPct < 0) {
    parts.push(`Avoid compression for: ${worstTopic.topic.replace("_", " ")} (${worstTopic.avgSavingsPct.toFixed(1)}%).`);
  }

  return parts.join(" ");
}

// ── helpers ───────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round2(n: number): number {
  return Math.round(n * 10) / 10;
}

function lc(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
}

function rc(s: string, w: number): string {
  return String(s).padStart(w);
}

function padColor(colored: string, _pos: boolean, visualWidth: number): string {
  const plain = colored.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, visualWidth - plain.length - 1);
  return " ".repeat(pad) + colored;
}

// ── single-mode summary ───────────────────────────────────────────────────

export function buildSingleModeSummary(
  result: LongSessionResult,
  mode: "baseline" | "optimized",
  numRounds: number
): LongSessionSummary {
  const m = result.metrics;
  const avgQ = round2(avg(m.qualityCurve));
  const label = mode === "baseline" ? "BASELINE" : "OPTIMIZED";
  return {
    avgTokenSavingsPct: 0,
    peakTokenSavingsPct: 0,
    finalRoundSavingsPct: 0,
    totalTokenSaved: 0,
    qualityDelta: 0,
    memoryRetentionDelta: 0,
    taskBreakdown: [],
    verdict: `${label} session — ${numRounds} rounds. Total prompt tokens: ${m.totalPromptTokens.toLocaleString()}. Avg quality: ${avgQ}/10. Memory retention: ${m.memoryRetentionScore}/10.`,
  };
}