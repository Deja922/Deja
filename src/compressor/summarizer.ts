import type { Message } from "@/types/index.js";

/**
 * Extractive summarizer — no LLM required.
 *
 * Takes a block of messages and produces a single system message that
 * captures the key sentences from each message.
 */
export function summarizeBlock(messages: Message[]): Message {
  const lines: string[] = [];

  for (const m of messages) {
    const sentences = extractKeySentences(m.content, 2);
    if (sentences.length > 0) {
      const prefix = m.role === "user" ? "User" : "Assistant";
      lines.push(`[${prefix}] ${sentences.join(" ")}`);
    }
  }

  const summary =
    lines.length > 0
      ? `[Summarized ${messages.length} earlier messages]\n${lines.join("\n")}`
      : `[${messages.length} earlier messages omitted]`;

  return {
    id: `summary-${Date.now()}`,
    role: "system",
    content: summary,
    timestamp: messages[0]?.timestamp ?? Date.now(),
    summary: summary,
  };
}

/**
 * Returns up to `maxSentences` most informative sentences from `text`.
 * Picks by: length (longer = more content), presence of code/numbers.
 */
function extractKeySentences(text: string, maxSentences: number): string[] {
  // Split on sentence boundaries but keep code blocks intact
  const codeBlocks: string[] = [];
  const stripped = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match.split("\n").slice(0, 3).join("\n") + "\n…");
    return `__CODE_${codeBlocks.length - 1}__`;
  });

  const sentences = stripped
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (sentences.length === 0) {
    // No clear sentences — take the first N chars
    return [text.slice(0, 120).trim() + (text.length > 120 ? "…" : "")];
  }

  // Score and sort sentences
  const scored = sentences.map((s) => ({
    text: s,
    score: scoreSentence(s),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Restore code block placeholders
  return scored
    .slice(0, maxSentences)
    .map(({ text }) =>
      text.replace(/__CODE_(\d+)__/g, (_, i) => codeBlocks[parseInt(i)] ?? "")
    );
}

function scoreSentence(s: string): number {
  let score = Math.min(1, s.length / 200);
  if (/\d/.test(s)) score += 0.1;
  if (/error|fix|issue|bug|result|output|return/i.test(s)) score += 0.2;
  if (/\?$/.test(s.trim())) score += 0.15;
  return score;
}
