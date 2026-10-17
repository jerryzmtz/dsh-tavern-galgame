import fs from 'node:fs/promises'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

// Exercise the same filesystem rejection branches without creating Windows links.
// This models metadata/realpath results, not kernel reparse or TOCTOU behavior.
export function simulateReparse(t) {
  const roots = new Map(), original = {lstat:fs.lstat, readdir:fs.readdir, realpath:fs.realpath}
  const key = value => process.platform === 'win32' ? path.resolve(String(value)).toLowerCase() : path.resolve(String(value))
  const marked = info => new Proxy(info, {get(target, name) {
    if (name === 'isSymbolicLink') return () => true
    if (name === 'isDirectory' || name === 'isFile') return () => false
    const value = Reflect.get(target, name)
    return typeof value === 'function' ? value.bind(target) : value
  }})
  t.mock.method(fs, 'lstat', async (file, options) => {
    const info = await original.lstat(file, options)
    return roots.has(key(file)) ? marked(info) : info
  })
  t.mock.method(fs, 'readdir', async (folder, options) => {
    const entries = await original.readdir(folder, options)
    return options?.withFileTypes ? entries.map(entry => roots.has(key(path.join(String(folder), entry.name))) ? marked(entry) : entry) : entries
  })
  t.mock.method(fs, 'realpath', async (file, options) => {
    const absolute = key(file)
    for (const [target, source] of roots) if (absolute === target || absolute.startsWith(target + path.sep)) return original.realpath(path.join(source, path.relative(target, absolute)), options)
    return original.realpath(file, options)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  return async (source, target) => {
    await fs.cp(source, target, {recursive:true, errorOnExist:true, force:false})
    roots.set(key(target), path.resolve(source))
  }
}
