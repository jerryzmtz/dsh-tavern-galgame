import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

import { installPluginDependencies, resolveDshBootModule, resolveHostDependencies } from '../bin/plugin-dependencies.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tavern-host-deps-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const pluginDirectory = path.join(root, 'tavern plugin')
  mkdirSync(pluginDirectory)
  const original = 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n'
  writeFileSync(path.join(pluginDirectory, 'pnpm-workspace.yaml'), original)
  const bootstrap = path.join(root, 'DSH Desktop/resources/app.asar.unpacked/lib/desktop-cli.js')
  mkdirSync(path.dirname(bootstrap), { recursive: true })
  writeFileSync(bootstrap, '')
  const packages = {}
  for (const [name, exportName] of [['dsh-agent', 'agentEvents'], ['dsh-tools', 'defineTool'], ['dsh-subprocess', 'scrubbedParentEnv'], ['dsh-skill-filesystem', 'FileSystemSkillProvider'], ['dsh-subagent', 'snapshotSubagentDescriptor'], ['dsh-typert-protocol', 'TypertRemoteService']]) {
    const directory = path.resolve(path.dirname(bootstrap), '../node_modules/@deepseek-ai', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '0.1.2-alpha.1', type: 'module', exports: './index.js' }))
    writeFileSync(path.join(directory, 'index.js'), `export function ${exportName}() { return 'host-alpha1' }\n`)
    packages[`@deepseek-ai/${name}`] = directory
  }
  const bootDirectory = path.resolve(path.dirname(bootstrap), '../node_modules/@deepseek-ai/dsh-app-boot')
  mkdirSync(bootDirectory)
  writeFileSync(path.join(bootDirectory, 'package.json'), '{"name":"@deepseek-ai/dsh-app-boot","version":"0.1.2-rc.1","type":"module","exports":"./index.js"}')
  writeFileSync(path.join(bootDirectory, 'index.js'), 'export function boot() {}\n')
  writeFileSync(path.join(pluginDirectory, 'package.json'), JSON.stringify({ name: 'host-deps-fixture', private: true, dependencies: Object.fromEntries(Object.keys(packages).map(name => [name, '>=0.1.0-rc.7'])) }))
  return { root, pluginDirectory, original, bootstrap, packages }
}

test('subprocess uses the selected host and its peer graph, restoring workspace policy after installation', async t => {
  const f = fixture(t)
  let called = false
  const deps = await installPluginDependencies({ ...f, host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
    run(command, args, options) {
      called = true
      assert.equal(command, 'pnpm')
      assert.deepEqual(args, ['install', '--lockfile=false'])
      assert.equal(options.cwd, f.pluginDirectory)
      const workspace = readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8')
      assert.equal(parse(workspace).overrides['@deepseek-ai/dsh-subprocess'], `link:${realpathSync(f.packages['@deepseek-ai/dsh-subprocess']).replaceAll('\\', '/')}`)
      assert.match(workspace, /autoInstallPeers: false/)
    },
  })
  assert.ok(called)
  assert.equal(deps.find(dep => dep.name === '@deepseek-ai/dsh-subprocess').directory, realpathSync(f.packages['@deepseek-ai/dsh-subprocess']))
  assert.equal(readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8'), f.original)
})

// private fork: this test must create dependency/security symlinks, prohibited on this Windows host.
test('真实 pnpm 离线安装本地链接，并由插件解析到宿主原包及其传递依赖', { skip: process.platform === 'win32' ? 'Requires links; prohibited on this Windows host' : false }, async t => {
  const f = fixture(t)
  const staleTools = path.join(f.pluginDirectory, 'node_modules/@deepseek-ai/dsh-tools')
  mkdirSync(staleTools, { recursive: true })
  writeFileSync(path.join(staleTools, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","version":"0.0.0","type":"module","exports":"./index.js"}')
  writeFileSync(path.join(staleTools, 'index.js'), 'export function defineTool() { return "stale" }')
  const helper = path.resolve(path.dirname(f.bootstrap), '../node_modules/host-helper')
  mkdirSync(helper)
  writeFileSync(path.join(helper, 'package.json'), '{"name":"host-helper","type":"module","exports":"./index.js"}')
  writeFileSync(path.join(helper, 'index.js'), 'export default "host-transitive"')
  writeFileSync(path.join(f.packages['@deepseek-ai/dsh-tools'], 'index.js'), 'import value from "host-helper"; export function defineTool() { return value }')
  const originalPackages = Object.values(f.packages).map(directory => readFileSync(path.join(directory, 'package.json'), 'utf8'))
  await installPluginDependencies({ ...f, host: 'desktop', env: { ...process.env, DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
    run(command, args, options) {
      // Neither registry access nor a cached alpha.1 package can make this pass.
      const result = spawnSync(command, [...args, '--offline', '--store-dir', './empty-store'], {
        ...options, encoding: 'utf8', shell: process.platform === 'win32', timeout: 30000,
      })
      assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
    },
  })
  const require = createRequire(path.join(f.pluginDirectory, 'probe.cjs'))
  for (const [name, directory] of Object.entries(f.packages)) assert.equal(realpathSync(require.resolve(name)), realpathSync(path.join(directory, 'index.js')))
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', 'import { defineTool } from "@deepseek-ai/dsh-tools"; console.log(defineTool())'], { cwd: f.pluginDirectory, encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  assert.equal(probe.stdout.trim(), 'host-transitive')
  assert.deepEqual(Object.values(f.packages).map(directory => readFileSync(path.join(directory, 'package.json'), 'utf8')), originalPackages)
})

for (const failure of ['missing', 'export', 'transitive']) {
  test(`宿主依赖 ${failure} 异常时明确报错，不删除旧依赖、不调用 pnpm`, async t => {
    const f = fixture(t)
    const directory = f.packages['@deepseek-ai/dsh-subagent']
    if (failure === 'missing') rmSync(directory, { recursive: true })
    else writeFileSync(path.join(directory, 'index.js'), failure === 'export' ? 'export const other = true' : 'import "missing-host-transitive"')
    mkdirSync(path.join(f.pluginDirectory, 'node_modules'))
    const sentinel = path.join(f.pluginDirectory, 'node_modules', 'keep.txt')
    writeFileSync(sentinel, 'keep')
    await assert.rejects(() => installPluginDependencies({ ...f, host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
      run() { assert.fail('不得调用 pnpm') },
    }), failure === 'missing' ? /缺少必需依赖 @deepseek-ai\/dsh-subagent/ : /dsh-subagent.*无法加载所需接口 snapshotSubagentDescriptor/)
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep')
    assert.equal(readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8'), f.original)
  })
}

test('Desktop 无 bootstrap 环境变量时按 app 可执行文件定位，不使用另一套 CLI', t => {
  const f = fixture(t)
  const executable = path.join(f.root, 'DSH Desktop', 'DSH Desktop.exe')
  const deps = resolveHostDependencies({ host: 'desktop', dsh: '/wrong/cli', platform: 'win32', env: { DSH_DESKTOP_APP_EXECUTABLE: executable } })
  assert.equal(deps.length, Object.keys(f.packages).length)
  assert.equal(realpathSync(resolveDshBootModule({ host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap } })), realpathSync(path.resolve(path.dirname(f.bootstrap), '../node_modules/@deepseek-ai/dsh-app-boot/index.js')))
  const macRoot = path.join(f.root, 'Desktop.app/Contents/Resources')
  mkdirSync(macRoot, { recursive: true })
  renameSync(path.resolve(path.dirname(f.bootstrap), '..'), path.join(macRoot, 'app.asar.unpacked'))
  const macDeps = resolveHostDependencies({ host: 'desktop', platform: 'darwin', env: { DSH_DESKTOP_APP_EXECUTABLE: path.join(f.root, 'Desktop.app/Contents/MacOS/DSH Desktop') } })
  assert.ok(macDeps.every(dep => dep.directory.includes('Desktop.app')))
  assert.ok(resolveDshBootModule({ host: 'desktop', platform: 'darwin', env: { DSH_DESKTOP_APP_EXECUTABLE: path.join(f.root, 'Desktop.app/Contents/MacOS/DSH Desktop') } }).includes('Desktop.app'))
})
