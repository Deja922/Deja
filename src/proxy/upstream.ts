import http from "http";
import https from "https";
import type { IncomingMessage, ServerResponse } from "http";
import type { ProviderConfig } from "./config-types.js";
import { writeProxyLog } from "./proxy-logger.js";

// ── Health check types ────────────────────────────────────────────────────────

export type HealthStatus = "reachable" | "auth_error" | "endpoint_not_found" | "network_error";

export interface UpstreamHealthResult {
  status: HealthStatus;
  endpoint: string | null;       // which endpoint responded
  httpStatus: number | null;     // HTTP status code from provider
  error: string | null;          // human-readable error message
}

// ── Retry configuration ─────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const UPSTREAM_TIMEOUT_MS = 30000;

interface RetryState {
  attempt: number;
  lastError: string | null;
}

const retryStates = new Map<string, RetryState>();

/** Return total retry attempts across all providers (for health/status reporting) */
export function getTotalRetries(): number {
  let total = 0;
  for (const state of retryStates.values()) {
    total += state.attempt;
  }
  return total;
}

function getRetryState(provider: ProviderConfig): RetryState {
  const key = provider.baseUrl;
  if (!retryStates.has(key)) {
    retryStates.set(key, { attempt: 0, lastError: null });
  }
  return retryStates.get(key)!;
}

function resetRetryState(provider: ProviderConfig): void {
  const key = provider.baseUrl;
  retryStates.set(key, { attempt: 0, lastError: null });
}

// ── Main forward function ──────────────────────────────────────────────────

export function forwardUpstream(
  req: IncomingMessage,
  body: Buffer,
  res: ServerResponse,
  provider: ProviderConfig,
  verbose: boolean,
): void {
  const state = getRetryState(provider);
  state.attempt = 0;
  doForward(req, body, res, provider, verbose, state);
}

function doForward(
  req: IncomingMessage,
  body: Buffer,
  res: ServerResponse,
  provider: ProviderConfig,
  verbose: boolean,
  state: RetryState,
): void {
  const upstreamUrl = new URL(provider.baseUrl);
  const transport = upstreamTransport(upstreamUrl);

  const options = {
    hostname: upstreamUrl.hostname,
    port: upstreamPort(upstreamUrl),
    path: upstreamPath(upstreamUrl, req.url),
    method: req.method,
    headers: upstreamHeaders(req, upstreamUrl, provider, body.length),
    timeout: UPSTREAM_TIMEOUT_MS,
  };

  const upstreamReq = transport.request(options, (upRes) => {
    // Success — reset retry state
    resetRetryState(provider);

    res.writeHead(upRes.statusCode ?? 200, upRes.headers);
    upRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    state.attempt++;
    state.lastError = err.message;

    if (verbose) {
      const msg = `[deja] upstream error (attempt ${state.attempt}/${MAX_RETRIES}): ${err.message}`;
      process.stderr.write(`${msg}\n`);
    }

    writeProxyLog({
      ts: new Date().toISOString(), type: "upstream_error",
      msg: `${provider.baseUrl}: ${err.message}`,
      data: { attempt: state.attempt, maxRetries: MAX_RETRIES },
    });

    if (state.attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, state.attempt - 1);
      writeProxyLog({
        ts: new Date().toISOString(), type: "retry",
        msg: `retry ${state.attempt}/${MAX_RETRIES} in ${delay}ms`,
        data: { attempt: state.attempt, delay },
      });
      if (verbose) {
        process.stderr.write(`[deja] retrying in ${delay}ms...\n`);
      }
      setTimeout(() => {
        doForward(req, body, res, provider, verbose, state);
      }, delay);
    } else {
      if (verbose) {
        process.stderr.write(
          `[deja] upstream unreachable after ${MAX_RETRIES} attempts: ${err.message}\n`
        );
        process.stderr.write(
          `[deja] tip: check your provider config and network connection\n`
        );
      }
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(JSON.stringify({
          error: {
            type: "upstream_error",
            message: `Upstream unreachable after ${MAX_RETRIES} retries: ${err.message}`,
          },
          diagnostics: {
            upstream: provider.baseUrl,
            retries: MAX_RETRIES,
            lastError: err.message,
            suggestion: "Check your API key, network connection, and provider URL.",
          },
        }));
      }
    }
  });

  upstreamReq.on("timeout", () => {
    upstreamReq.destroy(new Error("Timeout"));
  });

  if (body.length > 0) upstreamReq.write(body);
  upstreamReq.end();
}

/**
 * Probe a provider at a specific API endpoint to verify reachability.
 *
 * Tries /v1/messages (Anthropic format) and /v1/chat/completions (OpenAI format).
 * Returns a detailed result distinguishing:
 *   - reachable: provider responded (2xx or recognizable 4xx like 401/403/405)
 *   - auth_error: provider reachable but key is missing/invalid (401/403)
 *   - endpoint_not_found: provider reachable but neither endpoint format matched (404)
 *   - network_error: connection refused, DNS failure, or timeout
 */
export function checkUpstreamHealth(provider: ProviderConfig): Promise<UpstreamHealthResult> {
  return probeEndpoints(provider);
}

const ENDPOINTS_TO_PROBE = ["/v1/messages", "/v1/chat/completions"];

async function probeEndpoint(
  baseUrl: string,
  path: string,
  apiKey: string | undefined,
): Promise<{ status: HealthStatus; httpStatus: number | null; error: string | null }> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl);
      const transport = url.protocol === "http:" ? http : https;
      const port = url.port ? parseInt(url.port, 10) : (url.protocol === "http:" ? 80 : 443);

      const headers: Record<string, string> = { host: url.host };
      if (apiKey) {
        headers["x-api-key"] = apiKey;
        headers["authorization"] = `Bearer ${apiKey}`;
      }

      const req = transport.request(
        {
          hostname: url.hostname,
          port,
          path,
          method: "POST",
          timeout: 5000,
          headers: { ...headers, "content-type": "application/json", "content-length": "2" },
        },
        (res) => {
          res.resume();
          const code = res.statusCode ?? 0;

          // 2xx: fully reachable
          if (code >= 200 && code < 300) {
            resolve({ status: "reachable", httpStatus: code, error: null });
            return;
          }
          // 401/403: reachable but auth issue — provider is definitely there
          if (code === 401 || code === 403) {
            resolve({ status: "auth_error", httpStatus: code, error: null });
            return;
          }
          // 405 (Method Not Allowed) or 400 (Bad Request): endpoint exists, just doesn't like our probe body
          // This means the provider IS reachable
          if (code === 405 || code === 400 || code === 415 || code === 429) {
            resolve({ status: "reachable", httpStatus: code, error: null });
            return;
          }
          // 404: this specific endpoint doesn't exist, but provider may support the other format
          if (code === 404) {
            resolve({ status: "endpoint_not_found", httpStatus: code, error: null });
            return;
          }
          // Any other response (5xx, etc.): provider is reachable
          resolve({ status: "reachable", httpStatus: code, error: null });
        },
      );

      req.on("error", (err) => {
        resolve({
          status: "network_error",
          httpStatus: null,
          error: err.message,
        });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({
          status: "network_error",
          httpStatus: null,
          error: "Connection timed out after 5s",
        });
      });

      req.write("{}");
      req.end();
    } catch (err) {
      resolve({
        status: "network_error",
        httpStatus: null,
        error: err instanceof Error ? err.message : "Invalid URL",
      });
    }
  });
}

async function probeEndpoints(provider: ProviderConfig): Promise<UpstreamHealthResult> {
  let lastError: string | null = null;

  for (const endpoint of ENDPOINTS_TO_PROBE) {
    const result = await probeEndpoint(provider.baseUrl, endpoint, provider.apiKey);

    if (result.status === "reachable") {
      return { ...result, endpoint };
    }
    if (result.status === "auth_error") {
      return { ...result, endpoint };
    }
    if (result.status === "network_error") {
      lastError = result.error;
      // Don't break — the other endpoint might be on a different host pattern
    }
    // endpoint_not_found: try next endpoint
  }

  // All endpoints failed — if we got at least one network_error, report that
  if (lastError) {
    return { status: "network_error", endpoint: null, httpStatus: null, error: lastError };
  }
  // All returned 404 — provider is reachable but doesn't support either format
  return {
    status: "endpoint_not_found",
    endpoint: null,
    httpStatus: 404,
    error: "Neither /v1/messages nor /v1/chat/completions found on this provider",
  };
}

/**
 * Legacy boolean check — used by session health monitor.
 * Reachable or auth_error = the provider is responding.
 */
export function isProviderReachable(result: UpstreamHealthResult): boolean {
  return result.status === "reachable" || result.status === "auth_error";
}

/**
 * Passthrough: forward the request to upstream without any pipeline processing.
 * Used for non-messages requests and requests below the compression threshold.
 */
export function passthrough(
  req: IncomingMessage,
  body: Buffer,
  res: ServerResponse,
  provider: ProviderConfig,
  label: string,
  verbose: boolean,
): void {
  if (verbose) {
    process.stderr.write(`[deja] passthrough ${req.method} ${req.url} (${label})\n`);
  }
  forwardUpstream(req, body, res, provider, verbose);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function upstreamPath(upstreamUrl: URL, requestUrl: string | undefined): string {
  const reqPath = requestUrl?.startsWith("/") ? requestUrl : `/${requestUrl ?? ""}`;
  const basePath = upstreamUrl.pathname.replace(/\/$/, "");
  if (!basePath) return `${reqPath}${upstreamUrl.search}`;
  if (reqPath === "/") return `${basePath}${upstreamUrl.search}`;
  // Avoid double-path: if reqPath already starts with basePath (e.g. basePath=/v1,
  // reqPath=/v1/messages), use reqPath directly instead of /v1/v1/messages.
  if (reqPath.startsWith(basePath + "/") || reqPath === basePath) {
    return `${reqPath}${upstreamUrl.search}`;
  }
  return `${basePath}${reqPath}`;
}

function upstreamTransport(upstreamUrl: URL): typeof http | typeof https {
  return upstreamUrl.protocol === "http:" ? http : https;
}

function upstreamPort(upstreamUrl: URL): number {
  if (upstreamUrl.port) return parseInt(upstreamUrl.port, 10);
  return upstreamUrl.protocol === "http:" ? 80 : 443;
}

export function upstreamHeaders(
  req: IncomingMessage,
  upstreamUrl: URL,
  provider: ProviderConfig,
  bodyLength?: number,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {
    ...req.headers,
    host: upstreamUrl.host,
  };

  if (provider.apiKey) {
    headers["x-api-key"] = provider.apiKey;
    headers["authorization"] = `Bearer ${provider.apiKey}`;
  }

  delete headers["content-encoding"];
  delete headers["transfer-encoding"];

  if (bodyLength !== undefined) {
    headers["content-length"] = bodyLength.toString();
  }

  return headers;
}
