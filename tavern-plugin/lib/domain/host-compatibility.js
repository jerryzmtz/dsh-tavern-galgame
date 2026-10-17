import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function classifyHostVersion(version, adaptedVersion) {
  const status = version && version === adaptedVersion ? 'verified' : 'incompatible'
  return Object.freeze({ version: version || '', adaptedVersion, status,
    packageName: '@deepseek-ai/dsh-session',
    message: status === 'verified' ? '' : (version ? '当前 DSH 版本不适配。' : '无法识别当前 DSH 版本，按不适配处理。')
      + '本酒馆仅适配 DSH ' + adaptedVersion + '，请使用此版本；其他版本的重新生成、回退等功能可能无法使用。' })
}

// Resolve from the actual host dependency, not PATH or another installed CLI.
// Called once during plugin startup; the returned immutable value is reused.
export function readHostCompatibility({ resolveHost, read = readFileSync } = {}) {
  const policy = JSON.parse(read(new URL('../../../config/dsh-compatibility.json', import.meta.url), 'utf8'))
  let version = ''
  try {
    const resolve = resolveHost || (() => {
      const plugin = createRequire(new URL('../../package.json', import.meta.url))
      return createRequire(plugin.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-session')
    })
    let dir = dirname(resolve())
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(read(join(dir, 'package.json'), 'utf8'))
        if (pkg.name === '@deepseek-ai/dsh-session') { version = String(pkg.version || ''); break }
      } catch { /* Entry points may be nested below the package root. */ }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* Unknown must not prevent starting the user's game. */ }
  return classifyHostVersion(version, policy.adaptedDshVersion)
}
