/**
 * Heuristic quality scorer — 0–10 scale.
 *
 * Judges the response against the original prompt without calling an LLM.
 * Not a substitute for human eval; useful for quick regression detection.
 *
 * Breakdown:
 *   length     0–3  longer responses tend to be more complete
 *   relevance  0–3  keyword overlap between prompt and response
 *   coherence  0–2  sentence structure proxy (avg sentence length)
 *   completeness 0–2  penalise truncation / apology signals
 */
export function scoreQuality(prompt: string, response: string): number {
  if (!response.trim()) return 0;

  const lengthScore = scoreLength(response);
  const relevanceScore = scoreRelevance(prompt, response);
  const coherenceScore = scoreCoherence(response);
  const completenessScore = scoreCompleteness(response);

  const total = lengthScore + relevanceScore + coherenceScore + completenessScore;
  return Math.round(total * 10) / 10; // one decimal place
}

// ── sub-scores ────────────────────────────────────────────────────────────

function scoreLength(response: string): number {
  const chars = response.trim().length;
  if (chars < 50) return 0;
  if (chars < 150) return 1;
  if (chars < 400) return 2;
  return 3;
}

function scoreRelevance(prompt: string, response: string): number {
  const promptTokens = tokenSet(prompt);
  const responseTokens = tokenSet(response);
  if (promptTokens.size === 0) return 1.5;

  let hits = 0;
  for (const t of promptTokens) {
    if (responseTokens.has(t)) hits++;
  }

  const overlap = hits / promptTokens.size;
  return Math.round(overlap * 3 * 10) / 10;
}

function scoreCoherence(response: string): number {
  const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  const avgLen = response.length / sentences.length;
  // Sweet spot: 40–120 chars per sentence
  if (avgLen < 15 || avgLen > 250) return 0.5;
  if (avgLen < 30 || avgLen > 180) return 1;
  return 2;
}

function scoreCompleteness(response: string): number {
  const truncationSignals = /\[truncated\]|\.{3}\s*$|I cannot|I don't have|as an AI/i;
  return truncationSignals.test(response) ? 0 : 2;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3) // skip short stop-words
  );
}
