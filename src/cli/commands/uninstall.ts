import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { removeManagedSettings, isManagedSettingsActive, MANAGED_SETTINGS_PATH } from "../managed-settings.js";

interface UninstallOptions {
  port: number;
}

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

function clearProxyUrl(configPath: string, proxyUrl: string): boolean {
  try {
    let raw = readFileSync(configPath, "utf-8");
    raw = stripBOM(raw);
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false;
    }

    const env = settings["env"];
    if (env && typeof env === "object" && !Array.isArray(env)) {
      const envObj = env as Record<string, unknown>;
      if (envObj["ANTHROPIC_BASE_URL"] === proxyUrl) {
        delete envObj["ANTHROPIC_BASE_URL"];
        if (Object.keys(envObj).length === 0) {
          delete settings["env"];
        }
        writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
        return true;
      }
    }

    if (settings["ANTHROPIC_BASE_URL"] === proxyUrl) {
      delete settings["ANTHROPIC_BASE_URL"];
      writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function findBackups(configPath: string): string[] {
  const dir = configPath;
  const result: string[] = [];
  // backup files are configPath.backup-{timestamp}
  // they live alongside the config, so we scan by glob pattern in the parent dir
  try {
    const { readdirSync } = require("fs");
    const parent = require("path").dirname(configPath);
    const base = require("path").basename(configPath);
    const entries = readdirSync(parent);
    for (const entry of entries) {
      if (entry.startsWith(base + ".backup-")) {
        result.push(join(parent, entry));
      }
    }
    result.sort().reverse(); // newest first (timestamp sort)
  } catch {
    // ignore
  }
  return result;
}

function findSettingsPaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData) paths.push(join(appData, "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) {
      paths.push(join(localAppData, "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
      paths.push(join(localAppData, "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
    }
  } else if (process.platform === "darwin") {
    paths.push(join(home, "Library", "Application Support", "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
    paths.push(join(home, "Library", "Application Support", "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
  } else {
    paths.push(join(home, ".config", "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
    const xdgConfig = process.env["XDG_CONFIG_HOME"];
    if (xdgConfig) paths.push(join(xdgConfig, "Claude", "settings.json"));
  }

  return paths.filter((p) => existsSync(p));
}

export async function uninstall(opts: UninstallOptions): Promise<void> {
  const port = opts.port;
  const proxyUrl = `http://localhost:${port}`;

  console.log("");
  console.log("  Deja Uninstaller");
  console.log("  ────────────────");
  console.log("");

  // Step 1 — Clean up managed-settings.json (runtime routing file)
  if (isManagedSettingsActive()) {
    const result = removeManagedSettings();
    if (result.ok) {
      console.log(`  已删除: ${MANAGED_SETTINGS_PATH}`);
      console.log(`    Claude Code 将直连真实 API。`);
    } else {
      console.log(`  WARN 无法删除 managed-settings.json: ${result.error}`);
      console.log(`       请手动删除: ${MANAGED_SETTINGS_PATH}`);
    }
    console.log("");
  }

  // Step 2 — Clean any leftover localhost entries from settings.json (old install style)
  const paths = findSettingsPaths();

  if (paths.length === 0) {
    console.log("  No Claude Code settings.json found. Nothing to uninstall.");
    console.log("");
    return;
  }

  let changed = false;

  for (const configPath of paths) {
    let raw: string;
    try {
      raw = stripBOM(readFileSync(configPath, "utf-8"));
    } catch {
      continue;
    }

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const currentUrl = readCurrentUrl(settings);
    if (currentUrl !== proxyUrl) {
      console.log(`  ${configPath}`);
      console.log(`    Not pointing to Deja (${currentUrl ?? "not set"}), skipped.`);
      console.log("");
      continue;
    }

    // Try restoring from the most recent backup first
    const backups = findBackups(configPath);
    if (backups.length > 0) {
      try {
        const backupContent = readFileSync(backups[0]!, "utf-8");
        JSON.parse(backupContent); // validate
        writeFileSync(configPath, backupContent, "utf-8");
        console.log(`  ${configPath}`);
        console.log(`    Restored from backup: ${backups[0]}`);
        console.log(`    ANTHROPIC_BASE_URL removed, original config restored.`);
        changed = true;
        console.log("");
        continue;
      } catch {
        // backup restore failed, fall through to manual removal
      }
    }

    // No backup available, manually remove the setting
    const removed = clearProxyUrl(configPath, proxyUrl);
    if (removed) {
      console.log(`  ${configPath}`);
      console.log(`    Removed ANTHROPIC_BASE_URL.`);
      console.log(`    No backup found — the setting was deleted.`);
      changed = true;
    }
    console.log("");
  }

  if (changed) {
    console.log("  ────────────────");
    console.log("  Uninstall complete.");
    console.log("");
    console.log("  Claude Code will now connect directly to the API.");
    console.log("");
  } else {
    console.log("  ────────────────");
    console.log("  No changes were needed. Deja was not configured.");
    console.log("");
  }
}
