import { describe, expect, test } from "vitest";
import { estimateTokens } from "../src/cache/tokenizer.js";
import type { Context } from "../src/types/index.js";

describe("tokenizer", () => {
  test("estimates tokens for empty context", () => {
    const ctx: Context = { messages: [] };
    expect(estimateTokens(ctx)).toBe(0);
  });

  test("estimates tokens with messages", () => {
    const ctx: Context = {
      messages: [
        { id: "1", role: "user", content: "Hello world", timestamp: 0 },
        { id: "2", role: "assistant", content: "Hi there!", timestamp: 1 },
      ],
    };
    expect(estimateTokens(ctx)).toBeGreaterThan(0);
  });

  test("counts system prompt tokens", () => {
    const ctx: Context = {
      messages: [],
      systemPrompt: "You are a helpful assistant.",
    };
    expect(estimateTokens(ctx)).toBeGreaterThan(0);
  });
});
