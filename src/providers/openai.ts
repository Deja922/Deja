import OpenAI from "openai";
import type { IProvider, ProviderRequest, ProviderResponse } from "./index.js";
import type { Context } from "@/types/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

/**
 * Normalize internal pipeline messages to clean API format.
 * ALWAYS reconstructs from scratch — NEVER reuses raw SDK objects.
 * Only { role, content } are serialized; all other fields are discarded.
 */
function normalizeMessages(context: Context): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (context.systemPrompt) {
    messages.push({ role: "system", content: context.systemPrompt });
  }

  for (const m of context.messages.filter((m) => m.role !== "system")) {
    messages.push({
      role: m.role as "user" | "assistant",
      content: String(m.content ?? ""),
    });
  }

  return messages;
}

export class OpenAIProvider implements IProvider {
  private client: OpenAI;
  private model: string;

  constructor(model = "gpt-4o") {
    this.client = new OpenAI();
    this.model = model;
  }

  async send(req: ProviderRequest): Promise<ProviderResponse> {
    // Reconstruct messages from scratch — never carry raw SDK objects
    const messages = normalizeMessages(req.context);

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
