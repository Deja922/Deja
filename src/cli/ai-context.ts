#!/usr/bin/env tsx
import { Command } from "commander";
import { runProxy } from "../proxy/index.js";
import { MemoryStore } from "../memory/index.js";
import type { RunMode } from "../proxy/types.js";

const program = new Command();

program
  .name("ai-context")
  .description("Context Engine proxy — baseline vs optimized AI workflow testing")
  .version("0.1.0");

program
  .command("run <prompt>")
  .description("Run a prompt through the Context Engine and compare modes")
  .option("--mode <mode>", "baseline | optimized | both (default: both)", "both")
  .option("--context <file>", "Path to conversation history JSON")
  .option("--max-tokens <n>", "Hard token budget", "8000")
  .option("--target-tokens <n>", "Soft compression target", "4000")
  .option("--no-memory", "Disable semantic memory injection")
  .option("--provider <p>", "claude | openai | mock (default: claude)", "claude")
  .option("--model <m>", "Model name", "claude-sonnet-4-6")
  .action(async (prompt: string, opts: {
    mode: string;
    context?: string;
    maxTokens: string;
    targetTokens: string;
    memory: boolean;
    provider: string;
    model: string;
  }) => {
    const mode = (["baseline", "optimized", "both"].includes(opts.mode)
      ? opts.mode
      : "both") as RunMode;

    await runProxy(prompt, {
      mode,
      ...(opts.context !== undefined ? { contextFile: opts.context } : {}),
      maxTokens: parseInt(opts.maxTokens),
      targetTokens: parseInt(opts.targetTokens),
      memoryEnabled: opts.memory,
      provider: opts.provider as "claude" | "openai" | "mock",
      model: opts.model,
    });
  });

program
  .command("remember <text>")
  .description("Store text in long-term memory")
  .option("--tags <tags>", "Comma-separated tags")
  .action(async (text: string, opts: { tags?: string }) => {
    const tags = opts.tags?.split(",").map((t) => t.trim());
    const store = new MemoryStore();
    await store.store(text, tags);
    console.log(`✓ Stored: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);
  });

program
  .command("memory-clear")
  .description("Clear all stored memories")
  .action(async () => {
    await new MemoryStore().clear();
    console.log("✓ Memory cleared.");
  });

program.parse();
