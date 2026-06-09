import { randomUUID } from "crypto";
import type { Context, Message } from "@/types/index.js";
import type { IAdapter, MessageRecord } from "./index.js";

// ── OpenAI wire types ───────────────────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class OpenAIAdapter implements IAdapter {
  readonly pathPattern = /^\/v1\/chat\/completions/;

  // ── parse ──────────────────────────────────────────────────────────────

  requestToContext(body: unknown): { context: Context; records: MessageRecord[] } {
    const req = body as OpenAIRequest;
    const { systemPrompt, chatMessages } = splitSystemMessage(req.messages ?? []);

    const records: MessageRecord[] = chatMessages.map((msg) => {
      const id = randomUUID();
      return {
        id,
        original: msg,
        text: extractText(msg),
        hasStructuredBlocks: hasToolCalls(msg),
      } as MessageRecord & { original: OpenAIMessage };
    });

    const messages: Message[] = records.map((record, index) => {
      const orig = (record as MessageRecord & { original: OpenAIMessage }).original;
      return {
        id: record.id,
        role: openaiRoleToRole(orig.role),
        content: record.text,
        timestamp: Date.now() - (records.length - index) * 1000,
      };
    });

    const context: Context = { messages };
    if (systemPrompt) context.systemPrompt = systemPrompt;

    return { context, records };
  }

  // ── rebuild ────────────────────────────────────────────────────────────

  contextToRequest(
    ctx: Context,
    records: MessageRecord[],
    originalBody: Record<string, unknown>,
  ): OpenAIRequest {
    const typedRecords = records as (MessageRecord & { original: OpenAIMessage })[];
    const optimizedById = new Map(ctx.messages.map((m) => [m.id, m]));
    const messages: OpenAIMessage[] = [];

    // Re-insert system prompt as first message if it was there originally
    const orig = originalBody as OpenAIRequest;
    const origHasSystem = orig.messages?.some((m) => m.role === "system");
    if (origHasSystem && ctx.systemPrompt) {
      messages.push({ role: "system", content: ctx.systemPrompt });
    }

    for (const record of typedRecords) {
      const optimized = optimizedById.get(record.id);

      if (!optimized) {
        if (record.hasStructuredBlocks) {
          messages.push(rebuildToolMessage(record.original));
        }
        continue;
      }

      if (record.hasStructuredBlocks) {
        messages.push(rebuildToolMessage(record.original));
      } else {
        const newContent = optimized.summary ?? optimized.content;
        messages.push({
          role: roleToOpenAIRole(optimized.role),
          content: newContent,
        });
      }
    }

    return { ...orig, messages };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function splitSystemMessage(msgs: OpenAIMessage[]): {
  systemPrompt?: string;
  chatMessages: OpenAIMessage[];
} {
  const first = msgs[0];
  if (first?.role === "system") {
    return {
      systemPrompt: typeof first.content === "string" ? first.content : extractText(first),
      chatMessages: msgs.slice(1),
    };
  }
  return { chatMessages: msgs };
}

function extractText(msg: OpenAIMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (msg.content === null) return "";
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  // fallback: tool_calls → describe them
  if (msg.tool_calls?.length) {
    return msg.tool_calls
      .map((tc) => `[tool_call: ${tc.function.name}(${tc.function.arguments})]`)
      .join("\n");
  }
  return "";
}

function hasToolCalls(msg: OpenAIMessage): boolean {
  return Boolean(msg.tool_calls?.length) || msg.role === "tool";
}

function rebuildToolMessage(original: OpenAIMessage): OpenAIMessage {
  const rebuilt: OpenAIMessage = { role: original.role, content: original.content };
  if (original.tool_calls?.length) rebuilt.tool_calls = original.tool_calls;
  if (original.tool_call_id) rebuilt.tool_call_id = original.tool_call_id;
  if (original.name) rebuilt.name = original.name;
  return rebuilt;
}

function openaiRoleToRole(role: OpenAIMessage["role"]): "user" | "assistant" {
  if (role === "assistant" || role === "tool") return "assistant";
  return "user";
}

function roleToOpenAIRole(role: string): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}
