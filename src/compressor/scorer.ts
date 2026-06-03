import type { Message } from "@/types/index.js";

/**
 * Scores each message 0–1 by importance.
 *
 * Factors (all 0–1, then weighted sum):
 *   recency    0.40 — newer messages matter more
 *   density    0.30 — content richness (code, length, structure)
 *   role       0.20 — system/assistant carry more signal than short user acks
 *   uniqueness 0.10 — penalise messages similar to their neighbors
 */
export function scoreMessages(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;

  const n = messages.length;

  return messages.map((m, i) => {
    const recency = (i + 1) / n; // 0→1 as index increases

    const density = contentDensity(m.content);

    const role =
      m.role === "system" ? 1.0
      : m.role === "assistant" ? 0.7
      : 0.5;

    const prev = i > 0 ? messages[i - 1] : null;
    const uniqueness = prev ? 1 - jaccardSimilarity(m.content, prev.content) : 1.0;

    const importance =
      0.4 * recency +
      0.3 * density +
      0.2 * role +
      0.1 * uniqueness;

    return { ...m, importance: Math.min(1, Math.max(0, importance)) };
  });
}

// ── helpers ──────────────────────────────────────────────────────────────

function contentDensity(text: string): number {
  if (!text.trim()) return 0;

  let score = Math.min(1, text.length / 500); // length bonus, capped at 500 chars

  if (/```[\s\S]+?```/.test(text)) score = Math.min(1, score + 0.3); // code block
  if (/\?/.test(text)) score = Math.min(1, score + 0.1);             // question
  if (/\n/.test(text)) score = Math.min(1, score + 0.1);             // multi-line
  if (/error|bug|fix|issue/i.test(text)) score = Math.min(1, score + 0.15); // signal words

  return score;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;

  return intersection / (setA.size + setB.size - intersection);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
