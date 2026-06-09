import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import http from "http";
import { startProxy } from "../../proxy/server.js";
import type { RuntimeConfig, ProviderConfig, CompressionMode } from "../../proxy/config-types.js";
import { DEFAULT_CONFIG, COMPRESSION_MODES, resolveEnv } from "../../proxy/config-types.js";
import type { UpstreamHealthResult } from "../../proxy/upstream.js";
import { checkUpstreamHealth } from "../../proxy/upstream.js";
import { writeManagedSettings, removeManagedSettings, isManagedSettingsActive, MANAGED_SETTINGS_PATH } from "../managed-settings.js";

const DEFAULT_CONFIG_PATH = join(homedir(), ".deja", "config.json");
const PID_FILE = join(homedir(), ".deja", "deja.pid");

function loadConfigFile(path?: string): RuntimeConfig {
  const configPath = path ?? DEFAULT_CONFIG_PATH;
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<RuntimeConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    process.stderr.write(`[deja] failed to parse config: ${configPath}\n`);
    return DEFAULT_CONFIG;
  }
}

/** Get the effective provider config: config file > CLI upstream flag > env var > built-in default */
function resolveProvider(
  config: RuntimeConfig,
  cliUpstream?: string,
): { upstream: string; apiKey?: string; compatMode?: string } {
  // If CLI --upstream is given, it takes highest priority
  if (cliUpstream) {
    const apiKey = process.env["ANTHROPIC_API_KEY"] ?? process.env["OPENAI_API_KEY"];
    return {
      upstream: cliUpstream,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  // Next: config file's defaultProvider
  const name = config.defaultProvider;
  const provider = config.providers[name];
  if (provider) {
    const resolvedKey = provider.apiKey ? resolveEnv(provider.apiKey) : undefined;
    const mode = provider.compatMode;
    return {
      upstream: resolveEnv(provider.baseUrl),
      ...(resolvedKey ? { apiKey: resolvedKey } : {}),
      ...(mode ? { compatMode: mode } : {}),
    };
  }

  // Next: DEJA_UPSTREAM env var
  if (process.env["DEJA_UPSTREAM"]) {
    const apiKey = process.env["ANTHROPIC_API_KEY"] ?? process.env["OPENAI_API_KEY"];
    return {
      upstream: process.env["DEJA_UPSTREAM"]!,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  // Fallback
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? process.env["OPENAI_API_KEY"];
  return {
    upstream: "https://api.anthropic.com",
    ...(apiKey ? { apiKey } : {}),
  };
}

// ── pre-flight health checks ───────────────────────────────────────────────

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer(() => {});
    server.on("error", () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

function checkIsOurProxy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function formatHealthResult(result: UpstreamHealthResult): string {
  switch (result.status) {
    case "reachable":
      return `Provider responded at ${result.endpoint ?? "API"} (HTTP ${result.httpStatus})`;
    case "auth_error":
      return `Provider reachable but returned HTTP ${result.httpStatus} — API key may need to be set`;
    case "endpoint_not_found":
      return "Provider reachable but API format not recognized — check the upstream URL";
    case "network_error":
      return `Cannot connect — ${result.error ?? "unknown network error"}`;
  }
}

// ── daemon spawn ───────────────────────────────────────────────────────────

function spawnDaemon(args: string[]): void {
  // Build a clean argument list: remove --daemon so the child doesn't re-spawn
  const childArgs = process.argv.slice(1).filter((a, i) => {
    // Keep the first arg (script path)
    if (i === 0) return true;
    // Filter out --daemon and -d
    if (a === "--daemon" || a === "-d") return false;
    return true;
  });

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();

  // Write PID file
  const dir = join(homedir(), ".deja");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PID_FILE, String(child.pid ?? 0), "utf-8");

  console.log("");
  console.log("  Deja daemon started in background.");
  console.log(`  PID: ${child.pid ?? "unknown"}`);
  console.log("");
  console.log("  Commands:");
  console.log("    deja status     — check if running");
  console.log("    deja dashboard  — open web UI");
  console.log("    deja stop       — stop the daemon");
  console.log("    deja logs       — stream proxy logs");
  console.log("");
}

// ── main ────────────────────────────────────────────────────────────────────

export async function start(opts: Record<string, unknown>): Promise<void> {
  // ── daemon mode: re-spawn and exit ───────────────────────────────────
  if (opts["daemon"] || opts["d"]) {
    spawnDaemon(process.argv.slice(1));
    return;
  }

  const config = loadConfigFile(opts["config"] as string | undefined);

  // Apply compression mode (CLI --target-tokens / --max-tokens override mode defaults)
  const mode = (opts["mode"] as string | undefined) ?? config.pipeline.mode;
  if (mode && mode in COMPRESSION_MODES) {
    const modeSettings = COMPRESSION_MODES[mode as CompressionMode];
    config.pipeline.mode = mode as CompressionMode;
    config.pipeline.targetTokens = modeSettings.targetTokens;
    config.pipeline.maxTokens = modeSettings.maxTokens;
    config.pipeline.compressThreshold = modeSettings.compressThreshold;
  }

  const port = opts["port"] ? parseInt(String(opts["port"]), 10) : config.port;
  const verbose = !opts["quiet"];

  // Resolve upstream provider from config (CLI flags override config)
  const { upstream, apiKey, compatMode } = resolveProvider(
    config,
    opts["upstream"] as string | undefined,
  );

  // Pre-flight checks
  console.log("  Running startup checks...\n");

  // 1. Verify port available
  const portFree = await checkPortAvailable(port);
  if (!portFree) {
    // If it's already our proxy running, just exit — someone else started it
    const ourProxy = await checkIsOurProxy(port);
    if (ourProxy) {
      process.exit(0);
    }
    console.log(`  FAIL  Port ${port} is already in use.`);
    console.log("        Another instance may be running.");
    console.log("        Try: deja status  or  deja start --port " + (port + 1));
    console.log("");
    process.exit(1);
  }
  console.log(`  PASS  Port ${port} is available.`);

  // If managed-settings.json still points to Deja from a previous crash (port is
  // free but the file was not cleaned up), remove it now before re-writing below.
  if (isManagedSettingsActive()) {
    removeManagedSettings();
    console.log(`  INFO  Removed stale routing config from previous session.`);
  }

  // 2. Verify upstream reachable (uses config-based API key if available)
  const healthResult = await checkUpstreamHealth({
    baseUrl: upstream,
    apiKey,
  });
  const statusLabel = formatHealthResult(healthResult);
  if (healthResult.status === "reachable" || healthResult.status === "auth_error") {
    console.log(`  PASS  ${statusLabel}`);
  } else if (healthResult.status === "endpoint_not_found") {
    console.log(`  WARN  ${statusLabel}`);
    console.log("        Deja will try to forward requests anyway.");
    console.log("        If it doesn't work, verify the upstream URL is correct.");
  } else {
    console.log(`  WARN  ${statusLabel}`);
    console.log("        The proxy will still start, but requests may fail.");
    console.log("        Check your network, VPN, or firewall settings.");
  }

  // 3. Verify config
  const configExists = existsSync(DEFAULT_CONFIG_PATH);
  if (configExists) {
    console.log(`  PASS  Config file found at ~/.deja/config.json`);
  } else {
    console.log(`  INFO  No config file. Run "deja setup" to create one.`);
  }

  // 4. Verify API key
  if (apiKey) {
    const masked = apiKey.length > 8
      ? apiKey.slice(0, 4) + "..." + apiKey.slice(-4)
      : "***";
    console.log(`  PASS  API key is set (${masked})`);
    if (!process.env["ANTHROPIC_API_KEY"] && !process.env["OPENAI_API_KEY"]) {
      console.log("        (from ~/.deja/config.json — no env var needed)");
    }
  } else {
    console.log(`  WARN  No API key found.`);
    console.log("        Run: deja setup");
    console.log("        Or set env: $env:ANTHROPIC_API_KEY = \"your-key\"");
  }

  console.log("");

  // Write managed-settings.json so Claude Code routes through Deja.
  // This file is removed on stop/shutdown — if Deja is not running, Claude
  // falls back directly to the real provider without any manual file editing.
  const msWrite = writeManagedSettings(port);
  if (msWrite.ok) {
    console.log(`  PASS  Routing config written → ${msWrite.path}`);
    console.log(`        Claude Code will connect through Deja (localhost:${port})`);
    console.log(`        Stop Deja (Ctrl+C or deja stop) to restore direct connection.`);
  } else {
    console.log(`  WARN  Could not write managed-settings.json: ${msWrite.error}`);
    console.log(`        On Windows this requires admin rights.`);
    console.log(`        Claude Code will NOT route through Deja unless you set:`);
    console.log(`          ANTHROPIC_BASE_URL=http://localhost:${port} in settings.json`);
  }
  console.log("");

  // Start proxy
  startProxy({
    port,
    targetTokens: opts["targetTokens"] ? parseInt(String(opts["targetTokens"]), 10) : undefined,
    maxTokens: opts["maxTokens"] ? parseInt(String(opts["maxTokens"]), 10) : undefined,
    mode: mode as string | undefined,
    verbose,
    upstream: opts["upstream"] as string | undefined,
    config,
  });
}
