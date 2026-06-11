import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { DEFAULT_CONFIG, type ProviderConfig, type RuntimeConfig } from "../../proxy/config-types.js";
import { checkUpstreamHealth, isProviderReachable } from "../../proxy/upstream.js";
import {
  getCliReadCandidates,
  getWindowsProgramDataConfigPath,
  readFirstAvailableRuntimeConfig,
  writeRuntimeConfigToMirrors,
} from "@/config/deja-config-store.js";

interface KeyUpdateOptions {
  key: string;
  upstream?: string;
  provider?: string;
  skipHealthCheck?: boolean;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function normalizeUpstream(upstream: string): string {
  return upstream.trim().replace(/\/+$/, "");
}

function inferProviderFromUpstream(upstream: string): string {
  const lower = upstream.toLowerCase();
  if (lower.includes("openai") || lower.endsWith("/v1")) return "openai";
  if (lower.includes("deepseek")) return "deepseek";
  return "anthropic";
}

function defaultUpstreamForProvider(providerName: string): string {
  switch (providerName) {
    case "openai":
      return "https://api.openai.com";
    case "deepseek":
      return "https://api.deepseek.com/anthropic";
    case "anthropic":
      return "https://api.anthropic.com";
    default:
      return "https://api.anthropic.com";
  }
}

function inferCompatMode(providerName: string, upstream: string): ProviderConfig["compatMode"] {
  const lowerProvider = providerName.toLowerCase();
  const lowerUpstream = upstream.toLowerCase();
  if (
    lowerProvider.includes("openai") ||
    lowerUpstream.includes("/v1") ||
    lowerUpstream.includes("openai")
  ) {
    return "openai";
  }
  if (
    lowerProvider.includes("anthropic") ||
    lowerProvider.includes("deepseek") ||
    lowerUpstream.includes("/anthropic") ||
    lowerUpstream.includes("deepseek")
  ) {
    return "anthropic";
  }
  return undefined;
}

function resolveProviderName(
  optsProvider: string | undefined,
  upstream: string | undefined,
  config: RuntimeConfig,
): string {
  const explicit = optsProvider?.trim();
  if (explicit) return explicit;
  if (config.defaultProvider?.trim()) return config.defaultProvider;
  const firstConfigured = Object.keys(config.providers)[0];
  if (firstConfigured) return firstConfigured;
  if (upstream) return inferProviderFromUpstream(upstream);
  return "anthropic";
}

async function ensureHealth(
  provider: ProviderConfig,
  skipHealthCheck: boolean | undefined,
): Promise<void> {
  if (skipHealthCheck) {
    console.log("  INFO  Skipped upstream health check (--skip-health-check).");
    return;
  }

  const health = await checkUpstreamHealth(provider);
  if (isProviderReachable(health)) {
    if (health.status === "auth_error") {
      console.log(
        `  WARN  Upstream reachable (${provider.baseUrl}, HTTP ${health.httpStatus ?? "?"}), but API key authentication failed.`,
      );
      console.log("        Continuing because endpoint is reachable.");
    } else {
      console.log(`  PASS  Upstream reachable (${provider.baseUrl}, HTTP ${health.httpStatus ?? "?"}).`);
    }
    return;
  }

  if (health.status === "endpoint_not_found") {
    console.log("  WARN  Upstream is reachable but API format was not recognized.");
    console.log("        Continuing. If requests fail later, use --upstream with the provider-compatible endpoint.");
    return;
  }

  throw new Error(
    `Cannot reach upstream "${provider.baseUrl}": ${health.error ?? "network error"}. ` +
      "Fix network/upstream and retry, or use --skip-health-check if you are sure.",
  );
}

async function maybeRestartManagedService(): Promise<void> {
  if (process.platform === "win32") {
    const { restartWindowsServiceIfInstalled } = await import("../../service/windows-service.js");
    const result = restartWindowsServiceIfInstalled();
    if (result.restarted) {
      console.log(`  PASS  Restarted Windows service (${result.serviceName ?? "dejacontextengine"}).`);
      return;
    }
    if (result.serviceName && result.error) {
      console.log(`  WARN  Service detected (${result.serviceName}) but restart failed: ${result.error}`);
      console.log("        Please run PowerShell as Administrator and restart the service manually.");
      return;
    }
    console.log("  INFO  Windows service not installed; no service restart needed.");
    return;
  }

  if (process.platform === "darwin") {
    const { restartDaemonIfInstalled } = await import("../../service/macos-daemon.js");
    const result = await restartDaemonIfInstalled();
    if (result.restarted) {
      console.log("  PASS  Restarted macOS LaunchAgent.");
      return;
    }
    if (result.error) {
      console.log(`  WARN  LaunchAgent detected but restart failed: ${result.error}`);
      console.log("        Please run `deja service:remove` then `deja service:install`.");
      return;
    }
    console.log("  INFO  macOS LaunchAgent not installed; no service restart needed.");
  }
}

function canWritePath(targetPath: string): boolean {
  const dir = dirname(targetPath);
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.deja-write-probe-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(probe, "ok", "utf-8");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export async function keyUpdate(opts: KeyUpdateOptions): Promise<void> {
  const key = opts.key?.trim();
  if (!key) {
    throw new Error("Missing --key.");
  }

  const loaded = readFirstAvailableRuntimeConfig(getCliReadCandidates());
  const currentConfig = loaded?.config ?? DEFAULT_CONFIG;

  const upstreamFromArg = opts.upstream ? normalizeUpstream(opts.upstream) : undefined;
  const providerName = resolveProviderName(opts.provider, upstreamFromArg, currentConfig);
  const existingProvider = currentConfig.providers[providerName];

  const resolvedUpstream = upstreamFromArg
    ?? existingProvider?.baseUrl
    ?? defaultUpstreamForProvider(providerName);

  const compatMode = inferCompatMode(
    providerName,
    resolvedUpstream,
  ) ?? existingProvider?.compatMode;

  const updatedProvider: ProviderConfig = {
    ...(existingProvider ?? { baseUrl: resolvedUpstream }),
    baseUrl: resolvedUpstream,
    apiKey: key,
    ...(compatMode ? { compatMode } : {}),
  };

  await ensureHealth(updatedProvider, opts.skipHealthCheck);

  if (process.platform === "win32") {
    const { isWindowsServiceInstalled } = await import("../../service/windows-service.js");
    const serviceInstalled = isWindowsServiceInstalled();
    if (serviceInstalled) {
      const programDataPath = getWindowsProgramDataConfigPath();
      if (!canWritePath(programDataPath)) {
        throw new Error(
          `Windows service is installed and requires writing ${programDataPath}. ` +
            "Please run this command in Administrator PowerShell.",
        );
      }
    }
  }

  const nextConfig: RuntimeConfig = {
    ...currentConfig,
    providers: {
      ...currentConfig.providers,
      [providerName]: updatedProvider,
    },
    defaultProvider: providerName,
  };

  const writeResults = writeRuntimeConfigToMirrors(nextConfig, { includeLegacySystemProfileIfExists: true });
  const okPaths = writeResults.filter((r) => r.ok).map((r) => r.path);
  const failedPaths = writeResults.filter((r) => !r.ok);

  if (okPaths.length === 0) {
    throw new Error("Failed to write updated config to any runtime path.");
  }

  if (process.platform === "win32") {
    const { isWindowsServiceInstalled } = await import("../../service/windows-service.js");
    const serviceInstalled = isWindowsServiceInstalled();
    if (serviceInstalled) {
      const programDataPath = getWindowsProgramDataConfigPath();
      if (!okPaths.includes(programDataPath)) {
        throw new Error(
          `Windows service is installed, but config was not written to ${programDataPath}. ` +
            "Run this command in Administrator PowerShell and retry.",
        );
      }
    }
  }

  console.log("");
  console.log("  Key rotation complete.");
  console.log(`  Provider: ${providerName}`);
  console.log(`  Upstream: ${resolvedUpstream}`);
  console.log(`  API key:  ${maskKey(key)}`);
  if (loaded?.path) {
    console.log(`  Source config: ${loaded.path}`);
  } else {
    console.log("  Source config: defaults (no prior config found)");
  }
  console.log("");
  console.log("  Written config paths:");
  for (const path of okPaths) {
    console.log(`    - ${path}`);
  }
  if (failedPaths.length > 0) {
    console.log("  WARN  Failed paths:");
    for (const item of failedPaths) {
      console.log(`    - ${item.path}: ${item.error ?? "unknown error"}`);
    }
  }
  console.log("");

  await maybeRestartManagedService();

  console.log("");
  console.log("  Next check:");
  console.log("    deja doctor");
  console.log("");
}
