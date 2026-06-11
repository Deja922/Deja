import { describe, expect, test } from "vitest";
import http from "http";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { writeFileSync, rmSync } from "fs";
import { scoreQuality } from "../src/proxy/quality.js";
import { MockProvider } from "../src/proxy/mock-provider.js";
import { runProxy } from "../src/proxy/runner.js";
import { startProxy } from "../src/proxy/server.js";
import { estimateTokens } from "../src/cache/tokenizer.js";
import { AnthropicAdapter, hasProtocolBlocks, cleanContentForResend } from "../src/proxy/adapters/anthropic.js";
import { UpstreamResolver } from "../src/proxy/upstream-resolver.js";
import type { Context } from "../src/types/index.js";

function tmpSettings(content: unknown): string {
  const path = join(tmpdir(), `deja-settings-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(content), "utf-8");
  return path;
}

function tmpLog(): string {
  return join(tmpdir(), `ctx-proxy-test-${randomUUID()}`);
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function readRequest(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
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

// ── protocol blocks (thinking mode) ────────────────────────────────────────

describe("AnthropicAdapter — thinking mode protocol blocks", () => {
  const adapter = new AnthropicAdapter();

  test("requestToContext detects hasProtocolBlocks for thinking messages", () => {
    const { records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll think about this." },
            { type: "thinking", thinking: "Internal reasoning..." },
            { type: "signature", signature: "sig_xyz" },
            { type: "text", text: "Here is my answer." },
          ],
        },
      ],
    });

    expect(records[0]!.hasProtocolBlocks).toBeFalsy();
    expect(records[1]!.hasProtocolBlocks).toBe(true);
    expect(records[1]!.hasStructuredBlocks).toBe(false); // no tool_use/tool_result
  });

  test("requestToContext extracts only text content (strips thinking blocks)", () => {
    const { records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Visible reasoning." },
            { type: "thinking", thinking: "Hidden thinking." },
            { type: "redacted_thinking", data: "encrypted" },
            { type: "text", text: "Final answer." },
          ],
        },
      ],
    });

    // Only user-visible text should be extracted for compression
    expect(records[0]!.text).not.toContain("Hidden thinking.");
    expect(records[0]!.text).toContain("Visible reasoning.");
    expect(records[0]!.text).toContain("Final answer.");
  });

  test("contextToRequest preserves thinking blocks in the active tool-use turn", () => {
    const { context, records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Internal...", signature: "sig_abc" },
            { type: "text", text: "I'll read the file." },
            { type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/f" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "data" }],
        },
      ],
    });

    // Simulate compression replacing the extracted text
    context.messages[1]!.content = "Compressed.";
    context.messages[1]!.summary = "Compressed.";

    const rebuilt = adapter.contextToRequest(context, records, {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      thinking: { type: "enabled", budget_tokens: 1024 },
    }) as { messages: Array<{ role: string; content: unknown }> };

    const assistantMsg = rebuilt.messages.find(
      (m) => m.role === "assistant" && Array.isArray(m.content),
    );
    expect(assistantMsg).toBeDefined();

    const blocks = assistantMsg!.content as Array<{ type: string }>;
    // Active tool-use turn keeps its thinking block (required by the API)
    expect(blocks.some((b) => b.type === "thinking")).toBe(true);
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
  });

  test("contextToRequest strips thinking blocks when thinking is not enabled", () => {
    const { context, records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Internal...", signature: "sig_abc" },
            { type: "text", text: "Answer." },
          ],
        },
      ],
    });

    context.messages[1]!.content = "Compressed.";
    context.messages[1]!.summary = "Compressed.";

    const rebuilt = adapter.contextToRequest(context, records, {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
    }) as { messages: Array<{ role: string; content: unknown }> };

    const assistantMsg = rebuilt.messages.find(
      (m) => m.role === "assistant" && Array.isArray(m.content),
    );
    expect(assistantMsg).toBeDefined();

    const blocks = assistantMsg!.content as Array<{ type: string }>;
    // No thinking param → stale-signature safety strips thinking blocks
    expect(blocks.some((b) => b.type === "thinking")).toBe(false);
    expect(blocks.some((b) => b.type === "text")).toBe(true);
  });

  test("contextToRequest strips thinking from historical (non-active) turns", () => {
    const { context, records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        { role: "user", content: "First question." },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Old reasoning", signature: "stale_sig" },
            { type: "text", text: "First answer." },
          ],
        },
        { role: "user", content: "Second question." },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "New reasoning", signature: "fresh_sig" },
            { type: "text", text: "Second answer." },
          ],
        },
      ],
    });

    const rebuilt = adapter.contextToRequest(context, records, {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      thinking: { type: "enabled", budget_tokens: 1024 },
    }) as { messages: Array<{ role: string; content: unknown }> };

    const assistantMsgs = rebuilt.messages.filter(
      (m) => m.role === "assistant" && Array.isArray(m.content),
    );
    // Historical assistant turn (no tool_use, not the active turn) loses thinking
    const firstBlocks = assistantMsgs[0]!.content as Array<{ type: string }>;
    expect(firstBlocks.some((b) => b.type === "thinking")).toBe(false);
    // Final assistant turn has no tool_use either → thinking also stripped
    const lastBlocks = assistantMsgs[assistantMsgs.length - 1]!.content as Array<{ type: string }>;
    expect(lastBlocks.some((b) => b.type === "thinking")).toBe(false);
  });

  test("contextToRequest drops text-only messages that were compressed away", () => {
    const { context, records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "This is a text-only response." },
        { role: "user", content: "Follow up." },
      ],
    });

    // Drop the first user message
    context.messages = context.messages.slice(1);

    const rebuilt = adapter.contextToRequest(context, records, {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
    }) as { messages: Array<{ role: string; content: unknown }> };

    // Dropped text-only message should not appear
    const helloMsg = rebuilt.messages.find(
      (m) => typeof m.content === "string" && m.content === "Hello",
    );
    expect(helloMsg).toBeUndefined();
  });

  test("contextToRequest preserves tool messages without text compression", () => {
    const { context, records } = adapter.requestToContext({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: "Use tool.",
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Calling tool." },
            { type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/file" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "file content here" },
          ],
        },
      ],
    });

    context.messages[1]!.content = "Compressed text.";
    context.messages[1]!.summary = "Compressed text.";
    context.messages[2]!.content = "Compressed tool result.";
    context.messages[2]!.summary = "Compressed tool result.";

    const rebuilt = adapter.contextToRequest(context, records, {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
    }) as { messages: Array<{ role: string; content: unknown }> };

    const assistantBlocks = rebuilt.messages.find((m) => m.role === "assistant")!.content as Array<{ type: string; name?: string }>;
    expect(assistantBlocks.some((b) => b.type === "tool_use")).toBe(true);
    // Tool text should NOT be compressed (intact for critical tool content)
    expect(assistantBlocks.some((b) => b.type === "text")).toBe(true);

    // The last user message has the tool_result — find it
    const userMsgs = rebuilt.messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeGreaterThanOrEqual(2);
    const toolResultContent = userMsgs[userMsgs.length - 1]!.content;
    expect(Array.isArray(toolResultContent)).toBe(true);
    expect((toolResultContent as Array<{ type: string }>).some((b) => b.type === "tool_result")).toBe(true);
  });
});

describe("cleanContentForResend", () => {
  test("preserves thinking block", () => {
    const result = cleanContentForResend([
      { type: "text", text: "Hello" },
      { type: "thinking", thinking: "internal..." },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const blocks = result as Array<{ type: string }>;
    expect(blocks.find((b) => b.type === "thinking")).toBeDefined();
    expect(blocks.find((b) => b.type === "text")).toBeDefined();
  });

  test("preserves signature block", () => {
    const result = cleanContentForResend([
      { type: "text", text: "Hello" },
      { type: "signature", signature: "sig_abc" },
    ]);
    const blocks = result as Array<{ type: string }>;
    expect(blocks.find((b) => b.type === "signature")).toBeDefined();
  });

  test("preserves redacted_thinking block", () => {
    const result = cleanContentForResend([
      { type: "text", text: "Hello" },
      { type: "redacted_thinking", data: "encrypted" },
    ]);
    const blocks = result as Array<{ type: string }>;
    expect(blocks.find((b) => b.type === "redacted_thinking")).toBeDefined();
  });

  test("preserves tool_use block", () => {
    const result = cleanContentForResend([
      { type: "text", text: "Using tool." },
      { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
    ]);
    const blocks = result as Array<{ type: string }>;
    expect(blocks.find((b) => b.type === "tool_use")).toBeDefined();
  });

  test("preserves all blocks together", () => {
    const result = cleanContentForResend([
      { type: "text", text: "Thinking..." },
      { type: "thinking", thinking: "internal" },
      { type: "signature", signature: "sig_1" },
      { type: "text", text: "Final." },
      { type: "redacted_thinking", data: "enc" },
      { type: "tool_use", id: "tu_1", name: "X", input: {} },
    ]);
    const blocks = result as Array<{ type: string }>;
    expect(blocks.find((b) => b.type === "text")).toBeDefined();
    expect(blocks.find((b) => b.type === "thinking")).toBeDefined();
    expect(blocks.find((b) => b.type === "signature")).toBeDefined();
    expect(blocks.find((b) => b.type === "redacted_thinking")).toBeDefined();
    expect(blocks.find((b) => b.type === "tool_use")).toBeDefined();
  });

  test("string content passes through unchanged", () => {
    expect(cleanContentForResend("hello world")).toBe("hello world");
  });

  test("empty array returns fallback text block", () => {
    const result = cleanContentForResend([]);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ type: string }>)[0]!.type).toBe("text");
  });
});

describe("hasProtocolBlocks", () => {
  test("returns true when content has thinking", () => {
    expect(hasProtocolBlocks([{ type: "thinking", thinking: "x" }])).toBe(true);
  });

  test("returns true when content has signature", () => {
    expect(hasProtocolBlocks([{ type: "signature", signature: "x" }])).toBe(true);
  });

  test("returns true when content has redacted_thinking", () => {
    expect(hasProtocolBlocks([{ type: "redacted_thinking", data: "x" }])).toBe(true);
  });

  test("returns false for string content", () => {
    expect(hasProtocolBlocks("hello")).toBe(false);
  });

  test("returns false for text-only blocks", () => {
    expect(hasProtocolBlocks([{ type: "text", text: "hi" }])).toBe(false);
  });

  test("returns false for tool blocks", () => {
    expect(hasProtocolBlocks([{ type: "tool_use", id: "x", name: "X", input: {} }])).toBe(false);
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

describe("startProxy HTTP forwarding", () => {
  test("preserves Anthropic structured content blocks and upstream base path", async () => {
    let capturedPath = "";
    let capturedBody = "";

    const upstream = http.createServer(async (req, res) => {
      capturedPath = req.url ?? "";
      capturedBody = await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_test", type: "message", content: [] }));
    });

    const upstreamPort = await listen(upstream);
    const proxy = startProxy({
      port: 0,
      upstream: `http://127.0.0.1:${upstreamPort}/anthropic`,
      targetTokens: 120,
      maxTokens: 300,
      verbose: false,
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    const toolUse = {
      type: "tool_use",
      id: "toolu_123",
      name: "Read",
      input: { file_path: "src/index.ts" },
    };
    const toolResult = {
      type: "tool_result",
      tool_use_id: "toolu_123",
      content: "file contents",
    };

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        system: [{ type: "text", text: "You are a coding agent.", cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: "Please inspect the project carefully. ".repeat(120),
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "I will inspect it." }, toolUse],
          },
          {
            role: "user",
            content: [toolResult],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedPath).toBe("/anthropic/v1/messages");

    const forwarded = JSON.parse(capturedBody) as {
      system: unknown;
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(forwarded.system).toEqual([
      { type: "text", text: "You are a coding agent.", cache_control: { type: "ephemeral" } },
    ]);
    expect(forwarded.messages.some((message) =>
      Array.isArray(message.content) &&
      message.content.some((block: { type?: string }) => block.type === "tool_use")
    )).toBe(true);
    expect(forwarded.messages.some((message) =>
      Array.isArray(message.content) &&
      message.content.some((block: { type?: string }) => block.type === "tool_result")
    )).toBe(true);

    await close(proxy);
    await close(upstream);
  });

  test("preserves thinking block in the active tool-use turn when thinking enabled", async () => {
    let capturedBody = "";

    const upstream = http.createServer(async (req, res) => {
      capturedBody = await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_test", type: "message", content: [] }));
    });

    const upstreamPort = await listen(upstream);
    const proxy = startProxy({
      port: 0,
      upstream: `http://127.0.0.1:${upstreamPort}`,
      targetTokens: 120,
      maxTokens: 300,
      verbose: false,
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        thinking: { type: "enabled", budget_tokens: 1024 },
        messages: [
          {
            role: "user",
            content: "Solve a complex math problem step by step. ".repeat(20),
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "First, break the problem down...", signature: "sig_abc123" },
              { type: "text", text: "Let me compute this." },
              { type: "tool_use", id: "toolu_1", name: "Calc", input: { expr: "6*7" } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "42" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const forwarded = JSON.parse(capturedBody) as {
      messages: Array<{ role: string; content: Array<{ type: string }> }>;
    };

    const assistantMsg = forwarded.messages.find(
      (m) => m.role === "assistant" && Array.isArray(m.content),
    );
    expect(assistantMsg).toBeDefined();

    const blocks = assistantMsg!.content;
    // Active tool-use turn must keep its thinking block (API requires it)
    expect(blocks.some((b) => b.type === "thinking")).toBe(true);
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);

    await close(proxy);
    await close(upstream);
  });

  test("strips stale thinking/redacted_thinking from historical turns (cross-provider safety)", async () => {
    let capturedBody = "";

    const upstream = http.createServer(async (req, res) => {
      capturedBody = await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_test", type: "message", content: [] }));
    });

    const upstreamPort = await listen(upstream);
    const proxy = startProxy({
      port: 0,
      upstream: `http://127.0.0.1:${upstreamPort}`,
      targetTokens: 300,
      maxTokens: 600,
      verbose: false,
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        thinking: { type: "enabled", budget_tokens: 1024 },
        messages: [
          {
            role: "user",
            content: "Continue our thinking chain session. ".repeat(30),
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "old reasoning", signature: "stale_sig_from_other_provider" },
              { type: "redacted_thinking", data: "encrypted_think_data_xyz" },
              { type: "text", text: "Previous answer." },
            ],
          },
          {
            role: "user",
            content: "Now answer this follow-up question please. ".repeat(10),
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Final answer with no tool use." }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const forwarded = JSON.parse(capturedBody) as {
      messages: Array<{ role: string; content: string | Array<{ type: string }> }>;
    };

    // No thinking or redacted_thinking should survive — none of these turns is
    // an active tool-use turn, so their (potentially stale) signatures are dropped.
    for (const m of forwarded.messages) {
      if (Array.isArray(m.content)) {
        expect(m.content.some((b) => b.type === "thinking")).toBe(false);
        expect(m.content.some((b) => b.type === "redacted_thinking")).toBe(false);
      }
    }

    await close(proxy);
    await close(upstream);
  });

  test("never forwards an empty messages array (large system prompt + droppable messages)", async () => {
    let capturedBody = "";

    const upstream = http.createServer(async (req, res) => {
      capturedBody = await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_test", type: "message", content: [] }));
    });

    const upstreamPort = await listen(upstream);
    const proxy = startProxy({
      port: 0,
      upstream: `http://127.0.0.1:${upstreamPort}`,
      targetTokens: 120,
      maxTokens: 300,
      verbose: false,
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    // A large system prompt alone pushes the request over the compression
    // threshold, while the only message has empty (whitespace) text that the
    // relevance filter drops — historically this produced messages: [].
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        system: "You are a coding agent. ".repeat(80),
        messages: [{ role: "user", content: "   " }],
      }),
    });

    expect(response.status).toBe(200);
    const forwarded = JSON.parse(capturedBody) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    // The forwarded request must always carry at least one message.
    expect(Array.isArray(forwarded.messages)).toBe(true);
    expect(forwarded.messages.length).toBeGreaterThanOrEqual(1);

    await close(proxy);
    await close(upstream);
  });
});

// ── upstream resolver (CC Switch follow mode) ───────────────────────────────

describe("UpstreamResolver", () => {
  test("reads env.ANTHROPIC_BASE_URL from settings.json", () => {
    const path = tmpSettings({ env: { ANTHROPIC_BASE_URL: "https://aihubmix.com" } });
    const resolver = new UpstreamResolver({
      settingsPath: path,
      fallback: { baseUrl: "https://api.anthropic.com" },
      selfPort: 9090,
    });
    expect(resolver.getProvider().baseUrl).toBe("https://aihubmix.com");
    // Key must never be stored — it is passed through from request headers.
    expect(resolver.getProvider().apiKey).toBeUndefined();
    rmSync(path);
  });

  test("reads top-level ANTHROPIC_BASE_URL when no env block", () => {
    const path = tmpSettings({ ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic" });
    const resolver = new UpstreamResolver({
      settingsPath: path,
      fallback: { baseUrl: "https://api.anthropic.com" },
      selfPort: 9090,
    });
    expect(resolver.getProvider().baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(resolver.getProvider().compatMode).toBe("anthropic");
    rmSync(path);
  });

  test("falls back when settings file is missing", () => {
    const resolver = new UpstreamResolver({
      settingsPath: join(tmpdir(), `does-not-exist-${randomUUID()}.json`),
      fallback: { baseUrl: "https://fallback.example.com" },
      selfPort: 9090,
    });
    expect(resolver.getProvider().baseUrl).toBe("https://fallback.example.com");
  });

  test("falls back when settings file is malformed JSON", () => {
    const path = join(tmpdir(), `deja-bad-${randomUUID()}.json`);
    writeFileSync(path, "{not valid json", "utf-8");
    const resolver = new UpstreamResolver({
      settingsPath: path,
      fallback: { baseUrl: "https://fallback.example.com" },
      selfPort: 9090,
    });
    expect(resolver.getProvider().baseUrl).toBe("https://fallback.example.com");
    rmSync(path);
  });

  test("strips a UTF-8 BOM before parsing", () => {
    const path = join(tmpdir(), `deja-bom-${randomUUID()}.json`);
    writeFileSync(path, "﻿" + JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://aihubmix.com" } }), "utf-8");
    const resolver = new UpstreamResolver({
      settingsPath: path,
      fallback: { baseUrl: "https://api.anthropic.com" },
      selfPort: 9090,
    });
    expect(resolver.getProvider().baseUrl).toBe("https://aihubmix.com");
    rmSync(path);
  });

  test("ignores a self-referential URL to avoid forwarding loops", () => {
    const path = tmpSettings({ env: { ANTHROPIC_BASE_URL: "http://localhost:9090" } });
    const resolver = new UpstreamResolver({
      settingsPath: path,
      fallback: { baseUrl: "https://fallback.example.com" },
      selfPort: 9090,
    });
    // Must NOT forward to itself — uses the fallback instead.
    expect(resolver.getProvider().baseUrl).toBe("https://fallback.example.com");
    rmSync(path);
  });

  test("hot-reloads when settings.json changes", async () => {
    const path = tmpSettings({ env: { ANTHROPIC_BASE_URL: "https://first.example.com" } });
    let changed: string | null = null;
    const resolver = new UpstreamResolver({
      settingsPath: path,
      fallback: { baseUrl: "https://api.anthropic.com" },
      selfPort: 9090,
      onChange: (next) => { changed = next.baseUrl; },
    });
    expect(resolver.getProvider().baseUrl).toBe("https://first.example.com");

    resolver.start();
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(path, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://second.example.com" } }), "utf-8");

    await new Promise((r) => setTimeout(r, 2600)); // > REFRESH_INTERVAL (2s)
    resolver.stop();

    expect(resolver.getProvider().baseUrl).toBe("https://second.example.com");
    expect(changed).toBe("https://second.example.com");
    rmSync(path);
  }, 8000);
});

describe("startProxy follow mode (settings.json)", () => {
  test("forwards to the upstream named in a mock settings.json with key passthrough", async () => {
    let capturedPath = "";
    let capturedAuth = "";

    const upstream = http.createServer(async (req, res) => {
      capturedPath = req.url ?? "";
      capturedAuth = String(req.headers["x-api-key"] ?? "");
      await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_test", type: "message", content: [] }));
    });

    const upstreamPort = await listen(upstream);
    const settingsPath = tmpSettings({
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamPort}` },
    });

    // No --upstream → follow mode reads the mock settings.json.
    const proxy = startProxy({
      port: 0,
      verbose: false,
      claudeSettingsPath: settingsPath,
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "user-key-123" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        messages: [{ role: "user", content: "Inspect the project carefully. ".repeat(120) }],
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedPath).toBe("/v1/messages");
    // Key passthrough: the user's own key reaches the upstream unchanged.
    expect(capturedAuth).toBe("user-key-123");

    await close(proxy);
    await close(upstream);
    rmSync(settingsPath);
  });

  test("keeps OpenAI /v1/responses on static provider while Claude follows settings.json", async () => {
    let claudeHits = 0;
    let codexPath = "";
    let codexAuth = "";

    const claudeUpstream = http.createServer(async (req, res) => {
      claudeHits += 1;
      await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_claude", type: "message", content: [] }));
    });

    const codexUpstream = http.createServer(async (req, res) => {
      codexPath = req.url ?? "";
      codexAuth = String(req.headers["x-api-key"] ?? "");
      await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "resp_test", object: "response", output: [] }));
    });

    const claudePort = await listen(claudeUpstream);
    const codexPort = await listen(codexUpstream);
    const settingsPath = tmpSettings({
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudePort}` },
    });

    const proxy = startProxy({
      port: 0,
      verbose: false,
      claudeSettingsPath: settingsPath,
      config: {
        port: 0,
        pipeline: {
          maxTokens: 8000,
          targetTokens: 4000,
          rankingThreshold: 0.3,
          memoryEnabled: false,
          memoryTopK: 5,
          compressThreshold: 200,
        },
        providers: {
          codex: {
            baseUrl: `http://127.0.0.1:${codexPort}`,
            compatMode: "openai",
          },
        },
        defaultProvider: "codex",
      },
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "codex-user-key" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "Ping",
      }),
    });

    expect(response.status).toBe(200);
    expect(codexPath).toBe("/v1/responses");
    expect(codexAuth).toBe("codex-user-key");
    expect(claudeHits).toBe(0);

    await close(proxy);
    await close(claudeUpstream);
    await close(codexUpstream);
    rmSync(settingsPath);
  });

  test("routes OpenAI /v1/responses to an OpenAI-compatible provider even when default is anthropic", async () => {
    let claudeHits = 0;
    let codexPath = "";

    const claudeUpstream = http.createServer(async (req, res) => {
      claudeHits += 1;
      await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_claude", type: "message", content: [] }));
    });

    const codexUpstream = http.createServer(async (req, res) => {
      codexPath = req.url ?? "";
      await readRequest(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "resp_test", object: "response", output: [] }));
    });

    const claudePort = await listen(claudeUpstream);
    const codexPort = await listen(codexUpstream);
    const settingsPath = tmpSettings({
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudePort}` },
    });

    const proxy = startProxy({
      port: 0,
      verbose: false,
      claudeSettingsPath: settingsPath,
      config: {
        port: 0,
        pipeline: {
          maxTokens: 8000,
          targetTokens: 4000,
          rankingThreshold: 0.3,
          memoryEnabled: false,
          memoryTopK: 5,
          compressThreshold: 200,
        },
        providers: {
          claude: {
            baseUrl: `http://127.0.0.1:${claudePort}`,
            compatMode: "anthropic",
          },
          codex: {
            baseUrl: `http://127.0.0.1:${codexPort}`,
            compatMode: "openai",
          },
        },
        defaultProvider: "claude",
      },
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.on("listening", () => {
        const address = proxy.address();
        if (typeof address === "object" && address) resolve(address.port);
      });
    });

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "codex-user-key" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "Ping",
      }),
    });

    expect(response.status).toBe(200);
    expect(codexPath).toBe("/v1/responses");
    expect(claudeHits).toBe(0);

    await close(proxy);
    await close(claudeUpstream);
    await close(codexUpstream);
    rmSync(settingsPath);
  });
});
