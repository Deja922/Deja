param(
    [Parameter(Mandatory = $true)][string]$Owner,
    [Parameter(Mandatory = $true)][string]$Repo,
    [ValidateSet("private", "public")][string]$Visibility = "private",
    [switch]$DisableForking
)

$ErrorActionPreference = "Stop"

$token = $env:GITHUB_TOKEN
if (-not $token) {
    throw "Missing GITHUB_TOKEN. Set it before running this script."
}

$api = "https://api.github.com/repos/$Owner/$Repo"
$headers = @{
    Authorization = "Bearer $token"
    Accept        = "application/vnd.github+json"
    "User-Agent"  = "deja-protection-script"
}

Write-Host "Updating repository visibility to '$Visibility' for $Owner/$Repo ..."
$visibilityBody = @{
    private = ($Visibility -eq "private")
} | ConvertTo-Json

try {
    Invoke-RestMethod -Method Patch -Uri $api -Headers $headers -Body $visibilityBody -ContentType "application/json" | Out-Null
} catch {
    throw "Visibility update failed. Ensure token has repository Administration (write) permission. Raw: $($_.Exception.Message)"
}

if ($DisableForking) {
    Write-Host "Attempting to disable forking ..."
    try {
        $forkBody = @{
            allow_forking = $false
        } | ConvertTo-Json
        Invoke-RestMethod -Method Patch -Uri $api -Headers $headers -Body $forkBody -ContentType "application/json" | Out-Null
    } catch {
        Write-Warning "Could not disable forking via API (plan/permission may restrict this)."
    }
}

$result = Invoke-RestMethod -Method Get -Uri $api -Headers $headers
Write-Host "Done."
Write-Host "private     = $($result.private)"
Write-Host "visibility  = $($result.visibility)"
Write-Host "allow_forking = $($result.allow_forking)"
