import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { removeManagedSettings } from "../managed-settings.js";

const PID_FILE = join(homedir(), ".deja", "deja.pid");

export async function stop(): Promise<void> {
  console.log("");

  // Always clean up managed-settings.json when deja stop is called,
  // regardless of whether the daemon process is still alive.
  // This handles the crash case: process died but file was not removed.
  const cleanup = removeManagedSettings();
  if (cleanup.wasPresent) {
    console.log("  Removed routing config — Claude will connect directly after restart.");
  }

  if (!existsSync(PID_FILE)) {
    console.log("  No running Deja daemon found.");
    console.log("  (PID file does not exist at ~/.deja/deja.pid)");
    console.log("");
    return;
  }

  let pid: number;
  try {
    pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid) || pid <= 0) throw new Error("invalid pid");
  } catch {
    console.log("  PID file is corrupted. Removing it.");
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    console.log("");
    return;
  }

  // Check if process is actually running
  let running = false;
  try {
    if (process.platform === "win32") {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: "utf-8",
        windowsHide: true,
      });
      running = out.toLowerCase().includes("node") || out.toLowerCase().includes("deja");
    } else {
      execSync(`kill -0 ${pid}`, { stdio: "ignore" });
      running = true;
    }
  } catch {
    running = false;
  }

  if (!running) {
    console.log(`  Process ${pid} is not running. Cleaning up PID file.`);
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    console.log("");
    return;
  }

  // Kill the process
  console.log(`  Stopping Deja daemon (PID ${pid})...`);
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
    console.log(`  Deja stopped successfully.`);
  } catch {
    console.log(`  Could not stop process ${pid}. Try killing it manually.`);
  }

  // Clean up PID file
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }

  console.log("");
}
