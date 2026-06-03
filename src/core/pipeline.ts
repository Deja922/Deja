import type {
  Context,
  PipelineConfig,
  PipelineResult,
  PipelineStats,
} from "@/types/index.js";
import type { IPipeline } from "./index.js";
import { Compressor } from "@/compressor/index.js";
import { Ranker } from "@/ranking/index.js";
import { MemoryStore } from "@/memory/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

/**
 * Data flow:
 *
 *  raw Context
 *    └─► cleanup (dedup + remove noise)
 *          └─► ranking (score each message)
 *                └─► compression (summarize / drop low-score messages)
 *                      └─► memory inject (prepend relevant past context)
 *                            └─► token budget check (hard truncation fallback)
 *                                  └─► PipelineResult
 */
export class Pipeline implements IPipeline {
  private compressor: Compressor;
  private ranker: Ranker;
  private memory: MemoryStore;

  constructor() {
    this.compressor = new Compressor();
    this.ranker = new Ranker();
    this.memory = new MemoryStore();
  }

  async run(context: Context, config: PipelineConfig): Promise<PipelineResult> {
    const startMs = Date.now();
    const originalTokens = estimateTokens(context);

    // Stage 1 — cleanup: dedup + remove empty messages
    let ctx = this.cleanup(context);

    // Stage 2 — ranking: score each message
    ctx = await this.ranker.rank(ctx, config);

    // Stage 3 — compression: summarize / drop below threshold
    ctx = await this.compressor.compress(ctx, config);

    // Capture dropped/summarized counts BEFORE memory inject changes the count
    const messagesAfterCompression = ctx.messages.length;
    const messagesSummarized = ctx.messages.filter((m) => m.summary).length;

    // Stage 4 — memory inject
    if (config.memoryEnabled) {
      ctx = await this.memory.inject(ctx, config);
    }

    // Stage 5 — hard token budget enforcement
    ctx = this.enforceTokenBudget(ctx, config.maxTokens);

    const outputTokens = estimateTokens(ctx);
    const memoryHits = ctx.messages.filter((m) => m.source === "memory").length;

    const stats: PipelineStats = {
      originalTokens,
      outputTokens,
      compressionRatio: outputTokens / Math.max(originalTokens, 1),
      messagesDropped: Math.max(0, context.messages.length - messagesAfterCompression),
      messagesSummarized,
      memoryHits,
      durationMs: Date.now() - startMs,
    };

    return { context: ctx, stats };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private cleanup(ctx: Context): Context {
    const seen = new Set<string>();
    const messages = ctx.messages.filter((m) => {
      const key = m.content.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...ctx, messages };
  }

  private enforceTokenBudget(ctx: Context, maxTokens: number): Context {
    // Keep system prompt + newest messages that fit within budget
    const messages = [...ctx.messages];
    while (estimateTokens({ ...ctx, messages }) > maxTokens && messages.length > 1) {
      // drop oldest non-system message
      const oldestIdx = messages.findIndex((m) => m.role !== "system");
      if (oldestIdx === -1) break;
      messages.splice(oldestIdx, 1);
    }
    return { ...ctx, messages };
  }
}
