import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { recordUpdateDiagnostic, redactUpdateDiagnostic } from './update-diagnostics.mjs'
import { randomUUID } from 'node:crypto'
import { runInstallationProcess } from './installation-process.mjs'
import installationState from './installation-state.cjs'
import { createUpdateState } from './update-state.mjs'
import { readInstallationReceipt } from './installation-receipt.mjs'
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { INSTALL_HOSTS, SOURCE_ROOT, DSH_ROOT, RUNTIME_HOST, runtimeEnvironment, commandExists, sleep } from './launcher-environment.mjs'
import { startupTimeoutMs } from './service-startup.mjs'

// Own update execution and durable terminal outcomes, including installed-but-needs-restart.
export function encodeWindowsPowerShellScript(source) {
  const utf8Output = "$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\r\n"
  return `\uFEFF${utf8Output}${source.replace(/^\uFEFF/, '')}`
}

export function decodeUpdateOutput(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '')
  let text
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) text = buffer.subarray(2).toString('utf16le')
  else text = buffer.toString('utf8')
  return text.replace(/^\uFEFF/, '').replaceAll('\u0000', '')
}

export function parseUpdateOptions(args) {
  let host = RUNTIME_HOST
  let statusFile = ''
  let delay = 0
  let targetCommit = ''
  let attemptId = ''
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--host') host = args[++index]
    else if (value.startsWith('--host=')) host = value.slice('--host='.length)
    else if (value === '--status-file') statusFile = args[++index]
    else if (value.startsWith('--status-file=')) statusFile = value.slice('--status-file='.length)
    else if (value === '--delay') delay = Number(args[++index])
    else if (value.startsWith('--delay=')) delay = Number(value.slice('--delay='.length))
    else if (value === '--attempt-id') attemptId = args[++index]
    else if (value.startsWith('--attempt-id=')) attemptId = value.slice('--attempt-id='.length)
    else if (value === '--target-commit') targetCommit = args[++index]
    else if (value.startsWith('--target-commit=')) targetCommit = value.slice('--target-commit='.length)
    else throw new Error(`无法识别的更新参数：${value}`)
  }
  if (!INSTALL_HOSTS.has(host)) throw new Error(`不支持的安装宿主：${host}`)
  if (statusFile !== '' && !path.isAbsolute(statusFile)) throw new Error('更新状态文件必须使用绝对路径')
  if (!Number.isInteger(delay) || delay < 0 || delay > 5000) throw new Error('更新延迟必须是 0 到 5000 毫秒的整数')
  if (targetCommit !== '' && !/^[0-9a-f]{40}$/i.test(targetCommit)) throw new Error('目标提交号无效')
  if (attemptId && !/^[a-zA-Z0-9-]{1,100}$/.test(attemptId)) throw new Error('更新尝试编号无效')
  return { host, statusFile, delay, targetCommit, ...(attemptId ? { attemptId } : {}) }
}


// Long-lived services must be born outside the installer Job/process group.
// The existing start command owns its readiness timeout and child cleanup.
export async function startUpdatedService({ sourceRoot, dshHome, log = console.log, noOpen = false }) {
  try {
    const result = await promisify(execFile)(process.execPath, [path.join(sourceRoot, 'bin/dsh-tavern.mjs'), 'start'], {
      cwd: sourceRoot, windowsHide: true, timeout: startupTimeoutMs('cli') + 15_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...runtimeEnvironment({ installation: false }), DSH_HOME: dshHome, DSH_TAVERN_CLI_HOME: dshHome, DSH_TAVERN_RUNTIME_HOST: 'cli', ...(noOpen ? { DSH_TAVERN_NO_OPEN: '1' } : {}) },
    })
    if (result.stdout) log(result.stdout.trim())
  } catch (error) {
    error.message = `安装后的服务启动未能确认完成：${error.stderr || error.message}`
    error.unsafeToRetry = true
    throw error
  }
}

// The lines that explain an installer failure: the end of its output without the
// progress stream and PowerShell's error-record boilerplate. Redact after taking the
// tail; redaction also truncates, and must not keep the head of a long download log.
export function installerFailureTail(output, lines = 12) {
  const meaningful = String(output ?? '').split(/\r?\n/).filter(line => line.trim() !== '' &&
    !/^DSH_STATUS\s/.test(line) && !/^Progress: /.test(line) &&
    !/^\s*\+/.test(line) && !/^\s*\d+\s*$/.test(line) && !/^\s*(所在位置|At )\S*/.test(line) &&
    !/^\s*(CategoryInfo|FullyQualifiedErrorId)\s*:/.test(line))
  return redactUpdateDiagnostic(meaningful.slice(-lines).join('\n'))
}

export async function updateApplication(options = { host: RUNTIME_HOST, statusFile: '', delay: 0 }) {
  options = { statusFile: '', delay: 0, ...options }
  const sourceRoot = path.resolve(options.sourceRoot || SOURCE_ROOT)
  const log = typeof options.log === 'function' ? options.log : console.log
  const startedAt = Date.now()
  const attemptId = options.attemptId || randomUUID()
  const dshHome = path.resolve(options.dshHome || DSH_ROOT)
  // A working directory inside the app keeps Windows from swapping it (EBUSY), even
  // when the update was started from a terminal opened there.
  if (process.platform === 'win32' && !options.keepCwd) try { process.chdir(os.tmpdir()) } catch {}
  const lease = installationState.acquireInstallation({ dshHome, sourceRoot, statusFile: options.statusFile, attemptId, adopt: !!options.attemptId, supervised: true })
  lease.update({ supervised: true, state: 'running' })
  const state = createUpdateState(options.statusFile, dshHome)
  const writeUpdateStatus = value => state.write(value, { attemptId })
  const controller = new AbortController()
  const poll = setInterval(() => {
    try { if (installationState.cancellationRequested(dshHome, attemptId)) controller.abort(new Error('用户请求中止更新')) } catch (error) { controller.abort(error) }
  }, 200)
  let safeToRelease = true
  const targetCommit = String(options.targetCommit || '')
  let temporary = ''
  let outputFile = ''
  try {
    await writeUpdateStatus({
      phase: 'running', attemptId, host: options.host, startedAt, pid: process.pid, supervisorReady: true, cancellable: true,
      ...(targetCommit ? { targetCommit } : {}),
    })
    if (options.delay > 0) await sleep(options.delay)
    log('正在更新 DSH Tavern……')
    // private fork: the upstream installer would overwrite a local git checkout; sync with git instead.
    if (existsSync(path.join(sourceRoot, '.git'))) {
      throw new Error('当前是本地 Git 魔改版，应用内更新已禁用；请在源码目录用 git fetch upstream && git merge upstream/main 同步上游。')
    }
    const program = resolveUpdateProgram(options.host, process.platform, sourceRoot)
    const installer = program.script
    if (!existsSync(installer)) throw new Error(`当前安装缺少更新程序：${installer}`)
    const extension = path.extname(installer).slice(1) || 'sh'
    temporary = path.join(os.tmpdir(), `dsh-tavern-update-${process.pid}-${randomUUID()}.${extension}`)
    if (path.extname(installer).toLowerCase() === '.ps1') {
      writeFileSync(temporary, encodeWindowsPowerShellScript(readFileSync(installer, 'utf8')), 'utf8')
    } else {
      copyFileSync(installer, temporary)
    }
    const command = program.command
    const args = program.args.map((argument) => argument === installer ? temporary : argument)
    const capture = options.statusFile !== ''
    outputFile = capture ? `${temporary}.log` : ''
    let outputDescriptor = null
    let result
    let commandError
    try {
      if (capture) outputDescriptor = openSync(outputFile, 'w')
      result = await runInstallationProcess(command, args, {
        // Outside the app being replaced (Windows refuses to rename a directory in use as a cwd).
        cwd: os.tmpdir(),
        root: true, timeoutMs: options.timeoutMs || 30 * 60 * 1000, signal: controller.signal, label: '安装程序',
        processDirectory: path.join(lease.lockDir, 'processes'),
        onSpawn(child) { lease.update({ childPid: child.pid, stage: '安装程序', progressAt: Date.now() }) },
        env: {
          ...runtimeEnvironment(),
          DSH_TAVERN_HOST: options.host,
          ...(options.host === 'cli' ? { DSH_TAVERN_DEFER_SERVICE_START: '1' } : {}),
          DSH_TAVERN_UPDATE_ATTEMPT: attemptId,
          DSH_TAVERN_SOURCE_ROOT: sourceRoot,
          DSH_HOME: dshHome,
          ...(options.host === 'cli' ? { DSH_TAVERN_CLI_HOME: dshHome } : {}),
          DSH_TAVERN_INSTALL_ATTEMPT: attemptId,
          DSH_TAVERN_INSTALL_LOCK: lease.lockDir,
          ...(capture ? { DSH_TAVERN_UPDATE_LOG_ROOT: path.dirname(options.statusFile) } : {}),
          ...(options.targetCommit ? { DSH_TAVERN_TARGET_COMMIT: options.targetCommit } : {}),
          ...(capture ? { DSH_TAVERN_NO_OPEN: '1' } : {}),
        },
        stdio: capture ? ['ignore', outputDescriptor, outputDescriptor] : 'inherit',
        windowsHide: true,
      })
    } catch (error) { commandError = error; result = error } finally {
      if (outputDescriptor !== null) closeSync(outputDescriptor)
    }
    if (capture && existsSync(outputFile)) {
      const output = redactUpdateDiagnostic(decodeUpdateOutput(readFileSync(outputFile)), Infinity)
      recordUpdateDiagnostic(path.dirname(options.statusFile), { event: 'installer.output', attemptId, exitCode: result.status, signal: result.signal,
        durationMs: Date.now() - startedAt, output: output.slice(-6000), outputHead: output.slice(0, 6000),
        omittedCharacters: Math.max(0, output.length - 12000) })
    }
    if (commandError) {
      if (capture && existsSync(outputFile)) commandError.message += '\n' + installerFailureTail(decodeUpdateOutput(readFileSync(outputFile)))
      throw commandError
    }
    if (result.error) throw new Error(`无法运行更新程序：${result.error.message}`)
    if (result.status !== 0) {
      const details = capture && existsSync(outputFile) ? installerFailureTail(decodeUpdateOutput(readFileSync(outputFile))) : ''
      throw new Error(`更新失败${details ? `：${details}` : '，请查看上方错误信息。'}`)
    }
    if (temporary !== '' && existsSync(temporary)) unlinkSync(temporary)
    temporary = ''
    if (outputFile !== '' && existsSync(outputFile)) unlinkSync(outputFile)
    outputFile = ''
    const installedSourceRoot = options.installedSourceRoot || (options.host === 'android' ? sourceRoot : process.env.DSH_TAVERN_APP_DIR || path.join(dshHome, 'apps/dsh-tavern'))
    const receipt = await readInstallationReceipt({ sourceRoot: installedSourceRoot, dshHome, host: options.host, attemptId, after: startedAt - 1 })
    if (!receipt) throw new Error('安装程序已退出，但未确认配置验证和安装完成；请修复安装。')
    if (controller.signal.aborted) throw Object.assign(new Error('更新已取消'), { code: 'INSTALLATION_ABORTED' })
    if (options.host === 'cli') {
      lease.update({ stage: '启动 Tavern 服务', supervised: false })
      if (installationState.cancellationRequested(dshHome, attemptId)) throw Object.assign(new Error('更新已取消'), { code: 'INSTALLATION_ABORTED' })
      await (options.startService || startUpdatedService)({ sourceRoot: installedSourceRoot, dshHome, log, noOpen: options.statusFile !== '' })
    }
    await writeUpdateStatus({
      phase: 'completed', attemptId, host: options.host, completedAt: Date.now(),
      requiresRestart: options.host === 'desktop' || (options.host === 'android' && process.env.DSH_TAVERN_ANDROID_STANDALONE === '1'),
      ...(targetCommit ? { targetCommit } : {}),
    })
  } catch (error) {
    let failure = error
    if (error.unsafeToRetry || installationState.readInstallation(dshHome)?.unsafeToRetry) {
      safeToRelease = false
      lease.update({ state: 'blocked', unsafeToRetry: true })
    }
    if (temporary !== '' && existsSync(temporary)) {
      try { unlinkSync(temporary) } catch (cleanupError) {
        failure = new Error(`${String(error?.message || error)}；临时文件清理失败：${String(cleanupError?.message || cleanupError)}`)
      }
    }
    if (outputFile !== '' && existsSync(outputFile)) {
      try { unlinkSync(outputFile) } catch {}
    }
    // A staged CLI install restores the previous app when it fails after the switch.
    // Its earlier receipt still matching proves that build is intact. The installer
    // job has ended, so the service may be started outside it, as on success.
    let restored = false
    if (options.host === 'cli' && safeToRelease) {
      const appRoot = options.installedSourceRoot || process.env.DSH_TAVERN_APP_DIR || path.join(dshHome, 'apps/dsh-tavern')
      // Cancellation ends the whole installer tree, so its own cleanup may not run.
      // With the tree verified stopped, finish it here: undo an unfinished switch
      // (no-op when the installer already did) and drop a leftover staging copy.
      const stager = [appRoot, appRoot + '.previous'].map(root => path.join(root, 'bin/staged-app-install.mjs')).find(file => existsSync(file))
      if (stager) {
        try { await promisify(execFile)(process.execPath, [stager, 'rollback', '--app', appRoot], { windowsHide: true, timeout: 120_000 }) }
        catch (rollbackError) { failure = new Error(`${String(failure?.message || failure)}\n恢复原版本失败：${String(rollbackError?.stderr || rollbackError?.message || rollbackError)}`) }
      }
      restored = !!await readInstallationReceipt({ sourceRoot: appRoot, dshHome, host: options.host })
      if (existsSync(path.join(appRoot, 'bin/dsh-tavern.mjs'))) {
        try { await (options.startService || startUpdatedService)({ sourceRoot: appRoot, dshHome, log, noOpen: options.statusFile !== '' }) }
        catch (startError) { failure = new Error(`${String(failure?.message || failure)}\n${String(startError?.message || startError)}`) }
      }
    }
    await writeUpdateStatus({
      phase: safeToRelease ? 'failed' : 'blocked', attemptId, ...(restored ? {} : { repairRequired: true, repairSince: Date.now() }), host: options.host, failedAt: Date.now(),
      error: (restored ? '更新未完成，已恢复原版本并继续运行。' : '') + String(failure?.message || failure),
      ...(targetCommit ? { targetCommit } : {}),
    })
    throw failure
  } finally {
    clearInterval(poll)
    if (safeToRelease) lease.release()
  }
}

function resolveWindowsPowerShell(options = {}) {
  const environment = options.env || process.env
  const fileExists = options.fileExists || existsSync
  const commandAvailable = options.commandAvailable || commandExists
  const windowsRoots = [
    environment.SystemRoot,
    environment.SYSTEMROOT,
    environment.WINDIR,
    environment.windir,
  ].filter(Boolean)

  for (const windowsRoot of new Set(windowsRoots)) {
    const candidate = path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fileExists(candidate)) return candidate
  }
  if (commandAvailable('powershell.exe')) return 'powershell.exe'
  if (commandAvailable('pwsh.exe')) return 'pwsh.exe'
  return ''
}

export function resolveUpdateProgram(host, platform = process.platform, sourceRoot = SOURCE_ROOT, options = {}) {
  if (host === 'android') {
    const script = path.join(sourceRoot, 'android', 'update.sh')
    return { script, command: 'bash', args: [script] }
  }
  if (platform === 'win32') {
    const script = path.join(sourceRoot, 'install.ps1')
    const command = resolveWindowsPowerShell(options)
    if (command === '') {
      const hostPrefix = host === 'desktop' ? "$env:DSH_TAVERN_HOST='desktop'; " : ''
      throw new Error(
        `找不到 Windows PowerShell 或 PowerShell 7。请在当前 PowerShell 中运行：${hostPrefix}irm https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1 | iex`,
      )
    }
    return { script, command, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] }
  }
  const script = path.join(sourceRoot, 'install.sh')
  return { script, command: 'sh', args: [script] }
}
