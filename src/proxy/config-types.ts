// ── User-facing config (~/.deja/config.json) ──────────────────────────────

export type CompressionMode = "production" | "balanced" | "aggressive" | "demo";

export interface CompressionModeSettings {
  targetTokens: number;
  maxTokens: number;
  compressThreshold: number;
}

export const COMPRESSION_MODES: Record<CompressionMode, CompressionModeSettings> = {
  production:  { targetTokens: 4000, maxTokens: 8000, compressThreshold: 200 },
  balanced:    { targetTokens: 2500, maxTokens: 6000, compressThreshold: 150 },
  aggressive:  { targetTokens: 1200, maxTokens: 4000, compressThreshold: 100 },
  demo:        { targetTokens: 500,  maxTokens: 2000, compressThreshold: 50 },
};

export interface ProviderConfig {
  /** Base URL of the upstream API (e.g. https://api.openai.com) */
  baseUrl: string;
  /** API key. Supports ${ENV_VAR} syntax for environment variable references. */
  apiKey?: string | undefined;
  /** If set, this provider uses OpenAI or Anthropic compatible format */
  compatMode?: "openai" | "anthropic" | undefined;
}

export interface PipelineSettings {
  mode?: CompressionMode | undefined;
  maxTokens: number;
  targetTokens: number;
  rankingThreshold: number;
  memoryEnabled: boolean;
  memoryTopK: number;
  compressThreshold: number;
}

export interface RuntimeConfig {
  port: number;
  pipeline: PipelineSettings;
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_PIPELINE: PipelineSettings = {
  maxTokens: 8000,
  targetTokens: 4000,
  rankingThreshold: 0.3,
  memoryEnabled: false,
  memoryTopK: 5,
  compressThreshold: 200,
};

export const DEFAULT_CONFIG: RuntimeConfig = {
  port: 9090,
  pipeline: DEFAULT_PIPELINE,
  providers: {},
  defaultProvider: "anthropic",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve ${ENV_VAR} references in a string */
export function resolveEnv(s: string): string {
  return s.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}
