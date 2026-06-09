import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LOG_DIR = join(homedir(), ".deja");
const LOG_FILE = join(LOG_DIR, "proxy.log");
const MAX_LOG_LINES = 10000;

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

export interface ProxyLogEntry {
  ts: string;
  type: "compression" | "upstream_error" | "retry" | "request" | "startup" | "shutdown" | "health";
  msg: string;
  data?: Record<string, unknown>;
}

export function writeProxyLog(entry: ProxyLogEntry): void {
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
    rotateLogIfNeeded();
  } catch {
    // Silent fail — logging is best-effort
  }
}

function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length > MAX_LOG_LINES) {
      const trimmed = lines.slice(-MAX_LOG_LINES / 2).join("\n") + "\n";
      writeFileSync(LOG_FILE, trimmed, "utf-8");
    }
  } catch {
    // ignore
  }
}
