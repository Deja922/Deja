import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { DEFAULT_CONFIG, type RuntimeConfig } from "@/proxy/config-types.js";

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xfeff ? s.slice(1) : s;
}

export function getUserDejaDir(): string {
  return join(homedir(), ".deja");
}

export function getUserConfigPath(): string {
  return join(getUserDejaDir(), "config.json");
}

export function getWindowsProgramDataConfigPath(): string {
  const programData = process.env["ProgramData"] ?? "C:\\ProgramData";
  return join(programData, "Deja", "config.json");
}

export function getWindowsSystemProfileConfigPath(): string {
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  return join(systemRoot, "System32", "config", "systemprofile", ".deja", "config.json");
}

export function getCliReadCandidates(): string[] {
  if (process.platform === "win32") {
    return uniquePaths([
      getUserConfigPath(),
      getWindowsProgramDataConfigPath(),
      getWindowsSystemProfileConfigPath(),
    ]);
  }
  return [getUserConfigPath()];
}

export function getServiceReadCandidates(): string[] {
  const envPath = process.env["DEJA_CONFIG_PATH"];
  if (process.platform === "win32") {
    return uniquePaths([
      envPath ?? "",
      getWindowsProgramDataConfigPath(),
      getUserConfigPath(),
      getWindowsSystemProfileConfigPath(),
    ]);
  }
  return uniquePaths([envPath ?? "", getUserConfigPath()]);
}

export function getWriteMirrors(opts?: { includeLegacySystemProfileIfExists?: boolean }): string[] {
  if (process.platform === "win32") {
    const out = [getUserConfigPath(), getWindowsProgramDataConfigPath()];
    if (opts?.includeLegacySystemProfileIfExists) {
      const legacy = getWindowsSystemProfileConfigPath();
      if (existsSync(legacy)) out.push(legacy);
    }
    return uniquePaths(out);
  }
  return [getUserConfigPath()];
}

export interface ConfigLoadResult {
  config: RuntimeConfig;
  path: string;
}

export function readRuntimeConfig(path: string): RuntimeConfig | null {
  if (!existsSync(path)) return null;
  try {
    const rawText = stripBOM(readFileSync(path, "utf-8"));
    const raw = JSON.parse(rawText) as Partial<RuntimeConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      port: typeof raw.port === "number" ? raw.port : DEFAULT_CONFIG.port,
      defaultProvider:
        typeof raw.defaultProvider === "string" && raw.defaultProvider.trim()
          ? raw.defaultProvider
          : DEFAULT_CONFIG.defaultProvider,
      providers:
        raw.providers && typeof raw.providers === "object" && !Array.isArray(raw.providers)
          ? raw.providers
          : DEFAULT_CONFIG.providers,
      pipeline: {
        ...DEFAULT_CONFIG.pipeline,
        ...(raw.pipeline ?? {}),
      },
    };
  } catch {
    return null;
  }
}

export function readFirstAvailableRuntimeConfig(candidates: string[]): ConfigLoadResult | null {
  for (const p of candidates) {
    const config = readRuntimeConfig(p);
    if (config) return { config, path: p };
  }
  return null;
}

export function writeRuntimeConfig(path: string, config: RuntimeConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export interface ConfigWriteResult {
  path: string;
  ok: boolean;
  error?: string;
}

export function writeRuntimeConfigToMirrors(
  config: RuntimeConfig,
  opts?: { includeLegacySystemProfileIfExists?: boolean },
): ConfigWriteResult[] {
  const targets = getWriteMirrors(opts);
  return targets.map((path) => {
    try {
      writeRuntimeConfig(path, config);
      return { path, ok: true };
    } catch (err) {
      return { path, ok: false, error: (err as Error).message };
    }
  });
}
