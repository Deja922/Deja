import type { Context, Message, PipelineConfig } from "@/types/index.js";
import type { ICompressor } from "./index.js";
import { scoreMessages } from "./scorer.js";
import { summarizeBlock } from "./summarizer.js";
import { estimateTokens } from "@/cache/tokenizer.js";

export class Compressor implements ICompressor {
  async compress(context: Context, config: PipelineConfig): Promise<Context> {
    // Pass 1: dedup is always cheap — run unconditionally
    const deduped = dropNearDuplicates(context.messages);
    let ctx: Context = { ...context, messages: deduped };

    // Early exit if already within target after dedup
    if (estimateTokens(ctx) <= config.targetTokens) {
      return ctx;
    }

    let messages = scoreMessages(ctx.messages);

    // Pass 2: drop messages below ranking threshold, protecting system + last 4
    messages = dropBelowThreshold(messages, config.rankingThreshold);

    ctx = { ...ctx, messages };

    // Pass 3: still over target → summarise oldest non-system block
    if (estimateTokens(ctx) > config.targetTokens) {
      ctx = summarizeOldMessages(ctx, config.targetTokens);
    }

    // Pass 4: still over maxTokens → hard truncate message content
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
    if (m.role === "system") { deduped.push(m); continue; }

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
  const keepTail = 4;
  const body = messages.slice(0, Math.max(0, messages.length - keepTail));
  const tail = messages.slice(-keepTail);

  const filtered = body.filter(
    (m) => m.role === "system" || (m.importance ?? 1) >= threshold
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
  const nonSystem = messages.filter((m) => m.role !== "system");

  // How many old messages to fold into a summary?
  // Start by summarising bottom 50% of non-system messages
  const summarizeCount = Math.max(1, Math.floor(nonSystem.length * 0.5));
  const toSummarize = nonSystem.slice(0, summarizeCount);
  const toKeep = nonSystem.slice(summarizeCount);

  const summary = summarizeBlock(toSummarize);
  const result: Message[] = [...systemMessages, summary, ...toKeep];

  // If still over target, aggressively increase the summarised window
  const testCtx = { ...ctx, messages: result };
  if (estimateTokens(testCtx) > targetTokens && toKeep.length > 2) {
    const extra = summarizeBlock(toKeep.slice(0, Math.floor(toKeep.length / 2)));
    return {
      ...ctx,
      messages: [...systemMessages, extra, ...toKeep.slice(Math.floor(toKeep.length / 2))],
    };
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
    if (m.role !== "system" && m.content.length > 200) {
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
