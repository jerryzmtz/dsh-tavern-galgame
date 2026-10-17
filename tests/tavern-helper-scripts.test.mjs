import assert from 'node:assert/strict'
import test from 'node:test'

import { projectTavernHelperScripts } from '../tavern-plugin/lib/domain/tavern-helper-scripts.js'
import { createTavernRemoteAssetPinStore } from '../tavern-plugin/lib/domain/tavern-remote-assets.js'

test('MVUZOD 等别名的远程核心在缓存改写前识别，不下载也不重复运行', async () => {
  for (const name of ['MVUZOD', 'MVU', '变量框架']) {
    const source = [
      { id: 'core', name, type: 'script', enabled: true, content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'" },
      { id: 'schema', name: '变量管理', type: 'script', enabled: true, content: "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js'", data: { initial: 1 } }
    ]
    const original = structuredClone(source)
    const requests = []
    const store = createTavernRemoteAssetPinStore({ fetch: async url => {
      requests.push(String(url))
      return String(url).includes('api.github.com')
        ? { ok: true, json: async () => ({ sha: '0'.repeat(40) }) }
        : { ok: true, headers: { get: () => 'text/javascript' }, text: async () => 'export const registerMvuSchema = () => {}' }
    } })
    // Same order as the production view: pin assets, then select runnable scripts.
    const pinned = await store.pinExtensions({ helperScripts: source, regexScripts: [] })
    const runtime = projectTavernHelperScripts(pinned.helperScripts, { schema: { saved: 2 } })
    assert.deepEqual(runtime.scripts.map(script => script.id), ['schema'], name)
    assert.deepEqual(runtime.scripts[0].data, { saved: 2 })
    assert.match(runtime.scripts[0].content, /\/api\/dsh-tavern\/remote-assets\//)
    assert.equal(requests.some(url => url.includes('MagVarUpdate')), false)
    assert.ok(requests.some(url => url.includes('StageDog')))
    assert.equal(runtime.diagnostics[0].status, 'host-owned')
    assert.deepEqual(source, original)
  }
})
