import { readMetrics, aggregateMetrics } from "@/proxy/metrics-logger.js";

// `deja metrics` — local, privacy-safe usage summary for beta data collection.
// Reads ~/.deja/metrics.jsonl (numbers/enums only) and prints aggregates a
// tester can read or paste into a feedback issue. Nothing is uploaded.

export function metricsCmd(opts: { json?: boolean }): void {
  const entries = readMetrics();

  if (entries.length === 0) {
    console.log("");
    console.log("  No metrics recorded yet.");
    console.log("  Use Deja with your AI tool for a while, then run `deja metrics` again.");
    console.log("");
    return;
  }

  const s = aggregateMetrics(entries);

  if (opts.json) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  const pct = (n: number, d: number): string =>
    d > 0 ? `${Math.round((n / d) * 100)}%` : "0%";

  console.log("");
  console.log("  Deja Usage Metrics (local only — nothing is uploaded)");
  console.log("  ─────────────────────────────────────────────────────");
  console.log("");
  console.log(`  Window:        ${fmt(s.firstTs)} → ${fmt(s.lastTs)}`);
  console.log(`  Claude Code:   ${s.claudeCodeRequests} requests  (stats below cover these only)`);
  if (s.otherRequests > 0) {
    console.log(`  Excluded:      ${s.otherRequests} test/manual requests (non-Claude Code)`);
  }
  if (s.claudeCodeRequests === 0) {
    console.log("");
    console.log("  No real Claude Code traffic recorded yet — only test/manual requests.");
    console.log("  Restart Claude Code so it routes through Deja, then use it for a while.");
    console.log("");
    return;
  }
  console.log("");
  console.log("  ── Outcomes ──");
  console.log(`  Compressed:    ${s.compressed} (${pct(s.compressed, s.claudeCodeRequests)})`);
  console.log(`  Skipped:       ${s.skipped} (${pct(s.skipped, s.claudeCodeRequests)})  below threshold`);
  console.log(`  Passthrough:   ${s.passthrough} (${pct(s.passthrough, s.claudeCodeRequests)})`);
  console.log(`  Auto-bypass:   ${s.bypass} (${s.autoBypassRate}%)  safe-mode passthrough`);
  console.log(`  Errors:        ${s.error}`);
  console.log("");
  console.log("  ── Token Savings (compressed requests) ──");
  console.log(`  Average:       ${s.avgSavedPct}%`);
  console.log(`  Median:        ${s.medianSavedPct}%`);
  console.log("  Distribution:");
  for (const [bucket, count] of Object.entries(s.savingsBuckets)) {
    console.log(`    ${bucket.padEnd(8)} ${bar(count, s.compressed)} ${count}`);
  }
  console.log("");
  console.log("  Share feedback (optional): run `deja metrics --json` and paste");
  console.log("  the output into https://github.com/Deja922/Deja/issues/1");
  console.log("");
}

function fmt(ts: string | null): string {
  if (!ts) return "n/a";
  return ts.replace("T", " ").slice(0, 16);
}

function bar(count: number, total: number): string {
  if (total <= 0) return "";
  const width = Math.round((count / total) * 20);
  return "█".repeat(width).padEnd(20);
}
