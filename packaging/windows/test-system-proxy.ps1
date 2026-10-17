param(
    [Parameter(Mandatory=$true)][string]$Launcher,
    [Parameter(Mandatory=$true)][string]$TestDirectory,
    [string]$Registry = 'https://registry.npmjs.org'
)
# Reproduces "only the Windows system proxy works": every download host is blackholed in
# the hosts file (connections hang like a blocked site), and the only working route is an
# HTTP proxy configured as the WinINET system proxy. A complete online install then proves
# Setup -> install.ps1 -> git/curl/node/pnpm all honour the system proxy.
# Changes the hosts file and HKCU proxy settings for the run and restores both afterwards;
# meant for CI runners or disposable test machines, run as administrator.
$ErrorActionPreference = 'Stop'
$Launcher = (Resolve-Path -LiteralPath $Launcher).Path
$TestDirectory = [IO.Path]::GetFullPath($TestDirectory)
if (Test-Path -LiteralPath $TestDirectory) { throw 'Use a new, empty test directory' }
New-Item -ItemType Directory $TestDirectory | Out-Null

$blocked = @('github.com', 'api.github.com', 'codeload.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
    'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'registry.npmjs.org', 'registry.npmmirror.com', 'npmmirror.com', 'nodejs.org')
$hostsFile = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$hostsBackup = [IO.File]::ReadAllBytes($hostsFile)
$settingsKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$previousSettings = Get-ItemProperty -Path $settingsKey
$proxyLog = Join-Path $TestDirectory 'proxy-hosts.log'
$port = 18080
$proxy = $null
function Assert-True($condition, $message) { if (!$condition) { throw "FAIL: $message" }; Write-Output "PASS: $message" }
function Restore-ProxySetting([string]$Name) {
    if ($null -ne $previousSettings.$Name) { Set-ItemProperty -Path $settingsKey -Name $Name -Value $previousSettings.$Name }
    else { Remove-ItemProperty -Path $settingsKey -Name $Name -ErrorAction SilentlyContinue }
}
try {
    foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    # 10.255.255.1 is unroutable: a direct connection times out instead of failing fast.
    $lines = $blocked | ForEach-Object { "10.255.255.1 $_" }
    [IO.File]::AppendAllText($hostsFile, "`r`n# dsh-tavern system proxy test`r`n" + ($lines -join "`r`n") + "`r`n")
    ipconfig /flushdns | Out-Null
    & curl.exe --silent --output NUL --connect-timeout 5 https://registry.npmjs.org/
    Assert-True ($LASTEXITCODE -ne 0) 'direct connections to download hosts are blocked'

    $proxy = Start-Process -FilePath (Get-Command node).Source -ArgumentList @("`"$(Join-Path $PSScriptRoot 'test-proxy-server.cjs')`"", $port, "`"$proxyLog`"") -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 50 -and !(Test-Path -LiteralPath $proxyLog); $i++) { Start-Sleep -Milliseconds 200 }
    & curl.exe --silent --output NUL --connect-timeout 10 --proxy "http://127.0.0.1:$port" https://registry.npmjs.org/
    Assert-True ($LASTEXITCODE -eq 0) 'the test proxy reaches blocked hosts'

    Set-ItemProperty -Path $settingsKey -Name ProxyEnable -Value 1 -Type DWord
    Set-ItemProperty -Path $settingsKey -Name ProxyServer -Value "127.0.0.1:$port"
    Set-ItemProperty -Path $settingsKey -Name ProxyOverride -Value '<local>'

    $install = Join-Path $TestDirectory 'install'
    $env:DSH_LAUNCHER_TEST_ROOT = $install
    $process = Start-Process -FilePath $Launcher -ArgumentList '--prepare-only' -WindowStyle Hidden -PassThru
    $null = $process.Handle
    if (!$process.WaitForExit(300000)) { $process.Kill(); throw 'prepare-only timed out' }
    Assert-True ($process.ExitCode -eq 0) 'runtime preparation succeeds'
    Remove-Item Env:DSH_LAUNCHER_TEST_ROOT
    & (Join-Path $PSScriptRoot 'test-online-upgrade.ps1') -InstallDirectory $install -Registry $Registry
    $used = @(Get-Content -LiteralPath $proxyLog | Where-Object { $_ -notlike '#*' })
    Write-Output ('Hosts reached through the system proxy: ' + ($used -join ', '))
    $registryHost = ([Uri]$Registry).Host
    Assert-True ($used -contains $registryHost) "package downloads used the system proxy ($registryHost)"
    Assert-True (@($used | Where-Object { $_ -in @('github.com', 'cdn.jsdelivr.net', 'codeload.github.com') }).Count -gt 0) 'source download used the system proxy'
    Write-Output 'All system proxy checks passed.'
} finally {
    Remove-Item Env:DSH_LAUNCHER_TEST_ROOT -ErrorAction SilentlyContinue
    if ($proxy -and !$proxy.HasExited) { $proxy.Kill() }
    foreach ($name in @('ProxyEnable', 'ProxyServer', 'ProxyOverride')) { Restore-ProxySetting $name }
    [IO.File]::WriteAllBytes($hostsFile, $hostsBackup)
    ipconfig /flushdns | Out-Null
}
