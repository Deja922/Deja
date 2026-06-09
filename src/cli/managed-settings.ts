import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// Managed-settings.json is the enterprise policy layer for Claude Code.
// Priority: managed-settings.json > env vars > settings.json (CC Switch never writes here).
// Deja writes this file on start and removes it on stop — so killing Deja
// automatically restores direct-connection to the real provider.

function getManagedSettingsPath(): string {
  if (process.platform === "win32") {
    const programData = process.env["ProgramData"] ?? "C:\\ProgramData";
    return join(programData, "ClaudeCode", "managed-settings.json");
  } else if (process.platform === "darwin") {
    return "/Library/Application Support/ClaudeCode/managed-settings.json";
  } else {
    return "/etc/claude-code/managed-settings.json";
  }
}

export const MANAGED_SETTINGS_PATH = getManagedSettingsPath();

export interface ManagedSettingsResult {
  ok: boolean;
  path: string;
  wasPresent?: boolean;
  error?: string;
}

export function writeManagedSettings(port: number): ManagedSettingsResult {
  const path = MANAGED_SETTINGS_PATH;
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const content = { env: { ANTHROPIC_BASE_URL: `http://localhost:${port}` } };
    writeFileSync(path, JSON.stringify(content, null, 2) + "\n", "utf-8");
    return { ok: true, path };
  } catch (err) {
    return { ok: false, path, error: (err as Error).message };
  }
}

export function removeManagedSettings(): ManagedSettingsResult {
  const path = MANAGED_SETTINGS_PATH;
  if (!existsSync(path)) {
    return { ok: true, path, wasPresent: false };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env = settings["env"] as Record<string, unknown> | undefined;

    if (env && typeof env["ANTHROPIC_BASE_URL"] === "string") {
      const url = env["ANTHROPIC_BASE_URL"] as string;
      if (url.startsWith("http://localhost:")) {
        delete env["ANTHROPIC_BASE_URL"];
        if (Object.keys(env).length === 0) delete settings["env"];
        if (Object.keys(settings).length === 0) {
          unlinkSync(path);
        } else {
          writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
        }
        return { ok: true, path, wasPresent: true };
      }
    }
    return { ok: true, path, wasPresent: false };
  } catch (err) {
    return { ok: false, path, wasPresent: true, error: (err as Error).message };
  }
}

export function isManagedSettingsActive(): boolean {
  const path = MANAGED_SETTINGS_PATH;
  if (!existsSync(path)) return false;
  try {
    const settings = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const env = settings["env"] as Record<string, unknown> | undefined;
    return (
      typeof env?.["ANTHROPIC_BASE_URL"] === "string" &&
      (env["ANTHROPIC_BASE_URL"] as string).startsWith("http://localhost:")
    );
  } catch {
    return false;
  }
}
