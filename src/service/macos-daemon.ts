// macOS launchd LaunchAgent manager.
// Installs Deja as a user-level launch agent (starts on login, no root needed).
// Crash recovery handled via KeepAlive/Crashed + ThrottleInterval.

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { removeManagedSettings } from "../cli/managed-settings.js";

const LABEL = "com.deja.context-engine";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function getServiceScript(): string {
  const __filename = fileURLToPath(import.meta.url);
  return join(__filename, "..", "service-entry.js");
}

function getApiKey(): string {
  try {
    const configPath = join(homedir(), ".deja", "config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const providers = raw["providers"] as Record<string, { apiKey?: string }> | undefined;
    const defaultProvider = raw["defaultProvider"] as string | undefined;
    const provider = defaultProvider
      ? providers?.[defaultProvider]
      : Object.values(providers ?? {})[0];
    return provider?.apiKey ?? "";
  } catch {
    return "";
  }
}

function getUserId(): number {
  // process.getuid is POSIX-only (not available on Windows)
  return (process as { getuid?: () => number }).getuid?.() ?? 501;
}

function buildPlist(nodeExec: string, scriptPath: string, apiKey: string): string {
  const home = homedir();
  const logPath = join(home, ".deja", "deja.log");
  const apiKeyEntry = apiKey
    ? `        <key>ANTHROPIC_API_KEY</key>\n        <string>${apiKey}</string>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeExec}</string>
        <string>${scriptPath}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>DEJA_SERVICE_MODE</key>
        <string>1</string>
        <key>HOME</key>
        <string>${home}</string>
${apiKeyEntry}    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>2</integer>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
</dict>
</plist>
`;
}

export function registerDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
      if (!existsSync(launchAgentsDir)) mkdirSync(launchAgentsDir, { recursive: true });

      // Ensure log directory exists
      const logDir = join(homedir(), ".deja");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

      const nodeExec = process.execPath;
      const scriptPath = getServiceScript();
      const apiKey = getApiKey();

      writeFileSync(PLIST_PATH, buildPlist(nodeExec, scriptPath, apiKey), "utf-8");
      console.log(`[deja-daemon] plist written → ${PLIST_PATH}`);

      // Unload any existing instance first
      const uid = getUserId();
      try {
        execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" });
      } catch {
        try {
          execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" });
        } catch { /* not loaded */ }
      }

      // Load the agent (macOS 10.13+ prefers bootstrap)
      try {
        execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`, { stdio: "pipe" });
      } catch {
        execSync(`launchctl load "${PLIST_PATH}"`, { stdio: "pipe" });
      }

      console.log(`[deja-daemon] Service "${LABEL}" started`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function unregisterDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (!existsSync(PLIST_PATH)) {
        console.log(`[deja-daemon] No plist found at ${PLIST_PATH}, nothing to remove`);
        resolve();
        return;
      }

      const uid = getUserId();
      try {
        execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" });
      } catch {
        try {
          execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" });
        } catch { /* already unloaded */ }
      }

      unlinkSync(PLIST_PATH);
      removeManagedSettings();
      console.log(`[deja-daemon] LaunchAgent removed`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
