import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import { isManagedSettingsActive, MANAGED_SETTINGS_PATH } from "../managed-settings.js";

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xFEFF ? s.slice(1) : s;
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
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ ok: true, status: res.statusCode ?? 200, body }));
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
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

function readApiKeyFromConfig(): string | undefined {
  try {
    const configPath = join(homedir(), ".deja", "config.json");
    if (!existsSync(configPath)) return undefined;
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const providers = raw["providers"] as Record<string, { apiKey?: string }> | undefined;
    if (!providers) return undefined;
    const defaultProvider = raw["defaultProvider"] as string | undefined;
    const provider = defaultProvider ? providers[defaultProvider] : Object.values(providers)[0];
    return provider?.apiKey;
  } catch {
    return undefined;
  }
}

export async function doctor(opts: DoctorOptions): Promise<void> {
  const port = opts.port;
  const proxyUrl = `http://localhost:${port}`;

  console.log("");
  console.log("  Deja Doctor");
  console.log("  ───────────");
  console.log(`  OS: ${process.platform} | Node: ${process.version}`);
  console.log("");

  // 1. Proxy check
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
          console.log(`         upstream: DEGRADED — ${String(stats["upstreamLastError"] ?? "unknown")}`);
        }
      } catch { /* ignore */ }
    }
  } else {
    check("Proxy is running", false, `Cannot reach ${proxyUrl} — is the proxy started? Run: deja start`);
  }
  console.log("");

  // 2. Routing config — managed-settings.json (highest priority override)
  console.log("  [Routing Config]");
  if (isManagedSettingsActive()) {
    check("managed-settings.json", true, `${MANAGED_SETTINGS_PATH} → localhost:${port}`);
    console.log(`         Claude Code routes through Deja (this file is removed when Deja stops).`);
    if (!proxyResult.ok) {
      console.log(`         WARN: Deja is not running but managed-settings.json is present.`);
      console.log(`         Run "deja start" to start Deja, or "deja stop" to restore direct access.`);
    }
  } else {
    const msExists = existsSync(MANAGED_SETTINGS_PATH);
    if (msExists) {
      info("managed-settings.json", `${MANAGED_SETTINGS_PATH} exists but does not point to Deja`);
    } else {
      info("managed-settings.json", `Not present — run "deja start" to create it (requires admin on Windows)`);
    }
  }
  console.log("");

  // 3. Upstream check
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
        info("Upstream reachable", "not yet verified (no requests processed)");
      }
    } catch {
      info("Upstream reachable", "unknown (proxy responded but no stats)");
    }
  } else {
    info("Upstream reachable", "unknown (proxy not running)");
  }
  console.log("");

  // 4. Claude Code settings.json fallback check
  console.log("  [Claude Code settings.json]");
  console.log("  (Fallback when managed-settings.json is not present)");
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
        info(`${configPath}`, `ANTHROPIC_BASE_URL → ${proxyUrl} (points to Deja)`);
      } else if (baseUrl) {
        info(`${configPath}`, `ANTHROPIC_BASE_URL = ${String(baseUrl)}`);
      } else {
        info(`${configPath}`, "ANTHROPIC_BASE_URL not set (uses default or env var)");
      }
    } catch {
      info(`${configPath}`, "Cannot parse JSON");
    }
  }

  if (!foundConfig) {
    info("Config found", "No Claude Code settings.json found");
  }
  console.log("");

  // 5. API key check
  console.log("  [API Key]");
  const envKey = process.env["ANTHROPIC_API_KEY"] ?? process.env["OPENAI_API_KEY"];
  const configKey = readApiKeyFromConfig();
  const effectiveKey = envKey ?? configKey;

  if (effectiveKey) {
    const masked = effectiveKey.length > 8
      ? effectiveKey.slice(0, 4) + "..." + effectiveKey.slice(-4)
      : "***";
    const source = envKey ? "environment variable" : "~/.deja/config.json";
    check("API key found", true, `${masked} (from ${source})`);
  } else {
    check("API key found", false, "No API key — run: deja setup");
  }
  console.log("");

  console.log("  ───────────");
  console.log("  Doctor complete.");
  console.log("");
}
