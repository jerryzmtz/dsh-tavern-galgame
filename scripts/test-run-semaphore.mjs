import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export function affectedSlots(env = process.env) {
  const value = Number(env.DSH_AFFECTED_RUNS ?? 2)
  if (!Number.isInteger(value) || value < 1 || value > 4) throw Error('DSH_AFFECTED_RUNS must be an integer from 1 to 4 (use the same value in every agent)')
  return value
}

export function semaphoreDirectory(root) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
  return path.join(path.dirname(common), '.tmp', 'affected-run-slots')
}

export async function acquireAffectedSlot(directory, { slots = affectedSlots(), pollMs = 1000, signal } = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const token = randomUUID()
  let waiting = false
  while (true) {
    signal?.throwIfAborted()
    for (let slot = 0; slot < slots; slot++) {
      const file = path.join(directory, `${slot}.lock`)
      let fd
      try { fd = fs.openSync(file, 'wx') } catch (error) { if (error.code === 'EEXIST') continue; throw error }
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString(), cwd: process.cwd() }) + '\n') }
      catch (error) { fs.unlinkSync(file); throw error }
      finally { fs.closeSync(fd) }
      let released = false
      const release = () => {
        if (released) return
        released = true
        process.off('exit', release)
        // Never reclaim a foreign/stale slot automatically: PID reuse and competing waiters race.
        if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file)
      }
      process.once('exit', release)
      return release
    }
    if (!waiting) { console.error(`[test-guard] waiting for an affected-run slot in ${directory}`); waiting = true }
    await delay(pollMs, undefined, { signal })
  }
}
