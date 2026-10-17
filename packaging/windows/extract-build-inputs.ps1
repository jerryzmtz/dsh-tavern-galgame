param(
    [Parameter(Mandatory=$true)][string]$Launcher,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$Launcher = (Resolve-Path -LiteralPath $Launcher).Path
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force $Destination | Out-Null
# Read embedded resources only; do not run the downloaded launcher's entry point.
$assembly = [Reflection.Assembly]::LoadFile($Launcher)
foreach ($item in @(@('payload','online-payload.7z'), @('seven','7za.exe'))) {
    $stream = $assembly.GetManifestResourceStream($item[0])
    if ($null -eq $stream) { throw "Missing launcher resource: $($item[0])" }
    try {
        $file = [IO.File]::Create((Join-Path $Destination $item[1]))
        try { $stream.CopyTo($file) } finally { $file.Dispose() }
    } finally { $stream.Dispose() }
}
$expected = 'a272f20b3f1f5b15d2b8b05d22259e7e97597f47dfc01ee79291e34479d5cea4'
if ((Get-FileHash -LiteralPath (Join-Path $Destination 'online-payload.7z')).Hash.ToLowerInvariant() -ne $expected) { throw 'Unexpected Desktop payload' }
Write-Output "Verified build inputs: $Destination"
