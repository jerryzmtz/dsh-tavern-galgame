// Synthetic API markers only: no proprietary runtime in fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCubismCore, CUBISM_CORE_DOWNLOAD, CUBISM_CORE_LICENSE } from '../tavern-plugin/lib/fork-cubism-core.js'
import { createLive2dFiles } from '../tavern-plugin/lib/fork-live2d-files.js'
import { spineRuntimeStatus, spineRuntimeAvailable, importSpineRuntime } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'

const source = 'var Live2DCubismCore = {Moc: {}, Model: {}, Version: {}, csmGetVersion() {}, csmReviveMocInPlace() {}}; throw new Error("must not execute");'
const input = { name: 'live2dcubismcore.min.js', consent: true, base64: Buffer.from(source).toString('base64') }
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cubism-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, core: createCubismCore(root) }
}

test('offline import publishes atomically, serves existing route and preserves owner runtime', async t => {
  const { root, core } = await setup(t)
  const initial = await core.status()
  assert.equal(initial.installed, false)
  assert.equal(initial.core, '')
  assert.equal(initial.downloadUrl, CUBISM_CORE_DOWNLOAD)
  assert.equal(initial.licenseUrl, CUBISM_CORE_LICENSE)
  const results = await Promise.all([core.importFile(input), core.importFile(input)])
  assert.ok(results.every(result => result.coreInstalled))
  assert.deepEqual(await readdir(path.join(root, 'core')), ['live2dcubismcore.min.js'])
  assert.equal((await createLive2dFiles(root).read('core/live2dcubismcore.min.js')).body.toString(), source)
  await core.importFile({ ...input, name: 'live2dcubismcore.js', base64: Buffer.from(source + '\n// changed').toString('base64') })
  assert.equal(await readFile(path.join(root, 'core/live2dcubismcore.min.js'), 'utf8'), source)
  const spine = await spineRuntimeStatus()
  assert.equal(spine.installed, await spineRuntimeAvailable())
  assert.equal(spine.importSupported, true)
  assert.equal(spine.downloadUrl, 'https://www.npmjs.com/package/pixi-spine/v/3.1.2')
})

test('import boundary rejects consent, traversal, encoding, size, wrong runtime and syntax without writing', async t => {
  const { root, core } = await setup(t)
  for (const patch of [
    { consent: 'true' }, { consent: false }, { name: '../live2dcubismcore.min.js' }, { name: 'sdk.zip' },
    { base64: '!!!!' }, { base64: 'YQ==' + '=' }, { base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') },
    { base64: Buffer.from('<html>download</html>').toString('base64') },
    { base64: Buffer.from('var spine = {};').toString('base64') },
    { base64: Buffer.from(source + '{').toString('base64') },
    { base64: Buffer.from([255, 254]).toString('base64') }
  ]) await assert.rejects(core.importFile({ ...input, ...patch }))
  assert.equal(await core.hasCore(), false)
  assert.deepEqual(await readdir(root), [])
})


test('Spine import uses a fixed runtime target, validates once and never executes or overwrites', async t => {
  const { root } = await setup(t)
  const target = path.join(root, 'spine', 'pixi-spine.js')
  const source = 'this.PIXI.spine = { SpineParser: {}, TextureAtlas: {}, SkeletonBinary: {}, AnimationState: {}, Spine: {} }; throw Error("never execute");'
  const input = { name: 'pixi-spine.umd.js', base64: Buffer.from(source).toString('base64'), consent: true }
  assert.equal((await spineRuntimeStatus(target)).installed, false)
  for (const patch of [{ consent: false }, { name: '../pixi-spine.umd.js' }, { name: 'spine-player.js' }, { base64: '!!!!' },
    { base64: Buffer.from('var spine = {};').toString('base64') }, { base64: Buffer.from(source + '{').toString('base64') },
    { base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }, { base64: Buffer.from([255]).toString('base64') }]) {
    await assert.rejects(importSpineRuntime({ ...input, ...patch }, target))
  }
  assert.deepEqual(await readdir(root), [])
  const results = await Promise.all([importSpineRuntime(input, target), importSpineRuntime(input, target)])
  assert.ok(results.every(result => result.installed && result.importSupported))
  assert.equal(results[0].runtime, '/api/dsh-tavern/vendor/runtime-assets/spine/pixi-spine.js')
  await importSpineRuntime({ ...input, name: 'pixi-spine.js', base64: Buffer.from(source + '// new').toString('base64') }, target)
  assert.equal(await readFile(target, 'utf8'), source)
  assert.deepEqual(await readdir(path.dirname(target)), ['pixi-spine.js'])
})
