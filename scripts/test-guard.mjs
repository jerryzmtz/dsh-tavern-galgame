import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

export function memoryLimitMb(env = process.env) {
  const value = Number(env.DSH_TEST_MEMORY_MB ?? 4096)
  if (!Number.isSafeInteger(value) || value < 256 || value > 16384) throw Error('DSH_TEST_MEMORY_MB must be an integer from 256 to 16384')
  return value
}

// CommandLineToArgvW / CRT quoting, not shell quoting (no shell executes this string).
function quote(value) {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'
}

export function spawnGuarded(executable, args, { cwd, env = process.env, stdio = 'inherit', statusFile, timeoutMs = 180000, memoryMb = memoryLimitMb(env) }) {
  if (process.platform !== 'win32') throw Error('The hard test memory guard requires Windows Job Objects')
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 256 || memoryMb > 65536) throw Error('Invalid job memory limit')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffffffff) throw Error('Invalid job timeout')
  fs.mkdirSync(path.dirname(statusFile), { recursive: true })
  fs.rmSync(statusFile, { force: true })
  const config = { executable, command: [executable, ...args].map(quote).join(' '), cwd, statusFile,
    timeoutMs, memoryBytes: memoryMb * 1024 ** 2, parentPid: process.pid }
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./test-job.ps1', import.meta.url))], {
    cwd, env: { ...env, DSH_TEST_JOB_CONFIG: Buffer.from(JSON.stringify(config)).toString('base64') }, stdio, windowsHide: true,
  })
  child.completed = new Promise(resolve => {
    let spawnError
    child.once('error', error => { spawnError = error.message })
    child.once('close', (code, signal) => {
      let guard
      try { guard = JSON.parse(fs.readFileSync(statusFile, 'utf8')) } catch {}
      resolve({ code: guard?.code ?? (code || 127), signal, guard, spawnError,
        timedOut: guard?.reason === 'timeout', memoryExceeded: guard?.reason === 'memory',
        guardError: !guard })
    })
  })
  return child
}
