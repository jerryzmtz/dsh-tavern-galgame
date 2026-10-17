import test from 'node:test'
import assert from 'node:assert/strict'
import {jsonBytes, sealPack, verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {computeBundleHash, computeContentHash, verifyPackHashes} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'

test('bundle indexing preserves closure hashes across adjacent names, additions and removals', async () => {
  const pack = await syntheticPack(), manifest = structuredClone(pack.manifest), files = new Map(pack.files)
  manifest.bundles['widget-copy'] = {...manifest.bundles.widget}
  for (const [name, bytes] of pack.files) if (name.startsWith('bundles/widget/')) files.set(name.replace('bundles/widget/', 'bundles/widget-copy/'), bytes)
  files.delete('bundles/casual/smile.exp3.json')
  files.set('bundles/widget/index.html', Buffer.from('<p>Changed</p>'))
  files.set('credits/new.txt', Buffer.from('Not a bundle'))
  await sealPack(manifest, files, pack)
  for (const [key, bundle] of Object.entries(manifest.bundles)) {
    const prefix = 'bundles/' + key + '/'
    const entries = manifest.files.filter(file => file.path.startsWith(prefix)).map(file => ({...file, path:file.path.slice(prefix.length)}))
    assert.equal(bundle.contentHash, await computeBundleHash(entries))
  }
  assert.equal(manifest.bundles['widget-copy'].contentHash, pack.manifest.bundles.widget.contentHash)
  assert.notEqual(manifest.bundles.widget.contentHash, pack.manifest.bundles.widget.contentHash)
  assert.notEqual(manifest.bundles.casual.contentHash, pack.manifest.bundles.casual.contentHash)
  await verifyPackHashes(manifest)
  manifest.bundles['widget-copy'].contentHash = '0'.repeat(64)
  manifest.contentHash = await computeContentHash(manifest)
  await assert.rejects(verifyPackHashes(manifest), {code:'CONTENT_HASH_MISMATCH'})
})

test('resealing reuses equal descriptors without depending on Buffer or property identity', async t => {
  const pack = await syntheticPack(), manifest = structuredClone(pack.manifest), files = new Map(pack.files)
  for (const [name, bytes] of files) if (name.startsWith('bundles/')) files.set(name, Buffer.from(bytes))
  const digest = t.mock.method(globalThis.crypto.subtle, 'digest')
  await sealPack(manifest, files, pack)
  assert.deepEqual(manifest, pack.manifest)
  const fileCount = [...files.keys()].filter(name => name.startsWith('bundles/')).length
  assert.equal(digest.mock.calls.length, fileCount + 1, 'Only new byte buffers and the root manifest are hashed')
  await verifyPackHashes(manifest)
})

test('bundle validation isolates adjacent names and reuses only unchanged widget documents', async () => {
  const pack = await syntheticPack(), manifest = structuredClone(pack.manifest), files = new Map(pack.files)
  manifest.bundles['widget-copy'] = {...manifest.bundles.widget}
  manifest.assets.push({...manifest.assets.find(asset => asset.kind === 'widgets'), id:'clock-copy', bundleKey:'widget-copy'})
  for (const [name, bytes] of pack.files) if (name.startsWith('bundles/widget/')) files.set(name.replace('bundles/widget/', 'bundles/widget-copy/'), bytes)
  await sealPack(manifest, files, pack)
  const previous = await verifyBytes(manifest, files)
  const cached = await verifyBytes(manifest, files, {previous, sealed:true})
  assert.equal(cached.widgets.clock, previous.widgets.clock)
  assert.equal(cached.widgets['clock-copy'], previous.widgets['clock-copy'])

  const invalidDefaults = structuredClone(manifest)
  invalidDefaults.assets.find(asset => asset.id === 'clock-copy').settingsDefaults = {undeclared:true}
  await sealPack(invalidDefaults, files, previous)
  await assert.rejects(verifyBytes(invalidDefaults, files, {previous, sealed:true}), /Setting no longer matches its declaration/)

  const next = structuredClone(manifest), changedFiles = new Map(files)
  const changedWidget = {...previous.widgets['clock-copy'], view:{entry:'copy.html'}}
  changedFiles.set('bundles/widget-copy/widget.json', jsonBytes(changedWidget))
  changedFiles.set('bundles/widget-copy/copy.html', Buffer.from('<p>Copy only</p>'))
  await sealPack(next, changedFiles, previous)
  const changed = await verifyBytes(next, changedFiles, {previous, sealed:true})
  assert.equal(changed.widgets.clock, previous.widgets.clock)
  assert.deepEqual(changed.widgets['clock-copy'], changedWidget)
  assert.notEqual(changed.widgets['clock-copy'], previous.widgets['clock-copy'])

  changedFiles.delete('bundles/widget-copy/copy.html')
  await sealPack(next, changedFiles, previous)
  await assert.rejects(verifyBytes(next, changedFiles, {previous, sealed:true}), {code:'MISSING_DEPENDENCY'})
})

test('bundle validation still inspects actual model resources absent from the manifest', async () => {
  const pack = await syntheticPack(), files = new Map(pack.files)
  files.set('bundles/casual/undeclared.js', Buffer.from('alert(1)'))
  await assert.rejects(verifyBytes(pack.manifest, files, {previous:pack, sealed:true}), /Executable model resource rejected/)
})
