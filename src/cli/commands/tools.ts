import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { isManagedSettingsActive, MANAGED_SETTINGS_PATH } from "../managed-settings.js";
import {
  getCliReadCandidates,
  readFirstAvailableRuntimeConfig,
  writeRuntimeConfigToMirrors,
} from "@/config/deja-config-store.js";
import { DEFAULT_CONFIG, type ProviderConfig, type RuntimeConfig } from "@/proxy/config-types.js";

const HOME = homedir();
const CODEX_CONFIG_PATH = join(HOME, ".codex", "config.toml");

const CONTINUE_CONFIG_PATHS = [
  join(HOME, ".continue", "config.json"),
  join(HOME, ".continue", "config.ts"),
];

const SHELL_PROFILES = [
  join(HOME, ".zshrc"),
  join(HOME, ".bashrc"),
  join(HOME, ".bash_profile"),
  join(HOME, ".profile"),
];

export interface ToolStatus {
  name: string;
  installed: boolean;
  configured: boolean;
  note: string;
}

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xfeff ? s.slice(1) : s;
}

function readText(path: string): string {
  return stripBOM(readFileSync(path, "utf-8"));
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function findContinueConfig(): string | null {
  for (const p of CONTINUE_CONFIG_PATHS) {
    if (existsSync(p) && p.endsWith(".json")) return p;
  }
  return null;
}

function findShellProfile(): string {
  for (const p of SHELL_PROFILES) {
    if (existsSync(p)) return p;
  }
  return join(HOME, ".zshrc");
}

function isCursorInstalled(): boolean {
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    const candidates = [
      join(localAppData, "Programs", "Cursor", "Cursor.exe"),
      join(localAppData, "cursor", "Cursor.exe"),
    ];
    return candidates.some(existsSync);
  }
  const unixCandidates = [
    "/Applications/Cursor.app",
    join(HOME, "Applications", "Cursor.app"),
    "/usr/local/bin/cursor",
    "/usr/bin/cursor",
  ];
  return unixCandidates.some(existsSync);
}

function getCursorSettingsPaths(): string[] {
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    if (!localAppData) return [];
    return [
      join(localAppData, "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"),
      join(localAppData, "Cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      join(HOME, "Library", "Application Support", "Cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"),
      join(HOME, "Library", "Application Support", "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"),
    ];
  }
  return [
    join(HOME, ".config", "Cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"),
    join(HOME, ".config", "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"),
  ];
}

function getCodexBinaryHints(): string[] {
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    return [join(localAppData, "OpenAI", "Codex")];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Codex.app", join(HOME, "Applications", "Codex.app")];
  }
  return ["/usr/local/bin/codex", "/usr/bin/codex"];
}

function isCodexInstalled(): boolean {
  if (existsSync(CODEX_CONFIG_PATH)) return true;
  return getCodexBinaryHints().some(existsSync);
}

function readCurrentUrl(settings: Record<string, unknown>): string | undefined {
  if (typeof settings["ANTHROPIC_BASE_URL"] === "string") return settings["ANTHROPIC_BASE_URL"];
  const env = settings["env"];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const envObj = env as Record<string, unknown>;
    if (typeof envObj["ANTHROPIC_BASE_URL"] === "string") return envObj["ANTHROPIC_BASE_URL"];
  }
  return undefined;
}

function patchAnthropicBaseUrl(settingsPath: string, proxyUrl: string): boolean {
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readText(settingsPath)) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  const env = settings["env"];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    (env as Record<string, unknown>)["ANTHROPIC_BASE_URL"] = proxyUrl;
  } else {
    settings["ANTHROPIC_BASE_URL"] = proxyUrl;
  }
  writeText(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTomlStringValue(content: string, key: string): string | null {
  const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"\\s*$`, "m");
  const m = re.exec(content);
  return m ? m[1]! : null;
}

function getModelProvider(content: string): string {
  return getTomlStringValue(content, "model_provider") ?? "custom";
}

function buildSectionRegex(sectionName: string): RegExp {
  return new RegExp(`^\\s*\\[${escapeRegExp(sectionName)}\\]\\s*$`, "m");
}

function getSectionRange(content: string, sectionName: string): { start: number; end: number } | null {
  const sectionRe = buildSectionRegex(sectionName);
  const m = sectionRe.exec(content);
  if (!m || typeof m.index !== "number") return null;

  const start = m.index;
  const afterHeader = start + m[0].length;
  const rest = content.slice(afterHeader);
  const nextHeader = /^\s*\[[^\]]+\]\s*$/m.exec(rest);
  const end = nextHeader && typeof nextHeader.index === "number"
    ? afterHeader + nextHeader.index
    : content.length;

  return { start, end };
}

function upsertKeyInSection(content: string, sectionName: string, key: string, rawValue: string): string {
  const section = getSectionRange(content, sectionName);
  const keyLine = `${key} = ${rawValue}`;

  if (!section) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    return `${content}${suffix}\n[${sectionName}]\n${keyLine}\n`;
  }

  const original = content.slice(section.start, section.end);
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*.*$`, "m");
  const updated = keyRe.test(original)
    ? original.replace(keyRe, keyLine)
    : `${original.trimEnd()}\n${keyLine}\n`;

  return `${content.slice(0, section.start)}${updated}${content.slice(section.end)}`;
}

function readCodexActiveBaseUrl(content: string): string | null {
  const provider = getModelProvider(content);
  const sectionNames = [`model_providers.${provider}`, `model_providers."${provider}"`];
  for (const sectionName of sectionNames) {
    const range = getSectionRange(content, sectionName);
    if (!range) continue;
    const section = content.slice(range.start, range.end);
    const baseUrl = getTomlStringValue(section, "base_url");
    if (baseUrl) return baseUrl;
  }
  return null;
}

function readCodexActiveProviderName(content: string): string | null {
  const provider = getModelProvider(content);
  const sectionNames = [`model_providers.${provider}`, `model_providers."${provider}"`];
  for (const sectionName of sectionNames) {
    const range = getSectionRange(content, sectionName);
    if (!range) continue;
    const section = content.slice(range.start, range.end);
    const name = getTomlStringValue(section, "name");
    if (name) return name;
  }
  return null;
}

function isLocalProxyUrl(url: string, port: number): boolean {
  try {
    const parsed = new URL(url);
    const hostOk = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    return hostOk && parsed.port === String(port);
  } catch {
    return url.includes(`localhost:${port}`) || url.includes(`127.0.0.1:${port}`);
  }
}

function inferCompatModeFromBaseUrl(baseUrl: string): ProviderConfig["compatMode"] {
  if (/\/anthropic\b/i.test(baseUrl)) return "anthropic";
  return "openai";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

function configureDejaUpstreamForCodex(
  previousBaseUrl: string | null,
  codexToken: string | null,
  codexProviderName: string | null,
): void {
  if (!previousBaseUrl) {
    console.log("  INFO  Deja upstream unchanged (cannot infer previous Codex upstream).");
    return;
  }

  let normalized = normalizeBaseUrl(previousBaseUrl);
  if (isLoopbackUrl(normalized)) {
    // CCS Switch commonly uses provider name "aihubmix". If Codex is already
    // routed to localhost, we cannot recover the previous remote base_url from
    // codex config, so apply a safe known OpenAI-compatible endpoint.
    if ((codexProviderName ?? "").toLowerCase() === "aihubmix") {
      normalized = "https://api.aihubmix.com/v1";
    } else {
      console.log("  INFO  Deja upstream unchanged (Codex already pointed at localhost).");
      return;
    }
  }

  const compatMode = inferCompatModeFromBaseUrl(normalized);
  if (compatMode !== "openai") {
    console.log(`  WARN  Skipped Deja Codex upstream sync: ${normalized} is not OpenAI-compatible.`);
    return;
  }

  const loaded = readFirstAvailableRuntimeConfig(getCliReadCandidates());
  const current = loaded?.config ?? DEFAULT_CONFIG;
  const providerName = "codex";
  const existing = current.providers[providerName];
  const apiKey = codexToken ?? existing?.apiKey;

  const next: RuntimeConfig = {
    ...current,
    providers: {
      ...current.providers,
      [providerName]: {
        ...existing,
        baseUrl: normalized,
        ...(apiKey ? { apiKey } : {}),
        compatMode: "openai",
      },
    },
    defaultProvider: providerName,
  };

  const writeResults = writeRuntimeConfigToMirrors(next, { includeLegacySystemProfileIfExists: true });
  const okPaths = writeResults.filter((r) => r.ok).map((r) => r.path);
  const failed = writeResults.filter((r) => !r.ok);

  if (okPaths.length > 0) {
    console.log(`  OK  Deja upstream for Codex -> ${normalized}`);
  } else {
    console.log("  WARN  Failed to write Deja runtime config for Codex upstream.");
  }
  for (const item of failed) {
    console.log(`      WARN ${item.path}: ${item.error ?? "unknown error"}`);
  }
}

function configureCodex(port: number): void {
  const proxyBaseUrl = `http://localhost:${port}/v1`;
  let content = existsSync(CODEX_CONFIG_PATH)
    ? readText(CODEX_CONFIG_PATH)
    : 'model_provider = "custom"\n\n[model_providers]\n[model_providers.custom]\n';
  const previousBaseUrl = readCodexActiveBaseUrl(content);
  const codexProviderName = readCodexActiveProviderName(content);
  const codexToken = getTomlStringValue(content, "experimental_bearer_token");

  const provider = getModelProvider(content);
  const normalizedProvider = /^[A-Za-z0-9_-]+$/.test(provider) ? provider : "custom";
  if (normalizedProvider !== provider) {
    content = content.replace(
      /^(\s*model_provider\s*=\s*).+$/m,
      `$1"${normalizedProvider}"`,
    );
  }

  const sectionNames = [
    `model_providers.${normalizedProvider}`,
    `model_providers."${normalizedProvider}"`,
  ];

  let found = false;
  for (const sectionName of sectionNames) {
    if (getSectionRange(content, sectionName)) {
      content = upsertKeyInSection(content, sectionName, "base_url", `"${proxyBaseUrl}"`);
      found = true;
      break;
    }
  }
  if (!found) {
    content = upsertKeyInSection(content, sectionNames[0]!, "base_url", `"${proxyBaseUrl}"`);
  }

  writeText(CODEX_CONFIG_PATH, content.endsWith("\n") ? content : `${content}\n`);
  console.log(`  OK  Codex configured: ${CODEX_CONFIG_PATH}`);
  console.log(`      active provider base_url -> ${proxyBaseUrl}`);
  configureDejaUpstreamForCodex(previousBaseUrl, codexToken, codexProviderName);
}

function configureCursor(port: number): void {
  const proxyUrl = `http://localhost:${port}`;
  const candidates = getCursorSettingsPaths();
  const existing = candidates.filter((p) => existsSync(p));
  const targets = existing.length > 0 ? existing : (candidates[0] ? [candidates[0]] : []);

  if (targets.length === 0) {
    throw new Error("Cannot find Cursor settings path on this platform.");
  }

  for (const target of targets) {
    patchAnthropicBaseUrl(target, proxyUrl);
    console.log(`  OK  Cursor configured: ${target}`);
  }
}

function configureContinue(port: number): void {
  const proxyUrl = `http://localhost:${port}`;
  const continueDir = join(HOME, ".continue");
  const configPath = join(continueDir, "config.json");

  if (!existsSync(continueDir)) {
    mkdirSync(continueDir, { recursive: true });
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readText(configPath)) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }

  const models = (config["models"] as Array<Record<string, unknown>> | undefined) ?? [];
  const filtered = models.filter((m) => !(m["title"] as string)?.startsWith("Deja"));
  filtered.unshift({
    title: "Deja (Claude)",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    apiBase: proxyUrl,
  });
  config["models"] = filtered;

  writeText(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`  OK  Continue configured: ${configPath}`);
}

export function detectTools(port: number): ToolStatus[] {
  const proxyUrl = `http://localhost:${port}`;
  const results: ToolStatus[] = [];

  const claudeInstalled = existsSync(join(HOME, ".claude"));
  const claudeConfigured = isManagedSettingsActive();
  results.push({
    name: "Claude Code",
    installed: claudeInstalled,
    configured: claudeConfigured,
    note: claudeConfigured
      ? `managed-settings active (${MANAGED_SETTINGS_PATH})`
      : "run deja service:install",
  });

  const cursorInstalled = isCursorInstalled() || getCursorSettingsPaths().some(existsSync);
  let cursorConfigured = false;
  const cursorPaths = getCursorSettingsPaths().filter(existsSync);
  for (const path of cursorPaths) {
    try {
      const raw = JSON.parse(readText(path)) as Record<string, unknown>;
      const baseUrl = readCurrentUrl(raw);
      if (baseUrl && isLocalProxyUrl(baseUrl, port)) {
        cursorConfigured = true;
        break;
      }
    } catch {
      // ignore parse errors
    }
  }
  results.push({
    name: "Cursor",
    installed: cursorInstalled,
    configured: cursorConfigured,
    note: cursorConfigured
      ? `ANTHROPIC_BASE_URL -> ${proxyUrl}`
      : cursorInstalled
        ? "run deja tools:install cursor"
        : "not detected",
  });

  const continueConfigPath = findContinueConfig();
  const continueInstalled = existsSync(join(HOME, ".continue"));
  let continueConfigured = false;
  if (continueConfigPath) {
    try {
      const raw = JSON.parse(readText(continueConfigPath)) as Record<string, unknown>;
      const models = raw["models"] as Array<Record<string, unknown>> | undefined;
      continueConfigured = models?.some((m) => isLocalProxyUrl(String(m["apiBase"] ?? ""), port)) ?? false;
    } catch {
      continueConfigured = false;
    }
  }
  results.push({
    name: "VS Code + Continue",
    installed: continueInstalled,
    configured: continueConfigured,
    note: continueConfigured
      ? `apiBase -> ${proxyUrl}`
      : continueInstalled
        ? "run deja tools:install continue"
        : "not detected",
  });

  const codexInstalled = isCodexInstalled();
  let codexConfigured = false;
  let codexBaseUrl = "";
  if (existsSync(CODEX_CONFIG_PATH)) {
    try {
      const content = readText(CODEX_CONFIG_PATH);
      codexBaseUrl = readCodexActiveBaseUrl(content) ?? "";
      codexConfigured = codexBaseUrl ? isLocalProxyUrl(codexBaseUrl, port) : false;
    } catch {
      codexConfigured = false;
    }
  }
  results.push({
    name: "Codex",
    installed: codexInstalled,
    configured: codexConfigured,
    note: codexConfigured
      ? `base_url -> ${codexBaseUrl}`
      : codexInstalled
        ? "run deja tools:install codex"
        : "not detected",
  });

  return results;
}

export function toolsList(port: number): void {
  const tools = detectTools(port);
  console.log("");
  console.log("  Tool Integration Status");
  console.log("  -----------------------");
  for (const t of tools) {
    const status = !t.installed ? "NOT INSTALLED" : t.configured ? "CONFIGURED" : "NEEDS SETUP";
    const color = !t.installed ? "\x1b[90m" : t.configured ? "\x1b[32m" : "\x1b[33m";
    console.log(`  ${color}${status}\x1b[0m  ${t.name}`);
    console.log(`         ${t.note}`);
  }
  console.log("");
}

export function toolsInstall(toolName: string, port: number): void {
  const name = toolName.toLowerCase();
  console.log("");

  if (name === "cursor") {
    console.log("  Configuring Cursor...");
    configureCursor(port);
  } else if (name === "continue") {
    console.log("  Configuring VS Code + Continue...");
    configureContinue(port);
  } else if (name === "codex") {
    console.log("  Configuring Codex...");
    configureCodex(port);
  } else if (name === "all") {
    console.log("  Configuring all detected tools...");

    if (isCursorInstalled() || getCursorSettingsPaths().some(existsSync)) {
      configureCursor(port);
    } else {
      console.log("  - Skip Cursor (not detected)");
    }

    if (existsSync(join(HOME, ".continue"))) {
      configureContinue(port);
    } else {
      console.log("  - Skip Continue (not detected)");
    }

    if (isCodexInstalled()) {
      configureCodex(port);
    } else {
      console.log("  - Skip Codex (not detected)");
    }
  } else {
    console.error(`  Unknown tool: ${toolName} (supported: cursor | continue | codex | all)`);
    process.exit(1);
  }

  console.log("");
}
