import { readFileSync, existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ProviderConfig } from "./config-types.js";

/**
 * UpstreamResolver — CC Switch compatible, read-only upstream adapter.
 *
 * Claude Code is pointed at deja (localhost). Tools like CC Switch write the
 * *real* provider into ~/.claude/settings.json (env.ANTHROPIC_BASE_URL). This
 * resolver READS that file (never writes it) to learn where deja should
 * forward, re-reads it on a short interval so provider switches take effect
 * within a few seconds without restarting deja, and never stores API keys —
 * the incoming request's key is passed straight through to the upstream.
 *
 * Design constraints (per spec):
 *   - read-only access to settings.json; never modify CC Switch's files
 *   - auto-detect the active provider's base URL
 *   - API keys are passed through, never stored
 *   - hot reload: a settings.json change is picked up within REFRESH_INTERVAL
 *   - always has a fallback provider so a missing/broken file never breaks
 */

const REFRESH_INTERVAL_MS = 2000; // < 3s, per spec

/** Candidate locations for Claude Code's user settings file, in priority order. */
export function defaultSettingsPaths(): string[] {
  const home = homedir();
  const paths: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData) paths.push(join(appData, "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
  } else if (process.platform === "darwin") {
    paths.push(join(home, "Library", "Application Support", "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
  } else {
    const xdgConfig = process.env["XDG_CONFIG_HOME"];
    if (xdgConfig) paths.push(join(xdgConfig, "Claude", "settings.json"));
    paths.push(join(home, ".config", "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
  }
  return paths;
}

export interface ResolverOptions {
  /** Explicit settings.json path (overrides auto-detection — used in tests). */
  settingsPath?: string | undefined;
  /** Provider used when settings.json is missing/unreadable/points at deja itself. */
  fallback: ProviderConfig;
  /** deja's own port — used to detect and break self-forwarding loops. */
  selfPort: number;
  verbose?: boolean | undefined;
  /** Called whenever the resolved upstream changes. */
  onChange?: ((next: ProviderConfig, prev: ProviderConfig) => void) | undefined;
}

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Extract env.ANTHROPIC_BASE_URL (or top-level) from parsed settings. */
function readBaseUrl(settings: Record<string, unknown>): string | undefined {
  const env = settings["env"];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const v = (env as Record<string, unknown>)["ANTHROPIC_BASE_URL"];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const top = settings["ANTHROPIC_BASE_URL"];
  if (typeof top === "string" && top.trim()) return top.trim();
  return undefined;
}

function detectCompatMode(baseUrl: string): "anthropic" | "openai" | undefined {
  if (/\/anthropic\b/i.test(baseUrl)) return "anthropic";
  return undefined;
}

export class UpstreamResolver {
  private current: ProviderConfig;
  private readonly fallback: ProviderConfig;
  private readonly selfPort: number;
  private readonly verbose: boolean;
  private readonly explicitPath: string | undefined;
  private readonly onChange: ResolverOptions["onChange"];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSig = "";

  constructor(opts: ResolverOptions) {
    this.fallback = opts.fallback;
    this.selfPort = opts.selfPort;
    this.verbose = opts.verbose ?? false;
    this.explicitPath = opts.settingsPath;
    this.onChange = opts.onChange;
    this.current = opts.fallback;
    this.refresh(); // populate immediately
  }

  /** The upstream deja should forward to right now. */
  getProvider(): ProviderConfig {
    return this.current;
  }

  /** Begin polling settings.json for changes. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Locate the settings file to read (explicit path wins, else first existing). */
  private resolveSettingsPath(): string | undefined {
    if (this.explicitPath) return existsSync(this.explicitPath) ? this.explicitPath : undefined;
    return defaultSettingsPaths().find((p) => existsSync(p));
  }

  /** Returns the upstream described by settings.json, or null to use fallback. */
  private readFromSettings(): ProviderConfig | null {
    const path = this.resolveSettingsPath();
    if (!path) return null;

    let raw: string;
    try {
      raw = stripBOM(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null; // malformed file → fallback, never crash
    }

    const baseUrl = readBaseUrl(settings);
    if (!baseUrl) return null;

    // Self-loop guard: if settings points back at deja, forwarding there would
    // loop forever. Ignore it and use the fallback instead.
    if (this.pointsAtSelf(baseUrl)) return null;

    // Key passthrough: deliberately leave apiKey undefined so the upstream
    // forwarder uses the key from the incoming request headers.
    const compatMode = detectCompatMode(baseUrl);
    return { baseUrl, apiKey: undefined, ...(compatMode ? { compatMode } : {}) };
  }

  private pointsAtSelf(baseUrl: string): boolean {
    try {
      const u = new URL(baseUrl);
      const host = u.hostname.toLowerCase();
      const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
      if (!isLocal) return false;
      const port = u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
      return port === this.selfPort;
    } catch {
      return false;
    }
  }

  /** A change signature so we only log/notify when the upstream actually changes. */
  private signatureOf(path: string | undefined): string {
    if (!path) return "none";
    try {
      return `${path}:${statSync(path).mtimeMs}`;
    } catch {
      return "none";
    }
  }

  private refresh(): void {
    const path = this.resolveSettingsPath();
    const sig = this.signatureOf(path);
    if (sig === this.lastSig) return; // unchanged file → nothing to do
    this.lastSig = sig;

    const next = this.readFromSettings() ?? this.fallback;
    const prev = this.current;
    if (next.baseUrl === prev.baseUrl) {
      this.current = next; // keep latest (e.g. compatMode) but no notify
      return;
    }

    this.current = next;
    if (this.verbose) {
      process.stderr.write(
        `[deja] upstream changed: ${prev.baseUrl} -> ${next.baseUrl}` +
          (next === this.fallback ? " (fallback)" : " (from Claude settings)") +
          "\n"
      );
    }
    this.onChange?.(next, prev);
  }
}
