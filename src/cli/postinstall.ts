#!/usr/bin/env node
/**
 * Runs automatically after `npm install -g deja-context`.
 * Silently configures Claude Code and starts/registers the deja daemon.
 * Never fails the npm install — all errors are caught and swallowed.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { spawn, execSync } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const PORT = 9090;
const HOME = homedir();
const DEJA_DIR = join(HOME, ".deja");
const PID_FILE = join(DEJA_DIR, "deja.pid");

const __dir = dirname(fileURLToPath(import.meta.url));
const DEJA_SCRIPT = join(__dir, "deja.js");
const NODE_EXE = process.execPath;

function log(msg: string): void {
  process.stdout.write(`[deja] ${msg}\n`);
}

// ── Claude Code settings detection ───────────────────────────────────────────

function findSettingsPaths(): string[] {
  const paths: string[] = [];

  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData) paths.push(join(appData, "Claude", "settings.json"));
    paths.push(join(HOME, ".claude", "settings.json"));
    const local = process.env["LOCALAPPDATA"];
    if (local) {
      paths.push(join(local, "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
      paths.push(join(local, "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
    }
  } else if (process.platform === "darwin") {
    paths.push(join(HOME, "Library", "Application Support", "Claude", "settings.json"));
    paths.push(join(HOME, ".claude", "settings.json"));
    paths.push(join(HOME, "Library", "Application Support", "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
  } else {
    paths.push(join(HOME, ".config", "Claude", "settings.json"));
    paths.push(join(HOME, ".claude", "settings.json"));
    const xdg = process.env["XDG_CONFIG_HOME"];
    if (xdg) paths.push(join(xdg, "Claude", "settings.json"));
  }

  return paths;
}

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xFEFF ? s.slice(1) : s;
}

function injectProxyUrl(configPath: string): boolean {
  const proxyUrl = `http://localhost:${PORT}`;
  try {
    const dir = dirname(configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let settings: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        settings = JSON.parse(stripBOM(readFileSync(configPath, "utf-8"))) as Record<string, unknown>;
      } catch {
        settings = {};
      }
    }

    // Check both possible locations for the env var
    const env = settings["env"];
    if (env && typeof env === "object" && !Array.isArray(env)) {
      const envObj = env as Record<string, unknown>;
      if (envObj["ANTHROPIC_BASE_URL"] === proxyUrl) return false;
      envObj["ANTHROPIC_BASE_URL"] = proxyUrl;
    } else {
      if (settings["ANTHROPIC_BASE_URL"] === proxyUrl) return false;
      settings["ANTHROPIC_BASE_URL"] = proxyUrl;
    }

    writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

function configureClaudeCode(): void {
  const allPaths = findSettingsPaths();
  const existingPaths = allPaths.filter((p) => existsSync(p));

  if (existingPaths.length > 0) {
    for (const p of existingPaths) {
      const changed = injectProxyUrl(p);
      if (changed) log(`Configured: ${p}`);
    }
  } else {
    // Create ~/.claude/settings.json as fallback
    const defaultPath = join(HOME, ".claude", "settings.json");
    injectProxyUrl(defaultPath);
    log(`Created: ${defaultPath}`);
  }
}

// ── Proxy health check ────────────────────────────────────────────────────────

function isProxyRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

// ── Daemon start ──────────────────────────────────────────────────────────────

function startDaemon(): void {
  if (!existsSync(DEJA_DIR)) mkdirSync(DEJA_DIR, { recursive: true });
  const child = spawn(NODE_EXE, [DEJA_SCRIPT, "start"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  if (child.pid) writeFileSync(PID_FILE, String(child.pid), "utf-8");
}

// ── Auto-start registration ───────────────────────────────────────────────────

function registerWindowsAutoStart(): void {
  const startupDir = join(
    process.env["APPDATA"] ?? HOME,
    "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
  );
  if (!existsSync(startupDir)) return;

  const vbsPath = join(startupDir, "deja-proxy.vbs");
  // Escape backslashes for VBScript string literals
  const nodeEsc = NODE_EXE.replace(/\\/g, "\\\\");
  const scriptEsc = DEJA_SCRIPT.replace(/\\/g, "\\\\");
  const vbs = [
    `Set WshShell = CreateObject("WScript.Shell")`,
    `WshShell.Run Chr(34) & "${nodeEsc}" & Chr(34) & " " & Chr(34) & "${scriptEsc}" & Chr(34) & " start", 0, False`,
  ].join("\r\n");
  writeFileSync(vbsPath, vbs, "utf-8");
}

function registerMacOSAutoStart(): void {
  const plistDir = join(HOME, "Library", "LaunchAgents");
  if (!existsSync(plistDir)) mkdirSync(plistDir, { recursive: true });

  const logOut = join(DEJA_DIR, "proxy.log");
  const plistPath = join(plistDir, "com.deja.proxy.plist");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.deja.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_EXE}</string>
    <string>${DEJA_SCRIPT}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logOut}</string>
  <key>StandardErrorPath</key><string>${logOut}</string>
</dict>
</plist>`;

  writeFileSync(plistPath, plist, "utf-8");
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: "ignore" });
  } catch { /* non-fatal */ }
}

function registerLinuxAutoStart(): void {
  const systemdDir = join(HOME, ".config", "systemd", "user");
  if (!existsSync(systemdDir)) mkdirSync(systemdDir, { recursive: true });

  const logFile = join(DEJA_DIR, "proxy.log");
  const servicePath = join(systemdDir, "deja-proxy.service");
  const service = [
    "[Unit]",
    "Description=Deja Context Engine Proxy",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${NODE_EXE} ${DEJA_SCRIPT} start`,
    "Restart=on-failure",
    "RestartSec=5s",
    `StandardOutput=append:${logFile}`,
    `StandardError=append:${logFile}`,
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n");

  writeFileSync(servicePath, service, "utf-8");
  try {
    execSync("systemctl --user daemon-reload && systemctl --user enable deja-proxy.service && systemctl --user start deja-proxy.service", { stdio: "ignore" });
  } catch { /* non-fatal */ }
}

function registerAutoStart(): void {
  try {
    if (process.platform === "win32") {
      registerWindowsAutoStart();
      log("Auto-start registered (Windows Startup folder)");
    } else if (process.platform === "darwin") {
      registerMacOSAutoStart();
      log("Auto-start registered (macOS LaunchAgent)");
    } else {
      registerLinuxAutoStart();
      log("Auto-start registered (Linux systemd)");
    }
  } catch (err) {
    log(`Auto-start registration skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    log("Setting up Deja...");

    // 1. Configure Claude Code → point it at localhost:9090
    try {
      configureClaudeCode();
    } catch (err) {
      log(`Claude Code config skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Start daemon if not already running
    try {
      const running = await isProxyRunning();
      if (!running) {
        startDaemon();
        log("Daemon started on port 9090");
      } else {
        log("Daemon already running on port 9090");
      }
    } catch (err) {
      log(`Daemon start skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Register system auto-start so it survives reboots
    registerAutoStart();

    log("Done. Deja runs automatically — no setup needed.");
  } catch (err) {
    // Never fail the npm install
    process.stdout.write(`[deja] postinstall warning: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

main().catch(() => {});
