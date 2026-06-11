#Requires -RunAsAdministrator
param(
    [string]$ApiKey     = "",
    [string]$Upstream   = "",
    [string]$Provider   = "",
    [int]   $Port       = 9090,
    [string]$ReleaseTag = "",
    [switch]$Unattended
)
$ErrorActionPreference = "Continue"
$GITHUB_OWNER = "Deja922"
$GITHUB_REPO  = "Deja"
$INSTALL_DIR  = "$env:USERPROFILE\.deja\app"
$CONFIG_DIR   = "$env:USERPROFILE\.deja"

function Write-JsonUtf8NoBom {
    param(
        [Parameter(Mandatory = $true)] $Object,
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$Depth = 8
    )
    $json = $Object | ConvertTo-Json -Depth $Depth
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json + "`r`n", $utf8NoBom)
}

Clear-Host
Write-Host ""
Write-Host "  Deja Context Engine - Install" -ForegroundColor Cyan
Write-Host "  ================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Node.js
Write-Host "  [1/6] Checking Node.js..." -ForegroundColor White
try {
    $nodeVer = (node --version 2>&1).ToString().Trim()
    $major = [int]($nodeVer -replace "v(\d+)\..*",'$1')
    if ($major -lt 18) { Write-Host "  ERROR: Node.js $nodeVer too old, need v18+" -ForegroundColor Red; exit 1 }
    Write-Host "  OK  Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red; exit 1
}

# Step 2: Download release
Write-Host ""
Write-Host "  [2/6] Downloading Deja..." -ForegroundColor White
$rel = $null
if (-not $ReleaseTag) {
    try {
        $api = "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/releases/latest"
        $hdr = @{ "User-Agent"="deja-installer/1.0"; "Accept"="application/vnd.github+json" }
        $rel = Invoke-RestMethod -Uri $api -Headers $hdr -TimeoutSec 15
        $ReleaseTag = $rel.tag_name
        Write-Host "  OK  Latest version: $ReleaseTag" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Cannot fetch release info: $($_.Exception.Message)" -ForegroundColor Red; exit 1
    }
} else {
    try {
        $api = "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/releases/tags/$ReleaseTag"
        $hdr = @{ "User-Agent"="deja-installer/1.0"; "Accept"="application/vnd.github+json" }
        $rel = Invoke-RestMethod -Uri $api -Headers $hdr -TimeoutSec 15
        Write-Host "  OK  Version: $ReleaseTag" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Cannot fetch release $ReleaseTag`: $($_.Exception.Message)" -ForegroundColor Red; exit 1
    }
}
$zipAsset = $rel.assets | Where-Object { $_.name -like "*win-x64*.zip" } | Select-Object -First 1
if (-not $zipAsset) { Write-Host "  ERROR: No win-x64.zip in release $ReleaseTag" -ForegroundColor Red; exit 1 }

$tmpZip = "$env:TEMP\deja-$ReleaseTag.zip"
Write-Host "  Downloading $($zipAsset.name) ($([math]::Round($zipAsset.size/1MB,1)) MB)..." -ForegroundColor Gray
(New-Object System.Net.WebClient).DownloadFile($zipAsset.browser_download_url, $tmpZip)
Write-Host "  OK  Download complete" -ForegroundColor Green

if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
Expand-Archive -Path $tmpZip -DestinationPath $INSTALL_DIR -Force
Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
Set-Content -Path "$INSTALL_DIR\VERSION" -Value $ReleaseTag -Encoding UTF8

Push-Location $INSTALL_DIR
Write-Host "  Running npm ci..." -ForegroundColor Gray
npm ci --omit=dev --prefer-offline 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { npm install --omit=dev 2>&1 | Out-Null }
Write-Host "  OK  Dependencies installed" -ForegroundColor Green

# Install Electron binary
$electronExe = "$INSTALL_DIR\node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "  Downloading Electron runtime..." -ForegroundColor Gray
    for ($i = 1; $i -le 3; $i++) {
        try { node "$INSTALL_DIR\node_modules\electron\install.js" 2>&1 | Out-Null } catch {}
        if (Test-Path $electronExe) { break }
        if ($i -lt 3) { Write-Host "  Retry $i..." -ForegroundColor Yellow; Start-Sleep -Seconds 3 }
    }
    if (Test-Path $electronExe) {
        Write-Host "  OK  Electron ready" -ForegroundColor Green
    } else {
        # Fallback: use local npm cache if available
        $cached = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\electron-*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cached) {
            $distDir = "$INSTALL_DIR\node_modules\electron\dist"
            New-Item -ItemType Directory -Force $distDir | Out-Null
            Expand-Archive -Path $cached.FullName -DestinationPath $distDir -Force
            Write-Host "  OK  Electron extracted from local cache" -ForegroundColor Green
        } else {
            Write-Host "  WARN: Electron download failed, tray window unavailable" -ForegroundColor Yellow
        }
    }
}
Pop-Location

# Create launcher batch file
$launcherPath = "$INSTALL_DIR\start-tray.cmd"
$launcherContent = "@echo off`r`n`"$INSTALL_DIR\node_modules\electron\dist\electron.exe`" `"$INSTALL_DIR\dist\tray\main.js`""
[System.IO.File]::WriteAllText($launcherPath, $launcherContent, [System.Text.Encoding]::ASCII)

# Step 3: Configure API
Write-Host ""
Write-Host "  [3/6] Configure API..." -ForegroundColor White
if (-not $Unattended) {
    Write-Host "  Choose provider:" -ForegroundColor White
    Write-Host "    [1] aihubmix   (recommended, China-accessible)" -ForegroundColor Gray
    Write-Host "    [2] Anthropic  (official API, needs VPN)" -ForegroundColor Gray
    Write-Host "    [3] Custom URL" -ForegroundColor Gray
    Write-Host ""
    if (-not $Provider) {
        $choice = Read-Host "  Enter number (1-3) [default: 1]"
        if (-not $choice) { $choice = "1" }
        $Provider = $choice
    }
}
switch ($Provider) {
    { $_ -in "1","aihubmix"  } { $Upstream = "https://aihubmix.com";     $pName = "aihubmix"  }
    { $_ -in "2","anthropic" } { $Upstream = "https://api.anthropic.com"; $pName = "anthropic" }
    "3" { $Upstream = (Read-Host "  Upstream URL").TrimEnd("/"); $pName = "custom" }
    default { $Upstream = "https://aihubmix.com"; $pName = "aihubmix" }
}
Write-Host "  OK  Upstream: $Upstream" -ForegroundColor Green
if (-not $ApiKey -and -not $Unattended) {
    Write-Host ""
    $ApiKey = Read-Host "  API Key (right-click to paste)"
}

# Step 4: Write config
Write-Host ""
Write-Host "  [4/6] Writing config..." -ForegroundColor White
New-Item -ItemType Directory -Path $CONFIG_DIR -Force | Out-Null
$pCfg = @{ baseUrl=$Upstream; compatMode="anthropic" }
if ($ApiKey) { $pCfg.apiKey = $ApiKey }
$cfg = @{ port=$Port; pipeline=@{maxTokens=8000;targetTokens=4000;compressThreshold=200}; providers=@{$pName=$pCfg}; defaultProvider=$pName }
Write-JsonUtf8NoBom -Object $cfg -Path "$CONFIG_DIR\config.json" -Depth 6
Write-Host "  OK  Config: $CONFIG_DIR\config.json" -ForegroundColor Green

# Also write config to LocalSystem profile (service runs as LocalSystem)
$svcConfigDir = "C:\Windows\System32\config\systemprofile\.deja"
New-Item -ItemType Directory -Path $svcConfigDir -Force | Out-Null
Write-JsonUtf8NoBom -Object $cfg -Path "$svcConfigDir\config.json" -Depth 6
Write-Host "  OK  Service config: $svcConfigDir\config.json" -ForegroundColor Green

# Step 5: Windows Service
Write-Host ""
Write-Host "  [5/6] Registering Windows Service..." -ForegroundColor White
Push-Location $INSTALL_DIR
node "dist\service\windows-service.js" register 2>&1 | Out-Null
Start-Sleep -Seconds 2
Start-Service -Name "Deja Context Engine" -ErrorAction SilentlyContinue
Pop-Location
$policyBaseUrl = "http://localhost:$Port"
$policyObj = @{ env=@{ ANTHROPIC_BASE_URL=$policyBaseUrl } }
$policyJson = $policyObj | ConvertTo-Json -Depth 3 -Compress

# Write HKLM policy keys (Claude Code reads Settings JSON from this key)
$policyReg = "HKLM:\SOFTWARE\Policies\ClaudeCode"
New-Item -Path $policyReg -Force | Out-Null
New-ItemProperty -Path $policyReg -Name "ANTHROPIC_BASE_URL" -Value $policyBaseUrl -PropertyType String -Force | Out-Null
New-ItemProperty -Path $policyReg -Name "Settings" -Value $policyJson -PropertyType String -Force | Out-Null

# Write managed-settings.json in both known locations for compatibility
$managedDirs = @(
    "$env:ProgramFiles\ClaudeCode",
    "$env:ProgramData\ClaudeCode"
)
foreach ($managedDir in $managedDirs) {
    New-Item -ItemType Directory -Path $managedDir -Force | Out-Null
    Write-JsonUtf8NoBom -Object $policyObj -Path "$managedDir\managed-settings.json" -Depth 3
}
Write-Host "  OK  Service registered and started" -ForegroundColor Green

# Step 6: Tray startup
Write-Host ""
Write-Host "  [6/6] Configuring tray auto-start..." -ForegroundColor White
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Test-Path $electronExe) {
    Set-ItemProperty -Path $regPath -Name "DejaFloatingWindow" -Value "`"$launcherPath`""
    Start-Process "cmd.exe" -ArgumentList "/c `"$launcherPath`"" -WindowStyle Hidden -ErrorAction SilentlyContinue
    Write-Host "  OK  Tray window added to startup" -ForegroundColor Green
} else {
    Write-Host "  WARN: Electron not ready, skipping tray startup" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  ================================" -ForegroundColor Green
Write-Host "  Install complete!" -ForegroundColor Green
Write-Host "  ================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Upstream API : $Upstream" -ForegroundColor Gray
Write-Host "  Service      : auto-start on boot, auto-restart on crash" -ForegroundColor Gray
Write-Host "  Dashboard    : http://localhost:$Port/__deja__" -ForegroundColor Cyan
Write-Host "  Uninstall    : powershell -File `"$INSTALL_DIR\installer\uninstall.ps1`"" -ForegroundColor Gray
Write-Host ""

# Add node wrapper to PATH so users can run `deja` directly
$dejaShim = "$env:USERPROFILE\.deja\deja.cmd"
[System.IO.File]::WriteAllText($dejaShim, "@echo off`r`nnode `"$INSTALL_DIR\dist\cli\deja.js`" %*`r`n", [System.Text.Encoding]::ASCII)
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$dejaDir  = "$env:USERPROFILE\.deja"
if ($userPath -notlike "*$dejaDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$dejaDir", "User")
    Write-Host "  OK  Added deja to PATH (restart terminal to use 'deja' command)" -ForegroundColor Green
} else {
    Write-Host "  OK  deja already in PATH" -ForegroundColor Green
}
Write-Host ""
