import type { IncomingMessage } from "http";
import type { Context } from "@/types/index.js";

/**
 * Each adapter handles one API format:
 *   AnthropicAdapter  → /v1/messages (Anthropic native)
 *   OpenAIAdapter     → /v1/chat/completions (OpenAI + OpenAI-compatible)
 *
 * Adapter responsibilities:
 *   1. Detect whether an incoming request matches this format
 *   2. Parse the raw request body → internal Context
 *   3. Rebuild Context → provider-native request body for upstream forwarding
 */
export interface IAdapter {
  /** URL path pattern that identifies this provider's format */
  readonly pathPattern: RegExp;

  /** Parse raw provider request body → internal Context */
  requestToContext(body: unknown): { context: Context; records: MessageRecord[] };

  /** Rebuild provider-native request body from compressed Context */
  contextToRequest(
    ctx: Context,
    records: MessageRecord[],
    originalBody: Record<string, unknown>,
    opts?: ResendOptions,
  ): unknown;
}

/** Options that influence how the request is rebuilt for the upstream provider */
export interface ResendOptions {
  /** true if the request carries the anthropic-beta interleaved-thinking header */
  interleavedThinking?: boolean;
}

/** Lightweight record tracking original block structure for each message */
export interface MessageRecord {
  id: string;
  text: string;
  hasStructuredBlocks: boolean;
  /** true if message contains thinking/signature/redacted_thinking protocol blocks */
  hasProtocolBlocks?: boolean;
}
