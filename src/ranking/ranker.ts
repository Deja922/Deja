import type { Context, Message, PipelineConfig } from "@/types/index.js";
import type { IRanker } from "./index.js";

// ── Placeholder — full implementation in step 4 ──────────────────────────

export class Ranker implements IRanker {
  async rank(context: Context, _config: PipelineConfig): Promise<Context> {
    // Default: assign equal importance to all messages
    // Real implementation: TF-IDF or embedding similarity
    const messages: Message[] = context.messages.map((m) => ({
      ...m,
      importance: 0.5,
    }));
    return { ...context, messages };
  }
}
