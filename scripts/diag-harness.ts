import { Pipeline, loadConfig } from "../src/core/index.js";
import { estimateTokens } from "../src/cache/tokenizer.js";
import { randomUUID } from "crypto";

// Simulate 10 turns of conversation
const messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }> = [];
for (let i = 0; i < 10; i++) {
  messages.push({
    id: randomUUID(),
    role: "user",
    content: `Round ${i + 1}: Explain how the Pipeline class processes context through cleanup, ranking, compression, memory injection, and token budget enforcement.`,
    timestamp: Date.now() + i * 1000,
  });
  messages.push({
    id: randomUUID(),
    role: "assistant",
    content: `Round ${i + 1} response: The Pipeline processes messages in five stages: cleanup (dedup), ranking (score by recency/density/role/uniqueness), compression (summarize or drop), memory injection (add relevant past context), and token budget (hard truncation). Each stage is a separate class implementing a common interface.`,
    timestamp: Date.now() + i * 1000 + 500,
  });
}

const rawContext = { messages, systemPrompt: "You are a helpful TypeScript engineer." };
const rawTokens = estimateTokens(rawContext);
console.log(`Raw: ${messages.length} msgs, ${rawTokens} est tok`);

const config = await loadConfig({ maxTokens: 8000, targetTokens: 3000, memoryEnabled: true, provider: "claude", model: "claude-sonnet-4-6" });
const pipeline = new Pipeline();
const { context: compressed, stats } = await pipeline.run(rawContext, config);

console.log(`Pipeline: ${compressed.messages.length} msgs, ${stats.outputTokens} est tok, ${(stats.compressionRatio * 100).toFixed(1)}% ratio`);
console.log(`Dropped=${stats.messagesDropped} Summarized=${stats.messagesSummarized} MemHits=${stats.memoryHits}`);

// Simulate ClaudeProvider.normalizeMessages
const baselineMsgs = rawContext.messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: String(m.content ?? "") }));
const optimizedMsgs = compressed.messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: String(m.content ?? "") }));

const baseChars = baselineMsgs.reduce((s, m) => s + m.content.length, 0);
const optChars = optimizedMsgs.reduce((s, m) => s + m.content.length, 0);
console.log(`\nBaseline → API: ${baselineMsgs.length} msgs, ${baseChars} chars`);
console.log(`Optimized → API: ${optimizedMsgs.length} msgs, ${optChars} chars`);
console.log(`Char ratio: ${(optChars / Math.max(baseChars, 1) * 100).toFixed(1)}%`);

// Check system messages in optimized
const sysMsgs = compressed.messages.filter(m => m.role === "system");
if (sysMsgs.length > 0) {
  console.log(`\nSystem msgs: ${sysMsgs.length}, ${sysMsgs.reduce((s,m) => s + m.content.length, 0)} chars`);
}
