import type { Context } from "@/types/index.js";

/**
 * Fast token estimator — ~4 chars per token (GPT/Claude heuristic).
 * Replace with tiktoken for production accuracy.
 */
export function estimateTokens(context: Context): number {
  const systemTokens = context.systemPrompt
    ? Math.ceil(context.systemPrompt.length / 4)
    : 0;
  const messageTokens = context.messages.reduce(
    (sum, m) => sum + Math.ceil(m.content.length / 4) + 4, // +4 for role overhead
    0
  );
  return systemTokens + messageTokens;
}
