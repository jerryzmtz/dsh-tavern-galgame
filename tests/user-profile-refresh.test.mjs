import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/src/client/modules/library-refresh.js', import.meta.url), 'utf8')
const create = vm.runInNewContext(source + '\ncreateUserProfileRefreshModule')
const value = { userProfile: { revision: 1 }, currentConversation: { enabled: false } }

test('mutation invalidation and unmount prevent stale refresh from overwriting the view', async () => {
  const pending = [], seen = []
  const controller = create({ load: () => new Promise(resolve => pending.push(resolve)), onValue: x => seen.push(x) })
  controller.request(); controller.invalidate(); pending[0](value)
  await controller.whenIdle(); assert.equal(seen.length, 0)
  controller.request(); controller.dispose(); pending[1](value)
  await controller.whenIdle(); assert.equal(seen.length, 0)
})
