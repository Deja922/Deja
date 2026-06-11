import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { MANAGED_SETTINGS_PATH } from "../managed-settings.js";
import type { ProviderConfig, RuntimeConfig } from "../../proxy/config-types.js";
import { writeRuntimeConfigToMirrors } from "@/config/deja-config-store.js";

interface InstallOptions {
  port: number;
}

// ── Interactive prompt ──────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => resolve(answer.trim()));
  });
}

async function interactiveSetup(): Promise<{ upstream: string; apiKey: string; providerName: string }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("  ── API 配置 ──");
  console.log("");
  console.log("  选择上游 API 提供商：");
  console.log("    [1] DeepSeek   (推荐国内用户)");
  console.log("    [2] OpenAI");
  console.log("    [3] Anthropic");
  console.log("    [4] 自定义地址");
  console.log("");

  const choice = await ask(rl, "  请输入数字 (1-4) [默认: 1]: ");
  console.log("");

  let upstream: string;
  let providerName: string;

  switch (choice || "1") {
    case "1":
      upstream = "https://api.deepseek.com/anthropic";
      providerName = "deepseek";
      break;
    case "2":
      upstream = "https://api.openai.com";
      providerName = "openai";
      break;
    case "3":
      upstream = "https://api.anthropic.com";
      providerName = "anthropic";
      break;
    case "4":
      upstream = await ask(rl, "  请输入上游地址: ");
      if (!upstream) {
        upstream = "https://api.deepseek.com/anthropic";
        providerName = "deepseek";
        console.log(`  使用默认: ${upstream}`);
      } else {
        providerName = "custom";
      }
      break;
    default:
      upstream = "https://api.deepseek.com/anthropic";
      providerName = "deepseek";
      console.log(`  使用默认: DeepSeek`);
  }
  console.log(`  上游地址: ${upstream}`);
  console.log("");

  const apiKey = await ask(rl, "  请输入 API Key (粘贴后按回车): ");
  console.log("");

  rl.close();

  if (!apiKey) {
    console.log("  WARN 未输入 API Key。");
    console.log("       你可以稍后在 ~/.deja/config.json 中手动填写。");
    console.log("       或者设置环境变量: $env:ANTHROPIC_API_KEY = \"你的Key\"");
    console.log("");
  }

  return { upstream, apiKey, providerName };
}

function writeDejaConfig(
  port: number,
  upstream: string,
  apiKey: string,
  providerName: string,
): { primaryPath: string; okPaths: string[]; failedPaths: Array<{ path: string; error?: string }> } {
  let compatMode: ProviderConfig["compatMode"];
  if (upstream.includes("/anthropic") || providerName === "anthropic" || providerName === "deepseek") {
    compatMode = "anthropic";
  } else if (upstream.includes("/v1") || providerName === "openai") {
    compatMode = "openai";
  }

  const providerConfig: ProviderConfig = {
    baseUrl: upstream,
    ...(apiKey ? { apiKey } : {}),
    ...(compatMode ? { compatMode } : {}),
  };

  const config: RuntimeConfig = {
    port,
    pipeline: {
      maxTokens: 8000,
      targetTokens: 4000,
      rankingThreshold: 0.3,
      memoryEnabled: false,
      memoryTopK: 5,
      compressThreshold: 200,
    },
    providers: {},
    defaultProvider: providerName,
  };

  config.providers[providerName] = providerConfig;

  const writeResults = writeRuntimeConfigToMirrors(config, { includeLegacySystemProfileIfExists: true });
  const okPaths = writeResults.filter((r) => r.ok).map((r) => r.path);
  const failedPaths = writeResults
    .filter((r) => !r.ok)
    .map((r) => (r.error ? { path: r.path, error: r.error } : { path: r.path }));
  return { primaryPath: okPaths[0] ?? join(homedir(), ".deja", "config.json"), okPaths, failedPaths };
}

// ── main ────────────────────────────────────────────────────────────────────

export async function install(opts: InstallOptions): Promise<void> {
  const port = opts.port;

  console.log("");
  console.log("  Deja 安装向导");
  console.log("  ────────────");
  console.log("");
  console.log("  此向导配置上游 API（Deja → AI 服务）。");
  console.log("  Claude Code 路由（Claude Code → Deja）由 deja start 在运行时自动管理，");
  console.log("  关闭 Deja 后路由自动恢复直连，无需手动修改任何文件。");
  console.log("");

  // Step 1 — Interactive API setup
  const { upstream, apiKey, providerName } = await interactiveSetup();

  // Step 2 — Write Deja config (~/.deja/config.json only, no settings.json touched)
  const writeResult = writeDejaConfig(port, upstream, apiKey, providerName);
  if (writeResult.okPaths.length > 0) {
    console.log(`  配置已保存: ${writeResult.primaryPath}`);
    if (writeResult.okPaths.length > 1) {
      for (const p of writeResult.okPaths.slice(1)) {
        console.log(`  mirror: ${p}`);
      }
    }
  } else {
    console.log("  WARN 配置写入失败。");
  }
  if (writeResult.failedPaths.length > 0) {
    for (const f of writeResult.failedPaths) {
      console.log(`  WARN ${f.path}: ${f.error ?? "unknown error"}`);
    }
  }
  console.log("");

  // Step 3 — Summary
  console.log("  ────────────");
  console.log("  安装完成！");
  console.log("");
  console.log("  工作原理（零文件残留）：");
  console.log(`    deja start   → 写入 ${MANAGED_SETTINGS_PATH}`);
  console.log(`                   Claude Code 自动路由至 localhost:${port}`);
  console.log(`    deja stop    → 删除该文件，Claude Code 直连真实 API`);
  console.log(`    Ctrl+C       → 同上，自动清理`);
  console.log(`    强制关闭后   → 运行 deja stop 一次即可恢复`);
  console.log("");
  console.log("  下一步：");
  console.log("    deja start      启动 Deja 代理");
  console.log("    deja doctor     检查是否一切正常");
  console.log("    deja dashboard  打开实时仪表盘");
  console.log("");
}
