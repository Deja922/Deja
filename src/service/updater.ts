/**
 * Deja 自动更新模块
 *
 * 服务启动时检查 GitHub releases，有新版时后台下载并在服务重启后生效。
 * 只在 Windows Service 模式下运行（DEJA_SERVICE_MODE=1）。
 */

import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const GITHUB_OWNER = "Deja922";
const GITHUB_REPO  = "Deja";
const INSTALL_DIR  = path.join(process.env["USERPROFILE"] ?? "C:\\Users\\Default", ".deja", "app");
const VERSION_FILE = path.join(INSTALL_DIR, "VERSION");

export interface ReleaseInfo {
  tag: string;
  zipUrl: string;
  publishedAt: string;
}

function currentVersion(): string {
  try {
    return fs.readFileSync(VERSION_FILE, "utf-8").trim();
  } catch {
    return "v0.0.0";
  }
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "deja-updater/1.0", "Accept": "application/vnd.github+json" },
      timeout: 10000,
    }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("JSON parse failed")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

export async function checkForUpdate(): Promise<ReleaseInfo | null> {
  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    const data = await fetchJson(url) as Record<string, unknown>;
    const tag = data["tag_name"] as string;
    if (!tag || tag === currentVersion()) return null;

    const assets = data["assets"] as Array<Record<string, unknown>>;
    const zip = assets?.find((a) => (a["name"] as string)?.endsWith("win-x64.zip"));
    if (!zip) return null;

    return {
      tag,
      zipUrl: zip["browser_download_url"] as string,
      publishedAt: data["published_at"] as string,
    };
  } catch {
    return null;
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function follow(u: string): void {
      https.get(u, { headers: { "User-Agent": "deja-updater/1.0" }, timeout: 120000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers["location"] as string);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
        file.on("error", reject);
      }).on("error", reject);
    }
    follow(url);
  });
}

export async function applyUpdate(info: ReleaseInfo): Promise<void> {
  const tmpZip = path.join(INSTALL_DIR, "..", "update.zip");
  const tmpDir = path.join(INSTALL_DIR, "..", "update-tmp");

  process.stderr.write(`[deja-updater] Downloading ${info.tag}...\n`);
  await downloadFile(info.zipUrl, tmpZip);

  // 解压到临时目录，然后替换 dist/ dist-tray/ package.json
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`, { stdio: "inherit" });

  for (const dir of ["dist", "dist-tray"]) {
    const src  = path.join(tmpDir, dir);
    const dest = path.join(INSTALL_DIR, dir);
    if (fs.existsSync(src)) {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
    }
  }
  for (const file of ["package.json", "package-lock.json"]) {
    const src = path.join(tmpDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(INSTALL_DIR, file));
  }

  // 记录新版本号
  fs.writeFileSync(VERSION_FILE, info.tag, "utf-8");

  // 清理临时文件
  fs.rmSync(tmpZip, { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  process.stderr.write(`[deja-updater] Updated to ${info.tag}, restarting service...\n`);
}

/** 启动时异步检查，不阻塞主流程，发现更新后 15s 内应用并重启 */
export async function checkAndUpdateInBackground(): Promise<void> {
  try {
    const info = await checkForUpdate();
    if (!info) return;
    process.stderr.write(`[deja-updater] New version available: ${info.tag}\n`);
    await applyUpdate(info);
    // 更新完成后重启服务（node-windows 会自动重启）
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[deja-updater] Update check failed: ${err}\n`);
  }
}
