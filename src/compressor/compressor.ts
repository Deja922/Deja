import type { Context, Message, PipelineConfig } from "@/types/index.js";
import type { ICompressor } from "./index.js";
import { scoreMessages } from "./scorer.js";
import { summarizeBlock } from "./summarizer.js";
import { estimateTokens } from "@/cache/tokenizer.js";

export class Compressor implements ICompressor {
  async compress(context: Context, config: PipelineConfig): Promise<Context> {
    // Guard: strip any SYSTEM_LOGS/TELEMETRY that leaked through — they must NEVER
    // be compressed or reach the LLM. Only USER_MEMORY and TASK_MEMORY are eligible.
    const llmMessages = context.messages.filter(
      (m) => m.category !== "SYSTEM_LOGS" && m.category !== "TELEMETRY"
    );

    // Pass 1: dedup — only on LLM-bound messages
    const deduped = dropNearDuplicates(llmMessages);
    let ctx: Context = { ...context, messages: deduped };

    // Early exit if already within target after dedup
    if (estimateTokens(ctx) <= config.targetTokens) {
      return ctx;
    }

    let messages = scoreMessages(ctx.messages);

    // Pass 2: drop messages below ranking threshold, protecting system + last 6
    // Only drops LLM-bound messages (SYSTEM_LOGS/TELEMETRY already stripped above)
    messages = dropBelowThreshold(messages, config.rankingThreshold);

    ctx = { ...ctx, messages };

    // Pass 3: still over target → summarise oldest non-system block
    // Summarisation only touches USER_MEMORY/TASK_MEMORY messages
    if (estimateTokens(ctx) > config.targetTokens) {
      ctx = summarizeOldMessages(ctx, config.targetTokens);
    }

    // Pass 4: still over maxTokens → hard truncate message content
    // Truncation only touches non-system LLM-bound messages
    if (estimateTokens(ctx) > config.maxTokens) {
      ctx = hardTruncate(ctx, config.maxTokens);
    }

    return ctx;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * Remove messages that are very similar to a previous message.
 * Always keeps system messages and the last 2 messages.
 */
function dropNearDuplicates(messages: Message[]): Message[] {
  const keepTail = 2;
  const body = messages.slice(0, -keepTail);
  const tail = messages.slice(-keepTail);

  const deduped: Message[] = [];
  for (const m of body) {
    // Always keep system messages; always drop system logs / telemetry
    if (m.role === "system") { deduped.push(m); continue; }
    if (m.category === "SYSTEM_LOGS" || m.category === "TELEMETRY") continue;

    const isDup = deduped.some(
      (prev) => prev.role === m.role && jaccardSimilarity(prev.content, m.content) > 0.85
    );
    if (!isDup) deduped.push(m);
  }

  return [...deduped, ...tail];
}

/**
 * Drop messages with importance below threshold.
 * Always keeps: system messages + the last `keepTail` messages.
 */
function dropBelowThreshold(messages: Message[], threshold: number): Message[] {
  const keepTail = 10;
  const body = messages.slice(0, Math.max(0, messages.length - keepTail));
  const tail = messages.slice(-keepTail);

  const filtered = body.filter(
    (m) => m.role === "system"
      || (m.category !== "SYSTEM_LOGS" && m.category !== "TELEMETRY" && (m.importance ?? 1) >= threshold)
  );

  return [...filtered, ...tail];
}

/**
 * Summarise the oldest non-system messages into a single summary block.
 * Keeps the newest messages intact.
 */
function summarizeOldMessages(ctx: Context, targetTokens: number): Context {
  const messages = [...ctx.messages];
  const systemMessages = messages.filter((m) => m.role === "system");
  // Only summarise USER_MEMORY and TASK_MEMORY — never touch system logs
  const nonSystem = messages.filter(
    (m) => m.role !== "system"
      && m.category !== "SYSTEM_LOGS"
      && m.category !== "TELEMETRY"
  );

  // Always keep at least the last 8 messages (≈4 full exchanges) verbatim.
  // Short reference questions ("现在不会重复回答了？") need several preceding
  // turns to be interpretable — too small a keepTail means the LLM falls back
  // to the BACKGROUND summary instead, causing topic confusion.
  const minKeep = Math.min(8, nonSystem.length);
  let actualSummarize = Math.min(
    Math.max(1, Math.floor(nonSystem.length * 0.5)),
    nonSystem.length - minKeep
  );

  // Nothing old enough to summarise — return as-is.
  if (actualSummarize <= 0) return ctx;

  // Align the split to the nearest user/assistant boundary so toKeep always
  // starts with a user message. The Anthropic API rejects a messages array
  // that starts with an assistant — and a summary block gets dropped in
  // contextToRequest (it has no matching record), so an orphaned assistant
  // at the front would reach the API unchanged.
  while (actualSummarize > 0 && nonSystem[actualSummarize]?.role !== "user") {
    actualSummarize--;
  }
  if (actualSummarize <= 0) return ctx;

  const toSummarize = nonSystem.slice(0, actualSummarize);
  const toKeep = nonSystem.slice(actualSummarize);

  const summary = summarizeBlock(toSummarize);
  const result: Message[] = [...systemMessages, summary, ...toKeep];

  // If still over target AND there are enough messages to spare, do one more
  // round — but never compress below 6 verbatim messages, and always align
  // the second split to a user/assistant boundary.
  const testCtx = { ...ctx, messages: result };
  if (estimateTokens(testCtx) > targetTokens && toKeep.length > 6) {
    let secondSplit = Math.floor(toKeep.length / 3);
    // Align to nearest user message boundary (same reason as above)
    while (secondSplit > 0 && toKeep[secondSplit]?.role !== "user") {
      secondSplit--;
    }
    if (secondSplit > 0) {
      const extra = summarizeBlock(toKeep.slice(0, secondSplit));
      return {
        ...ctx,
        messages: [...systemMessages, extra, ...toKeep.slice(secondSplit)],
      };
    }
  }

  return { ...ctx, messages: result };
}

/**
 * Last resort: truncate individual message content to fit within maxTokens.
 * Trims from oldest non-system messages first.
 */
function hardTruncate(ctx: Context, maxTokens: number): Context {
  const messages = [...ctx.messages];
  let i = 0;

  while (estimateTokens({ ...ctx, messages }) > maxTokens && i < messages.length) {
    const m = messages[i]!;
    // Only truncate LLM-bound messages — never touch system logs / telemetry
    if (
      m.role !== "system"
      && m.category !== "SYSTEM_LOGS"
      && m.category !== "TELEMETRY"
      && m.content.length > 200
    ) {
      messages[i] = {
        ...m,
        content: m.content.slice(0, 200) + "… [truncated]",
      };
    }
    i++;
  }

  return { ...ctx, messages };
}

function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));

  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;

  return intersection / (setA.size + setB.size - intersection);
}
