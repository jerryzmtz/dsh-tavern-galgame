$ErrorActionPreference = 'Stop'
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:DSH_TEST_JOB_CONFIG)) | ConvertFrom-Json
Remove-Item Env:DSH_TEST_JOB_CONFIG
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'test-job.cs')
    $result = [TavernTestJob]::Run($config.executable, $config.command, $config.cwd, [uint64]$config.memoryBytes, [uint32]$config.timeoutMs, [uint32]$config.parentPid)
    $json = $result | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($config.statusFile, $json, [Text.UTF8Encoding]::new($false))
    if ($result.reason -ne 'exit') { [Console]::Error.WriteLine('[test-guard] ' + $json) }
    exit $result.code
} catch {
    [Console]::Error.WriteLine('[test-guard] setup/monitor failure: ' + $_)
    exit 127
}
