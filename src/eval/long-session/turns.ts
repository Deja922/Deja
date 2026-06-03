import type { LongSessionTurn } from "./types.js";

// 20 turns simulating a real TypeScript project coding session.
// Topics rotate through architecture → refactor → bug_fixing → memory_system
// → provider_router → cli_optimization → testing → deployment (×2.5 cycles).
//
// Key design: turns 8, 12, 16, 20 are "memory checkpoints" — they explicitly
// reference decisions from earlier turns to test whether the LLM still recalls
// them after compression.

export const SESSION_TURNS: LongSessionTurn[] = [
  // ── Round 1: architecture ─────────────────────────────────────────────
  {
    id: 1,
    topic: "architecture",
    userMessage:
      "We're building a TypeScript context compression middleware for LLM applications called ContextEngine. " +
      "The core requirement: intercept messages before they're sent to the API, compress/summarize older messages " +
      "to fit within a token budget, but preserve recent and important context. " +
      "Design the module architecture. What are the key interfaces and data flow?",
    expectedKeywords: ["pipeline", "interface", "message", "token", "compress", "context", "stage"],
  },

  // ── Round 2: architecture ─────────────────────────────────────────────
  {
    id: 2,
    topic: "architecture",
    userMessage:
      "Good. Now define the TypeScript types: Message (with id, role, content, timestamp, importance score), " +
      "Context (array of messages + systemPrompt), PipelineConfig (maxTokens, targetTokens, compressionRatio), " +
      "and PipelineResult (compressed context + stats). Make them strict — no any types.",
    expectedKeywords: ["interface", "Message", "Context", "PipelineConfig", "role", "timestamp", "tokens"],
  },

  // ── Round 3: refactor ─────────────────────────────────────────────────
  {
    id: 3,
    topic: "refactor",
    userMessage:
      "Implement the Pipeline class. It should run 5 stages in sequence: " +
      "(1) cleanup — remove duplicates and empty messages, " +
      "(2) ranking — score each message by recency + role + content density, " +
      "(3) compression — drop low-score messages and summarize medium-score ones, " +
      "(4) memory inject — prepend relevant past context from a persistent store, " +
      "(5) token budget check — hard truncation if still over limit. " +
      "Return PipelineResult with stats.",
    expectedKeywords: ["Pipeline", "cleanup", "ranking", "compression", "memory", "token", "stage", "stats"],
  },

  // ── Round 4: bug_fixing ───────────────────────────────────────────────
  {
    id: 4,
    topic: "bug_fixing",
    userMessage:
      "The cleanup stage has a bug: when messages have near-identical content (e.g. repeated tool call results " +
      "with slightly different timestamps), they pass the dedup check because we're doing exact string match. " +
      "The dedup is too strict. Fix it to use similarity-based dedup: " +
      "two messages are duplicates if their content Jaccard similarity > 0.85.",
    expectedKeywords: ["Jaccard", "similarity", "dedup", "token", "set", "intersection", "threshold"],
  },

  // ── Round 5: memory_system ────────────────────────────────────────────
  {
    id: 5,
    topic: "memory_system",
    userMessage:
      "Implement the MemoryStore. Requirements: " +
      "(1) store message embeddings as 256-dim hash vectors (no external API), " +
      "(2) cosine similarity search to find top-K relevant past messages, " +
      "(3) persist to ~/.context-engine/memory.json on every write, " +
      "(4) inject method: given a context, find relevant memories and prepend them as system messages. " +
      "The store should survive process restarts.",
    expectedKeywords: ["embedding", "cosine", "similarity", "persist", "JSON", "inject", "memory", "topK"],
  },

  // ── Round 6: provider_router ──────────────────────────────────────────
  {
    id: 6,
    topic: "provider_router",
    userMessage:
      "Add a provider abstraction layer. We need to support Claude (Anthropic SDK), OpenAI, and a Mock provider " +
      "for testing. Define an IProvider interface with send(request) and countTokens(context) methods. " +
      "The factory should auto-select based on environment variables: " +
      "ANTHROPIC_API_KEY → ClaudeProvider, OPENAI_API_KEY → OpenAIProvider, neither → MockProvider.",
    expectedKeywords: ["IProvider", "interface", "factory", "ClaudeProvider", "OpenAI", "Mock", "env", "API_KEY"],
  },

  // ── Round 7: refactor ─────────────────────────────────────────────────
  {
    id: 7,
    topic: "refactor",
    userMessage:
      "The Compressor scoring function currently weights recency at 50% and content density at 50%. " +
      "We need a 4-factor model: recency (40%), density (30%), role importance (20%), uniqueness (10%). " +
      "Role importance: system=1.0, user=0.7, assistant=0.5. " +
      "Uniqueness: inverse of how many similar messages are in the context. " +
      "Refactor the scorer to implement this. Keep it pure — no side effects.",
    expectedKeywords: ["recency", "density", "role", "uniqueness", "weight", "score", "pure", "system", "assistant"],
  },

  // ── Round 8: bug_fixing (memory checkpoint → references round 1) ───────
  {
    id: 8,
    topic: "bug_fixing",
    userMessage:
      "We're seeing a critical bug in production: the Pipeline sometimes returns an empty context — " +
      "all messages get dropped. This happens when the compression stage runs before the token budget check " +
      "and the compressor is too aggressive. " +
      "Fix it so that at least the last user message is always preserved, regardless of score. " +
      "Also, remind me: what were the 5 pipeline stages we defined at the start?",
    expectedKeywords: ["preserve", "last", "user", "message", "stage", "pipeline", "budget"],
    memoryCheckpoint: {
      referencedTurnId: 3,
      checkKeywords: ["cleanup", "ranking", "compression", "memory", "token"],
    },
  },

  // ── Round 9: cli_optimization ─────────────────────────────────────────
  {
    id: 9,
    topic: "cli_optimization",
    userMessage:
      "Build a CLI tool: `ctx run <prompt>`. Options: " +
      "--mode baseline|optimized|both (default: both), " +
      "--context <file.json> to load prior conversation history, " +
      "--provider claude|openai|mock, " +
      "--max-tokens and --target-tokens. " +
      "Output: side-by-side token comparison and quality score. " +
      "Use Commander.js.",
    expectedKeywords: ["Commander", "CLI", "option", "--mode", "--context", "baseline", "optimized", "compare"],
  },

  // ── Round 10: testing ─────────────────────────────────────────────────
  {
    id: 10,
    topic: "testing",
    userMessage:
      "Write unit tests for the Compressor using vitest. Cover: " +
      "(1) empty context returns empty context, " +
      "(2) context under token limit is unchanged, " +
      "(3) exact duplicates are always removed, " +
      "(4) the last user message is never dropped (the bug we fixed), " +
      "(5) compressed context token count ≤ targetTokens. " +
      "Use describe/it blocks, no mocking the scorer.",
    expectedKeywords: ["vitest", "describe", "it", "expect", "Compressor", "token", "duplicate", "empty"],
  },

  // ── Round 11: deployment ──────────────────────────────────────────────
  {
    id: 11,
    topic: "deployment",
    userMessage:
      "Package ContextEngine as an npm library. Requirements: " +
      "ESM-only (type: module), TypeScript declarations, " +
      "export the Pipeline, MemoryStore, and ClaudeProvider as public API. " +
      "Add a tsconfig for build (outDir: dist, declaration: true). " +
      "What does package.json exports field look like?",
    expectedKeywords: ["ESM", "exports", "declaration", "dist", "tsconfig", "package.json", "module", "types"],
  },

  // ── Round 12: architecture (memory checkpoint → references round 2) ────
  {
    id: 12,
    topic: "architecture",
    userMessage:
      "We need to add streaming support. The current IProvider.send() returns a full response. " +
      "Add IProvider.stream() that yields tokens incrementally. " +
      "The pipeline still runs before streaming starts (we compress first, then stream). " +
      "How does this affect the PipelineResult type and the Context types we defined earlier?",
    expectedKeywords: ["stream", "generator", "async", "IProvider", "yield", "token", "pipeline"],
    memoryCheckpoint: {
      referencedTurnId: 2,
      checkKeywords: ["Context", "Message", "PipelineConfig", "interface"],
    },
  },

  // ── Round 13: refactor ────────────────────────────────────────────────
  {
    id: 13,
    topic: "refactor",
    userMessage:
      "The MemoryStore is using a flat JSON array for storage. With 10k+ entries it's getting slow. " +
      "Refactor: keep the JSON file but add an in-memory index — a Map<string, MemoryEntry> keyed by id, " +
      "plus a sorted array of entries by recency for fast topK retrieval. " +
      "The index rebuilds from the JSON file on startup. Benchmark: topK(10) should be < 5ms.",
      expectedKeywords: ["Map", "index", "in-memory", "JSON", "topK", "benchmark", "startup", "rebuild"],
  },

  // ── Round 14: bug_fixing ──────────────────────────────────────────────
  {
    id: 14,
    topic: "bug_fixing",
    userMessage:
      "Users report that after enabling memory injection, the system prompt sometimes exceeds the model's " +
      "context window because too many memory entries are injected. " +
      "The bug: memory inject runs after compression but before the token budget check, " +
      "and injected memories can push the total back over the limit. " +
      "Fix: after memory inject, re-run the token budget enforcement. " +
      "Make sure injected memories are the first to be dropped if we're over budget.",
    expectedKeywords: ["memory", "inject", "budget", "token", "enforce", "drop", "system", "context window"],
  },

  // ── Round 15: provider_router ─────────────────────────────────────────
  {
    id: 15,
    topic: "provider_router",
    userMessage:
      "Add a RetryProvider wrapper that wraps any IProvider and adds: " +
      "exponential backoff (3 retries, starting at 1s, multiplier 2x), " +
      "rate limit detection (HTTP 429 → wait for Retry-After header), " +
      "timeout per attempt (30s). " +
      "It should be transparent — same IProvider interface.",
    expectedKeywords: ["retry", "backoff", "exponential", "429", "Retry-After", "timeout", "wrapper", "IProvider"],
  },

  // ── Round 16: testing (memory checkpoint → references round 5) ─────────
  {
    id: 16,
    topic: "testing",
    userMessage:
      "Write integration tests for the full Pipeline + MemoryStore combination using vitest. " +
      "Test that after 10 rounds of conversation, the optimized context stays under targetTokens " +
      "while the baseline grows linearly. " +
      "Also test that memory injection works: a fact mentioned in round 1 should appear in the context at round 10. " +
      "Recall: what persistence format did we choose for the MemoryStore?",
    expectedKeywords: ["integration", "vitest", "Pipeline", "MemoryStore", "targetTokens", "rounds", "linear"],
    memoryCheckpoint: {
      referencedTurnId: 5,
      checkKeywords: ["JSON", "persist", "memory.json", "embedding"],
    },
  },

  // ── Round 17: cli_optimization ────────────────────────────────────────
  {
    id: 17,
    topic: "cli_optimization",
    userMessage:
      "The CLI needs a `ctx eval` subcommand that runs a benchmark: " +
      "given a conversation history file, runs it through both baseline and optimized modes, " +
      "prints a table of token usage per round and a summary savings %. " +
      "Reuse the existing Commander setup. Output format: ASCII table with columns " +
      "Round | Base Tokens | Opt Tokens | Savings% | Quality.",
    expectedKeywords: ["eval", "subcommand", "benchmark", "table", "round", "savings", "Commander", "ASCII"],
  },

  // ── Round 18: deployment ──────────────────────────────────────────────
  {
    id: 18,
    topic: "deployment",
    userMessage:
      "Add a GitHub Actions CI workflow. It should: " +
      "run on push to main and on PRs, " +
      "run tsc --noEmit, vitest run, and check that the build produces a valid dist/, " +
      "cache node_modules with actions/cache, " +
      "fail fast on type errors before running tests. " +
      "Target: Node 20.",
    expectedKeywords: ["GitHub Actions", "workflow", "tsc", "vitest", "cache", "node_modules", "push", "PR"],
  },

  // ── Round 19: refactor ────────────────────────────────────────────────
  {
    id: 19,
    topic: "refactor",
    userMessage:
      "Performance profiling shows the Pipeline takes 120ms on a 2000-token context. " +
      "The bottleneck is the ranking stage — it calls estimateTokens() on every message in a loop. " +
      "Refactor: cache token counts in the Message object (tokens?: number field), " +
      "compute them once during cleanup, and reuse throughout the pipeline. " +
      "Target: Pipeline under 20ms for 2000-token context.",
    expectedKeywords: ["cache", "tokens", "performance", "Message", "estimateTokens", "cleanup", "loop", "ms"],
  },

  // ── Round 20: deployment (memory checkpoint → references round 1) ──────
  {
    id: 20,
    topic: "deployment",
    userMessage:
      "Final deployment checklist before v1.0 release: " +
      "What are the core guarantees ContextEngine makes to users? " +
      "Write the README introduction paragraph (3–4 sentences) that explains what ContextEngine is, " +
      "the problem it solves, and how it works at a high level. " +
      "Then list any known limitations.",
    expectedKeywords: ["README", "guarantee", "token", "compress", "context", "limitation", "release"],
    memoryCheckpoint: {
      referencedTurnId: 1,
      checkKeywords: ["pipeline", "compress", "context", "middleware", "token budget"],
    },
  },
];

export function getTurns(limit?: number): LongSessionTurn[] {
  return limit ? SESSION_TURNS.slice(0, limit) : SESSION_TURNS;
}
