import Anthropic from "@anthropic-ai/sdk";
import type { IProvider, ProviderRequest, ProviderResponse } from "./index.js";
import type { Context, CleanMessage } from "@/types/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";

/**
 * Normalize internal pipeline messages to clean API format.
 * ALWAYS reconstructs from scratch — NEVER reuses raw SDK objects.
 * Only { role, content } are serialized; all other fields are discarded.
 */
function normalizeMessages(context: Context): { role: "user" | "assistant"; content: string }[] {
  return context.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content ?? ""),
    }));
}

export class ClaudeProvider implements IProvider {
  private client: Anthropic;
  private model: string;

  constructor(model = "claude-sonnet-4-6") {
    this.client = new Anthropic();
    this.model = model;
  }

  async send(req: ProviderRequest): Promise<ProviderResponse> {
    // Reconstruct messages from scratch — never carry raw SDK objects
    const messages = normalizeMessages(req.context);

    const params: {
      model: string;
      max_tokens: number;
      messages: { role: "user" | "assistant"; content: string }[];
      system?: string;
    } = {
      model: this.model,
      max_tokens: req.maxTokens,
      messages,
    };
    if (req.context.systemPrompt !== undefined) {
      params.system = req.context.systemPrompt;
    }

    const response = await this.client.messages.create(params);

    const textBlock = response.content.find((b): b is { type: "text"; text: string } => b.type === "text");
    const content = textBlock?.text ?? "";

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
    return estimateTokens(context);
  }
}
