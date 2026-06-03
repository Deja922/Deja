import type { Context } from "@/types/index.js";
import type { IProvider, ProviderRequest } from "@/providers/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

/**
 * Mock provider — used when no API key is set.
 * Runs all optimization passes so metrics are real; only the "AI response" is fake.
 */
export class MockProvider implements IProvider {
  private label: string;

  constructor(label = "mock") {
    this.label = label;
  }

  async send(req: ProviderRequest): Promise<ReturnType<IProvider["send"]>> {
    await simulateLatency(80, 180);

    const lastUser = [...req.context.messages]
      .reverse()
      .find((m) => m.role === "user");
    const snippet = lastUser?.content.slice(0, 120) ?? "(no user message)";

    const content =
      `[${this.label}] Responding to: "${snippet}"\n\n` +
      `This is a mock response. Set ANTHROPIC_API_KEY to use the real Claude API. ` +
      `The context passed to this call contained ${req.context.messages.length} messages.`;

    const promptTokens = estimateTokens(req.context);
    const completionTokens = Math.ceil(content.length / 4);

    return {
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async countTokens(context: Context): Promise<number> {
    return estimateTokens(context);
  }
}

function simulateLatency(minMs: number, maxMs: number): Promise<void> {
  return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}
