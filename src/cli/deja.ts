#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("deja")
  .description("Deja Context Engine — compress, deduplicate, and stabilize LLM context")
  .version("0.1.0");

program
  .command("setup")
  .description("Interactive setup wizard: configure provider, API key, and Claude Code in one go")
  .option("--port <number>", "Proxy port", "9090")
  .option("--key <key>", "API key (skip interactive prompt)")
  .action(async (opts: { port: string; key?: string }) => {
    const { setup } = await import("./commands/setup.js");
    await setup({ port: parseInt(opts.port, 10), ...(opts.key ? { key: opts.key } : {}) });
  });

program
  .command("install")
  .description("Install Deja: auto-detect Claude Code, backup settings, inject proxy config")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (opts: { port: string }) => {
    const { install } = await import("./commands/install.js");
    await install({ port: parseInt(opts.port, 10) });
  });

program
  .command("uninstall")
  .description("Remove Deja: restore Claude Code settings.json from backup or clean proxy config")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (opts: { port: string }) => {
    const { uninstall } = await import("./commands/uninstall.js");
    await uninstall({ port: parseInt(opts.port, 10) });
  });

program
  .command("doctor")
  .description("Run diagnostics: check proxy, upstream, Claude Code config")
  .option("--port <number>", "Proxy port to check", "9090")
  .action(async (opts: { port: string }) => {
    const { doctor } = await import("./commands/doctor.js");
    await doctor({ port: parseInt(opts.port, 10) });
  });

program
  .command("start")
  .description("Start the Deja proxy with improved UX")
  .option("-p, --port <number>", "Port to listen on", "9090")
  .option("-d, --daemon", "Run as background daemon (survives terminal close)")
  .option("--mode <mode>", "Compression mode: production | balanced | aggressive | demo")
  .option("--target-tokens <number>", "Soft target tokens after compression")
  .option("--max-tokens <number>", "Hard token ceiling")
  .option("-q, --quiet", "Suppress per-request logs")
  .option("--upstream <url>", "Single upstream URL")
  .option("--config <path>", "Path to config file")
  .action(async (opts) => {
    const { start } = await import("./commands/start.js");
    await start(opts);
  });

program
  .command("stop")
  .description("Stop the Deja daemon")
  .action(async () => {
    const { stop } = await import("./commands/stop.js");
    await stop();
  });

program
  .command("dashboard")
  .description("Open the Deja dashboard in your browser")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (opts: { port: string }) => {
    const { dashboard } = await import("./commands/dashboard.js");
    await dashboard({ port: parseInt(opts.port, 10) });
  });

program
  .command("status")
  .description("Show proxy status: running/stopped, upstream, token savings")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (opts: { port: string }) => {
    const { statusCmd } = await import("./commands/status.js");
    await statusCmd({ port: parseInt(opts.port, 10) });
  });

program
  .command("logs")
  .description("Show proxy logs (compression events, upstream failures, retries)")
  .option("--port <number>", "Proxy port", "9090")
  .option("--tail <number>", "Show last N lines", "100")
  .option("-f, --follow", "Follow new log entries (like tail -f)")
  .action(async (opts: { port: string; tail: string; follow: boolean }) => {
    const { logsCmd } = await import("./commands/logs.js");
    await logsCmd({
      port: parseInt(opts.port, 10),
      tail: parseInt(opts.tail, 10),
      follow: opts.follow,
    });
  });

program
  .command("service:install")
  .description("Register Deja as a Windows Service (auto-start on boot). Run as Administrator.")
  .action(async () => {
    const { registerService } = await import("../service/windows-service.js");
    await registerService();
  });

program
  .command("service:remove")
  .description("Remove the Deja Windows Service and clean up routing config.")
  .action(async () => {
    const { unregisterService } = await import("../service/windows-service.js");
    const { removeManagedSettings } = await import("./managed-settings.js");
    const cleanup = removeManagedSettings();
    if (cleanup.wasPresent) {
      console.log("  Removed managed-settings.json");
    }
    await unregisterService();
  });

program.parse();
