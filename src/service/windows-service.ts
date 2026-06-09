// node-windows Windows Service 注册/卸载封装。
// node-windows 是 CommonJS 包，通过 createRequire 引入（项目是 ESM）。

import { createRequire } from "module";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const SERVICE_NAME = "Deja Context Engine";
const SERVICE_DESC = "Deja — Claude Code 智能上下文压缩代理，开机自启，后台静默运行";

// 编译产物路径：dist/service/service-entry.js
// import.meta.url 在 Windows 上形如 file:///C:/path/... 需要 fileURLToPath 处理
const __filename = fileURLToPath(import.meta.url);
const SERVICE_SCRIPT = join(__filename, "..", "service-entry.js");

function buildEnv(): Array<{ name: string; value: string }> {
  const env: Array<{ name: string; value: string }> = [];
  try {
    const configPath = join(homedir(), ".deja", "config.json");
    if (!existsSync(configPath)) return env;
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const providers = raw["providers"] as Record<string, { apiKey?: string }> | undefined;
    if (!providers) return env;
    const defaultProvider = raw["defaultProvider"] as string | undefined;
    const provider = defaultProvider ? providers[defaultProvider] : Object.values(providers)[0];
    if (provider?.apiKey) {
      env.push({ name: "ANTHROPIC_API_KEY", value: provider.apiKey });
    }
  } catch {
    // ignore — 服务进程会自己读 config.json
  }
  return env;
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
    execPath: process.execPath,   // 使用当前 Node 路径（防 LocalSystem 找不到 nvm 的 Node）
    env: buildEnv(),
    wait: 2,           // 崩溃后等 2 秒重启
    grow: 0.25,        // 每次崩溃延迟 +25%（指数退避）
    maxRestarts: 10,   // 最多 10 次，之后服务进入 paused 状态等待管理员
    abortOnError: false,
  });
}

export function registerService(): Promise<void> {
  return new Promise((resolve, reject) => {
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
      console.log(`[deja-service] Service started.`);
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

// CLI 支持：node dist/service/windows-service.js register|uninstall
// 供 install.ps1 和内部脚本调用
if (process.argv[2] === "register") {
  registerService()
    .then(() => process.exit(0))
    .catch((e: unknown) => { console.error(e); process.exit(1); });
} else if (process.argv[2] === "uninstall") {
  unregisterService()
    .then(() => process.exit(0))
    .catch((e: unknown) => { console.error(e); process.exit(1); });
}
