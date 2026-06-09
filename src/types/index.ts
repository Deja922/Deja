// ─────────────────────────────────────────────
// Domain types shared across all modules
// ─────────────────────────────────────────────

export type Role = "user" | "assistant" | "system";

/**
 * Message category — determines which pipeline stages process this message.
 *
 *   SYSTEM_LOGS  → dev-only (stderr / debug file), NEVER reaches LLM
 *   TELEMETRY    → dev-only (stderr / debug file), NEVER reaches LLM
 *   USER_MEMORY  → LLM-bound, eligible for compression
 *   TASK_MEMORY  → LLM-bound, eligible for compression
 */
export type MessageCategory = "SYSTEM_LOGS" | "TELEMETRY" | "USER_MEMORY" | "TASK_MEMORY";

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;        // Unix ms
  tokens?: number;          // filled by tokenizer
  importance?: number;      // 0–1, filled by ranker
  summary?: string;         // filled by compressor
  source?: "memory";        // set by memory module on injected messages
  category?: MessageCategory; // set by relevance filter (Stage 1)
}

/**
 * Pure text conversation history used at Context Engine boundaries.
 * MUST NOT contain raw Claude/Anthropic SDK objects.
 * All thinking, signature, redacted_thinking, and tool blocks
 * must be stripped before producing CleanMessage instances.
 */
export type CleanMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface Context {
  messages: Message[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
  /** Dev-only: messages filtered out by relevance filter (system logs, telemetry).
   *  Written to stderr for debugging but NEVER sent to the LLM. */
  debugMessages?: Message[];
}

// ─────────────────────────────────────────────
// Pipeline config — loaded from config/default.json
// ─────────────────────────────────────────────

export interface PipelineConfig {
  maxTokens: number;          // hard ceiling for output context
  targetTokens: number;       // soft target after compression
  rankingThreshold: number;   // 0–1, drop messages below this score
  memoryEnabled: boolean;
  memoryTopK: number;         // how many memory hits to inject
}

// ─────────────────────────────────────────────
// Pipeline result
// ─────────────────────────────────────────────

export interface PipelineStats {
  originalTokens: number;
  outputTokens: number;
  compressionRatio: number;   // actuallyachieved ratio
  messagesDropped: number;
  messagesSummarized: number;
  memoryHits: number;
  durationMs: number;
}

export interface PipelineResult {
  context: Context;
  stats: PipelineStats;
}

// ─────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  content: string;
  embedding: number[];
  createdAt: number;
  tags?: string[];
  score?: number;             // similarity score, set at query time
}

// ─────────────────────────────────────────────
// Provider abstraction
// ─────────────────────────────────────────────

export interface ProviderRequest {
  context: Context;
  maxTokens: number;
}

export interface ProviderResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
