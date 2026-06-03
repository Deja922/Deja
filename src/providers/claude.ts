import Anthropic from "@anthropic-ai/sdk";
import type { IProvider, ProviderRequest, ProviderResponse } from "./index.js";
import type { Context } from "@/types/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

export class ClaudeProvider implements IProvider {
  private client: Anthropic;
  private model: string;

  constructor(model = "claude-sonnet-4-6") {
    this.client = new Anthropic();
    this.model = model;
  }

  async send(req: ProviderRequest): Promise<ProviderResponse> {
    const messages = req.context.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.context.systemPrompt,
      messages,
    });

    const content = response.content[0]?.type === "text"
      ? response.content[0].text
      : "";

    return {
      content,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async countTokens(context: Context): Promise<number> {
    // Use fast estimate; Claude's actual count requires an API call
    return estimateTokens(context);
  }
}
