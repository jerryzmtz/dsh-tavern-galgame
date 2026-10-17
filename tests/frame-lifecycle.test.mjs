import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/modules/frame-lifecycle.js', import.meta.url), 'utf8')
const create = vm.runInNewContext(source + '; createTavernFrameLifecycle')

test('disposal cancels pending document mounts and invalidates queued sends', async () => {
  const timers = new Map()
  const lifetime = create({ setTimeout(fn) { timers.set(1, fn); return 1 }, clearTimeout(id) { timers.delete(id) } }, { body: null })
  lifetime.mount(() => assert.fail('disposed frame mounted'), assert.fail)
  assert.equal(timers.size, 1)
  let called = false
  const pending = lifetime.sender({ submit() { called = true } }).send('queued')
  lifetime.dispose()
  assert.equal(timers.size, 0)
  await assert.rejects(pending, /关闭/)
  assert.equal(called, false)
})
