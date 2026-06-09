#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Command } from "commander";
import { startProxy } from "../proxy/server.js";
import type { RuntimeConfig } from "../proxy/config-types.js";
import { DEFAULT_CONFIG } from "../proxy/config-types.js";

const DEFAULT_CONFIG_PATH = join(homedir(), ".deja", "config.json");

function loadConfigFile(path?: string): RuntimeConfig | undefined {
  const configPath = path ?? DEFAULT_CONFIG_PATH;
  if (!existsSync(configPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<RuntimeConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    process.stderr.write(`[deja] failed to parse config: ${configPath}\n`);
    return undefined;
  }
}

const program = new Command();

program
  .name("deja-proxy")
  .description("Deja local AI workflow runtime — multi-provider context optimization proxy")
  .option("-p, --port <number>", "Port to listen on")
  .option("--target-tokens <number>", "Soft target tokens after compression")
  .option("--max-tokens <number>", "Hard token ceiling")
  .option("-q, --quiet", "Suppress per-request logs")
  .option("--upstream <url>", "Single upstream URL (simple mode, bypasses providers config)")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .action((opts) => {
    const config = loadConfigFile(opts.config) ?? DEFAULT_CONFIG;

    startProxy({
      port: opts.port ? parseInt(opts.port, 10) : undefined,
      targetTokens: opts.targetTokens ? parseInt(opts.targetTokens, 10) : undefined,
      maxTokens: opts.maxTokens ? parseInt(opts.maxTokens, 10) : undefined,
      verbose: !opts.quiet,
      upstream: opts.upstream ?? undefined,
      config,
    });
  });

program.parse();
