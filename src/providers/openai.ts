import OpenAI from "openai";
import type { IProvider, ProviderRequest, ProviderResponse } from "./index.js";
import type { Context } from "@/types/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

export class OpenAIProvider implements IProvider {
  private client: OpenAI;
  private model: string;

  constructor(model = "gpt-4o") {
    this.client = new OpenAI();
    this.model = model;
  }

  async send(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (req.context.systemPrompt) {
      messages.push({ role: "system", content: req.context.systemPrompt });
    }

    for (const m of req.context.messages.filter((m) => m.role !== "system")) {
      messages.push({ role: m.role as "user" | "assistant", content: m.content });
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens,
      messages,
    });

    const content = response.choices[0]?.message.content ?? "";
    const usage = response.usage!;

    return {
      content,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  }

  async countTokens(context: Context): Promise<number> {
    return estimateTokens(context);
  }
}
