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
import { incrementUsage, getUsageStatus } from "../cli/usage.js";
import { getLicenseStatus } from "../cli/license.js";

// ── registered adapters ─────────────────────────────────────────────────────

// ── registered adapters ─────────────────────────────────────────────────────

const ADAPTERS: IAdapter[] = [
  new AnthropicAdapter(),
  new OpenAIAdapter(),
];

function requestLooksOpenAI(url: string | undefined): boolean {
  if (!url) return false;
  return /^\/v1\/(responses|chat\/completions)(?:\/|$|\?)/.test(url);
}

function providerLooksAnthropic(provider: ProviderConfig): boolean {
  if (provider.compatMode === "anthropic") return true;
  return /\/anthropic\b/i.test(provider.baseUrl);
}

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

  // ── per-instance session (not module-level — avoids state bleed between tests) ──
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
    licenseLimitReached: false as boolean,
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

  let _healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  function startUpstreamHealthCheck(getProvider: () => ProviderConfig): void {
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

  function resolveConfiguredProvider(name: string): ProviderConfig | null {
    const p = config.providers[name];
    if (!p) return null;
    return {
      baseUrl: resolveEnv(p.baseUrl),
      apiKey: p.apiKey ? resolveEnv(p.apiKey) : undefined,
      compatMode: p.compatMode,
    };
  }

  function findOpenAIProvider(): ProviderConfig | null {
    for (const name of Object.keys(config.providers)) {
      const candidate = resolveConfiguredProvider(name);
      if (!candidate) continue;
      if (!providerLooksAnthropic(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  const pipeline = new Pipeline();
  const staticProvider = getProvider();
  const openAIProvider = findOpenAIProvider() ?? (providerLooksAnthropic(staticProvider) ? null : staticProvider);

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
  const currentProvider = (requestUrl: string | undefined): ProviderConfig => {
    if (!resolver) return staticProvider;
    // In follow mode, Claude requests should follow Claude settings.
    // OpenAI-style requests (Codex/Cursor) should keep using the static Deja provider.
    if (requestLooksOpenAI(requestUrl)) {
      return openAIProvider ?? staticProvider;
    }
    return resolver.getProvider();
  };
  const healthProvider = (): ProviderConfig =>
    resolver ? resolver.getProvider() : staticProvider;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks);
      // Resolve the live upstream once per request (follow mode re-reads
      // Claude Code's settings.json; static mode returns the pinned provider).
      const provider = currentProvider(req.url);

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
          ...(() => { const u = getUsageStatus(); return { licenseMonthlyUsage: u.count, licenseMonthlyLimit: u.limit, licenseLimitReached: u.limitReached }; })(),
          ...(() => { const l = getLicenseStatus(); const tier = l.valid && l.tier ? l.tier : ("free" as const); return l.valid && l.email && l.expiry ? { licenseTier: tier, licenseEmail: l.email, licenseExpiry: l.expiry } : { licenseTier: tier }; })(),
        }));
        return;
      }

      if (req.method === "GET" && req.url === "/__deja__") {
        session.retryCount = getTotalRetries();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderDashboard({
          ...session,
          port: config.port,
          mode: config.pipeline.mode ?? "production",
          targetTokens: config.pipeline.targetTokens,
          maxTokens: config.pipeline.maxTokens,
          compressThreshold: config.pipeline.compressThreshold,
          ...(() => { const u = getUsageStatus(); return { licenseMonthlyUsage: u.count, licenseMonthlyLimit: u.limit, licenseLimitReached: u.limitReached }; })(),
          ...(() => { const l = getLicenseStatus(); const tier = l.valid && l.tier ? l.tier : ("free" as const); return l.valid && l.email && l.expiry ? { licenseTier: tier, licenseEmail: l.email, licenseExpiry: l.expiry } : { licenseTier: tier }; })(),
        }));
        return;
      }

      session.requests++;

      // 用户手动暂停：直接透传，跳过所有处理
      if (session.bypass && (session.bypassReason === "user" || session.bypassReason === null)) {
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
      // Claude Code sends heavy tool_use/tool_result blocks that extractMessageText
      // strips out — use the full JSON body size as the token estimate for threshold
      // decisions so agentic sessions actually trigger compression.
      const fullBodyTokens = Math.ceil(rawBody.length / 4);
      const effectiveTokens = Math.max(rawTokens, fullBodyTokens);

      // 智能自动 bypass（auto-high-compression）：已经进入安全模式，检查是否可以自动恢复
      // 恢复条件：消息数 ≤ 2（新对话开始）或上下文缩小到阈值以下
      // 注意：不能只用 effectiveTokens < threshold，因为 Claude Code 每次请求都携带
      // 完整 system prompt（~5000-8000 tok），effectiveTokens 永远不会低于 200。
      if (session.bypass && session.bypassReason === "auto-high-compression") {
        const msgCount = (body["messages"] as unknown[] | undefined)?.length ?? 0;
        const isNewConversation = msgCount <= 2;
        const threshold = config.pipeline.compressThreshold;
        if (isNewConversation || effectiveTokens < threshold) {
          session.bypass = false;
          session.bypassReason = null;
          if (verbose) {
            const reason = isNewConversation ? `new conversation (msgs=${msgCount})` : `context shrunk to ${rawTokens}tok`;
            process.stderr.write(`[deja] ⚡ auto-resume: ${reason}\n`);
          }
          writeProxyLog({ ts: new Date().toISOString(), type: "startup", msg: "auto-resume", data: { msgCount, rawTokens, threshold } });
          // Fall through to normal compression
        } else {
          session.passthrough++;
          if (verbose) {
            process.stderr.write(`[deja] ⚡ auto-bypass passthrough: context=${rawTokens}tok msgs=${msgCount} still large\n`);
          }
          passthrough(req, rawBody, res, provider, "auto-bypass", verbose);
          return;
        }
      }

      if (verbose) {
        const msgCount = (body["messages"] as unknown[])?.length ?? 0;
        const structuredCount = records.filter((r) => r.hasStructuredBlocks).length;
        process.stderr.write(
          `[deja] POST ${req.url} msgs=${msgCount} ~${effectiveTokens}tok (text=${rawTokens} body=${fullBodyTokens})` +
            ` sys=${rawCtx.systemPrompt ? "yes" : "no"}` +
            ` structured=${structuredCount}\n`
        );
      }

      writeProxyLog({
        ts: new Date().toISOString(), type: "request",
        msg: `POST ${req.url ?? ""} msgs=${rawCtx.messages.length} ~${effectiveTokens}tok`,
        data: { url: req.url, messageCount: rawCtx.messages.length, rawTokens, fullBodyTokens },
      });

      // Below threshold → skip compression, forward as-is
      const threshold = config.pipeline.compressThreshold;
      if (effectiveTokens < threshold) {
        session.skipped++;
        session.lastRequestTokens = effectiveTokens;
        session.lastRequestCompressed = false;
        if (verbose) {
          process.stderr.write(
            `[deja] compression skipped (context below threshold: ${effectiveTokens}tok < ${threshold}tok)\n`
          );
        }
        passthrough(req, rawBody, res, provider, `${effectiveTokens}tok<threshold`, verbose);
        return;
      }

      // License enforcement: FREE users limited to 100 compressions/month.
      // Over-limit requests are passthroughed silently — Claude keeps working.
      const usageStatus = getUsageStatus();
      if (usageStatus.limitReached) {
        session.licenseLimitReached = true;
        session.passthrough++;
        session.lastRequestTokens = rawTokens;
        session.lastRequestCompressed = false;
        if (verbose) {
          process.stderr.write(
            `[deja] 🔒 license limit reached (${usageStatus.count}/${usageStatus.limit ?? "∞"}/mo) — passthrough\n`
          );
        }
        passthrough(req, rawBody, res, provider, "license-limit", verbose);
        return;
      }

      // Run the pipeline — progressive two-level compression strategy:
      // Level 1 (light): targetTokens * 1.15 — preserves more content, lower compression ratio.
      // Level 2 (deep):  targetTokens        — used only if light pass is still too aggressive.
      // Auto-bypass only fires if even the deep pass hits ≥ AUTO_BYPASS_THRESHOLD.
      const lightTargetTokens = Math.min(
        config.pipeline.maxTokens - 500,
        Math.round(config.pipeline.targetTokens * 1.15),
      );
      const lightPipelineConfig = await loadConfig({
        maxTokens: config.pipeline.maxTokens,
        targetTokens: lightTargetTokens,
        memoryEnabled: config.pipeline.memoryEnabled,
      });
      const deepPipelineConfig = await loadConfig({
        maxTokens: config.pipeline.maxTokens,
        targetTokens: config.pipeline.targetTokens,
        memoryEnabled: config.pipeline.memoryEnabled,
      });
      let pipelineResult: { context: typeof rawCtx; stats: { originalTokens: number; outputTokens: number; messagesDropped: number; messagesSummarized: number; durationMs: number } };
      try {
        const lightResult = await pipeline.run(rawCtx, lightPipelineConfig);
        const lightRatio = 1 - lightResult.stats.outputTokens / Math.max(lightResult.stats.originalTokens, 1);
        if (lightRatio < 0.85) {
          // Light pass is not over-aggressive — use it
          pipelineResult = lightResult;
          if (verbose && lightRatio > 0) {
            process.stderr.write(`[deja] progressive: light pass ratio=${Math.round(lightRatio * 100)}% — using light result\n`);
          }
        } else {
          // Light pass still too aggressive — try deep pass
          if (verbose) {
            process.stderr.write(`[deja] progressive: light pass ratio=${Math.round(lightRatio * 100)}% ≥ 85% — falling to deep pass\n`);
          }
          pipelineResult = await pipeline.run(rawCtx, deepPipelineConfig);
        }
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

      // Rebuild provider-native request body FIRST so we can check for empty
      // messages before recording any session stats.
      const betaHeader = String(req.headers["anthropic-beta"] ?? "");
      const interleavedThinking = betaHeader.includes("interleaved-thinking");
      const newBody = adapter.contextToRequest(compressed, records, body, { interleavedThinking });

      // Safety net: never forward an empty messages array. If compression
      // dropped every message, fall back to the original request untouched.
      // Do NOT record session stats for this case — the original tokens are
      // forwarded unchanged, so counting outputTokens=0 would inflate compressionPct.
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
        session.passthrough++;
        passthrough(req, rawBody, res, provider, "empty-after-compression", verbose);
        return;
      }

      // Serialize compressed body now so we can use the actual byte size for
      // stats — body-level sizes correctly account for tool blocks that
      // text-only token estimates would miss entirely.
      const newBodyBuf = Buffer.from(JSON.stringify(newBody));

      // Record stats only after confirming the compressed request is valid.
      // Use actual body sizes (not text-only estimates) so tool-heavy Claude Code
      // sessions show real savings — text-only counts miss the tool blocks entirely.
      const outputBodyTokens = Math.ceil(newBodyBuf.length / 4);
      const saved = fullBodyTokens - outputBodyTokens;
      const pct = Math.round(
        (1 - outputBodyTokens / Math.max(fullBodyTokens, 1)) * 100,
      );

      session.compressed++;
      session.totalOriginalTokens += fullBodyTokens;
      session.totalOutputTokens += outputBodyTokens;
      session.lastRequestTokens = rawTokens;
      session.lastRequestCompressed = true;
      incrementUsage();

      // 智能自动 bypass：仅当 pipeline 真正大量丢弃消息（messagesDropped > 3）
      // 且字节压缩率 ≥95% 时才进入安全模式。
      // 普通的 tool_result 内容替换（compressOldToolContent）会产生高字节压缩率
      // 但不丢弃消息，这种情况是正常且安全的，不应触发 bypass。
      const AUTO_BYPASS_THRESHOLD = 95;
      const AUTO_BYPASS_MIN_DROPS = 3;
      if (!session.bypass && pct >= AUTO_BYPASS_THRESHOLD && stats.messagesDropped > AUTO_BYPASS_MIN_DROPS) {
        session.bypass = true;
        session.bypassReason = "auto-high-compression";
        if (verbose) {
          process.stderr.write(
            `[deja] ⚡ auto-bypass triggered: compression=${pct}% dropped=${stats.messagesDropped} — entering safe mode\n`
          );
        }
        writeProxyLog({
          ts: new Date().toISOString(), type: "compression",
          msg: `auto-bypass triggered: ${pct}% compression, ${stats.messagesDropped} messages dropped`,
          data: { pct, messagesDropped: stats.messagesDropped, originalTokens: stats.originalTokens, outputTokens: stats.outputTokens },
        });
      }

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
    startUpstreamHealthCheck(healthProvider);

    const providerName = Object.keys(config.providers)[0] ?? "cli";
    const p = config.providers[providerName];
    const upstreamDisplay = followMode
      ? `${healthProvider().baseUrl} (auto · follows Claude settings)`
      : p
        ? resolveEnv(p.baseUrl)
        : upstreamUrl ?? "https://api.anthropic.com";

    // Startup banner
    const modeLabel = config.pipeline.mode ?? "production";
    console.log("");
    console.log("  ----------------------------------------");
    console.log("      Deja Context Engine v0.1.1");
    console.log("  ----------------------------------------");
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
    console.log("    deja status     - show proxy status");
    console.log("    deja logs       - stream proxy logs");
    console.log("    deja dashboard  - open web UI");
    console.log("");

    // License status (non-blocking, best-effort)
    import("../cli/license.js").then(({ getLicenseStatus }) => {
      try {
        const lic = getLicenseStatus();
        if (lic.valid) {
          const exp = new Date(lic.expiry!).toLocaleDateString();
          console.log(`  License:      ${(lic.tier ?? "").toUpperCase()} - ${lic.email} (expires ${exp})`);
        } else {
          console.log("  License:      FREE BETA (unlimited during public beta)");
        }
        console.log("");
      } catch { /* ignore */ }
    }).catch(() => { /* ignore */ });

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
      process.stderr.write("[deja]   deja status              - check if already running\n");
      process.stderr.write("[deja]   deja start --port 9091   - use a different port\n");
    } else {
      process.stderr.write(`[deja] ERROR: ${err.message}\n`);
    }
    process.exit(1);
  });

  return server;
}
