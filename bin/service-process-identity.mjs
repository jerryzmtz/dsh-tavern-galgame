import { readFileSync } from 'node:fs'

export function processStartToken(pid, read = readFileSync) {
  try {
    const stat = read(`/proc/${pid}/stat`, 'utf8')
    // comm may contain spaces and parentheses; starttime is field 22.
    return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19] || null
  } catch { return null }
}

/** Android/proot may expose an unrelated, inaccessible Android PID after reuse. */
export function inspectRecordedProcess(record, { platform = process.platform, host, home,
  kill = process.kill.bind(process), read = readFileSync } = {}) {
  let denied = false
  try { kill(record.pid, 0) } catch (error) {
    if (error?.code === 'ESRCH') return 'gone'
    if (error?.code !== 'EPERM') return 'unknown'
    denied = true
  }
  if (host !== 'android' || platform !== 'linux') return 'owned'
  try {
    const args = read(`/proc/${record.pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    const option = name => {
      const index = args.indexOf(name)
      return index >= 0 ? args[index + 1] : args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1)
    }
    if (option('--profile') !== (record.profile || 'tavern')) return 'foreign'
    if (record.port && option('--port') !== String(record.port)) return 'foreign'
    const env = read(`/proc/${record.pid}/environ`, 'utf8').split('\0')
    const dshHome = env.find(entry => entry.startsWith('DSH_HOME='))?.slice(9)
    if (!dshHome) return 'unknown'
    if (dshHome !== home) return 'foreign'
    if (record.startToken) {
      const current = processStartToken(record.pid, read)
      if (!current) return 'unknown'
      if (current !== record.startToken) return 'foreign'
    }
    return 'owned'
  } catch (error) {
    // A process can exit between kill(0) and reading proc; permission failures
    // are unknown, not proof that the process has exited.
    return error?.code === 'ENOENT' && !denied ? 'gone' : 'unknown'
  }
}
