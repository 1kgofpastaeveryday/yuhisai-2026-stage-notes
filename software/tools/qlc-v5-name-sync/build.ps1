param(
    [string]$SourceDir = '<PATH>',
    [string]$OverlayDir = '<PATH>',
    [string]$BuildDir = '<PATH>',
    [string]$QtPrefix = '<PATH>',
    [string]$CompilerBin = '<PATH>',
    [string]$StockRuntime = '<PATH>',
    [string]$CMake = '<PATH>',
    [int]$Jobs = 8
)
$ErrorActionPreference = 'Stop'
$expectedCommit = 'f0f302f901b0bb56c2e8d5d6838c3aeed20013c0'
$engineHash = (Get-FileHash -LiteralPath (Join-Path $StockRuntime 'qlcplusengine.dll')).Hash.ToLowerInvariant()
if ($engineHash -ne '48b2d134d577fa11bc72ba1687c4456ac489245b6f6e8f5abffef6a475106bdb') {
    throw 'Engine does not match the tested QLC+5.3.0 Windows build'
}
$env:PATH = "$CompilerBin;$QtPrefix\bin;$(Split-Path -Parent $CMake);$env:PATH"
if (-not (Test-Path -LiteralPath $SourceDir)) {
    git clone --depth 1 --branch QLC+_5.3.0 https://github.com/mcallegari/qlcplus.git $SourceDir
    if ($LASTEXITCODE -ne 0) { throw 'QLC source download failed' }
}
$actualCommit = git -C $SourceDir rev-parse HEAD
if ($actualCommit -ne $expectedCommit) { throw "Unexpected QLC source: $actualCommit" }
$patch = Join-Path $PSScriptRoot 'function-caption.patch'
git -C $SourceDir apply --reverse --check $patch 2>$null
if ($LASTEXITCODE -ne 0) {
    git -C $SourceDir apply --check $patch
    if ($LASTEXITCODE -ne 0) { throw 'Caption patch does not apply cleanly' }
    git -C $SourceDir apply $patch
    if ($LASTEXITCODE -ne 0) { throw 'Applying caption patch failed' }
}
New-Item -ItemType Directory -Path $OverlayDir -Force | Out-Null
foreach ($name in @('CMakeLists.txt', 'name-sync-test.cpp')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $OverlayDir $name) -Force
}
# dlltool creates many short-lived files. Keep them on the local build drive.
Push-Location -LiteralPath $OverlayDir
try {
    & (Join-Path $CompilerBin 'gendef.exe') (Join-Path $StockRuntime 'qlcplusengine.dll')
    if ($LASTEXITCODE -ne 0) { throw 'Engine export extraction failed' }
    & (Join-Path $CompilerBin 'dlltool.exe') -d qlcplusengine.def -l libqlcplusengine.dll.a -D qlcplusengine.dll
    if ($LASTEXITCODE -ne 0) { throw 'Engine import library generation failed' }
} finally { Pop-Location }
& $CMake -S $OverlayDir -B $BuildDir -G Ninja "-DCMAKE_PREFIX_PATH=$QtPrefix" `
    "-DQLC_SOURCE=$SourceDir" "-DQLC_RUNTIME=$StockRuntime" '-DCMAKE_BUILD_TYPE=Release'
if ($LASTEXITCODE -ne 0) { throw 'QLC configure failed' }
& $CMake --build $BuildDir --target qlcplus5 name-sync-test --parallel $Jobs
if ($LASTEXITCODE -ne 0) { throw 'QLC build failed' }
Write-Output "Built $BuildDir\qmlui\qlcplus5.exe. No deployment or application launch performed."
