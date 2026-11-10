@echo off
setlocal
set "REMOTE_DIMMER_LAUNCHER=%~f0"
powershell.exe -NoProfile -Command "$source = [IO.File]::ReadAllText($env:REMOTE_DIMMER_LAUNCHER); Invoke-Expression ($source.Substring($source.LastIndexOf('# POWERSHELL') + 12))"
exit /b %errorlevel%
# POWERSHELL
$ErrorActionPreference = 'Stop'
$gateway = $null
$tunnel = $null
try {
    $webDir = Split-Path -Parent $env:REMOTE_DIMMER_LAUNCHER
    $runtimeDir = '<PATH>'
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:8765/status.json' | Out-Null
    } catch {
        throw 'Start the lighting server first: http://127.0.0.1:8765/status'
    }
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($listeners | Where-Object { $_.Port -eq 8768 }) {
        throw 'Web gateway port 8768 is already in use. No process was stopped.'
    }
    $runningTunnels = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'"
    if ($runningTunnels | Where-Object {
        $_.CommandLine -match '\btunnel\b.*\brun\b' -and
        $_.CommandLine -match '<HOST>|<HOST>'
    }) {
        throw 'The <HOST> tunnel is already running. No process was stopped.'
    }
    New-Item -ItemType Directory -Force -Path $runtimeDir, "$runtimeDir\go-cache", "$runtimeDir\go-tmp" | Out-Null
    $env:GOCACHE = "$runtimeDir\go-cache"
    $env:GOTMPDIR = "$runtimeDir\go-tmp"
    Set-Location -LiteralPath "$webDir\..\backend"
    & go build -buildvcs=false -o "$runtimeDir\web-gateway.exe" ./cmd/web-gateway
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $gateway = Start-Process -FilePath "$runtimeDir\web-gateway.exe" -WindowStyle Hidden -PassThru
    $tunnel = Start-Process -FilePath (Get-Command cloudflared.exe).Source -ArgumentList @(
        'tunnel', '--config', ('"{0}"' -f "$webDir\tunnel.windows.yml"), 'run', '<HOST>'
    ) -WindowStyle Hidden -PassThru
    Write-Host 'https://knudg.com/yuhisai/2026/dimmer/'
    Write-Host 'Ctrl+C stops Web hosting and its tunnel; backend levels are retained.'
    while (!$gateway.HasExited -and !$tunnel.HasExited) { Start-Sleep -Milliseconds 250 }
    if ($gateway.HasExited) { exit $gateway.ExitCode }
    exit $tunnel.ExitCode
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
} finally {
    foreach ($child in @($gateway, $tunnel)) {
        if ($null -ne $child -and !$child.HasExited) { $child.Kill(); $child.WaitForExit() }
    }
}
