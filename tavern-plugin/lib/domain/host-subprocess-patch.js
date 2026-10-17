import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { defaultHostRequire } from './host-session-patch.js'

const PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const VERSION = '0.1.5-rc.2'
const SHA256 = 'a3f85e92ce5eddc824348f83cf685d3e417a26c5f1ab602a81fe1bd13315fe2c'
const installed = new WeakMap()

// DSH's Windows Job launcher starts a Node runner with an IPC channel. From a
// detached web host it allocates a visible console unless windowsHide is set.
// Replace only ordinary spawn in memory; keep the native runner, Job ownership,
// disposal and interactive ConPTY paths. Official dependency files stay intact.
export async function installHostSubprocessPatch({ hostRequire, persistence, platform = process.platform } = {}) {
  if (platform !== 'win32') return () => {}
  const require = hostRequire || await defaultHostRequire(persistence)
  const pkg = JSON.parse(await readFile(require.resolve(PACKAGE + '/package.json'), 'utf8'))
  if (pkg.version !== VERSION) return () => {}
  const entry = require.resolve(PACKAGE)
  const { default: Local } = await import(pathToFileURL(entry).href)
  const prototype = Local.prototype
  let record = installed.get(prototype)
  if (!record) {
    const source = await readFile(entry, 'utf8')
    assert.equal(createHash('sha256').update(source).digest('hex'), SHA256,
      'Windows subprocess patch: pinned DSH source differs')
    const target = 'env: runnerEnvironment(WINDOWS_RUNNER_SELECTION, invocation),'
    assert.equal(source.split(target).length, 2, 'Windows subprocess patch: launcher target differs')
    const localRequire = createRequire(entry)
    const modified = source.replace(target, target + '\n\t\t\twindowsHide: true,')
      .replace(/\bfrom "([^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(
        specifier.startsWith('node:') ? specifier : pathToFileURL(localRequire.resolve(specifier)).href))
    // The pinned source has static imports only. Relative helper imports must
    // retain their original identities, including runner path resolution.
    const { default: Patched } = await import('data:text/javascript;base64,' + Buffer.from(modified).toString('base64'))
    // Another profile may have completed the same asynchronous preparation.
    record = installed.get(prototype)
    if (!record) {
      record = { original: Object.getOwnPropertyDescriptor(prototype, 'spawn'), patched: Patched.prototype.spawn, users: 0 }
      Object.defineProperty(prototype, 'spawn', { ...record.original, value: record.patched })
      installed.set(prototype, record)
    }
  }
  record.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--record.users) return
    if (prototype.spawn === record.patched) Object.defineProperty(prototype, 'spawn', record.original)
    installed.delete(prototype)
  }
}
