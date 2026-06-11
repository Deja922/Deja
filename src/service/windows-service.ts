import { createRequire } from "module";
import { join, dirname } from "path";
import { existsSync, copyFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  getUserConfigPath,
  getWindowsProgramDataConfigPath,
  getWindowsSystemProfileConfigPath,
} from "@/config/deja-config-store.js";

const require = createRequire(import.meta.url);

const SERVICE_NAME = "Deja Context Engine";
const SERVICE_DESC = "Deja context proxy service";
const SERVICE_NAME_CANDIDATES = ["dejacontextengine", "dejacontextengine.exe", SERVICE_NAME] as const;

const __filename = fileURLToPath(import.meta.url);
const SERVICE_SCRIPT = join(__filename, "..", "service-entry.js");

function buildEnv(): Array<{ name: string; value: string }> {
  return [{ name: "DEJA_CONFIG_PATH", value: getWindowsProgramDataConfigPath() }];
}

function ensureWindowsServiceConfigSeed(): void {
  const targetPath = getWindowsProgramDataConfigPath();
  const userPath = getUserConfigPath();
  const legacySystemProfilePath = getWindowsSystemProfileConfigPath();

  try {
    if (existsSync(userPath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(userPath, targetPath);
      return;
    }

    if (existsSync(targetPath)) return;

    if (existsSync(legacySystemProfilePath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(legacySystemProfilePath, targetPath);
    }
  } catch {
    // Ignore seed errors; service-entry still has fallback config candidates.
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createService(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Service } = require("node-windows") as { Service: new (opts: unknown) => unknown };
  return new Service({
    name: SERVICE_NAME,
    description: SERVICE_DESC,
    script: SERVICE_SCRIPT,
    nodeOptions: [],
    execPath: process.execPath,
    env: buildEnv(),
    wait: 2,
    grow: 0.25,
    maxRestarts: 10,
    abortOnError: false,
  });
}

function getInstalledServiceName(): string | null {
  for (const candidate of SERVICE_NAME_CANDIDATES) {
    try {
      execSync(`sc.exe query "${candidate}"`, { stdio: "pipe", windowsHide: true });
      return candidate;
    } catch {
      // Try next.
    }
  }
  return null;
}

export function isWindowsServiceInstalled(): boolean {
  return getInstalledServiceName() !== null;
}

export function restartWindowsServiceIfInstalled(): { restarted: boolean; serviceName?: string; error?: string } {
  const serviceName = getInstalledServiceName();
  if (!serviceName) return { restarted: false };

  try {
    execSync(`powershell -NoProfile -Command "Restart-Service -Name '${serviceName}' -Force -ErrorAction Stop"`, {
      stdio: "pipe",
      windowsHide: true,
    });
    return { restarted: true, serviceName };
  } catch (err) {
    return {
      restarted: false,
      serviceName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerService(): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureWindowsServiceConfigSeed();
    const svc = createService() as {
      on(e: string, cb: () => void): void;
      install(): void;
      start(): void;
    };
    svc.on("install", () => {
      console.log(`[deja-service] Service "${SERVICE_NAME}" installed. Starting...`);
      svc.start();
      resolve();
    });
    svc.on("alreadyinstalled", () => {
      console.log(`[deja-service] Service "${SERVICE_NAME}" already installed.`);
      resolve();
    });
    svc.on("start", () => {
      console.log("[deja-service] Service started.");
    });
    svc.on("error", () => reject(new Error("node-windows service install failed")));
    svc.install();
  });
}

export function unregisterService(): Promise<void> {
  return new Promise((resolve, reject) => {
    const svc = createService() as {
      on(e: string, cb: () => void): void;
      uninstall(): void;
    };
    svc.on("uninstall", () => {
      console.log(`[deja-service] Service "${SERVICE_NAME}" removed.`);
      resolve();
    });
    svc.on("error", () => reject(new Error("node-windows service uninstall failed")));
    svc.uninstall();
  });
}

if (process.argv[2] === "register") {
  registerService()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
} else if (process.argv[2] === "uninstall" || process.argv[2] === "remove") {
  unregisterService()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
