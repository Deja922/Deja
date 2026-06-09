import http from "http";
import { Pipeline, loadConfig } from "@/core/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import type { IAdapter } from "./adapters/index.js";
import { detectAdapter } from "./detector.js";
import { forwardUpstream, passthrough, checkUpstreamHealth, isProviderReachable, getTotalRetries } from "./upstream.js";
import type { RuntimeConfig, ProviderConfig, CompressionMode } from "./config-types.js";
import { resolveEnv, DEFAULT_CONFIG, COMPRESSION_MODES } from "./config-types.js";
import { UpstreamResolver } from "./upstream-resolver.js";
import { renderDashboard } from "./dashboard.js";
import { writeProxyLog } from "./proxy-logger.js";
import { removeManagedSettings } from "../cli/managed-settings.js";

// ── session tracking ────────────────────────────────────────────────────────

const session = {
  requests: 0,
  compressed: 0,
  skipped: 0,
  passthrough: 0,
  totalOriginalTokens: 0,
  totalOutputTokens: 0,
  startTime: Date.now(),
  retryCount: 0,
  upstreamOk: true as boolean | null,
  upstreamStatus: null as string | null,
  lastUpstreamCheck: 0,
  upstreamLastError: null as string | null,
  lastRequestTokens: 0,
  lastRequestCompressed: null as boolean | null,
  bypass: false as boolean,
  bypassReason: null as string | null,
};

function sessionSummary(): string {
  const saved = session.totalOriginalTokens - session.totalOutputTokens;
  const pct =
    session.totalOriginalTokens > 0
      ? Math.round((1 - session.totalOutputTokens / session.totalOriginalTokens) * 100)
      : 0;
  const uptime = Math.round((Date.now() - session.startTime) / 1000);
  return (
    `[deja:session] uptime=${uptime}s requests=${session.requests}` +
    ` compressed=${session.compressed} skipped=${session.skipped} passthrough=${session.passthrough}` +
    ` total_saved=${saved}tok (${pct}%)` +
    ` ${session.totalOriginalTokens}->${session.totalOutputTokens}`
  );
}

// ── periodic upstream health check ──────────────────────────────────────────

let _healthCheckTimer: ReturnType<typeof setInterval> | null = null;

function startUpstreamHealthCheck(getProvider: () => ProviderConfig): void {
  // Initial check after 5s (give server time to start)
  setTimeout(async () => {
    try {
      const result = await checkUpstreamHealth(getProvider());
      session.upstreamOk = isProviderReachable(result);
      session.upstreamStatus = result.status;
      session.lastUpstreamCheck = Date.now();
      if (!session.upstreamOk) {
        session.upstreamLastError = result.error ?? `Provider unreachable (${result.status})`;
        writeProxyLog({ ts: new Date().toISOString(), type: "health", msg: `upstream ${result.status}`, data: { upstream: getProvider().baseUrl, status: result.status, error: result.error } });
      }
    } catch {
      session.upstreamOk = false;
      session.upstreamStatus = "network_error";
    }
  }, 5000);

  // Periodic check every 60s
  _healthCheckTimer = setInterval(async () => {
    try {
      const wasOk = session.upstreamOk;
      const result = await checkUpstreamHealth(getProvider());
      session.upstreamOk = isProviderReachable(result);
      session.upstreamStatus = result.status;
      session.lastUpstreamCheck = Date.now();
      if (wasOk && !session.upstreamOk) {
        session.upstreamLastError = result.error ?? `Provider became unreachable (${result.status})`;
        writeProxyLog({ ts: new Date().toISOString(), type: "health", msg: `upstream became ${result.status}`, data: { status: result.status, error: result.error } });
      } else if (!wasOk && session.upstreamOk) {
        session.upstreamLastError = null;
        writeProxyLog({ ts: new Date().toISOString(), type: "health", msg: "upstream recovered" });
      }
    } catch {
      session.upstreamOk = false;
      session.upstreamStatus = "network_error";
    }
  }, 60000);
}

function stopUpstreamHealthCheck(): void {
  if (_healthCheckTimer) {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = null;
  }
}

// ── registered adapters ─────────────────────────────────────────────────────

const ADAPTERS: IAdapter[] = [
  new AnthropicAdapter(),
  new OpenAIAdapter(),
];

// ── server entry ────────────────────────────────────────────────────────────

export interface ProxyOptions {
  port?: number | undefined;
  targetTokens?: number | undefined;
  maxTokens?: number | undefined;
  mode?: string | undefined;
  verbose?: boolean | undefined;
  upstream?: string | undefined;
  config?: RuntimeConfig | undefined;
  /** Explicit Claude Code settings.json path for follow-mode (tests). */
  claudeSettingsPath?: string | undefined;
}

export function startProxy(opts: ProxyOptions = {}): http.Server {
  const verbose = opts.verbose ?? true;

  // Build effective config: CLI flags override config file
  const config = opts.config ?? DEFAULT_CONFIG;

  // Apply compression mode (CLI --target-tokens / --max-tokens override mode defaults)
  const effectiveMode = (opts.mode ?? config.pipeline.mode) as CompressionMode | undefined;
  if (effectiveMode && effectiveMode in COMPRESSION_MODES) {
    const ms = COMPRESSION_MODES[effectiveMode];
    config.pipeline.mode = effectiveMode;
    config.pipeline.targetTokens = ms.targetTokens;
    config.pipeline.maxTokens = ms.maxTokens;
    config.pipeline.compressThreshold = ms.compressThreshold;
  }

  if (opts.port !== undefined) config.port = opts.port;
  if (opts.targetTokens !== undefined) config.pipeline.targetTokens = opts.targetTokens;
  if (opts.maxTokens !== undefined) config.pipeline.maxTokens = opts.maxTokens;

  // If --upstream is given, use it as a single-provider fallback
  const upstreamUrl = opts.upstream ?? process.env["DEJA_UPSTREAM"];
  let fallbackProvider: ProviderConfig | undefined;
  if (upstreamUrl) {
    fallbackProvider = { baseUrl: upstreamUrl, apiKey: process.env["ANTHROPIC_API_KEY"] };
  }

  function getProvider(): ProviderConfig {
    const name = config.defaultProvider;
    if (config.providers[name]) {
      const p = config.providers[name]!;
      return {
        baseUrl: resolveEnv(p.baseUrl),
        apiKey: p.apiKey ? resolveEnv(p.apiKey) : undefined,
        compatMode: p.compatMode,
      };
    }
    if (fallbackProvider) return fallbackProvider;
    return { baseUrl: "https://api.anthropic.com", apiKey: process.env["ANTHROPIC_API_KEY"] };
  }

  const pipeline = new Pipeline();
  const staticProvider = getProvider();

  // Follow mode: when no upstream is pinned via --upstream / DEJA_UPSTREAM,
  // track the live provider from Claude Code's settings.json (CC Switch
  // compatible, read-only). An explicit upstream pins a static provider.
  const followMode = !upstreamUrl;
  const resolver = followMode
    ? new UpstreamResolver({
        fallback: staticProvider,
        selfPort: config.port,
        verbose,
        settingsPath: opts.claudeSettingsPath,
      })
    : null;
  const currentProvider = (): ProviderConfig =>
    resolver ? resolver.getProvider() : staticProvider;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks);
      // Resolve the live upstream once per request (follow mode re-reads
      // Claude Code's settings.json; static mode returns the pinned provider).
      const provider = currentProvider();

      // ── bypass 控制端点（托盘/高级用户使用）──────────────────────────
      // POST /deja/bypass — 切换为透传模式，不停服务，不重启 Claude
      // POST /deja/resume — 恢复压缩模式
      if (req.method === "POST" && req.url === "/deja/bypass") {
        session.bypass = true;
        session.bypassReason = (req.headers["x-deja-reason"] as string | undefined) ?? "user";
        writeProxyLog({ ts: new Date().toISOString(), type: "startup", msg: "bypass enabled", data: { reason: session.bypassReason } });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, bypass: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/deja/resume") {
        session.bypass = false;
        session.bypassReason = null;
        writeProxyLog({ ts: new Date().toISOString(), type: "startup", msg: "bypass disabled" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, bypass: false }));
        return;
      }

      // ── built-in endpoints ──────────────────────────────────────────
      if (req.method === "GET" && req.url === "/health") {
        session.retryCount = getTotalRetries();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: session.upstreamOk === false ? "degraded" : "ok",
          bypass: session.bypass,
          bypassReason: session.bypassReason,
          uptime: Math.round((Date.now() - session.startTime) / 1000),
          requests: session.requests,
          compressed: session.compressed,
          skipped: session.skipped,
          passthrough: session.passthrough,
          tokensSaved: session.totalOriginalTokens - session.totalOutputTokens,
          compressionPct: session.totalOriginalTokens > 0
            ? Math.round((1 - session.totalOutputTokens / session.totalOriginalTokens) * 100)
            : 0,
          upstreamOk: session.upstreamOk,
          upstreamStatus: session.upstreamStatus,
          upstreamLastError: session.upstreamLastError,
          retryCount: session.retryCount,
          port: config.port,
          mode: config.pipeline.mode ?? "production",
          targetTokens: config.pipeline.targetTokens,
          maxTokens: config.pipeline.maxTokens,
          compressThreshold: config.pipeline.compressThreshold,
          lastRequestTokens: session.lastRequestTokens,
          lastRequestCompressed: session.lastRequestCompressed,
        }));
        return;
      }

      if (req.method === "GET" && req.url === "/__deja__") {
        session.retryCount = getTotalRetries();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderDashboard({
          ...session,
          mode: config.pipeline.mode ?? "production",
          targetTokens: config.pipeline.targetTokens,
          maxTokens: config.pipeline.maxTokens,
          compressThreshold: config.pipeline.compressThreshold,
        }));
        return;
      }

      session.requests++;

      // bypass 模式：跳过所有压缩，直接透传（不停服务，不重启 Claude）
      if (session.bypass) {
        session.passthrough++;
        passthrough(req, rawBody, res, provider, "bypass", verbose);
        return;
      }

      // Detect which adapter handles this request
      const adapter = detectAdapter(req, ADAPTERS);

      if (!adapter) {
        session.passthrough++;
        passthrough(req, rawBody, res, provider, "unknown-endpoint", verbose);
        return;
      }

      if (req.method !== "POST") {
        session.passthrough++;
        passthrough(req, rawBody, res, provider, "non-POST", verbose);
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody.toString()) as Record<string, unknown>;
      } catch {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }

      // Parse request into internal Context format
      const { context: rawCtx, records } = adapter.requestToContext(body);
      const rawTokens = estimateTokens(rawCtx);

      if (verbose) {
        const msgCount = (body["messages"] as unknown[])?.length ?? 0;
        const structuredCount = records.filter((r) => r.hasStructuredBlocks).length;
        process.stderr.write(
          `[deja] POST ${req.url} msgs=${msgCount} ~${rawTokens}tok` +
            ` sys=${rawCtx.systemPrompt ? "yes" : "no"}` +
            ` structured=${structuredCount}\n`
        );
      }

      writeProxyLog({
        ts: new Date().toISOString(), type: "request",
        msg: `POST ${req.url ?? ""} msgs=${rawCtx.messages.length} ~${rawTokens}tok`,
        data: { url: req.url, messageCount: rawCtx.messages.length, rawTokens },
      });

      // Below threshold → skip compression, forward as-is
      const threshold = config.pipeline.compressThreshold;
      if (rawTokens < threshold) {
        session.skipped++;
        session.lastRequestTokens = rawTokens;
        session.lastRequestCompressed = false;
        if (verbose) {
          process.stderr.write(
            `[deja] compression skipped (context below threshold: ${rawTokens}tok < ${threshold}tok)\n`
          );
        }
        passthrough(req, rawBody, res, provider, `${rawTokens}tok<threshold`, verbose);
        return;
      }

      // Run the pipeline
      const pipelineConfig = await loadConfig({
        maxTokens: config.pipeline.maxTokens,
        targetTokens: config.pipeline.targetTokens,
        memoryEnabled: config.pipeline.memoryEnabled,
      });
      let pipelineResult: { context: typeof rawCtx; stats: { originalTokens: number; outputTokens: number; messagesDropped: number; messagesSummarized: number; durationMs: number } };
      try {
        pipelineResult = await pipeline.run(rawCtx, pipelineConfig);
      } catch (pipelineErr) {
        // Pipeline failure is non-fatal: forward the original request unchanged.
        const msg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
        process.stderr.write(`[deja] pipeline error (forwarding original): ${msg}\n`);
        writeProxyLog({ ts: new Date().toISOString(), type: "upstream_error", msg: `pipeline error → passthrough: ${msg}` });
        session.passthrough++;
        passthrough(req, rawBody, res, provider, "pipeline-error", verbose);
        return;
      }
      const { context: compressed, stats } = pipelineResult;

      const saved = stats.originalTokens - stats.outputTokens;
      const pct = Math.round(
        (1 - stats.outputTokens / Math.max(stats.originalTokens, 1)) * 100,
      );

      session.compressed++;
      session.totalOriginalTokens += stats.originalTokens;
      session.totalOutputTokens += stats.outputTokens;
      session.lastRequestTokens = rawTokens;
      session.lastRequestCompressed = true;

      if (verbose) {
        process.stderr.write(
          `[deja] compressed ${stats.originalTokens}->${stats.outputTokens}tok` +
            ` -${pct}% (~${saved} saved)` +
            ` dropped=${stats.messagesDropped} summarized=${stats.messagesSummarized}` +
            ` ${stats.durationMs}ms\n`
        );
        process.stderr.write(`${sessionSummary()}\n`);
      }

      writeProxyLog({
        ts: new Date().toISOString(), type: "compression",
        msg: `${stats.originalTokens}->${stats.outputTokens}tok -${pct}%`,
        data: {
          originalTokens: stats.originalTokens, outputTokens: stats.outputTokens,
          saved, pct, dropped: stats.messagesDropped, summarized: stats.messagesSummarized,
          durationMs: stats.durationMs,
        },
      });

      // Rebuild provider-native request body.
      // Detect interleaved thinking so historical thinking blocks are handled
      // correctly (interleaved requires the full chain; standard does not).
      const betaHeader = String(req.headers["anthropic-beta"] ?? "");
      const interleavedThinking = betaHeader.includes("interleaved-thinking");
      const newBody = adapter.contextToRequest(compressed, records, body, { interleavedThinking });

      // Safety net: never forward an empty messages array. If compression
      // dropped every message (e.g. a small conversation pushed over the
      // threshold only by a large system prompt), the upstream would reject it
      // with "at least one message is required". Fall back to the original
      // request untouched so the conversation always goes through.
      const rebuiltMessages = (newBody as { messages?: unknown }).messages;
      const originalMessages = body["messages"];
      const rebuiltEmpty = !Array.isArray(rebuiltMessages) || rebuiltMessages.length === 0;
      const originalHadMessages = Array.isArray(originalMessages) && originalMessages.length > 0;
      if (rebuiltEmpty && originalHadMessages) {
        if (verbose) {
          process.stderr.write(
            "[deja] compression produced an empty messages array — forwarding original request unchanged\n"
          );
        }
        writeProxyLog({
          ts: new Date().toISOString(), type: "compression",
          msg: "empty-messages fallback → forwarding original request",
          data: { originalMessageCount: (originalMessages as unknown[]).length },
        });
        passthrough(req, rawBody, res, provider, "empty-after-compression", verbose);
        return;
      }

      const newBodyBuf = Buffer.from(JSON.stringify(newBody));

      // Forward to upstream
      forwardUpstream(req, newBodyBuf, res, provider, verbose);
    });

    req.on("error", () => {
      res.writeHead(500);
      res.end("Internal Server Error");
    });
  });

  // ── graceful shutdown ─────────────────────────────────────────────────────

  function gracefulShutdown(signal: string): void {
    writeProxyLog({ ts: new Date().toISOString(), type: "shutdown", msg: `received ${signal}` });
    process.stderr.write(`\n[deja] received ${signal}, shutting down...\n`);
    // Remove managed-settings.json so Claude Code falls back to its direct provider immediately.
    // In service mode (DEJA_SERVICE_MODE=1) we keep the file — the service will auto-restart
    // and managed-settings must always point to Deja.
    if (!process.env["DEJA_SERVICE_MODE"]) {
      const cleanup = removeManagedSettings();
      if (cleanup.wasPresent) {
        process.stderr.write("[deja] managed-settings.json removed — Claude will connect directly\n");
        process.stderr.write("[deja] Note: restart Claude Code (or open a new session) to use direct connection\n");
      }
    }
    stopUpstreamHealthCheck();
    resolver?.stop();
    server.close(() => {
      process.stderr.write("[deja] server closed\n");
      process.exit(0);
    });
    setTimeout(() => {
      process.stderr.write("[deja] force exit after timeout\n");
      process.exit(1);
    }, 5000);
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    writeProxyLog({ ts: new Date().toISOString(), type: "upstream_error", msg: err.message });
    process.stderr.write(`[deja] uncaught exception: ${err.message}\n`);
    process.stderr.write("[deja] proxy will continue running. Restart with: deja start\n");
    // Don't exit — keep proxy alive
  });

  // ── startup ───────────────────────────────────────────────────────────────

  server.listen(config.port, () => {
    // Start following Claude Code's settings.json (follow mode only)
    resolver?.start();
    // Start upstream health monitoring
    startUpstreamHealthCheck(currentProvider);

    const providerName = Object.keys(config.providers)[0] ?? "cli";
    const p = config.providers[providerName];
    const upstreamDisplay = followMode
      ? `${currentProvider().baseUrl} (auto · follows Claude settings)`
      : p
        ? resolveEnv(p.baseUrl)
        : upstreamUrl ?? "https://api.anthropic.com";

    // Startup banner
    const modeLabel = config.pipeline.mode ?? "production";
    console.log("");
    console.log("  ┌────────────────────────────────────────┐");
    console.log("  │      Deja Context Engine v0.1.0        │");
    console.log("  └────────────────────────────────────────┘");
    console.log("");
    console.log(`  Mode:         ${modeLabel}`);
    console.log(`  Dashboard:    http://localhost:${config.port}/__deja__`);
    console.log(`  Health:       http://localhost:${config.port}/health`);
    console.log(`  Upstream:     ${upstreamDisplay}`);
    console.log(`  Port:         ${config.port}`);
    console.log(`  Pipeline:     target=${config.pipeline.targetTokens}tok, ceiling=${config.pipeline.maxTokens}tok`);
    console.log(`  Threshold:    ${config.pipeline.compressThreshold}tok`);
    console.log(`  Memory:       ${config.pipeline.memoryEnabled ? "enabled" : "disabled"}`);
    console.log("");
    if (p?.compatMode) {
      console.log(`  Provider:     ${providerName} (${p.compatMode} compatible)`);
    } else {
      console.log(`  Provider:     ${providerName}`);
    }
    console.log("");
    console.log("  Claude Code config:");
    console.log(`    ANTHROPIC_BASE_URL = http://localhost:${config.port}`);
    console.log("");
    console.log("  Commands:");
    console.log("    deja status     — show proxy status");
    console.log("    deja logs       — stream proxy logs");
    console.log("    deja dashboard  — open web UI");
    console.log("");

    writeProxyLog({
      ts: new Date().toISOString(), type: "startup",
      msg: `proxy started on port ${config.port}`,
      data: { port: config.port, upstream: upstreamDisplay, ...config.pipeline },
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(`\n[deja] ERROR: Port ${config.port} is already in use.\n`);
      process.stderr.write(`[deja] Another instance may be running. Try:\n`);
      process.stderr.write(`[deja]   deja status              — check if already running\n`);
      process.stderr.write(`[deja]   deja start --port 9091   — use a different port\n`);
    } else {
      process.stderr.write(`[deja] ERROR: ${err.message}\n`);
    }
    process.exit(1);
  });

  return server;
}
