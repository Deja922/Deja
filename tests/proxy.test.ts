import { describe, expect, test } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { scoreQuality } from "../src/proxy/quality.js";
import { MockProvider } from "../src/proxy/mock-provider.js";
import { runProxy } from "../src/proxy/runner.js";
import { estimateTokens } from "../src/cache/tokenizer.js";
import type { Context } from "../src/types/index.js";

function tmpLog(): string {
  return join(tmpdir(), `ctx-proxy-test-${randomUUID()}`);
}

// ── quality scorer ────────────────────────────────────────────────────────

describe("scoreQuality", () => {
  test("empty response scores 0", () => {
    expect(scoreQuality("What is TypeScript?", "")).toBe(0);
  });

  test("very short response scores low", () => {
    expect(scoreQuality("Explain generics in depth.", "Yes.")).toBeLessThan(5);
  });

  test("relevant long response scores high", () => {
    const response =
      "TypeScript generics allow you to write reusable, type-safe functions. " +
      "For example, function identity<T>(arg: T): T returns the same type. " +
      "You can use generics with interfaces: interface Box<T> { value: T }. " +
      "Constraints like T extends object restrict what types are accepted.";
    const score = scoreQuality("How do TypeScript generics work?", response);
    expect(score).toBeGreaterThanOrEqual(7);
  });

  test("truncated response loses completeness points", () => {
    const full = "TypeScript generics provide type-safe reusable code patterns with constraints.";
    const truncated = full + " [truncated]";
    expect(scoreQuality("generics", truncated)).toBeLessThan(
      scoreQuality("generics", full)
    );
  });

  test("response with keyword overlap scores higher than off-topic", () => {
    const prompt = "Explain async await in TypeScript";
    const relevant = "Async/await in TypeScript allows you to write asynchronous TypeScript code that reads synchronously. The async keyword marks a function as returning a Promise.";
    const irrelevant = "The weather in Paris is typically mild in spring. Visitors enjoy the Eiffel Tower and local cuisine.";
    expect(scoreQuality(prompt, relevant)).toBeGreaterThan(scoreQuality(prompt, irrelevant));
  });
});

// ── mock provider ─────────────────────────────────────────────────────────

describe("MockProvider", () => {
  test("returns structured response", async () => {
    const provider = new MockProvider("test");
    const ctx: Context = {
      messages: [{ id: "1", role: "user", content: "Hello world", timestamp: 0 }],
    };
    const result = await provider.send({ context: ctx, maxTokens: 512 });
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(
      result.usage.promptTokens + result.usage.completionTokens
    );
  });

  test("prompt tokens match estimated tokens", async () => {
    const provider = new MockProvider();
    const ctx: Context = {
      messages: [
        { id: "1", role: "system", content: "You are helpful.", timestamp: 0 },
        { id: "2", role: "user", content: "Explain generics", timestamp: 1 },
      ],
    };
    const result = await provider.send({ context: ctx, maxTokens: 512 });
    expect(result.usage.promptTokens).toBe(estimateTokens(ctx));
  });

  test("response mentions the user message content", async () => {
    const provider = new MockProvider();
    const ctx: Context = {
      messages: [
        { id: "1", role: "user", content: "unique-phrase-xyz-123", timestamp: 0 },
      ],
    };
    const result = await provider.send({ context: ctx, maxTokens: 512 });
    expect(result.content).toContain("unique-phrase-xyz-123");
  });
});

// ── runProxy ──────────────────────────────────────────────────────────────

describe("runProxy — baseline mode", () => {
  test("returns baseline result with correct shape", async () => {
    const report = await runProxy("What is dependency injection?", {
      mode: "baseline",
      provider: "mock",
      logDir: tmpLog(),
    });

    expect(report.baseline).toBeDefined();
    expect(report.optimized).toBeUndefined();
    expect(report.baseline!.mode).toBe("baseline");
    expect(report.baseline!.response.length).toBeGreaterThan(0);
    expect(report.baseline!.usage.promptTokens).toBeGreaterThan(0);
    expect(report.baseline!.qualityScore).toBeGreaterThanOrEqual(0);
    expect(report.baseline!.qualityScore).toBeLessThanOrEqual(10);
    expect(report.tokenSavingsPct).toBeUndefined();
  });
});

describe("runProxy — optimized mode", () => {
  test("returns optimized result with pipeline stats", async () => {
    const report = await runProxy("Explain the event loop in Node.js", {
      mode: "optimized",
      provider: "mock",
      memoryEnabled: false,
      logDir: tmpLog(),
    });

    expect(report.optimized).toBeDefined();
    expect(report.baseline).toBeUndefined();
    expect(report.optimized!.pipelineStats).toBeDefined();
    expect(report.optimized!.pipelineStats!.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.tokenSavingsPct).toBeUndefined();
  });
});

describe("runProxy — both mode", () => {
  test("returns both results and computes comparison metrics", async () => {
    const report = await runProxy("What are TypeScript decorators?", {
      mode: "both",
      provider: "mock",
      memoryEnabled: false,
      logDir: tmpLog(),
    });

    expect(report.baseline).toBeDefined();
    expect(report.optimized).toBeDefined();
    expect(report.tokenSavingsPct).toBeDefined();
    expect(report.qualityDelta).toBeDefined();
  });

  test("optimized compresses large context significantly", async () => {
    // Build a bloated multi-turn context
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `This is message number ${i}. `.repeat(20),
      timestamp: i * 1000,
    }));

    // Write a temp context file
    const { writeFileSync } = await import("fs");
    const ctxPath = join(tmpdir(), `ctx-${randomUUID()}.json`);
    writeFileSync(ctxPath, JSON.stringify({ messages }), "utf-8");

    const report = await runProxy("Summarize what we discussed.", {
      mode: "both",
      provider: "mock",
      contextFile: ctxPath,
      targetTokens: 200,
      memoryEnabled: false,
      logDir: tmpLog(),
    });

    const baseTokens = report.baseline!.usage.promptTokens;
    const optTokens = report.optimized!.usage.promptTokens;
    expect(optTokens).toBeLessThan(baseTokens);
    expect(report.tokenSavingsPct!).toBeGreaterThan(0);
  });

  test("qualityDelta is a finite number", async () => {
    const report = await runProxy("Hello", {
      mode: "both",
      provider: "mock",
      memoryEnabled: false,
      logDir: tmpLog(),
    });
    expect(Number.isFinite(report.qualityDelta!)).toBe(true);
  });
});

// ── logger ────────────────────────────────────────────────────────────────

describe("RunLogger", () => {
  test("saves JSON log to disk", async () => {
    const { existsSync, readFileSync } = await import("fs");
    const logDir = tmpLog();

    const report = await runProxy("Test logging", {
      mode: "baseline",
      provider: "mock",
      logDir,
    });

    // index.jsonl should exist
    expect(existsSync(join(logDir, "index.jsonl"))).toBe(true);
    // run-<id>.json should exist
    expect(existsSync(join(logDir, `run-${report.runId}.json`))).toBe(true);

    const saved = JSON.parse(
      readFileSync(join(logDir, `run-${report.runId}.json`), "utf-8")
    ) as typeof report;
    expect(saved.runId).toBe(report.runId);
    expect(saved.prompt).toBe("Test logging");
  });
});
