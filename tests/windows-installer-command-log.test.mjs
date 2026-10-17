import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

test('Windows installer preserves failure output and separates successful paths from stderr', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'installer-command-'))
  try {
    const source = (await readFile(new URL('../install.ps1', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
    const logger = source.match(/WriteAllText\(\$UpdateLogger, @'\n([\s\S]*?)\n'@/)[1]
    await writeFile(path.join(root, 'logger.cjs'), logger)
    const functions = source.slice(source.indexOf('  function Write-UpdateLog'), source.indexOf("  Write-UpdateLog 'installer.started'"))
    await writeFile(path.join(root, 'fail.cjs'), 'console.log("setup started");console.error("DOWNLOAD_FAILED password=secret https://u:secret@example.com/file?token=secret");process.exitCode=42')
    await writeFile(path.join(root, 'ok.cjs'), 'console.log("D:\\u005c包管理 space\\u005cbin");console.error("warning only")')
    const probe = `
$ErrorActionPreference = 'Stop'
$TempDir = $PSScriptRoot
$UpdateLogRoot = Join-Path $PSScriptRoot 'logs'
$UpdateLogger = Join-Path $PSScriptRoot 'logger.cjs'
${functions}
try {
  Invoke-InstallCommand 'desktop.package-manager' 'node' @((Join-Path $PSScriptRoot 'fail.cjs')) -CaptureOutput
  throw 'Failure was swallowed'
} catch {
  if ($_.Exception.Message -notmatch 'DOWNLOAD_FAILED' -or $_.Exception.Message -notmatch '42') { throw }
}
$result = Invoke-InstallCommand 'desktop.package-manager' 'node' @((Join-Path $PSScriptRoot 'ok.cjs')) -CaptureOutput
if ($result -match 'warning' -or $result -notmatch 'space') { throw 'stderr contaminated path' }
try {
  Assert-InstallFiles $PSScriptRoot
  throw 'Missing file accepted'
} catch { if ($_.Exception.Message -notmatch 'package.json') { throw } }
function node { throw 'broken Desktop Node shim' }
$fallback = Join-Path $PSScriptRoot 'fallback.txt'
[IO.File]::WriteAllText($fallback, 'FALLBACK_ERROR password=secret https://u:secret@example.com/file?token=secret')
Write-UpdateLog 'installer.stage.failed' 'fallback.test' '17' '' $fallback
`
    await writeFile(path.join(root, 'probe.ps1'), '\ufeff' + probe)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'probe.ps1')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const logs = (await readFile(path.join(root, 'logs/update-diagnostics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    const failure = logs.find(r => r.event === 'installer.stage.failed')
    assert.equal(failure.exitCode, 42)
    assert.equal(failure.step, 'desktop.package-manager')
    assert.match(failure.output, /DOWNLOAD_FAILED/)
    assert.match(failure.output, /setup started/)
    assert.doesNotMatch(JSON.stringify(logs), /secret/)
    assert.ok(logs.some(r => r.event === 'installer.stage.succeeded'))
    assert.match(logs.find(r => r.step === 'fallback.test').output, /FALLBACK_ERROR/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
