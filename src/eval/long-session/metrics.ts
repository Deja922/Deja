import type { SessionRound, LongSessionMetrics, LongSessionTurn } from "./types.js";

export function computeMetrics(
  rounds: SessionRound[],
  turns: LongSessionTurn[]
): LongSessionMetrics {
  return {
    avgRedundancyRate: computeAvgRedundancyRate(rounds),
    memoryRetentionScore: computeMemoryRetention(rounds, turns),
    reasoningDrift: computeReasoningDrift(rounds),
    totalPromptTokens: rounds.reduce((s, r) => s + r.promptTokens, 0),
    totalCompletionTokens: rounds.reduce((s, r) => s + r.completionTokens, 0),
    tokenGrowthCurve: rounds.map((r) => r.promptTokens),
    qualityCurve: rounds.map((r) => r.qualityScore),
  };
}

// ── Redundancy rate ───────────────────────────────────────────────────────
// Measures what fraction of the accumulated history is near-duplicate content.
// Uses Jaccard similarity between consecutive user/assistant messages.
// Higher value = more redundant (bad for baseline; good compression should reduce this).

function computeAvgRedundancyRate(rounds: SessionRound[]): number {
  if (rounds.length < 2) return 0;

  const rates: number[] = [];
  for (let i = 1; i < rounds.length; i++) {
    const prev = tokenize(rounds[i - 1].response);
    const curr = tokenize(rounds[i].response);
    rates.push(jaccard(prev, curr));
  }
  return round2(rates.reduce((a, b) => a + b, 0) / rates.length);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Memory retention score ────────────────────────────────────────────────
// For each memory checkpoint turn, check whether the response contains
// at least one of the expected check keywords from the referenced earlier turn.
// Score = (checkpoints passed / total checkpoints) × 10.

function computeMemoryRetention(
  rounds: SessionRound[],
  turns: LongSessionTurn[]
): number {
  const checkpointTurns = turns.filter((t) => t.memoryCheckpoint);
  if (checkpointTurns.length === 0) return 10;

  let passed = 0;
  for (const turn of checkpointTurns) {
    const round = rounds.find((r) => r.turnId === turn.id);
    if (!round) continue;
    const resp = round.response.toLowerCase();
    const keywords = turn.memoryCheckpoint!.checkKeywords;
    if (keywords.some((kw) => resp.includes(kw.toLowerCase()))) {
      passed++;
    }
  }

  return round2((passed / checkpointTurns.length) * 10);
}

// ── Reasoning drift ───────────────────────────────────────────────────────
// Measures how much quality score fluctuates across rounds.
// Computed as the standard deviation of quality scores, normalized to 0–10.
// Lower drift = more consistent reasoning quality = better.
// Score 10 = zero drift, score 0 = maximum drift (quality bounces 0–10).

function computeReasoningDrift(rounds: SessionRound[]): number {
  if (rounds.length < 2) return 10;
  const scores = rounds.map((r) => r.qualityScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  // stdDev of 0 = score 10 (no drift); stdDev of 5 = score 0 (max drift for 0-10 scale)
  return round2(Math.max(0, 10 - stdDev * 2));
}

function round2(n: number): number {
  return Math.round(n * 10) / 10;
}
