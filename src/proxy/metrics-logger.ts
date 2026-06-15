import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname } from "path";
import { getDataWritePath, getExistingDataReadCandidates } from "../config/data-paths.js";

// ── Lightweight, privacy-safe usage telemetry ───────────────────────────────
//
// One JSON line per request. NUMBERS AND ENUMS ONLY — never conversation
// content, prompts, code, file paths, or model output. Stays entirely on the
// user's machine; `deja metrics` aggregates it locally so a beta tester can
// read (and optionally paste) the summary themselves.
//
// Writer (proxy, possibly a LocalSystem service) and reader (CLI, the logged-in
// user) resolve the file through data-paths so they converge on one location;
// see data-paths.ts for why a bare homedir() splits them.

const METRICS_FILE = getDataWritePath("metrics.jsonl");
const MAX_METRIC_LINES = 20000;

/** Where the request came from — used to isolate real Claude Code load from
 * test/manual traffic (unit tests, curl, probes) that would otherwise skew the
 * beta numbers. */
export type MetricSource = "claude-code" | "other";

/**
 * Classify a request by its client headers. Claude Code (built on the Anthropic
 * SDK) sends `x-app: cli` and a `claude-cli/...` user-agent; tests, curl, and
 * health probes send neither. We err toward "other" so a misclassification
 * under-counts rather than contaminating the real-load stats — and `deja
 * metrics` always prints the excluded count so that failure is visible.
 */
export function classifySource(userAgent?: string, xApp?: string): MetricSource {
  if (xApp && xApp.toLowerCase() === "cli") return "claude-code";
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("claude-cli") || ua.includes("claude-code")) return "claude-code";
  return "other";
}

/** Outcome of a single proxied request — no content, only shape/size signals. */
export interface MetricEntry {
  ts: string;
  /** What the proxy did with this request. */
  outcome: "compressed" | "skipped" | "passthrough" | "bypass" | "error";
  /** Request client — only "claude-code" counts as real proxy load. */
  source: MetricSource;
  /** Number of messages in the incoming request (size signal, not content). */
  msgs: number;
  /** Estimated input tokens (full body bytes / 4). */
  inTokens: number;
  /** Estimated output tokens after compression (0 when not compressed). */
  outTokens: number;
  /** Byte-level savings percent (0 when not compressed). */
  savedPct: number;
  /** Messages dropped by the pipeline (compressed outcome only). */
  dropped: number;
  /** Whether the session was in safe-mode bypass at decision time. */
  bypass: boolean;
  /** Coarse reason, e.g. "auto-high-compression" | "user" | passthrough tag. */
  reason: string | null;
}

function ensureLogDir(): void {
  const dir = dirname(METRICS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function appendMetric(entry: MetricEntry): void {
  try {
    ensureLogDir();
    appendFileSync(METRICS_FILE, JSON.stringify(entry) + "\n", "utf-8");
    rotateIfNeeded();
  } catch {
    // Best-effort: telemetry must never break the proxy path.
  }
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(METRICS_FILE)) return;
    const lines = readFileSync(METRICS_FILE, "utf-8").split("\n").filter(Boolean);
    if (lines.length > MAX_METRIC_LINES) {
      const trimmed = lines.slice(-MAX_METRIC_LINES / 2).join("\n") + "\n";
      writeFileSync(METRICS_FILE, trimmed, "utf-8");
    }
  } catch {
    // ignore
  }
}

// ── aggregation (read side, used by `deja metrics`) ──────────────────────────

export interface MetricsSummary {
  /** All recorded requests, every source. */
  totalRequests: number;
  /** Real Claude Code load — the basis for every stat below. */
  claudeCodeRequests: number;
  /** Test / manual / probe traffic excluded from the stats below. */
  otherRequests: number;
  compressed: number;
  skipped: number;
  passthrough: number;
  bypass: number;
  error: number;
  /** Average byte savings over compressed requests only. */
  avgSavedPct: number;
  /** Median byte savings over compressed requests only. */
  medianSavedPct: number;
  /** Auto-bypass rate = bypass requests / total (the real-load M4 signal). */
  autoBypassRate: number;
  /** Distribution of savings on compressed requests, by bucket. */
  savingsBuckets: Record<string, number>;
  firstTs: string | null;
  lastTs: string | null;
}

export function readMetrics(): MetricEntry[] {
  // Merge every candidate location (ProgramData + user + systemprofile) so the
  // CLI sees service-written data regardless of which account wrote it, plus
  // any legacy data from before the path was unified. Sorted by timestamp.
  const all: MetricEntry[] = [];
  for (const file of getExistingDataReadCandidates("metrics.jsonl")) {
    try {
      const parsed = readFileSync(file, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try { return JSON.parse(l) as MetricEntry; } catch { return null; }
        })
        .filter((e): e is MetricEntry => e !== null);
      all.push(...parsed);
    } catch {
      // skip unreadable candidate
    }
  }
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return all;
}

export function aggregateMetrics(entries: MetricEntry[]): MetricsSummary {
  const total = entries.length;
  // Only real Claude Code traffic counts. Entries predating the `source` field
  // (or from tests/curl) are treated as "other" and excluded from the stats.
  const real = entries.filter((e) => e.source === "claude-code");
  const compressed = real.filter((e) => e.outcome === "compressed");
  const savings = compressed.map((e) => e.savedPct);

  const buckets: Record<string, number> = {
    "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0,
  };
  for (const s of savings) {
    if (s < 25) buckets["0-25%"]!++;
    else if (s < 50) buckets["25-50%"]!++;
    else if (s < 75) buckets["50-75%"]!++;
    else buckets["75-100%"]!++;
  }

  const bypassCount = real.filter((e) => e.outcome === "bypass").length;

  return {
    totalRequests: total,
    claudeCodeRequests: real.length,
    otherRequests: total - real.length,
    compressed: compressed.length,
    skipped: real.filter((e) => e.outcome === "skipped").length,
    passthrough: real.filter((e) => e.outcome === "passthrough").length,
    bypass: bypassCount,
    error: real.filter((e) => e.outcome === "error").length,
    avgSavedPct: savings.length ? round1(savings.reduce((a, b) => a + b, 0) / savings.length) : 0,
    medianSavedPct: median(savings),
    autoBypassRate: real.length ? round1((bypassCount / real.length) * 100) : 0,
    savingsBuckets: buckets,
    firstTs: real[0]?.ts ?? null,
    lastTs: real[real.length - 1]?.ts ?? null,
  };
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
