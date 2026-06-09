import Anthropic from "@anthropic-ai/sdk";
import { Pipeline, loadConfig } from "../src/core/index.js";
import { estimateTokens } from "../src/cache/tokenizer.js";
import { randomUUID } from "crypto";

const client = new Anthropic();

// Simulate 5 turns like the benchmark
const messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }> = [];
for (let i = 0; i < 5; i++) {
  messages.push({
    id: randomUUID(),
    role: "user",
    content: `Round ${i + 1}: Design a TypeScript interface for a context compression pipeline. Include cleanup, ranking, compression, memory injection, and token budget stages.`,
    timestamp: Date.now() + i * 1000,
  });
  messages.push({
    id: randomUUID(),
    role: "assistant",
    content: `Round ${i + 1} answer: The Pipeline should have five stages. Cleanup removes duplicates via exact match. Ranking uses a weighted function (recency 40%, density 30%, role 20%, uniqueness 10%) to score each message. Compression drops messages below a score threshold and summarizes those in the middle. Memory injection prepends relevant context from a persistent store. Token budget enforces a hard ceiling by truncating oldest messages first.`,
    timestamp: Date.now() + i * 1000 + 500,
  });
}

const rawContext = { messages, systemPrompt: "You are a senior TypeScript engineer." };

// Baseline call
const baseClean = messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
const baseResp = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 50,
  messages: baseClean,
  system: rawContext.systemPrompt,
});

// Optimized call (pipeline compress)
const config = await loadConfig({ maxTokens: 8000, targetTokens: 3000, memoryEnabled: true, provider: "claude", model: "claude-sonnet-4-6" });
const pipeline = new Pipeline();
const { context: compressed, stats } = await pipeline.run(rawContext, config);

const optClean = compressed.messages.filter(m => m.role !== "system").map(m => ({ role: m.role as "user" | "assistant", content: String(m.content ?? "") }));
const optResp = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 50,
  messages: optClean,
  system: compressed.systemPrompt ?? undefined,
});

console.log(`=== Comparison ===`);
console.log(`Baseline: ${baseClean.length} msgs → API input_tokens=${baseResp.usage.input_tokens}`);
console.log(`Optimized: ${optClean.length} msgs → API input_tokens=${optResp.usage.input_tokens}`);
console.log(`Pipeline est: raw=${stats.originalTokens} → output=${stats.outputTokens}`);
console.log(`Dropped=${stats.messagesDropped} Summarized=${stats.messagesSummarized}`);
console.log(`\nAPI token ratio: ${(optResp.usage.input_tokens / Math.max(baseResp.usage.input_tokens, 1) * 100).toFixed(1)}%`);
console.log(`Baseline chars: ${baseClean.reduce((s,m) => s + m.content.length, 0)}`);
console.log(`Optimized chars: ${optClean.reduce((s,m) => s + m.content.length, 0)}`);
