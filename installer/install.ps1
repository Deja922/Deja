<#
.SYNOPSIS
    Deja Context Engine — 一键安装脚本
.DESCRIPTION
    从 GitHub Release 下载最新版本，自动完成：
    检测依赖 → 下载解压 → 配置 API → 注册 Windows Service → 写路由配置 → 配置悬浮窗开机自启
.EXAMPLE
    irm https://raw.githubusercontent.com/Deja922/Deja/main/installer/install.ps1 | iex
    或下载后运行：
    powershell -ExecutionPolicy Bypass -File install.ps1
#>

param(
    [string]$ApiKey     = "",
    [string]$Upstream   = "",
    [string]$Provider   = "",
    [int]   $Port       = 9090,
    [string]$ReleaseTag = "",   # 留空则自动获取最新
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$GITHUB_OWNER   = "Deja922"
$GITHUB_REPO    = "Deja"
$INSTALL_DIR    = "$env:USERPROFILE\.deja\app"
$CONFIG_DIR     = "$env:USERPROFILE\.deja"

# ── 标题 ──────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║      Deja Context Engine                 ║" -ForegroundColor Cyan
Write-Host "  ║      智能上下文压缩 · 为 Claude 加速     ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 管理员检测 ────────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "  ⚠  请以管理员身份运行此脚本" -ForegroundColor Yellow
    Write-Host "  方法：右键 PowerShell → 以管理员身份运行" -ForegroundColor Gray
    exit 1
}

# ── 步骤 1：检测 Node.js ──────────────────────────────────────────────────────
Write-Host "  [1/6] 检测 Node.js..." -ForegroundColor White
try {
    $nodeVersion = (node --version 2>&1).ToString().Trim()
    $major = [int]($nodeVersion -replace "v(\d+)\..*", '$1')
    if ($major -lt 18) {
        Write-Host "  ✗  Node.js $nodeVersion 版本过低，需要 v18+" -ForegroundColor Red
        Write-Host "     下载：https://nodejs.org" -ForegroundColor Gray
        exit 1
    }
    Write-Host "  ✓  Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗  未找到 Node.js，请先安装 v18+" -ForegroundColor Red
    exit 1
}

# ── 步骤 2：下载最新 Release ──────────────────────────────────────────────────
Write-Host ""
Write-Host "  [2/6] 下载 Deja..." -ForegroundColor White

# 获取最新 Release 信息
if (-not $ReleaseTag) {
    try {
        $apiUrl  = "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/releases/latest"
        $headers = @{ "User-Agent" = "deja-installer/1.0"; "Accept" = "application/vnd.github+json" }
        $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 15
        $ReleaseTag = $release.tag_name
        Write-Host "  ✓  最新版本: $ReleaseTag" -ForegroundColor Green
    } catch {
        Write-Host "  ✗  无法获取 Release 信息：$($_.Exception.Message)" -ForegroundColor Red
        Write-Host "     请检查网络或访问 https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases" -ForegroundColor Gray
        exit 1
    }
}

# 找 win-x64.zip asset
$zipAsset = $release.assets | Where-Object { $_.name -like "*win-x64*.zip" } | Select-Object -First 1
if (-not $zipAsset) {
    Write-Host "  ✗  Release $ReleaseTag 中没有找到 win-x64.zip" -ForegroundColor Red
    exit 1
}

# 下载 zip
$tmpZip = "$env:TEMP\deja-$ReleaseTag.zip"
Write-Host "  ⬇  下载 $($zipAsset.name) ($([math]::Round($zipAsset.size/1MB,1)) MB)..." -ForegroundColor Gray
try {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($zipAsset.browser_download_url, $tmpZip)
    Write-Host "  ✓  下载完成" -ForegroundColor Green
} catch {
    Write-Host "  ✗  下载失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 解压到安装目录
Write-Host "  📦 解压到 $INSTALL_DIR..." -ForegroundColor Gray
if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
Expand-Archive -Path $tmpZip -DestinationPath $INSTALL_DIR -Force
Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue

# 写入版本号
Set-Content -Path "$INSTALL_DIR\VERSION" -Value $ReleaseTag -Encoding UTF8

# npm ci 安装生产依赖
Write-Host "  📦 安装依赖（npm ci）..." -ForegroundColor Gray
Push-Location $INSTALL_DIR
try {
    npm ci --omit=dev --prefer-offline 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    Write-Host "  ✓  依赖安装完成" -ForegroundColor Green
} catch {
    Write-Host "  ⚠  依赖安装失败，尝试 npm install..." -ForegroundColor Yellow
    npm install --omit=dev 2>&1 | Out-Null
}

# 安装 Electron 二进制（可能需要从 GitHub 下载，最多重试 3 次）
$electronExeDest = "$INSTALL_DIR\node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExeDest)) {
    Write-Host "  ⬇  下载 Electron 运行时..." -ForegroundColor Gray
    for ($i = 1; $i -le 3; $i++) {
        try {
            node "$INSTALL_DIR\node_modules\electron\install.js" 2>&1 | Out-Null
            if (Test-Path $electronExeDest) { break }
        } catch {}
        if ($i -lt 3) {
            Write-Host "  ⚠  第 $i 次失败，重试..." -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        }
    }
    if (Test-Path $electronExeDest) {
        Write-Host "  ✓  Electron 已下载" -ForegroundColor Green
    } else {
        Write-Host "  ⚠  Electron 下载失败，悬浮窗将不可用" -ForegroundColor Yellow
    }
}

# 创建启动器脚本（避免依赖 electron-builder 打包）
$launcherPath = "$INSTALL_DIR\start-tray.cmd"
@"
@echo off
"$INSTALL_DIR\node_modules\electron\dist\electron.exe" "$INSTALL_DIR\dist-tray\main.js"
"@ | Set-Content -Path $launcherPath -Encoding ASCII

Pop-Location

# ── 步骤 3：配置 API ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [3/6] 配置 API..." -ForegroundColor White
Write-Host ""

if (-not $Unattended) {
    Write-Host "  请选择 API 提供商：" -ForegroundColor White
    Write-Host "    [1] aihubmix   — 推荐，国内可用，支持所有 Claude 模型" -ForegroundColor Gray
    Write-Host "    [2] Anthropic  — 官方 API（需海外网络）" -ForegroundColor Gray
    Write-Host "    [3] 自定义地址" -ForegroundColor Gray
    Write-Host ""
    if (-not $Provider) {
        $choice = Read-Host "  请输入数字 (1-3) [默认: 1]"
        if (-not $choice) { $choice = "1" }
        $Provider = $choice
    }
}

switch ($Provider) {
    { $_ -in "1","aihubmix" } { $Upstream = "https://aihubmix.com";     $providerName = "aihubmix"  }
    { $_ -in "2","anthropic" }{ $Upstream = "https://api.anthropic.com"; $providerName = "anthropic" }
    "3" {
        $Upstream     = (Read-Host "  上游地址（如：https://aihubmix.com）").TrimEnd("/")
        $providerName = "custom"
    }
    default { $Upstream = "https://aihubmix.com"; $providerName = "aihubmix" }
}
Write-Host "  ✓  上游: $Upstream" -ForegroundColor Green

if (-not $ApiKey -and -not $Unattended) {
    Write-Host ""
    Write-Host "  请输入 API Key（右键可粘贴）：" -ForegroundColor White
    $ApiKey = Read-Host "  API Key"
}

# ── 步骤 4：写入配置 ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [4/6] 写入配置..." -ForegroundColor White

New-Item -ItemType Directory -Path $CONFIG_DIR -Force | Out-Null
$providerConfig = @{ baseUrl = $Upstream; compatMode = "anthropic" }
if ($ApiKey) { $providerConfig.apiKey = $ApiKey }
$config = @{
    port            = $Port
    pipeline        = @{ maxTokens=8000; targetTokens=4000; compressThreshold=200 }
    providers       = @{ $providerName = $providerConfig }
    defaultProvider = $providerName
}
$config | ConvertTo-Json -Depth 6 | Set-Content -Path "$CONFIG_DIR\config.json" -Encoding UTF8
Write-Host "  ✓  配置写入: $CONFIG_DIR\config.json" -ForegroundColor Green

# ── 步骤 5：注册 Windows Service ──────────────────────────────────────────────
Write-Host ""
Write-Host "  [5/6] 注册 Windows Service..." -ForegroundColor White

Push-Location $INSTALL_DIR
try {
    node "dist\service\windows-service.js" register 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Start-Service -Name "Deja Context Engine" -ErrorAction SilentlyContinue
    Write-Host "  ✓  Windows Service 已注册并启动" -ForegroundColor Green
} catch {
    Write-Host "  ⚠  服务注册失败：$($_.Exception.Message)" -ForegroundColor Yellow
}
Pop-Location

# 写入路由配置
$managedDir = "$env:ProgramData\ClaudeCode"
New-Item -ItemType Directory -Path $managedDir -Force | Out-Null
@{ env = @{ ANTHROPIC_BASE_URL = "http://localhost:$Port" } } |
    ConvertTo-Json -Depth 3 |
    Set-Content -Path "$managedDir\managed-settings.json" -Encoding UTF8
Write-Host "  ✓  路由配置写入" -ForegroundColor Green

# ── 步骤 6：悬浮窗开机自启 ────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [6/6] 配置悬浮窗开机自启..." -ForegroundColor White

$electronExe  = "$INSTALL_DIR\node_modules\electron\dist\electron.exe"
$launcherPath = "$INSTALL_DIR\start-tray.cmd"
$regPath      = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if (Test-Path $electronExe) {
    Set-ItemProperty -Path $regPath -Name "DejaFloatingWindow" -Value "`"$launcherPath`""
    Write-Host "  ✓  悬浮窗已加入开机自启" -ForegroundColor Green
    Start-Process "cmd.exe" -ArgumentList "/c `"$launcherPath`"" -WindowStyle Hidden -ErrorAction SilentlyContinue
} else {
    Write-Host "  ⚠  Electron 未就绪，跳过悬浮窗自启" -ForegroundColor Yellow
}

# ── 完成 ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║           安装完成！                     ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  ✅ 上游 API：$Upstream" -ForegroundColor Gray
Write-Host "  ✅ Windows Service：开机自动启动，崩溃自动重启" -ForegroundColor Gray
Write-Host "  ✅ 悬浮窗：右下角显示运行状态" -ForegroundColor Gray
Write-Host "  ✅ Claude Code：流量已自动路由经过 Deja" -ForegroundColor Gray
Write-Host ""
Write-Host "  Dashboard：http://localhost:$Port/__deja__" -ForegroundColor Cyan
Write-Host "  卸载：powershell -File `"$INSTALL_DIR\installer\uninstall.ps1`"" -ForegroundColor Gray
Write-Host ""
