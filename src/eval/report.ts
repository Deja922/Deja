import type { EvalReport, EvalResult, EvalSummary } from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────

function col(s: string | number, w: number, align: "l" | "r" = "l"): string {
  const str = String(s);
  return align === "r" ? str.padStart(w) : str.padEnd(w);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function padColor(colored: string, _positive: boolean, visualWidth: number): string {
  const plain = colored.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, visualWidth - plain.length - 1);
  return " ".repeat(pad) + colored;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── public entry point ────────────────────────────────────────────────────

export function printReport(report: EvalReport): void {
  const mode = report.mode ?? "both";
  if (mode === "baseline") return printSingleMode(report, "baseline");
  if (mode === "optimized") return printSingleMode(report, "optimized");
  printComparisonReport(report);
}

// ── single-mode table ─────────────────────────────────────────────────────

function printSingleMode(report: EvalReport, mode: "baseline" | "optimized"): void {
  const W = { name: 34, tok: 9, comp: 9, q: 7, lat: 9 };

  const top = `┌${"─".repeat(W.name + 2)}┬${"─".repeat(W.tok + 2)}┬${"─".repeat(W.comp + 2)}┬${"─".repeat(W.q + 2)}┬${"─".repeat(W.lat + 2)}┐`;
  const mid = `├${"─".repeat(W.name + 2)}┼${"─".repeat(W.tok + 2)}┼${"─".repeat(W.comp + 2)}┼${"─".repeat(W.q + 2)}┼${"─".repeat(W.lat + 2)}┤`;
  const bot = `└${"─".repeat(W.name + 2)}┴${"─".repeat(W.tok + 2)}┴${"─".repeat(W.comp + 2)}┴${"─".repeat(W.q + 2)}┴${"─".repeat(W.lat + 2)}┘`;

  const row = (name: string, prompt: string, completion: string, q: string, lat: string) =>
    `│ ${col(name, W.name)} │ ${col(prompt, W.tok, "r")} │ ${col(completion, W.comp, "r")} │ ${col(q, W.q, "r")} │ ${col(lat, W.lat, "r")} │`;

  const label = mode === "baseline" ? "BASELINE (no Context Engine)" : "OPTIMIZED (with Context Engine)";
  console.log();
  console.log(`\x1b[1m  EVAL — ${label}\x1b[0m  —  ${report.timestamp}`);
  console.log(`  Provider: ${report.provider}  Model: ${report.model}\n`);
  console.log(top);
  console.log(row("Task", "Prompt T", "Compl T", "Quality", "Latency"));
  console.log(mid);

  for (const r of report.results) {
    const s = r[mode];
    if (!s) continue;
    console.log(row(
      truncate(r.taskName, W.name),
      s.usage.promptTokens.toString(),
      s.usage.completionTokens.toString(),
      s.qualityScore.toFixed(1),
      `${s.latencyMs}ms`,
    ));
  }

  console.log(mid);
  const sm = report.summary;
  const avgQ = mode === "baseline" ? sm.avgBaselineQuality : sm.avgOptimizedQuality;
  const avgTok = mode === "baseline" ? sm.avgBaselineTokens : sm.avgOptimizedTokens;
  console.log(row("AVERAGE", avgTok.toFixed(0), "—", avgQ.toFixed(1), "—"));
  console.log(bot);
  console.log();
}

// ── comparison table ──────────────────────────────────────────────────────

function printComparisonReport(report: EvalReport): void {
  const W = { name: 34, tok: 9, savings: 9, q: 7, delta: 8 };

  const line = () =>
    `├${"─".repeat(W.name + 2)}┼${"─".repeat(W.tok + 2)}┼${"─".repeat(W.tok + 2)}┼${"─".repeat(W.savings + 2)}┼${"─".repeat(W.q + 2)}┼${"─".repeat(W.q + 2)}┼${"─".repeat(W.delta + 2)}┤`;

  const row = (
    name: string, baseTok: string, optTok: string,
    savings: string, baseQ: string, optQ: string, delta: string
  ) =>
    `│ ${col(name, W.name)} │ ${col(baseTok, W.tok, "r")} │ ${col(optTok, W.tok, "r")} │ ${col(savings, W.savings, "r")} │ ${col(baseQ, W.q, "r")} │ ${col(optQ, W.q, "r")} │ ${col(delta, W.delta, "r")} │`;

  const top = `┌${"─".repeat(W.name + 2)}┬${"─".repeat(W.tok + 2)}┬${"─".repeat(W.tok + 2)}┬${"─".repeat(W.savings + 2)}┬${"─".repeat(W.q + 2)}┬${"─".repeat(W.q + 2)}┬${"─".repeat(W.delta + 2)}┐`;
  const bot = `└${"─".repeat(W.name + 2)}┴${"─".repeat(W.tok + 2)}┴${"─".repeat(W.tok + 2)}┴${"─".repeat(W.savings + 2)}┴${"─".repeat(W.q + 2)}┴${"─".repeat(W.q + 2)}┴${"─".repeat(W.delta + 2)}┘`;

  console.log();
  console.log(`\x1b[1m  EVAL HARNESS REPORT\x1b[0m  —  ${report.timestamp}`);
  console.log(`  Provider: ${report.provider}  Model: ${report.model}  Judge: ${report.judgeEnabled ? "Claude" : "heuristic"}`);
  console.log();
  console.log(top);
  console.log(row("Task", "Base Tok", "Opt Tok", "Savings", "Base Q", "Opt Q", "ΔQuality"));
  console.log(line());

  for (const r of report.results) {
    if (!r.baseline || !r.optimized) continue;
    const savings = r.tokenSavingsPct;
    const savingsStr = savings > 0
      ? `\x1b[32m+${savings.toFixed(1)}%\x1b[0m`
      : `\x1b[31m${savings.toFixed(1)}%\x1b[0m`;
    const deltaStr = r.qualityDelta >= 0
      ? `\x1b[32m+${r.qualityDelta.toFixed(1)}\x1b[0m`
      : `\x1b[31m${r.qualityDelta.toFixed(1)}\x1b[0m`;

    console.log(
      `│ ${col(truncate(r.taskName, W.name), W.name)} │ ${col(r.baseline.usage.promptTokens.toString(), W.tok, "r")} │ ${col(r.optimized.usage.promptTokens.toString(), W.tok, "r")} │ ${padColor(savingsStr, savings > 0, W.savings + 2)} │ ${col(r.baseline.qualityScore.toFixed(1), W.q, "r")} │ ${col(r.optimized.qualityScore.toFixed(1), W.q, "r")} │ ${padColor(deltaStr, r.qualityDelta >= 0, W.delta + 2)} │`
    );
  }

  console.log(line());

  const s = report.summary;
  console.log(row(
    "AVERAGE",
    s.avgBaselineTokens.toFixed(0),
    s.avgOptimizedTokens.toFixed(0),
    `${s.avgTokenSavingsPct > 0 ? "+" : ""}${s.avgTokenSavingsPct.toFixed(1)}%`,
    s.avgBaselineQuality.toFixed(1),
    s.avgOptimizedQuality.toFixed(1),
    `${s.avgQualityDelta >= 0 ? "+" : ""}${s.avgQualityDelta.toFixed(1)}`,
  ));
  console.log(bot);

  console.log();
  console.log(`\x1b[1m  Verdict:\x1b[0m ${s.verdict}`);
  console.log();
}

// ── verbose breakdown ─────────────────────────────────────────────────────

export function printVerbose(report: EvalReport): void {
  const mode = report.mode ?? "both";
  const modes: Array<"baseline" | "optimized"> =
    mode === "baseline" ? ["baseline"] :
    mode === "optimized" ? ["optimized"] :
    ["baseline", "optimized"];

  for (const r of report.results) {
    console.log(`\n\x1b[1m── ${r.taskName} ──\x1b[0m`);
    for (const m of modes) {
      const s = r[m];
      if (!s) continue;
      console.log(`\n  [${m.toUpperCase()}]`);
      console.log(`    Tokens:  prompt=${s.usage.promptTokens}  completion=${s.usage.completionTokens}`);
      console.log(`    Latency: ${s.latencyMs}ms`);
      console.log(`    Quality: ${s.qualityScore}/10`);
      console.log(`      breakdown → structure=${s.scoreBreakdown.structure}  keywords=${s.scoreBreakdown.keywordCoverage}  length=${s.scoreBreakdown.length}  format=${s.scoreBreakdown.format}${s.scoreBreakdown.judgeScore !== undefined ? `  judge=${s.scoreBreakdown.judgeScore}` : ""}`);
      console.log(`    Response (first 300 chars):`);
      console.log(`    ${s.response.slice(0, 300).replace(/\n/g, "\n    ")}…`);
    }
  }
}

// ── summary builder ───────────────────────────────────────────────────────

export function buildSummary(results: EvalResult[], mode = "both"): EvalSummary {
  const n = results.length;
  if (n === 0) {
    return {
      totalTasks: 0,
      avgTokenSavingsPct: 0,
      avgQualityDelta: 0,
      avgBaselineQuality: 0,
      avgOptimizedQuality: 0,
      avgBaselineTokens: 0,
      avgOptimizedTokens: 0,
      verdict: "No tasks ran.",
    };
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const baselineResults = results.filter((r) => r.baseline);
  const optimizedResults = results.filter((r) => r.optimized);

  const avgTokenSavingsPct = mode === "both" ? avg(results.map((r) => r.tokenSavingsPct)) : 0;
  const avgQualityDelta = mode === "both" ? avg(results.map((r) => r.qualityDelta)) : 0;
  const avgBaselineQuality = baselineResults.length > 0
    ? avg(baselineResults.map((r) => r.baseline!.qualityScore)) : 0;
  const avgOptimizedQuality = optimizedResults.length > 0
    ? avg(optimizedResults.map((r) => r.optimized!.qualityScore)) : 0;
  const avgBaselineTokens = baselineResults.length > 0
    ? avg(baselineResults.map((r) => r.baseline!.usage.promptTokens)) : 0;
  const avgOptimizedTokens = optimizedResults.length > 0
    ? avg(optimizedResults.map((r) => r.optimized!.usage.promptTokens)) : 0;

  const verdict = mode === "both"
    ? buildVerdict(avgTokenSavingsPct, avgQualityDelta, n)
    : `Ran ${n} task${n !== 1 ? "s" : ""} in ${mode} mode.`;

  return {
    totalTasks: n,
    avgTokenSavingsPct: round(avgTokenSavingsPct),
    avgQualityDelta: round(avgQualityDelta),
    avgBaselineQuality: round(avgBaselineQuality),
    avgOptimizedQuality: round(avgOptimizedQuality),
    avgBaselineTokens: round(avgBaselineTokens),
    avgOptimizedTokens: round(avgOptimizedTokens),
    verdict,
  };
}

function buildVerdict(savings: number, delta: number, n: number): string {
  const parts: string[] = [`Ran ${n} task${n !== 1 ? "s" : ""}.`];

  if (savings > 25) parts.push(`Significant token reduction (avg ${savings.toFixed(1)}% savings).`);
  else if (savings > 10) parts.push(`Moderate token reduction (avg ${savings.toFixed(1)}% savings).`);
  else if (savings > 0) parts.push(`Minimal token reduction (avg ${savings.toFixed(1)}% savings).`);
  else parts.push(`No token savings — pipeline may be over-aggressive or context too short.`);

  if (delta > 0.5) parts.push(`Quality improved (+${delta.toFixed(1)}). Context Engine is adding value.`);
  else if (delta >= -0.3) parts.push(`Quality neutral (Δ${delta.toFixed(1)}). Compression safe.`);
  else parts.push(`Quality dropped (${delta.toFixed(1)}). Review compression aggressiveness.`);

  return parts.join(" ");
}
