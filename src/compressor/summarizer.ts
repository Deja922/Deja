import type { Message } from "@/types/index.js";

/**
 * Extractive summarizer — no LLM required.
 *
 * Takes a block of messages and produces a single system message that
 * captures the key sentences from each message.
 */
export function summarizeBlock(messages: Message[]): Message {
  const lines: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    // Skip assistant messages that are purely recap/bullet lists — they create
    // feedback loops when re-injected: the LLM "continues" them instead of
    // answering the current question.
    if (m.role !== "user" && isBulletRecap(m.content)) continue;

    // Give more sentences to the most recent messages in this block — they
    // represent the topic being discussed just before the keep boundary, and
    // are most likely to be referenced by short follow-up questions.
    const isRecent = i >= messages.length - 2;
    const sentences = extractKeySentences(m.content, isRecent ? 3 : 1);
    if (sentences.length > 0) {
      const prefix = m.role === "user" ? "User previously asked" : "Assistant previously explained";
      lines.push(`${prefix}: ${sentences.join(" ")}`);
    }
  }

  // Explicit framing: LLM must not repeat or continue from this block.
  const summary =
    lines.length > 0
      ? `[BACKGROUND — earlier conversation history, do not repeat or continue from this]\n${lines.join("\n")}`
      : `[${messages.length} earlier messages omitted — do not repeat past answers]`;

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
  // Penalise build/test output lines — they look important (numbers, keywords)
  // but are poor conversational anchors and mislead the LLM about the current topic.
  if (/\d+\/\d+\s*(passed|tests?|passing|failed)/i.test(s)) score -= 0.6;
  if (/^(build|compile|tsc|npm run|node\s)/i.test(s)) score -= 0.4;
  if (/✔|✅|PASS|FAIL|\[ok\]|\[err\]/i.test(s)) score -= 0.3;
  // Penalise numbered/bullet recap lists — assistant summary bullets tend to
  // create feedback loops when re-injected as "key context" on the next turn.
  if (/^\s*[\d]+[.、]\s|^\s*[-•]\s/.test(s)) score -= 0.4;
  return score;
}

/** Returns true if the message is primarily a numbered/bullet recap list. */
function isBulletRecap(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const bulletLines = lines.filter((l) => /^\s*[\d]+[.)、]\s|^\s*[-•*]\s/.test(l));
  return bulletLines.length / lines.length >= 0.5;
}
