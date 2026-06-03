import type { Context, PipelineStats } from "@/types/index.js";

export type RunMode = "baseline" | "optimized" | "both";

export interface RunOptions {
  mode: RunMode;
  contextFile?: string;   // optional conversation history JSON
  maxTokens: number;
  targetTokens: number;
  memoryEnabled: boolean;
  provider: "claude" | "openai" | "mock";
  model: string;
  logDir: string;
}

export interface RunResult {
  mode: "baseline" | "optimized";
  inputContext: Context;
  outputContext: Context;
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  pipelineStats?: PipelineStats;
  qualityScore: number;
  latencyMs: number;
}

export interface ComparisonReport {
  runId: string;
  timestamp: string;
  prompt: string;
  baseline?: RunResult;
  optimized?: RunResult;
  tokenSavingsPct?: number;
  qualityDelta?: number;
}
