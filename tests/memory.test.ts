import { describe, expect, test, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { MemoryStore } from "../src/memory/store.js";
import { LocalEmbedder } from "../src/memory/embeddings.js";
import { cosine, topK } from "../src/memory/similarity.js";
import type { Context, Message, PipelineConfig } from "../src/types/index.js";

function tmpDb(): string {
  return join(tmpdir(), `ctx-test-${randomUUID()}.json`);
}

function makeCtx(userContent: string): Context {
  const messages: Message[] = [
    { id: "1", role: "user", content: userContent, timestamp: Date.now() },
  ];
  return { messages };
}

const config: PipelineConfig = {
  maxTokens: 8000,
  targetTokens: 4000,
  compressionRatio: 0.5,
  rankingThreshold: 0.3,
  memoryEnabled: true,
  memoryTopK: 3,
  provider: "claude",
  model: "claude-sonnet-4-6",
};

// ── embedder ─────────────────────────────────────────────────────────────

describe("LocalEmbedder", () => {
  const embedder = new LocalEmbedder(128);

  test("returns vector of correct dimensionality", async () => {
    const vec = await embedder.embed("Hello world");
    expect(vec.length).toBe(128);
  });

  test("returns L2-normalized vector (magnitude ≈ 1)", async () => {
    const vec = await embedder.embed("TypeScript generics are useful");
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  test("empty string returns zero vector", async () => {
    const vec = await embedder.embed("");
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  test("similar texts produce higher cosine similarity than dissimilar", async () => {
    const a = await embedder.embed("TypeScript generics type safety");
    const b = await embedder.embed("TypeScript generics interface types");
    const c = await embedder.embed("cooking pasta recipe italian food");

    const simAB = cosine(a, b);
    const simAC = cosine(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });
});

// ── similarity ───────────────────────────────────────────────────────────

describe("cosine", () => {
  test("identical vectors give similarity 1", () => {
    const v = [0.6, 0.8, 0];
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors give similarity 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  test("mismatched lengths return 0", () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("topK", () => {
  test("returns indices of top K scores", () => {
    const scores = [0.1, 0.9, 0.5, 0.8, 0.3];
    const result = topK(scores, 2);
    expect(result).toContain(1); // 0.9
    expect(result).toContain(3); // 0.8
    expect(result.length).toBe(2);
  });

  test("K larger than array returns all indices", () => {
    expect(topK([0.5, 0.3], 10).length).toBe(2);
  });
});

// ── MemoryStore ───────────────────────────────────────────────────────────

describe("MemoryStore", () => {
  test("store and inject: injects relevant memory into context", async () => {
    const store = new MemoryStore(tmpDb());
    await store.store("The project uses PostgreSQL for the main database.");
    await store.store("Authentication is handled by JWT tokens.");
    await store.store("The frontend is built with React and TypeScript.");

    const ctx = makeCtx("How does authentication work in this project?");
    const result = await store.inject(ctx, config);

    const memMessages = result.messages.filter((m) => m.source === "memory");
    expect(memMessages.length).toBe(1);
    expect(memMessages[0]!.content).toContain("Relevant memory context");
  });

  test("empty store returns context unchanged", async () => {
    const store = new MemoryStore(tmpDb());
    const ctx = makeCtx("What is the database?");
    const result = await store.inject(ctx, config);
    expect(result.messages.length).toBe(ctx.messages.length);
  });

  test("clear removes all memories", async () => {
    const store = new MemoryStore(tmpDb());
    await store.store("Remember this important fact.");
    await store.clear();

    const ctx = makeCtx("Do you remember anything?");
    const result = await store.inject(ctx, config);
    expect(result.messages.filter((m) => m.source === "memory").length).toBe(0);
  });

  test("injected memory appears after system messages", async () => {
    const store = new MemoryStore(tmpDb());
    await store.store("The API base URL is https://api.example.com");

    const ctx: Context = {
      messages: [
        { id: "sys", role: "system", content: "You are a helpful assistant.", timestamp: 0 },
        { id: "u1", role: "user", content: "What is the API URL?", timestamp: 1 },
      ],
    };

    const result = await store.inject(ctx, config);
    const memIdx = result.messages.findIndex((m) => m.source === "memory");
    const sysIdx = result.messages.findIndex((m) => m.role === "system" && m.source !== "memory");

    expect(memIdx).toBeGreaterThan(sysIdx);
  });

  test("respects topK config", async () => {
    const store = new MemoryStore(tmpDb());
    for (let i = 0; i < 10; i++) {
      await store.store(`TypeScript tip number ${i}: use strict mode.`);
    }

    const ctx = makeCtx("Tell me about TypeScript");
    const result = await store.inject(ctx, { ...config, memoryTopK: 2 });

    const injected = result.messages.find((m) => m.source === "memory");
    // topK=2, so at most 2 entries in the block
    expect(injected).toBeDefined();
    // Content has at most 2 numbered entries
    const entryCount = (injected!.content.match(/^\d+\./gm) ?? []).length;
    expect(entryCount).toBeLessThanOrEqual(2);
  });
});
