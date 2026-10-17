import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import test from 'node:test'
import { parseDocument } from 'yaml'

import { ensureSidebarDefaults, isServiceReady } from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

const installationSource = await readFile(new URL('../bin/profile-installation.mjs', import.meta.url), 'utf8')

const profilePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const managedProfilePatch = await readFile(new URL('../tavern-plugin/cordis.patch.yml', import.meta.url), 'utf8')

const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const tavernPluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))

test('Tavern profile isolates conversations from other DSH profiles on fresh installs', () => {
  assert.match(managedProfilePatch, /id: session-persistence-jsonl[\s\S]*dshHomePath\('profile-data', 'tavern', 'sessions'\)/)
  assert.match(managedProfilePatch, /id: storage-json[\s\S]*dshHomePath\('profile-data', 'tavern', 'storages'\)/)
  assert.deepEqual(parseDocument(profilePatch).toJS(), [])
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-tavern-plugin'))
  assert.equal(tavernPluginManifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(installationSource, /prepareProfilePatch/)
  assert.match(unixInstaller, /node "\$\{APP_DIR\}\/bin\/dsh-tavern\.mjs" install --host "\$\{INSTALL_HOST\}"/)
  assert.match(windowsInstaller, /Invoke-InstallCommand 'profile\.install' 'node' @\(\(Join-Path \$AppDir 'bin\\dsh-tavern\.mjs'\), 'install', '--host', \$InstallHost\)/)
})

test('Tavern sidebar migration marker与三个库设置写入 YAML', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-settings-'))
  t.after(async function () { await rm(directory, { recursive: true, force: true }) })
  const settingsPath = path.join(directory, 'settings.yaml')
  await writeFile(settingsPath, 'dsh-better-sidebar:\n  tabsEnabled:\n    editor: false\n', 'utf8')

  assert.equal(ensureSidebarDefaults(settingsPath), true)
  const written = await readFile(settingsPath, 'utf8')
  assert.match(written, /dsh-tavern:\n  sidebarDefaultsVersion: 8/)
  assert.match(written, /editor: true/)
  assert.match(written, /dsh-tavern:resources: true/)
  assert.match(written, /dsh-tavern:cards: true/)
  assert.match(written, /dsh-tavern:presets: true/)
  assert.doesNotMatch(written, /dsh-tavern:boundary-prompts/)
})

test('一键安装先安装下载包依赖，再运行 Tavern 安装器', () => {
  // CLI: dependencies install beside the running app, then switch, re-link and configure.
  const order = (text, markers) => {
    const positions = markers.map(marker => text.indexOf(marker))
    positions.forEach((position, index) => assert.ok(position >= 0, '缺少步骤：' + markers[index]))
    for (let index = 1; index < positions.length; index++) assert.ok(positions[index - 1] < positions[index], markers[index - 1] + ' 应在 ' + markers[index] + ' 之前')
  }
  order(unixInstaller, ['pnpm --dir "${APP_DIR}.staging" install --frozen-lockfile', 'dsh-tavern.mjs" stop', 'node "${STAGER}" swap',
    'pnpm --dir "${APP_DIR}" install --frozen-lockfile --offline', 'node "${APP_DIR}/bin/dsh-tavern.mjs" install', 'node "${STAGER}" commit'])
  order(windowsInstaller, ["Invoke-InstallCommand 'dependencies.install' $PnpmCommand @('--dir', \"$AppDir.staging\", 'install', '--frozen-lockfile'",
    '& node $OldLauncher stop', '& node $Stager swap', "Invoke-InstallCommand 'dependencies.relink'", "Invoke-InstallCommand 'profile.install' 'node'", '& node $Stager commit'])
  // Desktop and releases without the stager keep installing in place.
  const legacyUnix = unixInstaller.slice(unixInstaller.indexOf('node "${STAGER}" commit'))
  order(legacyUnix, ['pnpm --dir "${APP_DIR}" install --frozen-lockfile\n', 'node "${APP_DIR}/bin/dsh-tavern.mjs" install'])
  const legacyWindows = windowsInstaller.slice(windowsInstaller.indexOf('& node $Stager commit'))
  order(legacyWindows, ["Invoke-InstallCommand 'dependencies.install' $PnpmCommand @('--dir', $AppDir, 'install', '--frozen-lockfile'", "Invoke-InstallCommand 'profile.install' 'node'"])
})

test('Web 服务就绪检查接受 alpha.2 鉴权响应', async () => {
  assert.equal(await isServiceReady(3081, async () => ({ ok: true })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 401 })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false })), false)
  assert.equal(await isServiceReady(3088, async () => ({ ok: false, status: 403 }), 'android'), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 403 }), 'cli'), false)
  assert.equal(await isServiceReady(3088, async () => ({ ok: false, status: 500 }), 'android'), false)
  assert.equal(await isServiceReady(3081, async () => { throw new Error('offline') }), false)
})
