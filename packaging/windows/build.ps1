param(
    [Parameter(Mandatory=$true)][string]$Payload,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$TemporaryDirectory
)
$ErrorActionPreference = 'Stop'
$Payload = (Resolve-Path -LiteralPath $Payload).Path
$SevenZip = (Resolve-Path -LiteralPath $SevenZip).Path
$Output = [IO.Path]::GetFullPath($Output)
# The launcher verifies the embedded payload and names its runtime directory after
# the payload hash, so inject the hash of the payload actually being embedded.
$payloadHash = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant()
$launcherSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Launcher.cs'), [Text.Encoding]::UTF8)
$hashPattern = 'const string PayloadSha256="[0-9a-f]{64}";'
$versionPattern = 'const string Version="[0-9a-f]{16}-'
if (-not ([regex]::IsMatch($launcherSource, $hashPattern) -and [regex]::IsMatch($launcherSource, $versionPattern))) { throw 'Launcher.cs payload constants not found' }
$launcherSource = [regex]::Replace($launcherSource, $hashPattern, "const string PayloadSha256=`"$payloadHash`";")
$launcherSource = [regex]::Replace($launcherSource, $versionPattern, "const string Version=`"$($payloadHash.Substring(0,16))-")
$directory = Split-Path -Parent $Output
New-Item -ItemType Directory -Force $directory | Out-Null
$buildTemp = if ($TemporaryDirectory) { [IO.Path]::GetFullPath($TemporaryDirectory) } else { Join-Path $directory 'build-temp' }
New-Item -ItemType Directory -Force $buildTemp | Out-Null
$oldTemp = $env:TEMP; $oldTmp = $env:TMP
try {
    $env:TEMP = $buildTemp; $env:TMP = $buildTemp
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $launcherFile = Join-Path $buildTemp 'Launcher.cs'
    # BOM keeps the .NET Framework compiler from reading the Chinese UI strings as ANSI.
    [IO.File]::WriteAllText($launcherFile, $launcherSource, [Text.UTF8Encoding]::new($true))
    & $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Xml.Linq.dll "/out:$Output" "/resource:$Payload,payload" "/resource:$SevenZip,seven" "/resource:$PSScriptRoot/../../bin/download.cjs,downloadModule" "/resource:$PSScriptRoot/setup-upgrade.mjs,setupUpgrade" "/resource:$PSScriptRoot/../../install.ps1,powershellInstaller" $launcherFile (Join-Path $PSScriptRoot 'SetupDialog.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
    Write-Output "PayloadSHA256=$payloadHash"
    Get-FileHash -LiteralPath $Output -Algorithm SHA256
} finally {
    $env:TEMP = $oldTemp; $env:TMP = $oldTmp
    if ($launcherFile -and [IO.File]::Exists($launcherFile)) { [IO.File]::Delete($launcherFile) }
    # Delete only an empty compiler temp directory, never arbitrary build files.
    if ([IO.Directory]::Exists($buildTemp) -and [IO.Directory]::GetFileSystemEntries($buildTemp).Length -eq 0) { [IO.Directory]::Delete($buildTemp) }
}
