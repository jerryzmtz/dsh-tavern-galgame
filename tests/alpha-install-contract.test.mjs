import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
const json = async file => JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'))

test('standalone plugin declares the subprocess seam at the adapted runtime version', async () => {
  const plugin = await json('tavern-plugin/package.json')
  const runtime = await json('config/dsh-compatibility.json')
  assert.equal(plugin.dependencies['@deepseek-ai/dsh-subprocess'], runtime.adaptedDshVersion)
})

test('plugin lock matches every declared dependency without auto-installing host peers', async () => {
  const lock = parse(await readFile(new URL('../tavern-plugin/pnpm-lock.yaml', import.meta.url), 'utf8'))
  const workspace = parse(await readFile(new URL('../tavern-plugin/pnpm-workspace.yaml', import.meta.url), 'utf8'))
  assert.equal(workspace.autoInstallPeers, false)
  assert.equal(lock.settings.autoInstallPeers, false)
  for (const [importer, manifest] of [
    ['.', 'tavern-plugin/package.json'],
    ['packages/dsh-tavern-remote', 'tavern-plugin/packages/dsh-tavern-remote/package.json'],
  ]) {
    const pkg = await json(manifest)
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(pkg[group] || {})) {
        assert.equal(lock.importers[importer][group][name].specifier, version, name)
      }
    }
  }
  assert.match(lock.importers['.'].dependencies['@deepseek-ai/dsh-subprocess'].version, /^0\.1\.5-rc\.2(?:\(|$)/)
})

test('Corepack and the install engine require the pnpm version used for the release lockfile', async () => {
  const root = await json('package.json')
  assert.equal(root.packageManager, 'pnpm@11.8.0')
  assert.equal(root.engines.pnpm, '>=11.8.0 <12')
})
