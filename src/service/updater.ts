/**
 * Deja 自动更新模块
 *
 * 服务启动时检查 GitHub releases，有新版时后台下载并在服务重启后生效。
 * 只在 Service 模式下运行（DEJA_SERVICE_MODE=1）。
 */

import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { homedir } from "os";

const GITHUB_OWNER = "Deja922";
const GITHUB_REPO  = "Deja";
const INSTALL_DIR  = path.join(homedir(), ".deja", "app");
const VERSION_FILE = path.join(INSTALL_DIR, "VERSION");

export interface ReleaseInfo {
  tag: string;
  assetUrl: string;
  assetName: string;
  publishedAt: string;
}

function currentVersion(): string {
  try {
    return fs.readFileSync(VERSION_FILE, "utf-8").trim();
  } catch {
    return "v0.0.0";
  }
}

function scoreAsset(name: string, platform: string, arch: string): number {
  const lower = name.toLowerCase();
  const platformTokens = platform === "darwin" ? ["mac", "darwin", "osx"] : ["linux"];
  const archTokens = arch === "x64" ? ["x64", "amd64", "x86_64"] : ["arm64", "aarch64"];
  let score = 0;
  if (platformTokens.some((t) => lower.includes(t))) score += 10;
  if (archTokens.some((t) => lower.includes(t))) score += 10;
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) score += 3;
  if (lower.endsWith(".zip")) score += 2;
  if (lower.includes("tray")) score += 1;
  return score;
}

function getPlatform(): string {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

function getArch(): string {
  return process.arch === "arm64" ? "arm64" : "x64";
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

    const platform = getPlatform();
    const arch = getArch();
    const assets = (data["assets"] as Array<Record<string, unknown>>) ?? [];

    // Windows: prefer win-x64.zip for backwards compat
    if (platform === "win32") {
      const zip = assets.find((a) => (a["name"] as string)?.endsWith("win-x64.zip"));
      if (!zip) return null;
      return {
        tag,
        assetUrl: zip["browser_download_url"] as string,
        assetName: zip["name"] as string,
        publishedAt: data["published_at"] as string,
      };
    }

    // Mac/Linux: score-based matching (mirrors install.sh logic)
    const candidates = assets
      .map((a) => ({
        name: a["name"] as string ?? "",
        url: a["browser_download_url"] as string ?? "",
        score: scoreAsset(a["name"] as string ?? "", platform, arch),
      }))
      .filter((a) => a.url && (a.name.endsWith(".zip") || a.name.endsWith(".tar.gz") || a.name.endsWith(".tgz")))
      .sort((a, b) => b.score - a.score);

    if (!candidates.length || (candidates[0]?.score ?? 0) < 10) return null;

    const best = candidates[0]!;
    return {
      tag,
      assetUrl: best.url,
      assetName: best.name,
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

function extractArchive(archivePath: string, destDir: string): void {
  if (process.platform === "win32") {
    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: "inherit" });
  } else if (archivePath.endsWith(".zip")) {
    execSync(`unzip -q "${archivePath}" -d "${destDir}"`, { stdio: "inherit" });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: "inherit" });
  }
}

export async function applyUpdate(info: ReleaseInfo): Promise<void> {
  const tmpArchive = path.join(INSTALL_DIR, "..", "update" + path.extname(info.assetName));
  const tmpDir = path.join(INSTALL_DIR, "..", "update-tmp");

  process.stderr.write(`[deja-updater] Downloading ${info.tag}...\n`);
  await downloadFile(info.assetUrl, tmpArchive);

  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  extractArchive(tmpArchive, tmpDir);

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

  fs.writeFileSync(VERSION_FILE, info.tag, "utf-8");
  fs.rmSync(tmpArchive, { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  process.stderr.write(`[deja-updater] Updated to ${info.tag}, restarting service...\n`);
}

/** 启动时异步检查，不阻塞主流程，发现更新后应用并重启 */
export async function checkAndUpdateInBackground(): Promise<void> {
  try {
    const info = await checkForUpdate();
    if (!info) return;
    process.stderr.write(`[deja-updater] New version available: ${info.tag}\n`);
    await applyUpdate(info);
    // 服务进程退出后由 launchd/node-windows 自动重启
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[deja-updater] Update check failed: ${err}\n`);
  }
}
