import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { removeManagedSettings } from "../cli/managed-settings.js";
import { getUserConfigPath } from "@/config/deja-config-store.js";

const LABEL = "com.deja.context-engine";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function getServiceScript(): string {
  const __filename = fileURLToPath(import.meta.url);
  return join(__filename, "..", "service-entry.js");
}

function getUserId(): number {
  return (process as { getuid?: () => number }).getuid?.() ?? 501;
}

function getConfigPath(): string {
  return process.env["DEJA_CONFIG_PATH"] ?? getUserConfigPath();
}

function buildPlist(nodeExec: string, scriptPath: string, configPath: string): string {
  const home = homedir();
  const logPath = join(home, ".deja", "deja.log");

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
        <key>DEJA_CONFIG_PATH</key>
        <string>${configPath}</string>
    </dict>
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

export function isDaemonInstalled(): boolean {
  return existsSync(PLIST_PATH);
}

export function registerDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
      if (!existsSync(launchAgentsDir)) mkdirSync(launchAgentsDir, { recursive: true });

      const logDir = join(homedir(), ".deja");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

      const nodeExec = process.execPath;
      const scriptPath = getServiceScript();
      const configPath = getConfigPath();

      writeFileSync(PLIST_PATH, buildPlist(nodeExec, scriptPath, configPath), "utf-8");
      console.log(`[deja-daemon] plist written -> ${PLIST_PATH}`);

      const uid = getUserId();
      try {
        execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" });
      } catch {
        try {
          execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: "pipe" });
        } catch {
          // not loaded
        }
      }

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

export async function restartDaemonIfInstalled(): Promise<{ restarted: boolean; error?: string }> {
  if (!isDaemonInstalled()) return { restarted: false };
  try {
    await registerDaemon();
    return { restarted: true };
  } catch (err) {
    return { restarted: false, error: err instanceof Error ? err.message : String(err) };
  }
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
        } catch {
          // already unloaded
        }
      }

      unlinkSync(PLIST_PATH);
      removeManagedSettings();
      console.log("[deja-daemon] LaunchAgent removed");
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
