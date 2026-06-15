import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname } from "path";
import { getDataWritePath } from "../config/data-paths.js";

// Writer may run as a LocalSystem service; resolve through data-paths so the
// CLI reader (see logs.ts) converges on the same file. See data-paths.ts.
const LOG_FILE = getDataWritePath("proxy.log");
const MAX_LOG_LINES = 10000;

function ensureLogDir(): void {
  const dir = dirname(LOG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
