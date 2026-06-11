import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import type { RuntimeConfig } from "../../proxy/config-types.js";
import {
  getCliReadCandidates,
  getUserConfigPath,
  getWindowsProgramDataConfigPath,
  getWindowsSystemProfileConfigPath,
  readFirstAvailableRuntimeConfig,
  readRuntimeConfig,
} from "@/config/deja-config-store.js";
import { isManagedSettingsActive, MANAGED_SETTINGS_PATH } from "../managed-settings.js";

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xfeff ? s.slice(1) : s;
}

function readCurrentUrl(settings: Record<string, unknown>): string | undefined {
  if (typeof settings["ANTHROPIC_BASE_URL"] === "string") {
    return settings["ANTHROPIC_BASE_URL"];
  }
  const env = settings["env"];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const envObj = env as Record<string, unknown>;
    if (typeof envObj["ANTHROPIC_BASE_URL"] === "string") {
      return envObj["ANTHROPIC_BASE_URL"];
    }
  }
  return undefined;
}

interface DoctorOptions {
  port: number;
}

function check(label: string, ok: boolean, detail: string): void {
  const icon = ok ? "PASS" : "FAIL";
  console.log(`  ${icon}  ${label}`);
  if (detail) {
    console.log(`         ${detail}`);
  }
}

function info(label: string, detail: string): void {
  console.log(`  INFO  ${label}`);
  if (detail) console.log(`         ${detail}`);
}

function httpGet(url: string): Promise<{ ok: boolean; status?: number; body?: string }> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => resolve({ ok: true, status: res.statusCode ?? 200, body }));
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function findSettingsPaths(): string[] {
  const home = homedir();
  const paths: string[] = [join(home, ".claude", "settings.json")];
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData) paths.push(join(appData, "Claude", "settings.json"));
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) {
      paths.push(join(localAppData, "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
      paths.push(join(localAppData, "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
    }
  } else if (process.platform === "darwin") {
    paths.push(join(home, "Library", "Application Support", "Claude", "settings.json"));
    paths.push(join(home, "Library", "Application Support", "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
  } else {
    paths.push(join(home, ".config", "Claude", "settings.json"));
    const xdgConfig = process.env["XDG_CONFIG_HOME"];
    if (xdgConfig) paths.push(join(xdgConfig, "Claude", "settings.json"));
  }
  return paths;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function configSignature(config: RuntimeConfig): string {
  const provider = config.providers[config.defaultProvider];
  return JSON.stringify({
    port: config.port,
    defaultProvider: config.defaultProvider,
    baseUrl: provider?.baseUrl ?? "",
    apiKey: provider?.apiKey ?? "",
    compatMode: provider?.compatMode ?? "",
  });
}

interface ConfigSnapshot {
  path: string;
  exists: boolean;
  config: RuntimeConfig | null;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function getMirrorPaths(): string[] {
  const base = process.platform === "win32"
    ? [getUserConfigPath(), getWindowsProgramDataConfigPath(), getWindowsSystemProfileConfigPath()]
    : [getUserConfigPath()];
  const envPath = process.env["DEJA_CONFIG_PATH"];
  const cliCandidates = getCliReadCandidates();
  return uniquePaths([
    ...(envPath ? [envPath] : []),
    ...base,
    ...cliCandidates,
  ]);
}

function readSnapshots(paths: string[]): ConfigSnapshot[] {
  return paths.map((path) => {
    const exists = existsSync(path);
    return {
      path,
      exists,
      config: exists ? readRuntimeConfig(path) : null,
    };
  });
}

export async function doctor(opts: DoctorOptions): Promise<void> {
  const port = opts.port;
  const proxyUrl = `http://localhost:${port}`;

  console.log("");
  console.log("  Deja Doctor");
  console.log("  -----------");
  console.log(`  OS: ${process.platform} | Node: ${process.version}`);
  console.log("");

  console.log("  [Proxy]");
  const proxyResult = await httpGet(`${proxyUrl}/health`);
  if (proxyResult.ok) {
    check("Proxy is running", true, proxyUrl);
    if (proxyResult.body) {
      try {
        const stats = JSON.parse(proxyResult.body) as Record<string, unknown>;
        console.log(`         uptime: ${String(stats["uptime"] ?? "?")}s`);
        console.log(`         requests: ${String(stats["requests"] ?? "?")}`);
        console.log(`         tokens saved: ${String(stats["tokensSaved"] ?? "?")}`);
        if (stats["upstreamOk"] === false) {
          console.log(`         upstream: DEGRADED -> ${String(stats["upstreamLastError"] ?? "unknown")}`);
        }
      } catch {
        // ignore
      }
    }
  } else {
    check("Proxy is running", false, `Cannot reach ${proxyUrl}. Run: deja start`);
  }
  console.log("");

  console.log("  [Routing Config]");
  if (isManagedSettingsActive()) {
    check("managed-settings.json", true, `${MANAGED_SETTINGS_PATH} -> localhost:${port}`);
    if (!proxyResult.ok) {
      console.log("         WARN: managed-settings is active but Deja is not running.");
      console.log('         Run "deja start" or "deja stop" to restore direct routing.');
    }
  } else if (existsSync(MANAGED_SETTINGS_PATH)) {
    info("managed-settings.json", `${MANAGED_SETTINGS_PATH} exists but does not point to Deja`);
  } else {
    info("managed-settings.json", 'Not present. Run "deja start" to create it.');
  }
  console.log("");

  console.log("  [Upstream]");
  if (proxyResult.ok && proxyResult.body) {
    try {
      const stats = JSON.parse(proxyResult.body) as Record<string, unknown>;
      const upstreamOk = stats["upstreamOk"];
      if (upstreamOk === true) {
        check("Upstream reachable", true, String(stats["upstream"] ?? ""));
      } else if (upstreamOk === false) {
        check("Upstream reachable", false, String(stats["upstream"] ?? "unknown"));
      } else {
        info("Upstream reachable", "Not yet verified (no forwarded requests yet).");
      }
    } catch {
      info("Upstream reachable", "Unknown (invalid health payload).");
    }
  } else {
    info("Upstream reachable", "Unknown (proxy not running).");
  }
  console.log("");

  console.log("  [Runtime Config Mirrors]");
  const snapshots = readSnapshots(getMirrorPaths());
  const readable = snapshots.filter((s) => s.config);
  for (const snap of snapshots) {
    if (!snap.exists) {
      info(snap.path, "missing");
      continue;
    }
    if (!snap.config) {
      check(snap.path, false, "exists but cannot be parsed");
      continue;
    }
    const provider = snap.config.providers[snap.config.defaultProvider];
    const maskedKey = provider?.apiKey ? maskKey(provider.apiKey) : "(none)";
    info(
      snap.path,
      `provider=${snap.config.defaultProvider}, baseUrl=${provider?.baseUrl ?? "(none)"}, key=${maskedKey}`,
    );
  }

  if (readable.length <= 1) {
    info("Mirror drift", "not enough readable mirrors to compare");
  } else {
    const baseline = configSignature(readable[0]!.config!);
    const drifted = readable.filter((s) => configSignature(s.config!) !== baseline);
    if (drifted.length === 0) {
      check("Mirror drift", true, "all readable runtime config mirrors are in sync");
    } else {
      check("Mirror drift", false, `detected differences in ${drifted.length} mirror file(s)`);
      for (const d of drifted) {
        console.log(`         drift: ${d.path}`);
      }
      console.log("         fix: deja key:update --key YOUR_NEW_KEY");
      if (process.platform === "win32") {
        console.log("         note: run Administrator PowerShell so ProgramData can be updated.");
      }
    }
  }
  if (process.platform === "win32") {
    const { isWindowsServiceInstalled } = await import("../../service/windows-service.js");
    if (isWindowsServiceInstalled()) {
      const programDataPath = getWindowsProgramDataConfigPath();
      const programDataSnapshot = snapshots.find((s) => s.path === programDataPath);
      if (!programDataSnapshot?.config) {
        check(
          "Windows service config",
          false,
          `${programDataPath} is missing/unreadable while service is installed`,
        );
        console.log("         fix: run Administrator PowerShell, then `deja key:update --key YOUR_NEW_KEY`");
      } else {
        check("Windows service config", true, `${programDataPath} is present and readable`);
      }
    }
  }
  console.log("");

  console.log("  [Claude/Cursor settings.json fallback]");
  console.log("  (Used when managed-settings.json is not active)");
  const configPaths = findSettingsPaths();
  let foundConfig = false;

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    foundConfig = true;
    try {
      const raw = stripBOM(readFileSync(configPath, "utf-8"));
      const settings = JSON.parse(raw) as Record<string, unknown>;
      const baseUrl = readCurrentUrl(settings);

      if (baseUrl === proxyUrl) {
        info(configPath, `ANTHROPIC_BASE_URL -> ${proxyUrl} (points to Deja)`);
      } else if (baseUrl) {
        info(configPath, `ANTHROPIC_BASE_URL = ${String(baseUrl)}`);
      } else {
        info(configPath, "ANTHROPIC_BASE_URL not set");
      }
    } catch {
      info(configPath, "Cannot parse JSON");
    }
  }
  if (!foundConfig) {
    info("Fallback config", "No Claude/Cursor settings.json found");
  }
  console.log("");

  console.log("  [API Key]");
  const envKey = process.env["ANTHROPIC_API_KEY"] ?? process.env["OPENAI_API_KEY"];
  const loaded = readFirstAvailableRuntimeConfig(getCliReadCandidates());
  const configProvider = loaded?.config.providers[loaded.config.defaultProvider];
  const configKey = configProvider?.apiKey;
  const effectiveKey = envKey ?? configKey;

  if (effectiveKey) {
    const source = envKey ? "environment variable" : loaded?.path ?? "runtime config";
    check("API key found", true, `${maskKey(effectiveKey)} (from ${source})`);
  } else {
    check("API key found", false, 'No key detected. Run "deja setup" or "deja key:update --key ...".');
  }
  console.log("");

  console.log("  -----------");
  console.log("  Doctor complete.");
  console.log("");
}
