@echo off
setlocal
set "REMOTE_DIMMER_LAUNCHER=%~f0"
powershell.exe -NoProfile -Command "$source = [IO.File]::ReadAllText($env:REMOTE_DIMMER_LAUNCHER); Invoke-Expression ($source.Substring($source.LastIndexOf('# POWERSHELL') + 12))"
exit /b %errorlevel%
# POWERSHELL
$ErrorActionPreference = 'Stop'
try {
    $webDir = Split-Path -Parent $env:REMOTE_DIMMER_LAUNCHER
    $runtimeDir = '<PATH>'
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($listeners | Where-Object { $_.Port -eq 8769 }) {
        Write-Host 'Admin console is already running: http://127.0.0.1:8769/'
        exit 0
    }
    New-Item -ItemType Directory -Force -Path $runtimeDir, "$runtimeDir\go-cache", "$runtimeDir\go-tmp" | Out-Null
    $env:GOCACHE = "$runtimeDir\go-cache"
    $env:GOTMPDIR = "$runtimeDir\go-tmp"
    Set-Location -LiteralPath "$webDir\..\backend"
    & go build -buildvcs=false -o "$runtimeDir\admin-console.exe" ./cmd/admin-console
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host 'Admin console: http://127.0.0.1:8769/'
    Write-Host 'Ctrl+C stops only the admin console.'
    & "$runtimeDir\admin-console.exe"
    exit $LASTEXITCODE
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
}
