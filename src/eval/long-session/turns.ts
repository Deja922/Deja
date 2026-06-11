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

export function getTurns(limit?: number, workflow: "coding" | "planning" | "agent" = "coding", dataset: "loop" | "realistic" = "loop"): LongSessionTurn[] {
  const source = workflow === "planning" ? PLANNING_TURNS : workflow === "agent" ? AGENT_TURNS : SESSION_TURNS;

  // realistic dataset is non-looping: only use authored turns in order.
  if (dataset === "realistic") {
    const max = limit ? Math.min(limit, source.length) : source.length;
    return source.slice(0, max).map((turn, index) => ({ ...turn, id: index + 1 }) as LongSessionTurn);
  }

  if (!limit) return source;
  const result: LongSessionTurn[] = [];
  for (let i = 0; i < limit; i++) {
    const base = source[i % source.length];
    result.push({ ...base, id: i + 1 } as LongSessionTurn);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 20-TURN PLANNING WORKFLOW
// ───────────────────────────────────────────────────────────────────────────────
// Scenario: Planning a complex product launch (AI-powered analytics dashboard).
// Topics cycle: requirements → scope_definition → architecture_design →
//   risk_assessment → implementation_plan → launch_planning (×3.3 cycles).
// Memory checkpoints at turns 8, 12, 16, 20.
// ═══════════════════════════════════════════════════════════════════════════════

export const PLANNING_TURNS: LongSessionTurn[] = [
  // ── Round 1: requirements ──────────────────────────────────────────────────
  {
    id: 1,
    topic: "requirements",
    userMessage:
      "We need to plan the launch of 'DataViz Pro' — an AI-powered real-time analytics dashboard for enterprise customers. " +
      "Target audience: data analysts and business executives. Core differentiator: natural language querying of live data sources. " +
      "Start by defining the top 5 user requirements and their priority (P0-P2). Consider both analyst and executive personas.",
    expectedKeywords: ["requirement", "priority", "persona", "analyst", "executive", "natural language", "real-time", "P0", "dashboard"],
  },
  {
    id: 2,
    topic: "scope_definition",
    userMessage:
      "Good requirements. Now define the MVP scope. We have 12 weeks and a team of 5 engineers + 1 designer. " +
      "What features go into MVP vs v1.1 vs v2? Use MoSCoW prioritization (Must/Should/Could/Won't). " +
      "Consider: the NLP query engine, data connectors, visualization library, auth/SSO, alerting, sharing/collaboration.",
    expectedKeywords: ["MoSCoW", "MVP", "Must", "Should", "Could", "Won't", "week", "engineer", "scope"],
  },
  {
    id: 3,
    topic: "architecture_design",
    userMessage:
      "Design the high-level system architecture for DataViz Pro. Requirements from scope: " +
      "real-time data ingestion, NLP-to-SQL translation, caching layer, multi-tenant isolation. " +
      "Propose the tech stack for: frontend, backend API, data pipeline, NLP service, and infrastructure. " +
      "Trade-offs: latency vs throughput, consistency vs availability, development speed vs operational maturity.",
    expectedKeywords: ["architecture", "pipeline", "ingestion", "NLP", "SQL", "caching", "multi-tenant", "trade-off", "latency", "throughput"],
  },
  {
    id: 4,
    topic: "risk_assessment",
    userMessage:
      "Identify the top 5 technical risks for this project. For each risk: " +
      "probability (1-5), impact (1-5), risk score (P×I), mitigation strategy, and contingency plan. " +
      "Pay special attention to: NLP accuracy degradation over time, data source connection failures, " +
      "real-time query performance under load, and security of multi-tenant data isolation.",
    expectedKeywords: ["risk", "probability", "impact", "mitigation", "contingency", "NLP accuracy", "performance", "security", "isolation"],
  },
  {
    id: 5,
    topic: "implementation_plan",
    userMessage:
      "Create a 12-week implementation roadmap. Break it into 3 phases of 4 weeks each. " +
      "Phase 1: Core infrastructure + basic dashboard. Phase 2: NLP engine + data connectors. Phase 3: Polish + enterprise features. " +
      "For each phase: define milestones, deliverables, dependencies, and success criteria. " +
      "Assume 5 engineers — assign rough ownership (who does what).",
    expectedKeywords: ["phase", "milestone", "deliverable", "dependency", "week", "roadmap", "Phase 1", "Phase 2", "Phase 3", "ownership"],
  },
  {
    id: 6,
    topic: "requirements",
    userMessage:
      "A major potential customer just gave feedback: they need Excel export AND PDF scheduled reports. " +
      "These weren't in our original requirements. How do we handle this? " +
      "Options: (a) swap with existing P1 feature, (b) push to v1.1, (c) reduce scope elsewhere. " +
      "Analyze the impact on timeline, architecture, and team morale. Make a recommendation with rationale.",
    expectedKeywords: ["Excel", "PDF", "export", "schedule", "scope", "trade", "impact", "recommendation", "timeline", "customer"],
  },
  {
    id: 7,
    topic: "architecture_design",
    userMessage:
      "The NLP-to-SQL component is the highest-risk subsystem. Design it in detail: " +
      "How does a user query ('show me sales by region last quarter') become a SQL query? " +
      "Consider: schema discovery, query validation, result caching, and handling ambiguous queries. " +
      "Should we use an LLM directly, or a hybrid approach with a semantic layer?",
    expectedKeywords: ["NLP-to-SQL", "schema", "query", "validation", "caching", "LLM", "semantic", "hybrid", "ambiguous", "discovery"],
  },
  // ── Round 8: memory checkpoint — references rounds 1 and 4 ──────────────────
  {
    id: 8,
    topic: "risk_assessment",
    userMessage:
      "Update the risk register from round 4. Two weeks in, we've learned: " +
      "(1) NLP accuracy on complex nested queries is worse than expected (was risk #1, now probability 5 instead of 3), " +
      "(2) A new risk emerged: the team's lead backend engineer might leave (notice period). " +
      "Also, remind me: what were the original P0 requirements we defined at the start? " +
      "How do these risks affect those requirements?",
    expectedKeywords: ["probability", "risk register", "NLP accuracy", "backfill", "notice", "P0", "requirement", "updated"],
    memoryCheckpoint: {
      referencedTurnId: 1,
      checkKeywords: ["natural language", "real-time", "P0", "persona", "analyst", "executive"],
    },
  },
  {
    id: 9,
    topic: "scope_definition",
    userMessage:
      "We're now at week 5 (mid Phase 2). The NLP engine is delayed by 1.5 weeks due to the accuracy issues. " +
      "Re-scope the remaining 7 weeks. What gets cut? What gets simplified? " +
      "Consider: can we ship with a simpler NLP (template-based queries) for MVP and add full NL later? " +
      "What's the minimum viable NLP that still delivers the core differentiator?",
    expectedKeywords: ["re-scope", "delay", "template", "NLP", "simplify", "minimum viable", "differentiator", "cut", "week 5"],
  },
  {
    id: 10,
    topic: "implementation_plan",
    userMessage:
      "The revised plan from round 9 is approved. Now write the detailed sprint plan for weeks 6-8: " +
      "Sprint 3 (wk 6-7): Template-based query system + 3 core data connectors (PostgreSQL, BigQuery, Snowflake). " +
      "Sprint 4 (wk 8): Dashboard builder + chart library integration. " +
      "For each sprint: daily standup agenda, definition of done, testing strategy, and integration checkpoints.",
    expectedKeywords: ["sprint", "Sprint 3", "Sprint 4", "definition of done", "standup", "integration", "connector", "PostgreSQL", "BigQuery", "Snowflake"],
  },
  {
    id: 11,
    topic: "launch_planning",
    userMessage:
      "Start planning the beta launch. We'll do a 2-week closed beta with 5 design partners (enterprise customers). " +
      "Define: beta success criteria, feedback collection mechanism, SLA for critical bugs, " +
      "onboarding flow for beta users, and the go/no-go criteria for the full launch. " +
      "What support load should we expect?",
    expectedKeywords: ["beta", "design partner", "success criteria", "feedback", "SLA", "onboarding", "go/no-go", "support", "launch"],
  },
  // ── Round 12: memory checkpoint — references rounds 2 and 5 ──────────────────
  {
    id: 12,
    topic: "risk_assessment",
    userMessage:
      "Beta launch is next week. Final risk review: go through every risk from the register (started in round 4, updated in round 8). " +
      "Which risks are now retired? Which are escalated? " +
      "Also, remind me — what was the MoSCoW categorization we agreed on for MVP scope? " +
      "Are we actually shipping all the 'Must' items? What about the phased roadmap from round 5 — are we on track?",
    expectedKeywords: ["retired", "escalated", "MoSCoW", "Must", "MVP", "phase", "on track", "scope", "risk register", "final"],
    memoryCheckpoint: {
      referencedTurnId: 2,
      checkKeywords: ["MoSCoW", "MVP", "Must", "Should", "Could", "scope", "phase", "week"],
    },
  },
  {
    id: 13,
    topic: "requirements",
    userMessage:
      "Beta feedback is in (week 11). Key findings: " +
      "(1) Users love the natural language queries but want autocomplete suggestions, " +
      "(2) Dashboard load time must be under 2 seconds (currently 4.5s on large datasets), " +
      "(3) SSO integration is confusing — users expect a simpler setup. " +
      "Prioritize these for the v1.0 launch (2 weeks away). What's fixable in 2 weeks vs what must wait?",
    expectedKeywords: ["beta feedback", "autocomplete", "load time", "SSO", "latency", "v1.0", "prioritize", "2 weeks", "performance"],
  },
  {
    id: 14,
    topic: "architecture_design",
    userMessage:
      "The dashboard performance issue (4.5s load time) needs an architectural fix. Options: " +
      "(a) Add Redis cache layer for query results, (b) Pre-aggregate common queries in a materialized view, " +
      "(c) Move chart rendering to Web Workers, (d) Implement progressive loading. " +
      "Analyze each option's implementation effort, risk, and performance gain. Recommend a combination.",
    expectedKeywords: ["Redis", "cache", "materialized view", "Web Worker", "progressive loading", "performance", "implementation effort", "benchmark"],
  },
  {
    id: 15,
    topic: "launch_planning",
    userMessage:
      "One week to launch. Write the final launch checklist: " +
      "Infrastructure: scaling plan, monitoring dashboards, on-call rotation. " +
      "Product: feature flags, kill switches, user communication templates. " +
      "Marketing: blog post outline, social media schedule, press kit contents. " +
      "Legal: privacy policy review, data processing agreement, terms of service update.",
    expectedKeywords: ["checklist", "launch", "monitoring", "on-call", "feature flags", "kill switch", "communication", "privacy", "terms", "marketing"],
  },
  // ── Round 16: memory checkpoint — references rounds 7 and 9 ─────────────────
  {
    id: 16,
    topic: "risk_assessment",
    userMessage:
      "Launch day post-mortem prep. Before we launch, document: " +
      "What were the 3 best decisions we made during planning? What were the 2 worst? " +
      "Specifically, recall: why did we choose the hybrid NLP approach (round 7) over direct LLM? " +
      "And how did the re-scoping decision in round 9 affect the final product? " +
      "What would you change if we started over?",
    expectedKeywords: ["best decision", "worst", "hybrid NLP", "re-scope", "post-mortem", "lessons learned", "start over"],
    memoryCheckpoint: {
      referencedTurnId: 7,
      checkKeywords: ["hybrid", "NLP-to-SQL", "LLM", "semantic", "schema", "template"],
    },
  },
  {
    id: 17,
    topic: "implementation_plan",
    userMessage:
      "We launched! Now plan v1.1 (next 4 weeks). The team has bandwidth for ~15 story points per week. " +
      "Prioritized backlog: autocomplete NLP (8 pts), PDF export (5 pts), SSO v2 (3 pts), " +
      "dashboard performance (8 pts), new chart types (5 pts), alerting rules (8 pts), " +
      "team collaboration (13 pts), API rate limiting (3 pts). " +
      "What fits into 4 weeks? Sequence them for maximum impact.",
    expectedKeywords: ["v1.1", "story points", "backlog", "autocomplete", "PDF", "SSO", "alerting", "sequence", "velocity", "sprint"],
  },
  {
    id: 18,
    topic: "scope_definition",
    userMessage:
      "Competitor launched a similar product with a built-in AI copilot for data exploration. " +
      "Our v1.1 plan doesn't include this. Should we pivot? " +
      "Analyze: (a) stick to the plan, (b) delay v1.1 to add copilot, (c) fast-follow with copilot in v1.2. " +
      "Consider: market timing, team capacity, technical feasibility, and strategic positioning.",
    expectedKeywords: ["competitor", "copilot", "pivot", "v1.1", "v1.2", "market timing", "capacity", "positioning", "strategic"],
  },
  {
    id: 19,
    topic: "launch_planning",
    userMessage:
      "Plan the v1.1 launch + customer migration strategy. " +
      "We have 50 beta users on v1.0. How do we roll out v1.1 without disruption? " +
      "Design: canary deployment strategy, database migration plan, " +
      "backward compatibility guarantees, customer communication timeline, and rollback procedure.",
    expectedKeywords: ["canary", "deployment", "migration", "backward compatibility", "rollback", "communication", "customer", "v1.1", "beta"],
  },
  // ── Round 20: memory checkpoint — references round 1 ────────────────────────
  {
    id: 20,
    topic: "requirements",
    userMessage:
      "Final retrospective: looking back from v1.1 launch to the very beginning. " +
      "How well did our original requirements (round 1) hold up? " +
      "Which P0 requirement proved most valuable? Which requirement was wrong? " +
      "What did we learn about planning AI-powered products that we didn't know 20 rounds ago? " +
      "Write a 3-paragraph retrospective for the team's knowledge base.",
    expectedKeywords: ["retrospective", "P0", "requirement", "valuable", "lesson", "planning", "AI-powered", "knowledge base", "wrong"],
    memoryCheckpoint: {
      referencedTurnId: 1,
      checkKeywords: ["natural language", "real-time", "P0", "persona", "analyst", "executive", "dashboard"],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// 20-TURN AGENT WORKFLOW
// ───────────────────────────────────────────────────────────────────────────────
// Scenario: Building and operating an AI agent for automated DevOps/SRE tasks.
// Topics cycle: agent_setup → tool_execution → error_recovery →
//   multi_step_workflow → production_monitoring (×4 cycles).
// Memory checkpoints at turns 8, 12, 16, 20.
// ═══════════════════════════════════════════════════════════════════════════════

export const AGENT_TURNS: LongSessionTurn[] = [
  // ── Round 1: agent_setup ────────────────────────────────────────────────────
  {
    id: 1,
    topic: "agent_setup",
    userMessage:
      "We're building 'OpsBot' — an AI agent that automates DevOps/SRE incident response. " +
      "The agent monitors alerts from PagerDuty, diagnoses issues, and executes remediation steps. " +
      "Design the agent's tool schema. First 5 tools: (1) query_logs(service, time_range, filter), " +
      "(2) get_metrics(service, metric_name, time_range), (3) check_deployment(service, version), " +
      "(4) restart_service(service, reason), (5) scale_replicas(service, count, reason). " +
      "Define each tool's input/output schema, error modes, and required permissions.",
    expectedKeywords: ["tool", "schema", "query_logs", "get_metrics", "check_deployment", "restart_service", "scale_replicas", "permission", "error mode"],
  },
  {
    id: 2,
    topic: "agent_setup",
    userMessage:
      "Define the agent's decision framework. How does OpsBot decide which tool to call? " +
      "Design the observation → reasoning → action loop. " +
      "Specifically: (a) alert triage logic (how to classify P1/P2/P3), " +
      "(b) tool selection policy (which tool for which symptom), " +
      "(c) confidence threshold for autonomous vs human-approval actions, " +
      "(d) context gathering strategy before taking action.",
    expectedKeywords: ["observation", "reasoning", "action", "triage", "P1", "P2", "P3", "confidence threshold", "human approval", "tool selection"],
  },
  {
    id: 3,
    topic: "tool_execution",
    userMessage:
      "First incident simulation: PagerDuty fires a P1 alert — 'payment-service: latency p99 > 2000ms for 5 minutes'. " +
      "Walk through the exact sequence of tool calls OpsBot should make: " +
      "What does it query first? What metrics does it check? What's the decision tree? " +
      "Show the full trace of tool calls with expected inputs and outputs at each step.",
    expectedKeywords: ["P1", "latency", "p99", "trace", "tool call", "payment-service", "query", "metrics", "sequence", "decision tree"],
  },
  {
    id: 4,
    topic: "error_recovery",
    userMessage:
      "The tool call from round 3 failed at step 3: `query_logs(payment-service, '5m', 'error')` returns `null` " +
      "because the logging service is also degraded. The agent must handle this gracefully. " +
      "Design OpsBot's error recovery protocol for tool failures: " +
      "(a) retry with backoff, (b) fallback to alternative data source, " +
      "(c) escalate to human with partial findings, (d) continue with reduced confidence. " +
      "When should the agent use each strategy?",
    expectedKeywords: ["error recovery", "retry", "backoff", "fallback", "escalate", "partial", "degraded", "null", "protocol", "strategy"],
  },
  {
    id: 5,
    topic: "multi_step_workflow",
    userMessage:
      "Design a multi-step workflow for the 'database connection pool exhaustion' incident pattern. " +
      "This is a known pattern where: connection pool saturates → queries queue up → API timeouts → cascading failures. " +
      "The workflow should: (1) detect the pattern from metrics, (2) identify which service is the root cause, " +
      "(3) apply the fix (increase pool size / restart connections / throttle upstream), " +
      "(4) verify recovery, (5) create a post-mortem summary. Define the state machine.",
    expectedKeywords: ["workflow", "state machine", "connection pool", "cascading", "root cause", "throttle", "verify", "post-mortem", "pattern"],
  },
  {
    id: 6,
    topic: "tool_execution",
    userMessage:
      "New incident: `check_deployment(payment-service, v2.3.1)` shows the deployment 15 minutes ago introduced a memory leak. " +
      "The agent needs to decide: rollback vs scale up vs patch. " +
      "Walk through the tool execution sequence: what data does OpsBot gather to make this decision? " +
      "What's the rollback procedure? How does the agent verify the rollback succeeded?",
    expectedKeywords: ["deployment", "memory leak", "rollback", "scale", "patch", "v2.3.1", "verify", "gather", "decision"],
  },
  {
    id: 7,
    topic: "production_monitoring",
    userMessage:
      "OpsBot has been running for a week. Design the monitoring dashboard for the agent itself: " +
      "What metrics should we track? Suggestions: tool call success rate, mean time to resolution (MTTR), " +
      "false positive rate (unnecessary escalations), agent decision latency, " +
      "autonomous vs human-approved action ratio. " +
      "How do we detect when the agent's performance degrades?",
    expectedKeywords: ["monitoring", "dashboard", "MTTR", "false positive", "success rate", "latency", "autonomous ratio", "degradation", "metrics"],
  },
  // ── Round 8: memory checkpoint — references rounds 1 and 3 ──────────────────
  {
    id: 8,
    topic: "error_recovery",
    userMessage:
      "Major incident: OpsBot itself triggered a false rollback on the production database because " +
      "it misdiagnosed a slow query as a deployment issue (round 6's memory leak pattern was incorrectly matched). " +
      "Design the guardrails to prevent this: (a) pre-action validation checks, " +
      "(b) blast radius limits, (c) mandatory human approval for destructive actions. " +
      "Also, remind me: what were the original 5 tools we defined? Which ones are 'destructive' vs 'read-only'? " +
      "Classify each by risk level.",
    expectedKeywords: ["guardrail", "false rollback", "validation", "blast radius", "destructive", "read-only", "risk level", "approval", "classification"],
    memoryCheckpoint: {
      referencedTurnId: 1,
      checkKeywords: ["query_logs", "get_metrics", "check_deployment", "restart_service", "scale_replicas", "destructive"],
    },
  },
  {
    id: 9,
    topic: "agent_setup",
    userMessage:
      "After the incident in round 8, we need to rebuild trust in the agent. " +
      "Propose a staged re-enablement plan: " +
      "Stage 1 (shadow mode): agent suggests actions but doesn't execute. " +
      "Stage 2 (read-only): agent executes only read-only tools with human review. " +
      "Stage 3 (limited write): agent executes write tools with a 5-minute human approval window. " +
      "Stage 4 (full auto): previous autonomy restored with new guardrails. " +
      "Define the exit criteria for each stage.",
    expectedKeywords: ["shadow mode", "read-only", "write", "full auto", "stage", "exit criteria", "re-enablement", "trust", "human review"],
  },
  {
    id: 10,
    topic: "tool_execution",
    userMessage:
      "New tool needed: `analyze_trend(service, metric, window)` that performs statistical analysis on metric trends " +
      "to detect anomalies before they become incidents (shift from reactive → proactive). " +
      "Design the tool schema, the anomaly detection algorithm (z-score? IQR? ML-based?), " +
      "the alert threshold tuning, and how this tool integrates with the existing tool chain. " +
      "What false positive rate is acceptable?",
    expectedKeywords: ["analyze_trend", "anomaly", "proactive", "z-score", "IQR", "threshold", "false positive", "trend", "statistical", "algorithm"],
  },
  {
    id: 11,
    topic: "multi_step_workflow",
    userMessage:
      "Design a 'self-healing deployment' workflow: " +
      "When a new deployment is detected, OpsBot automatically monitors it for 30 minutes. " +
      "If error rate increases > 2σ from baseline → investigate → if confirmed regression → auto-rollback. " +
      "Define the full state machine with: health check phases, metric baselines, " +
      "statistical significance thresholds, rollback decision criteria, and notification templates.",
    expectedKeywords: ["self-healing", "deployment", "health check", "baseline", "2σ", "statistical significance", "auto-rollback", "state machine", "30 minutes"],
  },
  // ── Round 12: memory checkpoint — references rounds 5 and 8 ─────────────────
  {
    id: 12,
    topic: "production_monitoring",
    userMessage:
      "Three months in. OpsBot has handled 200+ incidents. Analyze the metrics: " +
      "MTTR dropped from 45min to 12min. But false positive rate is 18% (target: <10%). " +
      "Most false positives come from the connection pool exhaustion pattern (round 5) — " +
      "the threshold is too sensitive. " +
      "Recall the guardrails we implemented after round 8's incident. Are they working? " +
      "Propose specific threshold tuning and new validation rules.",
    expectedKeywords: ["MTTR", "false positive", "threshold", "tuning", "200 incidents", "18%", "guardrails", "validation", "sensitive"],
    memoryCheckpoint: {
      referencedTurnId: 8,
      checkKeywords: ["guardrail", "validation", "blast radius", "destructive", "approval", "false rollback"],
    },
  },
  {
    id: 13,
    topic: "agent_setup",
    userMessage:
      "Extend OpsBot to support multi-agent coordination. " +
      "Scenario: a cross-service incident where payment-service and inventory-service both show alerts. " +
      "Two OpsBot instances need to coordinate — one per service — sharing findings and avoiding conflicting actions. " +
      "Design the inter-agent communication protocol: message format, conflict resolution, " +
      "shared state, and leader election for the final remediation decision.",
    expectedKeywords: ["multi-agent", "coordination", "communication protocol", "conflict resolution", "shared state", "leader election", "cross-service"],
  },
  {
    id: 14,
    topic: "error_recovery",
    userMessage:
      "Edge case: OpsBot encounters a completely novel incident pattern it has never seen before. " +
      "All pattern matching returns confidence < 30%. No standard workflow matches. " +
      "Design the 'unknown incident' protocol: what does the agent do when it doesn't know what to do? " +
      "Options: (a) escalate immediately, (b) gather more data and retry classification, " +
      "(c) attempt generic safe actions, (d) engage a human-in-the-loop with structured context.",
    expectedKeywords: ["unknown incident", "novel", "confidence < 30%", "escalate", "gather", "human-in-the-loop", "classification", "generic"],
  },
  {
    id: 15,
    topic: "tool_execution",
    userMessage:
      "Add a 'runbook' tool: `execute_runbook(runbook_id, parameters)` that executes predefined remediation procedures. " +
      "Runbooks are written by senior SREs and version-controlled in git. " +
      "Design: runbook schema (YAML format), parameter validation, execution sandboxing, " +
      "rollback on failure, and audit trail. How does the agent decide between using a runbook vs composing tools dynamically?",
    expectedKeywords: ["runbook", "execute_runbook", "YAML", "sandboxing", "audit trail", "version-controlled", "SRE", "parameter", "dynamically"],
  },
  // ── Round 16: memory checkpoint — references rounds 11 and 13 ───────────────
  {
    id: 16,
    topic: "multi_step_workflow",
    userMessage:
      "Design a 'major incident commander' workflow that orchestrates the full response: " +
      "(1) Declare incident severity, (2) Assemble response team (page on-call), " +
      "(3) Create war room (Slack channel + Zoom), (4) Execute diagnostic playbook, " +
      "(5) Track action items and owners, (6) Status updates every 15 minutes, " +
      "(7) Resolution verification, (8) Post-mortem scheduling. " +
      "This combines the self-healing deployment (round 11) with the multi-agent coordination (round 13). " +
      "How do these pieces fit together?",
    expectedKeywords: ["major incident", "commander", "war room", "playbook", "action items", "status update", "15 minutes", "resolution", "post-mortem"],
    memoryCheckpoint: {
      referencedTurnId: 11,
      checkKeywords: ["self-healing", "deployment", "health check", "baseline", "auto-rollback", "state machine"],
    },
  },
  {
    id: 17,
    topic: "production_monitoring",
    userMessage:
      "OpsBot is now handling 500+ incidents/month. We need SLO-based monitoring. " +
      "Define SLOs for: incident acknowledgment time (< 30s), diagnosis accuracy (> 85%), " +
      "remediation success rate (> 90%), escalation appropriateness (> 95%). " +
      "Design the SLO dashboard, error budgets, and the policy for when to take OpsBot offline " +
      "(e.g., if error budget is exhausted, switch to human-only mode).",
    expectedKeywords: ["SLO", "error budget", "acknowledgment", "accuracy", "success rate", "escalation", "dashboard", "offline", "human-only"],
  },
  {
    id: 18,
    topic: "error_recovery",
    userMessage:
      "Disaster scenario: OpsBot's own infrastructure fails — its database is corrupted, " +
      "all state is lost. Design the agent's self-recovery procedure: " +
      "(1) Detect own failure (health check from secondary region), " +
      "(2) Fail over to standby instance, (3) Rebuild state from audit logs, " +
      "(4) Replay pending actions, (5) Notify on-call with recovery summary. " +
      "What state MUST be persisted outside the agent? What can be reconstructed?",
    expectedKeywords: ["disaster", "self-recovery", "fail over", "standby", "audit logs", "replay", "corrupted", "persist", "reconstruct"],
  },
  {
    id: 19,
    topic: "agent_setup",
    userMessage:
      "Plan OpsBot v2: from reactive incident response to proactive reliability engineering. " +
      "New capabilities: (1) Chaos engineering — scheduled fault injection to test system resilience, " +
      "(2) Capacity forecasting — predict resource needs 30 days ahead, " +
      "(3) Dependency risk analysis — map service dependencies and identify single points of failure. " +
      "For each new capability: what tools are needed, what's the risk, and what's the rollout plan?",
    expectedKeywords: ["OpsBot v2", "proactive", "chaos engineering", "capacity forecasting", "dependency risk", "fault injection", "resilience", "rollout"],
  },
  // ── Round 20: memory checkpoint — references round 1 ────────────────────────
  {
    id: 20,
    topic: "production_monitoring",
    userMessage:
      "One year retrospective. OpsBot has handled 8,000+ incidents with 94% autonomous resolution rate. " +
      "Looking back at the original 5 tools we defined in round 1 — which ones are still in use? " +
      "Which were replaced or deprecated? " +
      "Write a 3-paragraph engineering blog post about 'Lessons from a Year of AIOps': " +
      "what worked, what surprised us, and what we'd do differently. " +
      "Include the MTTR improvement, false positive journey, and the guardrails evolution.",
    expectedKeywords: ["8,000", "94%", "autonomous", "deprecated", "blog post", "AIOps", "lesson", "surprised", "differently", "evolution"],
    memoryCheckpoint: {
      referencedTurnId: 1,
      checkKeywords: ["query_logs", "get_metrics", "check_deployment", "restart_service", "scale_replicas", "tool"],
    },
  },
];
