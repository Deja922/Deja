// ─────────────────────────────────────────────
// Domain types shared across all modules
// ─────────────────────────────────────────────

export type Role = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;        // Unix ms
  tokens?: number;          // filled by tokenizer
  importance?: number;      // 0–1, filled by ranker
  summary?: string;         // filled by compressor
  source?: "memory";        // set by memory module on injected messages
}

export interface Context {
  messages: Message[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Pipeline config — loaded from config/default.json
// ─────────────────────────────────────────────

export interface PipelineConfig {
  maxTokens: number;          // hard ceiling for output context
  targetTokens: number;       // soft target after compression
  compressionRatio: number;   // 0–1, how aggressively to compress
  rankingThreshold: number;   // 0–1, drop messages below this score
  memoryEnabled: boolean;
  memoryTopK: number;         // how many memory hits to inject
  provider: ProviderType;
  model: string;
}

export type ProviderType = "claude" | "openai" | "local";

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
