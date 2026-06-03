import type { Context, PipelineConfig } from "@/types/index.js";

export interface IMemoryStore {
  /** Persist text to long-term memory */
  store(content: string, tags?: string[]): Promise<void>;
  /** Inject top-K relevant memories into context as system messages */
  inject(context: Context, config: PipelineConfig): Promise<Context>;
  /** Remove all stored memories */
  clear(): Promise<void>;
}

export { MemoryStore } from "./store.js";
