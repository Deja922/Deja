// Windows Service 进程入口。
// 由 node-windows 通过 SCM 直接调用：node dist/service/service-entry.js
// 不使用 Commander CLI，直接读取 ~/.deja/config.json 启动代理。

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { startProxy } from "../proxy/server.js";
import { writeManagedSettings, isManagedSettingsActive } from "../cli/managed-settings.js";
import type { RuntimeConfig } from "../proxy/config-types.js";
import { DEFAULT_CONFIG } from "../proxy/config-types.js";

// 标记服务模式：server.ts 据此跳过 shutdown 时删除 managed-settings.json
process.env["DEJA_SERVICE_MODE"] = "1";

const CONFIG_PATH = join(homedir(), ".deja", "config.json");

function loadConfig(): RuntimeConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<RuntimeConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    process.stderr.write(`[deja-service] Failed to parse config, using defaults\n`);
    return DEFAULT_CONFIG;
  }
}

const config = loadConfig();
const port = config.port;

// 服务启动时写入 managed-settings.json（LocalSystem 账户有权限写 C:\ProgramData\）
const writeResult = writeManagedSettings(port);
if (writeResult.ok) {
  process.stderr.write(`[deja-service] routing config written → ${writeResult.path}\n`);
} else {
  process.stderr.write(`[deja-service] WARN: cannot write managed-settings: ${writeResult.error ?? "unknown"}\n`);
}

// 每 30 秒检查并补写（防止第三方工具意外清除）
setInterval(() => {
  if (!isManagedSettingsActive()) {
    const r = writeManagedSettings(port);
    if (r.ok) {
      process.stderr.write(`[deja-service] managed-settings re-written (was missing)\n`);
    }
  }
}, 30_000);

// 启动代理（verbose=false 避免日志洪流写入 Windows 事件日志）
// follow mode 自动读取 settings.json（CC Switch 写的真实 upstream URL）
startProxy({
  config,
  verbose: false,
});
