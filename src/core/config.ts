import type { PipelineConfig } from "@/types/index.js";

const defaults: PipelineConfig = {
  maxTokens: 8000,
  targetTokens: 4000,
  compressionRatio: 0.5,
  rankingThreshold: 0.3,
  memoryEnabled: false,
  memoryTopK: 5,
  provider: "claude",
  model: "claude-sonnet-4-6",
};

export async function loadConfig(overrides?: Partial<PipelineConfig>): Promise<PipelineConfig> {
  return { ...defaults, ...overrides };
}
