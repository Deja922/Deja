#!/usr/bin/env tsx
import { Command } from "commander";
import { readFileSync } from "fs";
import { Pipeline, loadConfig } from "../core/index.js";
import { MemoryStore } from "../memory/index.js";
import type { Context } from "../types/index.js";

const program = new Command();

program
  .name("ctx")
  .description("AI Context Engine — compress, rank, and manage AI context")
  .version("0.1.0");

program
  .command("compress")
  .description("Compress a JSON context file and print stats")
  .argument("<file>", "Path to context JSON file")
  .option("--max-tokens <n>", "Hard token budget", "8000")
  .option("--target-tokens <n>", "Soft compression target", "4000")
  .option("--memory", "Enable semantic memory injection")
  .action(async (file: string, opts: { maxTokens: string; targetTokens: string; memory?: boolean }) => {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Context;
    const config = await loadConfig({
      maxTokens: parseInt(opts.maxTokens),
      targetTokens: parseInt(opts.targetTokens),
      memoryEnabled: opts.memory ?? false,
    });
    const pipeline = new Pipeline();
    const result = await pipeline.run(raw, config);

    console.log("\n── Result ──────────────────────────────────────");
    console.log(`Messages:    ${result.context.messages.length} (was ${raw.messages.length})`);
    console.log(`Tokens:      ${result.stats.outputTokens} (was ${result.stats.originalTokens})`);
    console.log(`Ratio:       ${(result.stats.compressionRatio * 100).toFixed(1)}%`);
    console.log(`Dropped:     ${result.stats.messagesDropped}`);
    console.log(`Summarized:  ${result.stats.messagesSummarized}`);
    console.log(`Memory hits: ${result.stats.memoryHits}`);
    console.log(`Duration:    ${result.stats.durationMs}ms`);
    console.log("────────────────────────────────────────────────\n");
  });

program
  .command("remember")
  .description("Store text in long-term memory")
  .argument("<text>", "Text to remember")
  .option("--tags <tags>", "Comma-separated tags")
  .action(async (text: string, opts: { tags?: string }) => {
    const tags = opts.tags?.split(",").map((t) => t.trim());
    const store = new MemoryStore();
    await store.store(text, tags);
    console.log(`✓ Stored in memory: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);
  });

program
  .command("memory-clear")
  .description("Clear all stored memories")
  .action(async () => {
    const store = new MemoryStore();
    await store.clear();
    console.log("✓ Memory cleared.");
  });

program.parse();
