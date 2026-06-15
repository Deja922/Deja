import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Shared resolution for Deja's runtime data files (metrics.jsonl, proxy.log).
 *
 * The proxy runs as a node-windows service under LocalSystem, whose homedir is
 * `C:\Windows\System32\config\systemprofile`, while the CLI runs as the logged-in
 * user. A bare `homedir()/.deja` therefore splits writer and reader into two
 * different files — `deja metrics` / `deja logs` would show nothing of real
 * service traffic. This mirrors the convention already used for config.json:
 * write to a shared ProgramData location, read by merging every candidate.
 */

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

export function getUserDataPath(file: string): string {
  return join(homedir(), ".deja", file);
}

export function getProgramDataPath(file: string): string {
  const programData = process.env["ProgramData"] ?? "C:\\ProgramData";
  return join(programData, "Deja", file);
}

export function getSystemProfileDataPath(file: string): string {
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  return join(systemRoot, "System32", "config", "systemprofile", ".deja", file);
}

/**
 * Where to write a data file. On Windows this is ProgramData (writable by both
 * LocalSystem and the user, and readable by both), so service and CLI converge
 * on one file. Elsewhere it's the user dir.
 */
export function getDataWritePath(file: string): string {
  if (process.platform === "win32") return getProgramDataPath(file);
  return getUserDataPath(file);
}

/**
 * All locations a reader should consult, in priority order. Includes the legacy
 * user and systemprofile paths so data written before this change (or by a
 * differently-accounted process) is still surfaced.
 */
export function getDataReadCandidates(file: string): string[] {
  if (process.platform === "win32") {
    return uniquePaths([
      getProgramDataPath(file),
      getUserDataPath(file),
      getSystemProfileDataPath(file),
    ]);
  }
  return [getUserDataPath(file)];
}

/** Read candidates that actually exist on disk. */
export function getExistingDataReadCandidates(file: string): string[] {
  return getDataReadCandidates(file).filter((p) => existsSync(p));
}
