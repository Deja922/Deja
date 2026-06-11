#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("deja")
  .description("Deja Context Engine - compress, deduplicate, and stabilize LLM context")
  .version("0.1.2");

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
  .command("key:update")
  .description("Rotate API key and sync runtime config across all mirrors")
  .requiredOption("--key <key>", "New API key")
  .option("--upstream <url>", "Optional upstream URL override")
  .option("--provider <name>", "Optional provider name override")
  .option("--skip-health-check", "Skip upstream health check before writing")
  .action(async (opts: { key: string; upstream?: string; provider?: string; skipHealthCheck?: boolean }) => {
    const { keyUpdate } = await import("./commands/key-update.js");
    await keyUpdate({
      key: opts.key,
      ...(opts.upstream ? { upstream: opts.upstream } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
      skipHealthCheck: Boolean(opts.skipHealthCheck),
    });
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
  .command("bypass <state>")
  .description("Pause/resume compression without stopping the proxy (on | off)")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (state: string, opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    const normalized = state.toLowerCase();
    if (normalized !== "on" && normalized !== "off") {
      console.error("Invalid state. Use: deja bypass on | deja bypass off");
      process.exit(1);
    }

    const endpoint = normalized === "on" ? "/deja/bypass" : "/deja/resume";
    const url = `http://127.0.0.1:${port}${endpoint}`;

    try {
      const resp = await fetch(url, { method: "POST" });
      if (!resp.ok) {
        console.error(`Failed to set bypass (${resp.status} ${resp.statusText})`);
        process.exit(1);
      }

      if (normalized === "on") {
        console.log("Compression paused (bypass enabled).");
      } else {
        console.log("Compression resumed.");
      }
    } catch (err) {
      console.error(`Cannot reach Deja on port ${port}: ${(err as Error).message}`);
      process.exit(1);
    }
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
  .description("Register Deja as a system daemon (Windows Service / macOS LaunchAgent). Run as Administrator on Windows.")
  .action(async () => {
    if (process.platform === "win32") {
      const { registerService } = await import("../service/windows-service.js");
      await registerService();
    } else if (process.platform === "darwin") {
      const { registerDaemon } = await import("../service/macos-daemon.js");
      await registerDaemon();
    } else {
      console.error("service:install is not yet supported on this platform. Use `deja start --daemon` instead.");
      process.exit(1);
    }
  });

program
  .command("service:remove")
  .description("Remove the Deja system daemon and clean up routing config.")
  .action(async () => {
    const { removeManagedSettings } = await import("./managed-settings.js");
    const cleanup = removeManagedSettings();
    if (cleanup.wasPresent) {
      console.log("  Removed managed-settings.json");
    }
    if (process.platform === "win32") {
      const { unregisterService } = await import("../service/windows-service.js");
      await unregisterService();
    } else if (process.platform === "darwin") {
      const { unregisterDaemon } = await import("../service/macos-daemon.js");
      await unregisterDaemon();
    } else {
      console.error("service:remove is not yet supported on this platform.");
      process.exit(1);
    }
  });

program
  .command("tools:list")
  .description("List detected AI tools and their Deja routing status")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (opts: { port: string }) => {
    const { toolsList } = await import("./commands/tools.js");
    toolsList(parseInt(opts.port, 10));
  });

program
  .command("tools:install <tool>")
  .description("Configure tool to route via Deja (cursor | continue | codex | all)")
  .option("--port <number>", "Proxy port", "9090")
  .action(async (tool: string, opts: { port: string }) => {
    const { toolsInstall } = await import("./commands/tools.js");
    toolsInstall(tool, parseInt(opts.port, 10));
  });

program
  .command("license:activate <key>")
  .description("Activate Deja with a license key")
  .action(async (key: string) => {
    const { validateKey, saveLicense } = await import("./license.js");
    const status = validateKey(key);
    if (!status.valid) {
      if (status.reason === "invalid key format") {
        console.error("  ERROR  Invalid key format. Key should start with DEJA-.");
      } else if (status.reason === "key expired") {
        const exp = status.expiry ? new Date(status.expiry).toLocaleDateString("zh-CN") : "unknown";
        console.error(`  ERROR  Key expired (expiry: ${exp}).`);
      } else if (status.reason === "signature invalid") {
        console.error("  ERROR  Invalid key signature. Key may be tampered or for another version.");
      } else {
        console.error(`  ERROR  Activation failed: ${status.reason}`);
      }
      process.exit(1);
    }
    saveLicense(key);
    const expiry = new Date(status.expiry!).toLocaleDateString("zh-CN");
    console.log("  OK  License activated");
    console.log(`     Tier   : ${(status.tier ?? "").toUpperCase()}`);
    console.log(`     Email  : ${status.email}`);
    console.log(`     Expiry : ${expiry}`);
    console.log("     Note  : Restart Deja service if it is currently running.");
  });

program
  .command("license:redeem <code>")
  .description("Redeem purchase/trial code and activate license automatically")
  .option("--endpoint <url>", "Redeem API endpoint (default: DEJA_LICENSE_REDEEM_ENDPOINT or built-in)")
  .option("--email <email>", "Optional account email for redeem verification")
  .option("--phone <phone>", "Optional account phone for redeem verification")
  .option("--device-id <id>", "Optional explicit device id (advanced)")
  .option("--timeout-ms <ms>", "HTTP timeout in milliseconds", "12000")
  .action(async (code: string, opts: { endpoint?: string; email?: string; phone?: string; deviceId?: string; timeoutMs: string }) => {
    const { redeemLicense } = await import("./commands/license-redeem.js");
    const parsedTimeout = parseInt(opts.timeoutMs, 10);
    await redeemLicense(code, {
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.email ? { email: opts.email } : {}),
      ...(opts.phone ? { phone: opts.phone } : {}),
      ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
      timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 12000,
    });
  });

program
  .command("license:status")
  .description("Show current license status")
  .action(async () => {
    const { getLicenseStatus } = await import("./license.js");
    const status = getLicenseStatus();
    if (!status.valid) {
      console.log(`  License: FREE (${status.reason})`);
    } else {
      const expiry = new Date(status.expiry!).toLocaleDateString();
      console.log(`  License: ${(status.tier ?? "").toUpperCase()} - ${status.email} (expires ${expiry})`);
    }
  });

program.parse();

