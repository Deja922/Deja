import type { Context, PipelineConfig } from "@/types/index.js";

export interface ICompressor {
  compress(context: Context, config: PipelineConfig): Promise<Context>;
}

export { Compressor } from "./compressor.js";
