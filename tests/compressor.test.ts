import { describe, expect, test } from "vitest";
import { Compressor } from "../src/compressor/index.js";
import { scoreMessages } from "../src/compressor/scorer.js";
import { summarizeBlock } from "../src/compressor/summarizer.js";
import { estimateTokens } from "../src/cache/tokenizer.js";
import type { Context, Message, PipelineConfig } from "../src/types/index.js";

function makeMessage(role: Message["role"], content: string, i = 0): Message {
  return { id: String(i), role, content, timestamp: i * 1000 };
}

function makeContext(messages: Message[], systemPrompt?: string): Context {
  return { messages, systemPrompt };
}

const baseConfig: PipelineConfig = {
  maxTokens: 500,
  targetTokens: 250,
  compressionRatio: 0.5,
  rankingThreshold: 0.3,
  memoryEnabled: false,
  memoryTopK: 5,
  provider: "claude",
  model: "claude-sonnet-4-6",
};

// ── scorer ───────────────────────────────────────────────────────────────

describe("scorer", () => {
  test("assigns importance 0–1 to all messages", () => {
    const messages = [
      makeMessage("user", "Hello", 0),
      makeMessage("assistant", "Hi! How can I help?", 1),
      makeMessage("user", "Fix this bug:\n```ts\nconst x = null;\n```", 2),
    ];
    const scored = scoreMessages(messages);
    for (const m of scored) {
      expect(m.importance).toBeGreaterThanOrEqual(0);
      expect(m.importance).toBeLessThanOrEqual(1);
    }
  });

  test("later messages score higher (recency bonus)", () => {
    const messages = [
      makeMessage("user", "old message with some content here", 0),
      makeMessage("user", "new message with some content here", 1),
    ];
    const scored = scoreMessages(messages);
    expect(scored[1]!.importance!).toBeGreaterThan(scored[0]!.importance!);
  });

  test("system messages get full role bonus", () => {
    const messages = [
      makeMessage("system", "You are a helpful assistant.", 0),
      makeMessage("user", "You are a helpful assistant.", 1),
    ];
    const [sys, user] = scoreMessages(messages);
    expect(sys!.importance!).toBeGreaterThan(user!.importance! * 0.5);
  });
});

// ── summarizer ───────────────────────────────────────────────────────────

describe("summarizer", () => {
  test("produces a single system message", () => {
    const messages = [
      makeMessage("user", "What is dependency injection?", 0),
      makeMessage("assistant", "Dependency injection is a design pattern where objects receive their dependencies from outside rather than creating them internally. It improves testability.", 1),
    ];
    const summary = summarizeBlock(messages);
    expect(summary.role).toBe("system");
    expect(summary.content).toContain("Summarized 2 earlier messages");
  });

  test("handles short messages gracefully", () => {
    const messages = [makeMessage("user", "ok", 0)];
    const summary = summarizeBlock(messages);
    expect(summary.role).toBe("system");
    expect(summary.content.length).toBeGreaterThan(0);
  });

  test("summary is shorter than original content", () => {
    const longContent = "This is a very long message. ".repeat(30);
    const messages = [makeMessage("user", longContent, 0)];
    const summary = summarizeBlock(messages);
    expect(summary.content.length).toBeLessThan(longContent.length);
  });
});

// ── compressor ───────────────────────────────────────────────────────────

describe("compressor", () => {
  const compressor = new Compressor();

  test("passthrough when already within target", async () => {
    const ctx = makeContext([
      makeMessage("user", "Hi", 0),
      makeMessage("assistant", "Hello!", 1),
    ]);
    const result = await compressor.compress(ctx, baseConfig);
    expect(result.messages.length).toBe(2);
  });

  test("reduces tokens when over target", async () => {
    const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
      makeMessage(
        i % 2 === 0 ? "user" : "assistant",
        "This is a message with substantial content that contributes to token count. ".repeat(5),
        i
      )
    );
    const ctx = makeContext(messages);
    const originalTokens = estimateTokens(ctx);
    const result = await compressor.compress(ctx, baseConfig);
    const newTokens = estimateTokens(result);

    expect(newTokens).toBeLessThan(originalTokens);
    expect(newTokens).toBeLessThanOrEqual(baseConfig.maxTokens);
  });

  test("always keeps system messages", async () => {
    const messages: Message[] = [
      makeMessage("system", "You are a strict code reviewer.", 0),
      ...Array.from({ length: 15 }, (_, i) =>
        makeMessage(i % 2 === 0 ? "user" : "assistant", "Some message content. ".repeat(10), i + 1)
      ),
    ];
    const ctx = makeContext(messages);
    const result = await compressor.compress(ctx, baseConfig);
    expect(result.messages.some((m) => m.role === "system")).toBe(true);
  });

  test("deduplicates near-identical messages", async () => {
    const dup = "Tell me about TypeScript interfaces please.";
    const messages: Message[] = [
      ...Array.from({ length: 6 }, (_, i) => makeMessage("user", dup, i)),
      makeMessage("assistant", "TypeScript interfaces define the shape of objects.", 6),
      makeMessage("user", "Can you show an example?", 7),
    ];
    const ctx = makeContext(messages);
    // high target so only dedup pass runs
    const result = await compressor.compress(ctx, { ...baseConfig, targetTokens: 50000 });
    const dupCount = result.messages.filter((m) => m.role === "user" && m.content === dup).length;
    expect(dupCount).toBeLessThan(6);
  });

  test("output never exceeds maxTokens", async () => {
    const messages: Message[] = Array.from({ length: 50 }, (_, i) =>
      makeMessage(i % 2 === 0 ? "user" : "assistant", "A".repeat(300), i)
    );
    const ctx = makeContext(messages);
    const result = await compressor.compress(ctx, baseConfig);
    expect(estimateTokens(result)).toBeLessThanOrEqual(baseConfig.maxTokens);
  });
});
