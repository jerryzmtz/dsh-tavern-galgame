// Native Session tests need the same 0.1.5-rc.2 surface relaxation Tavern installs
// at runtime: assistant/message replacements may cite shadowed nodes. Without it,
// real Session.append rejects Tavern rollback/edit tombstones.
// The dedicated installer test verifies unpatched rejection itself, so skip there.
import '../../scripts/debug/mute-automation.mjs'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { prepareExpandedPatch } from '../../tavern-plugin/lib/domain/host-session-patch.js'

const APPLIED = Symbol.for('dsh-tavern.host-session-patch-preload.v1')

if (!globalThis[APPLIED] && !process.argv.some(arg => arg.endsWith('/host-session-patch.test.mjs'))) {
  let runtimeRoot
  let version
  if (process.env.DSH_BOOT_MODULE) {
    const anchor = new URL('../../dsh-session/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE))
    const require = createRequire(anchor)
    version = require('@deepseek-ai/dsh-session/package.json').version
    runtimeRoot = fileURLToPath(new URL('../../../', anchor)) // private fork: Windows drive paths
  } else {
    const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
    const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
    version = hostRequire('@deepseek-ai/dsh-session/package.json').version
    const sessionPath = hostRequire.resolve('@deepseek-ai/dsh-session')
    runtimeRoot = sessionPath.split(/[/\\]node_modules[/\\]/)[0]
  }
  if (version === '0.1.5-rc.2') {
    await prepareExpandedPatch(runtimeRoot, { version })
    globalThis[APPLIED] = true
  }
}
