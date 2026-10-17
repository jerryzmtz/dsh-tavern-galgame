import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { IMAGE_PLUGIN_HOST_EXPORTS, installBundledImagePlugin } from '../bin/bundled-image-plugin.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-bundled-image-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'tavern-plugin/packages/dsh-image-gen')
  mkdirSync(path.join(directory, 'lib'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) writeFileSync(path.join(directory, file), '')
  writeFileSync(path.join(directory, 'package.json'), '{"name":"dsh-image-gen","type":"module"}')
  const bootstrap = path.join(root, 'desktop/app.asar.unpacked/cli.js')
  const packages = {}
  for (const [name, exported] of Object.entries(IMAGE_PLUGIN_HOST_EXPORTS)) {
    const target = path.join(path.dirname(bootstrap), 'node_modules', name)
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version: '0.1.2', type: 'module', exports: './index.js' }))
    writeFileSync(path.join(target, 'index.js'), exported ? `export function ${exported}() {}` : 'export default {}')
    packages[name] = target
  }
  return { root, directory, packages, options: { sourceRoot: root, host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap } } }
}

// private fork: this test must create dependency/security symlinks, prohibited on this Windows host.
test('内置插件链接所有宿主依赖，无 npm 下载或构建；可重复安装', { skip: process.platform === 'win32' ? 'Requires links; prohibited on this Windows host' : false }, t => {
  const f = fixture(t)
  for (let i = 0; i < 2; i++) assert.equal(installBundledImagePlugin(f.options).length, 4)
  const require = createRequire(path.join(f.directory, 'probe.cjs'))
  for (const [name, directory] of Object.entries(f.packages)) assert.equal(realpathSync(require.resolve(name)), realpathSync(path.join(directory, 'index.js')))
})
