import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Lightweight, privacy-safe usage telemetry ───────────────────────────────
//
// One JSON line per request to ~/.deja/metrics.jsonl. NUMBERS AND ENUMS ONLY —
// never conversation content, prompts, code, file paths, or model output.
// Stays entirely on the user's machine; `deja metrics` aggregates it locally so
// a beta tester can read (and optionally paste) the summary themselves.

const LOG_DIR = join(homedir(), ".deja");
const METRICS_FILE = join(LOG_DIR, "metrics.jsonl");
const MAX_METRIC_LINES = 20000;

/** Outcome of a single proxied request — no content, only shape/size signals. */
export interface MetricEntry {
  ts: string;
  /** What the proxy did with this request. */
  outcome: "compressed" | "skipped" | "passthrough" | "bypass" | "error";
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
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
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
  totalRequests: number;
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
  try {
    if (!existsSync(METRICS_FILE)) return [];
    return readFileSync(METRICS_FILE, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l) as MetricEntry; } catch { return null; }
      })
      .filter((e): e is MetricEntry => e !== null);
  } catch {
    return [];
  }
}

export function aggregateMetrics(entries: MetricEntry[]): MetricsSummary {
  const total = entries.length;
  const compressed = entries.filter((e) => e.outcome === "compressed");
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

  const bypassCount = entries.filter((e) => e.outcome === "bypass").length;

  return {
    totalRequests: total,
    compressed: compressed.length,
    skipped: entries.filter((e) => e.outcome === "skipped").length,
    passthrough: entries.filter((e) => e.outcome === "passthrough").length,
    bypass: bypassCount,
    error: entries.filter((e) => e.outcome === "error").length,
    avgSavedPct: savings.length ? round1(savings.reduce((a, b) => a + b, 0) / savings.length) : 0,
    medianSavedPct: median(savings),
    autoBypassRate: total ? round1((bypassCount / total) * 100) : 0,
    savingsBuckets: buckets,
    firstTs: entries[0]?.ts ?? null,
    lastTs: entries[entries.length - 1]?.ts ?? null,
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
