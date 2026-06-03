/** Cosine similarity between two L2-normalized vectors. Returns 0–1. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  // Vectors are pre-normalized so dot product == cosine similarity
  return Math.max(0, Math.min(1, dot));
}

/** Return the indices of the top-K highest scoring items. */
export function topK(scores: number[], k: number): number[] {
  return scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ i }) => i);
}
