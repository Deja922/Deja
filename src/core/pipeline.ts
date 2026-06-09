import type {
  Context,
  Message,
  MessageCategory,
  PipelineConfig,
  PipelineResult,
  PipelineStats,
} from "@/types/index.js";
import type { IPipeline } from "./index.js";
import { Compressor } from "@/compressor/index.js";
import { MemoryStore } from "@/memory/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

// ── classification helper ──────────────────────────────────────────────────

function classifyMessage(
  text: string,
  systemLogPatterns: RegExp[],
  telemetryPatterns: RegExp[],
): MessageCategory {
  // Check system log patterns first (broadest match)
  for (const pattern of systemLogPatterns) {
    if (pattern.test(text)) return "SYSTEM_LOGS";
  }
  // Check telemetry patterns second
  for (const pattern of telemetryPatterns) {
    if (pattern.test(text)) return "TELEMETRY";
  }
  // Heuristic: system/assistant messages with config/technical content → TASK_MEMORY
  // User messages or conversational assistant responses → USER_MEMORY
  const looksLikeUserContent =
    /^(i|we|you|can|what|how|why|where|when|please|let|help|need|want|should|could|would|tell|show|explain|find|fix|add|make|create|update|remove|delete|run|test|check|use|try|the|a|an|this|that|it|is|are|do|does|did|has|have|had)/i.test(
      text
    );
  return looksLikeUserContent ? "USER_MEMORY" : "TASK_MEMORY";
}

/**
 * Data flow:
 *
 *  raw Context
 *    → relevance filter (classify + strip system logs / telemetry)
 *    → cleanup (dedup + remove empty messages)
 *    → compression (score → dedup → drop low-score → summarize → truncate)
 *    → memory inject (prepend relevant past context, if enabled)
 *    → token budget check (hard ceiling fallback)
 *    → PipelineResult
 */
export class Pipeline implements IPipeline {
  private compressor: Compressor;
  private memory: MemoryStore;

  constructor() {
    this.compressor = new Compressor();
    this.memory = new MemoryStore();
  }

  async run(context: Context, config: PipelineConfig): Promise<PipelineResult> {
    const startMs = Date.now();
    const originalTokens = estimateTokens(context);

    // Stage 1 — relevance filter: drop system logs / telemetry before anything else
    let ctx = this.filterRelevance(context);

    // Stage 2 — cleanup: dedup + remove empty messages
    ctx = this.cleanup(ctx);

    // Stage 3 — compression: score, dedup, summarize, drop below threshold
    // (scoring happens inside the compressor; no separate ranking pass needed)
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

  /**
   * Context Relevance Filter (Stage 1).
   *
   * Classifies EVERY message into one of four categories:
   *   SYSTEM_LOGS   → dev-only runtime output (routed to debug channel, NEVER reaches LLM)
   *   TELEMETRY     → operational measurements (routed to debug channel, NEVER reaches LLM)
   *   USER_MEMORY   → user content that should reach LLM (kept in messages, compressed)
   *   TASK_MEMORY   → task content that should reach LLM (kept in messages, compressed)
   *
   * Rules:
   *   - Messages matching system/telemetry patterns are ALWAYS removed from ctx.messages
   *     and moved to ctx.debugMessages (stderr + debug log file).
   *   - Only USER_MEMORY and TASK_MEMORY pass through to downstream pipeline stages.
   *   - Compression (Stage 4) only acts on USER/TASK memory — never on system logs.
   */
  private filterRelevance(ctx: Context): Context {
    // ── pattern banks ──────────────────────────────────────────────────────
    const SYSTEM_LOG_PATTERNS: RegExp[] = [
      /^\[deja[^\]]*\]/i,
      /^proxy\s+(running|started|listening|stopped)/i,
      /^upstream:/i,
      /^target:\s+\d+\s+tokens/i,
      /^compression\s+threshold/i,
      /^to use with/i,
      /^then restart/i,
      /^\$env:ANTHROPIC_BASE_URL/i,
      /^export\s+ANTHROPIC_BASE_URL/i,
    ];

    const TELEMETRY_PATTERNS: RegExp[] = [
      /^\[deja:session\]/i,
      /\d+%\s*\(~\d+\s+saved\)/,
      /\d+tok\b.*\d+tok/,
      /uptime=\d+s/i,
      /requests=\d+/i,
      /compressed=\d+/i,
    ];

    // ── classify each message ──────────────────────────────────────────────
    const llmMessages: Message[] = [];
    const debugMessages: Message[] = [];

    for (const m of ctx.messages) {
      const text = m.content.trim();
      if (!text) continue;

      const category = classifyMessage(text, SYSTEM_LOG_PATTERNS, TELEMETRY_PATTERNS);
      const classified = { ...m, category };

      if (category === "USER_MEMORY" || category === "TASK_MEMORY") {
        llmMessages.push(classified);
      } else {
        debugMessages.push(classified);
      }
    }

    // ── route dev-only messages to stderr (never to LLM) ───────────────────
    if (debugMessages.length > 0) {
      const now = new Date().toISOString();
      process.stderr.write(
        `[deja:filter] ${now} dropped ${debugMessages.length} system/telemetry message(s):\n`
      );
      for (const dm of debugMessages) {
        const preview =
          dm.content.length > 120 ? dm.content.slice(0, 120) + "…" : dm.content;
        process.stderr.write(`  [${dm.category}] ${preview}\n`);
      }
    }

    return { ...ctx, messages: llmMessages, debugMessages };
  }

  private cleanup(ctx: Context): Context {
    // ── classify before dedup: always keep system logs out ──
    const seen = new Set<string>();
    const messages = ctx.messages.filter((m) => {
      // Extra guard: if any SYSTEM_LOGS/TELEMETRY survived, drop them here too
      if (m.category === "SYSTEM_LOGS" || m.category === "TELEMETRY") return false;
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
