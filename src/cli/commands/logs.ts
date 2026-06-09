import { existsSync, readFileSync, watchFile, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface LogsOptions {
  port: number;
  tail: number;
  follow: boolean;
}

const LOG_FILE = join(homedir(), ".deja", "proxy.log");

function colorize(line: string): string {
  try {
    const entry = JSON.parse(line) as { type: string; ts: string; msg: string; data?: Record<string, unknown> };
    const ts = entry.ts?.slice(11, 19) ?? "--:--:--";
    const type = entry.type ?? "unknown";
    const msg = entry.msg ?? "";

    switch (type) {
      case "compression": {
        const d = entry.data ?? {};
        return `  ${ts}  \x1b[32m[compress]\x1b[0m  ${msg}  (${d.durationMs ?? "?"}ms)`;
      }
      case "upstream_error":
        return `  ${ts}  \x1b[31m[upstream]\x1b[0m  \x1b[31m${msg}\x1b[0m`;
      case "retry":
        return `  ${ts}  \x1b[33m[retry]\x1b[0m    ${msg}`;
      case "request":
        return `  ${ts}  \x1b[36m[request]\x1b[0m   ${msg}`;
      case "startup":
        return `  ${ts}  \x1b[35m[startup]\x1b[0m   ${msg}`;
      case "shutdown":
        return `  ${ts}  \x1b[35m[shutdown]\x1b[0m  ${msg}`;
      case "health": {
        const recovered = msg.includes("recovered");
        return recovered
          ? `  ${ts}  \x1b[32m[health]\x1b[0m    ${msg}`
          : `  ${ts}  \x1b[31m[health]\x1b[0m    \x1b[31m${msg}\x1b[0m`;
      }
      default:
        return `  ${ts}  [${type}]  ${msg}`;
    }
  } catch {
    return `  ${line}`;
  }
}

function readTail(n: number): string[] {
  if (!existsSync(LOG_FILE)) return [];
  const content = readFileSync(LOG_FILE, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  return lines.slice(-n);
}

export async function logsCmd(opts: LogsOptions): Promise<void> {
  const tail = opts.tail;

  console.log("");
  console.log("  Deja Logs");
  console.log("  ─────────");
  console.log("");

  if (!existsSync(LOG_FILE)) {
    console.log("  No log file found at ~/.deja/proxy.log");
    console.log("  The proxy may not have been started yet.");
    console.log("");
    console.log("  Start it with:  deja start");
    console.log("");
    return;
  }

  // Print tail
  const tailLines = readTail(tail);
  if (tailLines.length === 0) {
    console.log("  (empty log file)");
  } else {
    for (const line of tailLines) {
      console.log(colorize(line));
    }
  }
  console.log("");

  if (!opts.follow) {
    if (tailLines.length >= tail) {
      console.log("  Showing last entries. Use -f to follow new events.");
    }
    console.log("");
    return;
  }

  // Follow mode
  console.log("  Streaming... (Ctrl+C to stop)");
  console.log("");

  let lastSize = 0;
  try { lastSize = statSync(LOG_FILE).size; } catch { lastSize = 0; }

  const watcher = watchFile(LOG_FILE, { interval: 500 }, (curr) => {
    if (curr.size > lastSize) {
      try {
        const fd = readFileSync(LOG_FILE, "utf-8");
        const all = fd.split("\n").filter(Boolean);
        // Rough estimate of new lines based on size delta
        const estimateNew = Math.min(all.length, Math.ceil((curr.size - lastSize) / 40) + 2);
        const newLines = all.slice(-estimateNew);
        for (const line of newLines) {
          console.log(colorize(line));
        }
      } catch { /* best effort */ }
      lastSize = curr.size;
    }
  });

  process.on("SIGINT", () => {
    watcher.unref();
    console.log("");
    console.log("  Stopped following.");
    console.log("");
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => { /* never resolves */ });
}
