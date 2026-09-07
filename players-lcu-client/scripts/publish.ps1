[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$projectFile = Join-Path $projectRoot "players-lcu-client.csproj"
$publishDirectory = Join-Path $projectRoot "artifacts\publish\win-x64"

if (-not (Test-Path -LiteralPath $projectFile -PathType Leaf)) {
    throw "Could not find the client project at '$projectFile'."
}

$dotnetPath = (Get-Command dotnet -CommandType Application -ErrorAction Stop).Path

# Publishing never replaces an existing build. This prevents a rehearsal from
# accidentally using a mix of stale and newly published files.
if (Test-Path -LiteralPath $publishDirectory) {
    $existingFiles = Get-ChildItem -LiteralPath $publishDirectory -Force
    if (@($existingFiles).Count -gt 0) {
        throw "Refusing to overwrite '$publishDirectory'. Review or remove that specific publish directory, then run this script again."
    }
}
else {
    [void][System.IO.Directory]::CreateDirectory($publishDirectory)
}

Write-Host "Publishing a self-contained Windows x64 client to '$publishDirectory'..."

& $dotnetPath publish $projectFile `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    --output $publishDirectory `
    --nologo `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=None `
    -p:DebugSymbols=false

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$executable = Join-Path $publishDirectory "players-lcu-client.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Publish completed but '$executable' was not produced."
}

Write-Host "Publish complete. Run '$executable' on the tournament PC."
