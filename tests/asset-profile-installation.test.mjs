// private fork: ordinary pack sources are authoring inputs, not runtime defaults.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'
import { prepareProfileConfiguration } from '../bin/profile-installation.mjs'
import { resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { installedComposition, sourceRoot } from './fixtures/installed-composition.mjs'

for (const host of ['desktop', 'cli', 'android']) test(`installer activates exactly one asset bundle with matching roots: ${host}`, async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'asset-install-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const { manifest, entries, configFor, profileDir } = await installedComposition({ home, host })
  assert.equal(manifest.dsh.profile.bundles.filter(name => name === 'dsh-asset-library').length, 1)
  assert.equal(manifest.dependencies['dsh-asset-library'], 'link:' + path.join(sourceRoot, 'tavern-plugin/packages/dsh-asset-library').replaceAll('\\', '/'))
  assert.ok(manifest.dshTavern.managedBundles.includes('dsh-asset-library'))
  assert.ok(manifest.dshTavern.managedDependencies.includes('dsh-asset-library'))
  assert.equal(manifest.dsh.bundle, undefined, 'do not activate the aggregate as well as individual bundles')
  const assets = entries.filter(entry => entry.id === 'dsh-asset-library')
  assert.equal(assets.length, 1)
  const { Context } = await import('@deepseek-ai/cordis')
  const { Entry } = await import('@deepseek-ai/cordis-plugin-loader')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const entry = new Entry({ ctx })
  entry.options = assets[0]
  const config = configFor(assets[0])
  // private fork: installer config has no pack sources or implicit imports.
  assert.deepEqual(Object.keys(config).sort(), ['assetRoot'])
  assert.equal(config.profileId, undefined)
  assert.equal(config.legacyDataRoot, undefined)
  assert.equal(config.assetRoot, path.join(home, 'profile-data', 'tavern', 'asset-packs'))
  assert.equal(config.assetRoot, manifest.dshTavern.assetRoot)
  assert.equal(manifest.dshTavern.dataRoot, resolveTavernDataRoot({ dshHome: home }))
  assert.equal(entries.filter(entry => entry.id === 'dsh-tavern').length, 1)
  const upgraded = prepareProfileConfiguration(host, '0.1.5-rc.2', { sourceRoot, profileDir, dshHome: home })
  assert.deepEqual(upgraded.manifest, manifest)
  assert.equal(upgraded.patchText, undefined)
})

test('installer preserves the native disabled override and unrelated user configuration', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'asset-disabled-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const patch = '- id: dsh-asset-library\n  disabled: true\n- id: dsh-tavern\n  config:\n    userSetting: retained\n'
  const result = await installedComposition({ home, patch })
  assert.equal(result.entries.find(entry => entry.id === 'dsh-asset-library').disabled, true)
  assert.equal(result.entries.find(entry => entry.id === 'dsh-tavern').config.userSetting, 'retained')
  assert.equal(await readFile(path.join(result.profileDir, 'cordis.patch.yml'), 'utf8'), patch)
})

test('aggregate includes one asset owner and evaluates the same explicit roots as installed profiles', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'asset-aggregate-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  execFileSync(process.execPath, ['bin/build-plugin-package.mjs', '--check'], { cwd: sourceRoot })
  const profile = await installedComposition({ home })
  const boot = await import(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const entries = boot.composeEntries([boot.loadOverlayPatches('test', path.join(sourceRoot, 'plugin.patch.yml'))])
  const assets = entries.filter(entry => entry.id === 'dsh-asset-library')
  assert.equal(assets.length, 1)
  assert.deepEqual(profile.configFor(assets[0]), profile.configFor(profile.entries.find(entry => entry.id === 'dsh-asset-library')))
  assert.equal(assets[0].name, profile.entries.find(entry => entry.id === 'dsh-asset-library').name)
  const source = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
  const lock = parse(await readFile(path.join(sourceRoot, 'pnpm-lock.yaml'), 'utf8'))
  for (const [name, specifier] of Object.entries(source.devDependencies)) {
    assert.equal(lock.importers['.'].devDependencies[name].specifier, specifier, 'frozen root lock: ' + name)
  }
})
