<#
.SYNOPSIS
    Deja Context Engine — 卸载脚本
.DESCRIPTION
    停止服务、移除开机自启、清理路由配置和安装目录
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File uninstall.ps1
#>

param([switch]$KeepConfig)

$ErrorActionPreference = "SilentlyContinue"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "  请以管理员身份运行此脚本" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  正在卸载 Deja Context Engine..." -ForegroundColor Cyan
Write-Host ""

# 1. 停止并删除 Windows Service
Write-Host "  [1/5] 停止 Windows Service..." -ForegroundColor White
$svc = Get-Service -Name "dejacontextengine" -ErrorAction SilentlyContinue
if (-not $svc) { $svc = Get-Service -Name "Deja Context Engine" -ErrorAction SilentlyContinue }

if ($svc) {
    Stop-Service -Name $svc.Name -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $nodeWin = "$env:USERPROFILE\.deja\app\node_modules\node-windows"
    if (Test-Path "$nodeWin\lib\index.js") {
        node "$env:USERPROFILE\.deja\app\dist\service\windows-service.js" remove 2>$null
        Start-Sleep -Seconds 2
    }
    # 强制删除残留服务
    sc.exe delete $svc.Name 2>$null
    Write-Host "  ✓  服务已停止并移除" -ForegroundColor Green
} else {
    Write-Host "  ✓  服务未安装，跳过" -ForegroundColor Gray
}

# 2. 杀掉 Electron 悬浮窗进程
Write-Host "  [2/5] 关闭悬浮窗..." -ForegroundColor White
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "deja-tray" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  ✓  悬浮窗已关闭" -ForegroundColor Green

# 3. 移除开机自启注册表项
Write-Host "  [3/5] 移除开机自启..." -ForegroundColor White
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "DejaFloatingWindow" -ErrorAction SilentlyContinue
Write-Host "  ✓  开机自启已移除" -ForegroundColor Green

# 4. 删除路由配置（managed-settings.json）
Write-Host "  [4/5] 清理路由配置..." -ForegroundColor White
$managedPath = "$env:ProgramData\ClaudeCode\managed-settings.json"
if (Test-Path $managedPath) {
    Remove-Item $managedPath -Force
    Write-Host "  ✓  managed-settings.json 已删除" -ForegroundColor Green
} else {
    Write-Host "  ✓  路由配置不存在，跳过" -ForegroundColor Gray
}

# 5. 删除安装目录
Write-Host "  [5/5] 删除安装目录..." -ForegroundColor White
$installDir = "$env:USERPROFILE\.deja"
if (Test-Path $installDir) {
    if ($KeepConfig) {
        # 保留 config.json，只删 app/
        Remove-Item "$installDir\app" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  ✓  安装目录已删除（config.json 已保留）" -ForegroundColor Green
    } else {
        Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  ✓  安装目录已删除" -ForegroundColor Green
    }
} else {
    Write-Host "  ✓  安装目录不存在，跳过" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  ✅ Deja 已完全卸载。Claude Code 将恢复直连上游 API。" -ForegroundColor Green
Write-Host ""

# Remove deja.cmd shim and PATH entry added by installer
$dejaShim = "$env:USERPROFILE\.deja\deja.cmd"
if (Test-Path $dejaShim) { Remove-Item $dejaShim -Force -ErrorAction SilentlyContinue }
$dejaDir  = "$env:USERPROFILE\.deja"
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -like "*$dejaDir*") {
    $newPath = ($userPath -split ";" | Where-Object { $_ -ne $dejaDir }) -join ";"
    [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
}
