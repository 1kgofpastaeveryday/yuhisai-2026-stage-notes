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
    if ($listeners | Where-Object { $_.Port -in 8765, 8766 }) {
        throw 'Server port 8765 or 8766 is already in use. No process was stopped.'
    }
    New-Item -ItemType Directory -Force -Path $runtimeDir, "$runtimeDir\go-cache", "$runtimeDir\go-tmp" | Out-Null
    $env:GOCACHE = "$runtimeDir\go-cache"
    $env:GOTMPDIR = "$runtimeDir\go-tmp"
    Set-Location -LiteralPath "$webDir\..\backend"
    & go build -buildvcs=false -o "$runtimeDir\remote-dimmer.exe" .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host 'Lighting server: http://127.0.0.1:8765/status'
    Write-Host 'Ctrl+C stops the lighting server and requests zero levels.'
    & "$runtimeDir\remote-dimmer.exe" -config "$webDir\..\venue\config.windows.json"
    exit $LASTEXITCODE
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
}
