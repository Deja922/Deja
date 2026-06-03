import type { Context, PipelineConfig, PipelineResult } from "@/types/index.js";

/**
 * Central pipeline — runs each stage in order:
 *   cleanup → ranking → compression → memory inject → token budget check
 *
 * Each stage is a pure function: Context in, Context out.
 * Stats are accumulated across stages and returned with the final context.
 */
export interface IPipeline {
  run(context: Context, config: PipelineConfig): Promise<PipelineResult>;
}

export { Pipeline } from "./pipeline.js";
export { loadConfig } from "./config.js";
