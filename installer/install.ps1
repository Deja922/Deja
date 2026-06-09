<#
.SYNOPSIS
    Deja Context Engine — 一键安装脚本
.DESCRIPTION
    自动完成：检测依赖 → 配置 API → 注册 Windows Service → 写入路由配置
    需要以管理员身份运行（用于写入 C:\ProgramData\ClaudeCode\）
.EXAMPLE
    irm https://raw.githubusercontent.com/Deja922/Deja/main/installer/install.ps1 | iex
    或下载后运行：
    powershell -ExecutionPolicy Bypass -File install.ps1
#>

param(
    [string]$ApiKey    = "",
    [string]$Upstream  = "",
    [string]$Provider  = "",
    [int]   $Port      = 9090,
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$DEJA_VERSION = "0.1.0"
$DEJA_INSTALL_DIR = "$env:USERPROFILE\.deja\app"   # Deja 代码安装位置
$DEJA_CONFIG_DIR  = "$env:USERPROFILE\.deja"

# ── 标题 ──────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║      Deja Context Engine  v$DEJA_VERSION         ║" -ForegroundColor Cyan
Write-Host "  ║      智能上下文压缩 · 为 Claude 加速     ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 管理员检测 ────────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "  ⚠  请以管理员身份运行此脚本" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  方法：右键点击 PowerShell → 以管理员身份运行"
    Write-Host "  然后重新执行安装命令"
    Write-Host ""
    Read-Host "  按回车退出"
    exit 1
}

# ── 步骤 1：检测 Node.js ──────────────────────────────────────────────────────
Write-Host "  [1/5] 检测 Node.js..." -ForegroundColor White
try {
    $nodeVersion = (& node --version 2>&1).ToString().Trim()
    $major = [int]($nodeVersion -replace "v(\d+)\..*", '$1')
    if ($major -lt 18) {
        Write-Host "  ✗  Node.js $nodeVersion 版本过低，需要 v18+" -ForegroundColor Red
        Write-Host "     下载地址：https://nodejs.org/zh-cn/download/" -ForegroundColor Gray
        exit 1
    }
    Write-Host "  ✓  Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗  未找到 Node.js，请先安装 v18+" -ForegroundColor Red
    Write-Host "     下载地址：https://nodejs.org/zh-cn/download/" -ForegroundColor Gray
    Write-Host ""
    Write-Host "     安装完成后请重新运行此脚本。"
    Read-Host "  按回车退出"
    exit 1
}

# ── 步骤 2：检测 Claude Code ──────────────────────────────────────────────────
Write-Host ""
Write-Host "  [2/5] 检测 Claude Code..." -ForegroundColor White

$claudeFound = $false
$candidatePaths = @(
    "$env:APPDATA\Claude\settings.json",
    "$env:USERPROFILE\.claude\settings.json",
    "$env:LOCALAPPDATA\Code\User\globalStorage\anthropic.claude-code\settings.json",
    "$env:LOCALAPPDATA\cursor\User\globalStorage\anthropic.claude-code\settings.json"
)
foreach ($p in $candidatePaths) {
    if (Test-Path $p) {
        Write-Host "  ✓  找到 Claude Code: $p" -ForegroundColor Green
        $claudeFound = $true
        break
    }
}
if (-not $claudeFound) {
    Write-Host "  ⚠  未找到 Claude Code 配置" -ForegroundColor Yellow
    Write-Host "     路由配置仍会写入，Claude Code 安装后自动生效" -ForegroundColor Gray
}

# ── 步骤 3：配置 API ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [3/5] 配置 API..." -ForegroundColor White
Write-Host ""

if (-not $Unattended) {
    Write-Host "  请选择 API 提供商：" -ForegroundColor White
    Write-Host "    [1] aihubmix   — 推荐（国内可用，支持所有 Claude 模型）" -ForegroundColor Gray
    Write-Host "    [2] DeepSeek   — 国内 API，性价比高" -ForegroundColor Gray
    Write-Host "    [3] Anthropic  — Claude 官方 API（需要海外网络）" -ForegroundColor Gray
    Write-Host "    [4] 自定义地址" -ForegroundColor Gray
    Write-Host ""

    if (-not $Provider) {
        $choice = Read-Host "  请输入数字 (1-4) [默认: 1]"
        if (-not $choice) { $choice = "1" }
        $Provider = $choice
    }
}

switch ($Provider) {
    { $_ -in "1", "aihubmix" } {
        if (-not $Upstream) { $Upstream = "https://aihubmix.com" }
        $providerName = "aihubmix"
        $compatMode   = "anthropic"
    }
    { $_ -in "2", "deepseek" } {
        if (-not $Upstream) { $Upstream = "https://api.deepseek.com/anthropic" }
        $providerName = "deepseek"
        $compatMode   = "anthropic"
    }
    { $_ -in "3", "anthropic" } {
        if (-not $Upstream) { $Upstream = "https://api.anthropic.com" }
        $providerName = "anthropic"
        $compatMode   = "anthropic"
    }
    "4" {
        $Upstream = Read-Host "  请输入上游地址（例：https://aihubmix.com）"
        $Upstream = $Upstream.TrimEnd("/")
        $providerName = "custom"
        $compatMode   = if ($Upstream -match "/v1" -and $Upstream -notmatch "/anthropic") { "openai" } else { "anthropic" }
    }
    default {
        if (-not $Upstream) { $Upstream = "https://aihubmix.com" }
        $providerName = "aihubmix"
        $compatMode   = "anthropic"
    }
}

Write-Host "  ✓  上游地址: $Upstream" -ForegroundColor Green
Write-Host ""

if (-not $ApiKey -and -not $Unattended) {
    Write-Host "  请输入 API Key：" -ForegroundColor White
    Write-Host "    aihubmix: https://aihubmix.com → 个人中心 → API Keys" -ForegroundColor Gray
    Write-Host "    右键点击终端可粘贴内容" -ForegroundColor Gray
    Write-Host ""
    $ApiKey = Read-Host "  API Key"
    Write-Host ""
}

if (-not $ApiKey) {
    Write-Host "  ⚠  未输入 API Key，稍后可在 $DEJA_CONFIG_DIR\config.json 中手动填写" -ForegroundColor Yellow
    Write-Host ""
}

# ── 步骤 4：写入配置 ──────────────────────────────────────────────────────────
Write-Host "  [4/5] 写入配置文件..." -ForegroundColor White

# 确保目录存在
if (-not (Test-Path $DEJA_CONFIG_DIR)) {
    New-Item -ItemType Directory -Path $DEJA_CONFIG_DIR -Force | Out-Null
}

# 构建 config.json（兼容现有格式）
$providerConfig = @{ baseUrl = $Upstream; compatMode = $compatMode }
if ($ApiKey) { $providerConfig.apiKey = $ApiKey }

$config = @{
    port = $Port
    pipeline = @{
        maxTokens         = 8000
        targetTokens      = 4000
        rankingThreshold  = 0.3
        memoryEnabled     = $false
        memoryTopK        = 5
        compressThreshold = 200
    }
    providers       = @{ $providerName = $providerConfig }
    defaultProvider = $providerName
}

$configJson = $config | ConvertTo-Json -Depth 6
Set-Content -Path "$DEJA_CONFIG_DIR\config.json" -Value $configJson -Encoding UTF8
Write-Host "  ✓  配置已写入: $DEJA_CONFIG_DIR\config.json" -ForegroundColor Green

# ── 步骤 5：注册 Windows Service + 写路由配置 ─────────────────────────────────
Write-Host ""
Write-Host "  [5/5] 安装后台服务..." -ForegroundColor White

# 确定 Deja 代码位置（本脚本在 installer/ 子目录，上级目录是项目根）
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dejaRoot   = Split-Path -Parent $scriptDir

# 检查 dist/service/service-entry.js 是否存在（是否已 build）
$serviceEntry = "$dejaRoot\dist\service\service-entry.js"
if (-not (Test-Path $serviceEntry)) {
    Write-Host "  ⚙  正在编译 Deja..." -ForegroundColor Gray
    Push-Location $dejaRoot
    try {
        & npm run build 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "build failed" }
        Write-Host "  ✓  编译完成" -ForegroundColor Green
    } catch {
        Write-Host "  ✗  编译失败，请运行 npm run build 查看错误" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
}

# 安装 node-windows（如果缺失）
Push-Location $dejaRoot
$nodeWindowsCheck = Join-Path $dejaRoot "node_modules\node-windows\lib\index.js"
if (-not (Test-Path $nodeWindowsCheck)) {
    Write-Host "  ⚙  安装 node-windows..." -ForegroundColor Gray
    & npm install node-windows --save 2>&1 | Out-Null
}

# 注册 Windows Service
try {
    & node "$dejaRoot\dist\service\windows-service.js" register
    if ($LASTEXITCODE -eq 0) {
        # 启动服务
        Start-Sleep -Seconds 2
        try {
            Start-Service -Name "Deja Context Engine" -ErrorAction Stop
            Write-Host "  ✓  Windows Service 已注册并启动" -ForegroundColor Green
        } catch {
            Write-Host "  ✓  Windows Service 已注册（服务启动中，请稍候）" -ForegroundColor Green
        }
    } else {
        throw "register returned non-zero"
    }
} catch {
    Write-Host "  ⚠  服务注册失败（$($_.Exception.Message)）" -ForegroundColor Yellow
    Write-Host "     你可以稍后手动运行: deja service:install" -ForegroundColor Gray
}
Pop-Location

# 写入 managed-settings.json（管理员权限，已具备）
$managedDir = "$env:ProgramData\ClaudeCode"
if (-not (Test-Path $managedDir)) {
    New-Item -ItemType Directory -Path $managedDir -Force | Out-Null
}
$managedSettings = @{ env = @{ ANTHROPIC_BASE_URL = "http://localhost:$Port" } } | ConvertTo-Json -Depth 3
Set-Content -Path "$managedDir\managed-settings.json" -Value $managedSettings -Encoding UTF8
Write-Host "  ✓  路由配置写入: $managedDir\managed-settings.json" -ForegroundColor Green

# 更新旧版 VBS 开机启动为新服务模式（如果存在）
$vbsPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\deja-proxy.vbs"
if (Test-Path $vbsPath) {
    Remove-Item $vbsPath -Force
    Write-Host "  ✓  已移除旧版 VBS 开机启动（已由 Windows Service 替代）" -ForegroundColor Green
}

# ── 完成 ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║           安装完成！                     ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Deja 已配置完毕：" -ForegroundColor White
Write-Host "    ✅ 上游 API：$Upstream" -ForegroundColor Gray
Write-Host "    ✅ Windows Service：开机自动启动，崩溃自动重启" -ForegroundColor Gray
Write-Host "    ✅ Claude Code：路由配置已写入，流量将自动经过 Deja" -ForegroundColor Gray
Write-Host ""
Write-Host "  现在直接打开 Claude Code 即可使用。" -ForegroundColor Cyan
Write-Host "  Deja 在后台静默压缩上下文，你不需要做任何操作。" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dashboard（查看节省统计）：" -ForegroundColor White
Write-Host "    http://localhost:$Port/__deja__" -ForegroundColor Gray
Write-Host ""
Write-Host "  如有问题，运行诊断命令：" -ForegroundColor White
Write-Host "    deja doctor" -ForegroundColor Gray
Write-Host ""
