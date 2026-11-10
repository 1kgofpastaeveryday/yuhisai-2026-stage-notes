param(
    [string]$SourceDir = '<PATH>',
    [string]$BuildDir = '<PATH>',
    [string]$QtPrefix = '<PATH>',
    [string]$CompilerBin = '<PATH>',
    [string]$CMake = '<PATH>'
)
$ErrorActionPreference = 'Stop'
if ((git -C $SourceDir rev-parse HEAD) -ne 'f0f302f901b0bb56c2e8d5d6838c3aeed20013c0') {
    throw 'Unexpected QLC source commit'
}
# A single cumulative patch keeps overlapping caption/lifetime/tree changes
# reproducible from the pinned base without reverse-checking intermediate states.
foreach ($patch in @((Join-Path $PSScriptRoot 'full-runtime.patch'))) {
    git -C $SourceDir apply --reverse --check $patch 2>$null
    if ($LASTEXITCODE -ne 0) {
        git -C $SourceDir apply --check $patch
        if ($LASTEXITCODE -ne 0) { throw "Patch does not apply: $patch" }
        git -C $SourceDir apply $patch
        if ($LASTEXITCODE -ne 0) { throw "Patch failed: $patch" }
    }
}
$env:PATH = "$CompilerBin;$QtPrefix\bin;$(Split-Path -Parent $CMake);$env:PATH"
& $CMake -S $PSScriptRoot -B $BuildDir -G Ninja "-DQLC_SOURCE=$SourceDir" "-DCMAKE_PREFIX_PATH=$QtPrefix" '-DCMAKE_BUILD_TYPE=Release'
if ($LASTEXITCODE -ne 0) { throw 'Configure failed' }
& $CMake --build $BuildDir --target qlcplus5 name-sync-test --parallel 8
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
Copy-Item -LiteralPath (Join-Path $BuildDir 'engine\src\qlcplusengine.dll') -Destination (Join-Path $BuildDir 'qlcplusengine.dll') -Force
Write-Output 'Built frontend and engine. No deployment or app launch performed.'
