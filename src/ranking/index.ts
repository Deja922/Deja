import type { Context, PipelineConfig } from "@/types/index.js";

export interface IRanker {
  rank(context: Context, config: PipelineConfig): Promise<Context>;
}

export { Ranker } from "./ranker.js";
