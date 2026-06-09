import http from "http";

interface StatusOptions {
  port: number;
}

interface HealthResponse {
  status: string;
  uptime: number;
  requests: number;
  compressed: number;
  skipped: number;
  passthrough: number;
  tokensSaved: number;
  compressionPct: number;
  upstreamOk: boolean | null;
  upstreamLastError: string | null;
  retryCount: number;
  port: number;
}

function httpGetJson(url: string): Promise<HealthResponse | null> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        try { resolve(JSON.parse(body) as HealthResponse); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export async function statusCmd(opts: StatusOptions): Promise<void> {
  const healthUrl = `http://localhost:${opts.port}/health`;
  const dashboardUrl = `http://localhost:${opts.port}/__deja__`;

  console.log("");
  console.log("  Deja Status");
  console.log("  ───────────");
  console.log("");

  const health = await httpGetJson(healthUrl);

  if (!health) {
    console.log("  Proxy:       STOPPED");
    console.log("");
    console.log("  The proxy is not running on port " + opts.port + ".");
    console.log("");
    console.log("  Recovery actions:");
    console.log("    deja start               — start the proxy");
    console.log("    deja doctor              — run full diagnostics");
    console.log("");
    return;
  }

  // Status badge
  const badge = health.status === "ok" ? "RUNNING" : "DEGRADED";
  console.log(`  Proxy:       ${badge}`);
  console.log(`  Port:        ${health.port}`);
  console.log(`  Uptime:      ${formatUptime(health.uptime)}`);
  console.log(`  Dashboard:   ${dashboardUrl}`);
  console.log("");

  // Upstream
  console.log("  ── Upstream ──");
  if (health.upstreamOk === null) {
    console.log("  Status:      checking...");
  } else if (health.upstreamOk) {
    console.log("  Status:      reachable");
  } else {
    console.log("  Status:      UNREACHABLE");
    if (health.upstreamLastError) {
      console.log(`  Last error:  ${health.upstreamLastError}`);
    }
    console.log("");
    console.log("  Recovery actions:");
    console.log("    1. Check your network connection");
    console.log("    2. Verify API key is set:  $env:ANTHROPIC_API_KEY");
    console.log("    3. Check upstream URL in config");
  }
  console.log(`  Retries:     ${health.retryCount}`);
  console.log("");

  // Requests
  console.log("  ── Requests ──");
  console.log(`  Total:       ${health.requests}`);
  console.log(`  Compressed:  ${health.compressed}`);
  console.log(`  Skipped:     ${health.skipped} (below threshold)`);
  console.log(`  Passthrough: ${health.passthrough}`);
  console.log("");

  // Tokens
  console.log("  ── Tokens ──");
  console.log(`  Saved:       ${health.tokensSaved.toLocaleString()} tok`);
  console.log(`  Ratio:       ${health.compressionPct}%`);
  console.log("");
}
