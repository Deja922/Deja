import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { checkUpstreamHealth, isProviderReachable } from "../../proxy/upstream.js";

interface SetupOptions {
  port: number;
  key?: string;
}

// ── Interactive prompts ─────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => resolve(answer.trim()));
  });
}

// ── Deja config writer ──────────────────────────────────────────────────────

function writeDejaConfig(port: number, upstream: string, apiKey: string, providerName: string): string {
  const configDir = join(homedir(), ".deja");
  const configPath = join(configDir, "config.json");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  let compatMode: string | undefined;
  if (upstream.includes("/anthropic") || providerName === "anthropic" || providerName === "deepseek") {
    compatMode = "anthropic";
  } else if (upstream.includes("/v1") || providerName === "openai") {
    compatMode = "openai";
  }

  const config = {
    port,
    pipeline: {
      maxTokens: 8000,
      targetTokens: 4000,
      rankingThreshold: 0.3,
      memoryEnabled: false,
      memoryTopK: 5,
      compressThreshold: 200,
    },
    providers: {
      [providerName]: {
        baseUrl: upstream,
        ...(apiKey ? { apiKey } : {}),
        ...(compatMode ? { compatMode } : {}),
      },
    } as Record<string, unknown>,
    defaultProvider: providerName,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}

// ── Claude Code patching ────────────────────────────────────────────────────

function stripBOM(s: string): string {
  return s.codePointAt(0) === 0xFEFF ? s.slice(1) : s;
}

function findSettingsPaths(): string[] {
  const home = homedir();
  const paths: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData) paths.push(join(appData, "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) {
      paths.push(join(localAppData, "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
      paths.push(join(localAppData, "cursor", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
    }
  } else if (process.platform === "darwin") {
    paths.push(join(home, "Library", "Application Support", "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
    paths.push(join(home, "Library", "Application Support", "Code", "User", "globalStorage", "anthropic.claude-code", "settings.json"));
  } else {
    paths.push(join(home, ".config", "Claude", "settings.json"));
    paths.push(join(home, ".claude", "settings.json"));
    const xdgConfig = process.env["XDG_CONFIG_HOME"];
    if (xdgConfig) paths.push(join(xdgConfig, "Claude", "settings.json"));
  }
  return paths.filter((p) => existsSync(p));
}

function readCurrentUrl(settings: Record<string, unknown>): string | undefined {
  if (typeof settings["ANTHROPIC_BASE_URL"] === "string") return settings["ANTHROPIC_BASE_URL"];
  const env = settings["env"];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const envObj = env as Record<string, unknown>;
    if (typeof envObj["ANTHROPIC_BASE_URL"] === "string") return envObj["ANTHROPIC_BASE_URL"];
  }
  return undefined;
}

function patchSettings(configPath: string, proxyUrl: string): boolean {
  try {
    let raw = readFileSync(configPath, "utf-8");
    raw = stripBOM(raw);
    let settings: Record<string, unknown>;
    try { settings = JSON.parse(raw) as Record<string, unknown>; } catch { settings = {}; }
    if (readCurrentUrl(settings) === proxyUrl) return true; // already done

    const backupPath = configPath + `.backup-${Date.now()}`;
    copyFileSync(configPath, backupPath);

    const env = settings["env"];
    if (env && typeof env === "object" && !Array.isArray(env)) {
      (env as Record<string, unknown>)["ANTHROPIC_BASE_URL"] = proxyUrl;
    } else {
      settings["ANTHROPIC_BASE_URL"] = proxyUrl;
    }
    writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    return readCurrentUrl(JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>) === proxyUrl;
  } catch {
    return false;
  }
}

function ensureClaudeCodeConfig(proxyUrl: string): boolean {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (existsSync(settingsPath)) return true;
  try {
    const dir = join(homedir(), ".claude");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ ANTHROPIC_BASE_URL: proxyUrl }, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ── main entry ──────────────────────────────────────────────────────────────

export async function setup(opts: SetupOptions): Promise<void> {
  const port = opts.port;
  const proxyUrl = `http://localhost:${port}`;

  console.log("");
  console.log("  ╔══════════════════════════════╗");
  console.log("  ║   Deja 一键配置向导          ║");
  console.log("  ╚══════════════════════════════╝");
  console.log("");
  console.log("  此向导将自动完成：");
  console.log("  1. 选择 API 提供商");
  console.log("  2. 设置 API Key");
  console.log("  3. 保存配置文件");
  console.log("  4. 验证上游连接");
  console.log("  5. 配置 Claude Code");
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // ── Step 1: Provider ──────────────────────────────────────────────────
  console.log("  ── 第 1 步：选择 API 提供商 ──");
  console.log("");
  console.log("  [1] DeepSeek   — 推荐国内用户，兼容 Anthropic 格式");
  console.log("  [2] OpenAI     — ChatGPT / GPT-4");
  console.log("  [3] Anthropic  — Claude 官方 API");
  console.log("  [4] 自定义     — 输入你自己的中转站地址");
  console.log("");

  const choice = await ask(rl, "  请选择 (1-4) [默认 1]: ");
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
      upstream = await ask(rl, "  请输入中转站完整地址 (如 https://aihubmix.com 或 https://api.example.com/anthropic): ");
      if (!upstream) {
        upstream = "https://api.deepseek.com/anthropic";
        providerName = "deepseek";
        console.log(`  使用默认: DeepSeek`);
      } else {
        // Normalize: strip trailing slash
        upstream = upstream.replace(/\/+$/, "");
        providerName = "custom";
        // Friendly note: /v1 in URL is handled automatically, no need to strip
      }
      break;
    default:
      upstream = "https://api.deepseek.com/anthropic";
      providerName = "deepseek";
  }
  console.log(`  ${"OK".padEnd(6)} 上游地址: ${upstream}`);
  console.log("");

  // ── Step 2: API key ───────────────────────────────────────────────────
  let apiKey: string;

  if (opts.key) {
    apiKey = opts.key;
    console.log("  ── 第 2 步：API Key ──");
    console.log(`  ${"OK".padEnd(6)} 已从 --key 参数获取`);
    console.log("");
  } else {
    console.log("  ── 第 2 步：输入 API Key ──");
    console.log("");
    console.log("  从哪里获取 API Key：");
    console.log("    DeepSeek:   platform.deepseek.com → API Keys");
    console.log("    OpenAI:     platform.openai.com → API Keys");
    console.log("    Anthropic:  console.anthropic.com → API Keys");
    console.log("    中转站:     联系你的中转站提供商");
    console.log("");
    console.log("  提示：右键点击终端窗口即可粘贴，或按 Ctrl+Shift+V");
    console.log("");
    console.log("  如果无法粘贴，可以 Ctrl+C 退出，然后用 deja setup --key 你的Key 直接跳过此步骤。");
    console.log("");

    apiKey = await ask(rl, "  API Key (粘贴后按回车): ");
    console.log("");

    if (!apiKey) {
      console.log("  WARN  未输入 API Key。");
      console.log("        你可以稍后编辑 ~/.deja/config.json 手动添加。");
      console.log("");
    }
  }

  rl.close();

  // ── Step 3: Save config ───────────────────────────────────────────────
  console.log("  ── 第 3 步：保存配置 ──");
  const configPath = writeDejaConfig(port, upstream, apiKey, providerName);
  console.log(`  ${"OK".padEnd(6)} 配置已保存: ${configPath}`);
  console.log("");

  // ── Step 4: Validate upstream ─────────────────────────────────────────
  console.log("  ── 第 4 步：验证上游连接 ──");
  console.log(`         正在测试 ${upstream} ...`);
  const healthResult = await checkUpstreamHealth({ baseUrl: upstream, apiKey });

  if (isProviderReachable(healthResult)) {
    if (healthResult.status === "auth_error") {
      console.log(`  ${"OK".padEnd(6)} 上游可达 (HTTP ${healthResult.httpStatus})`);
      console.log(`         API Key 可能无效 — 启动后如有问题请检查 Key。`);
    } else {
      console.log(`  ${"OK".padEnd(6)} 上游连接正常 (${healthResult.endpoint ?? "API"} HTTP ${healthResult.httpStatus})`);
    }
  } else if (healthResult.status === "endpoint_not_found") {
    console.log(`  WARN  上游可达但 API 格式不匹配`);
    console.log(`         如果启动后请求失败，请检查上游地址是否正确。`);
  } else {
    console.log(`  WARN  无法连接上游 (${healthResult.error ?? "网络错误"})`);
    console.log(`         请检查网络、VPN 或防火墙设置。`);
  }
  console.log("");

  // ── Step 5: Patch Claude Code ─────────────────────────────────────────
  console.log("  ── 第 5 步：配置 Claude Code ──");

  const settingsPaths = findSettingsPaths();
  if (settingsPaths.length === 0) {
    const created = ensureClaudeCodeConfig(proxyUrl);
    if (created) {
      console.log(`  ${"OK".padEnd(6)} 已创建: ~/.claude/settings.json`);
      console.log(`         ANTHROPIC_BASE_URL = "${proxyUrl}"`);
    } else {
      console.log(`  WARN  无法自动配置 Claude Code。`);
      console.log(`         请手动在 ~/.claude/settings.json 中添加：`);
      console.log(`         {"ANTHROPIC_BASE_URL": "${proxyUrl}"}`);
    }
  } else {
    let ok = true;
    for (const p of settingsPaths) {
      const patched = patchSettings(p, proxyUrl);
      if (!patched) ok = false;
    }
    if (ok) {
      console.log(`  ${"OK".padEnd(6)} 已配置 ${settingsPaths.length} 个 Claude Code 配置文件`);
    } else {
      console.log(`  WARN  部分配置文件更新失败，请手动检查。`);
    }
  }
  console.log("");

  // ── Final summary ─────────────────────────────────────────────────────
  console.log("  ╔══════════════════════════════╗");
  console.log("  ║   配置完成！                 ║");
  console.log("  ╚══════════════════════════════╝");
  console.log("");
  console.log("  现在只需运行一个命令启动 Deja：");
  console.log("");
  console.log("    deja start");
  console.log("");
  console.log("  启动后：");
  console.log("    正常使用 Claude Code，Deja 在后台自动工作");
  console.log("    deja dashboard  随时查看实时统计");
  console.log("    deja doctor     检查运行状态");
  console.log("    deja stop       停止后台运行");
  console.log("");
  console.log("  提示：");
  console.log("    - 每次开机后需要运行 deja start");
  console.log("    - 运行 deja start --daemon 可以在后台静默运行");
  console.log("    - 配置保存在 ~/.deja/config.json，随时可以修改");
  console.log("    - 运行 deja uninstall 还原所有配置");
  console.log("");
}
