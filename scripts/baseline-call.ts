import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";

const raw = JSON.parse(readFileSync("examples/life-sim-context.json", "utf-8"));
const client = new Anthropic();

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  直接调用 Claude（Baseline）— 无任何处理");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

const t0 = Date.now();
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2048,
  system: raw.systemPrompt,
  messages: raw.messages.map((m: any) => ({ role: m.role, content: m.content })),
});
const latency = Date.now() - t0;

const content = response.content[0]?.type === "text" ? response.content[0].text : "";
const inputTokens = response.usage.input_tokens;
const outputTokens = response.usage.output_tokens;

console.log("── 输出 ─────────────────────────────────────────\n");
console.log(content);
console.log("\n── Token 统计 ───────────────────────────────────");
console.log(`Input tokens:   ${inputTokens}`);
console.log(`Output tokens:  ${outputTokens}`);
console.log(`Total tokens:   ${inputTokens + outputTokens}`);
console.log(`Latency:        ${latency}ms`);
console.log(`Prompt chars:   ${raw.systemPrompt.length + raw.messages[0].content.length}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
