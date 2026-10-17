import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'acorn'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = name => readFileSync(path.join(root, name), 'utf8')
const require = createRequire(import.meta.url)
const publicVendor = text => text.replaceAll('\r\n','\n').replaceAll('/home/'+'runner/work/DSH-better-sidebar/DSH-better-sidebar/','/build/dsh-better-sidebar/').replaceAll('C:\\'+'Users\\Me','C:\\example').replaceAll('c:/'+'users/me/file.png','c:/example/file.png').replaceAll('/home/'+'u/f.ts','/example/f.ts').replaceAll('C:/'+'Users/u/f.ts','C:/example/f.ts').replaceAll('absolute/home/'+'me/x.txt','absolute/example/x.txt')
const sidebarRoot = path.dirname(require.resolve('dsh-better-sidebar/package.json'))
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')

test('standard package ships runtime resources without local links, host copies or install scripts', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.deepEqual(manifest.dsh.bundle, { patch: './plugin.patch.yml' })
  assert.equal(manifest.bin, undefined, 'standard installation must not replace the legacy launcher')
  for (const [name, spec] of Object.entries(manifest.dependencies)) {
    assert.ok(!/^(link|file):/.test(spec), `${name} depends on checkout paths`)
    assert.ok(!name.startsWith('@deepseek-ai/'), `${name} would install a second host`)
    assert.notEqual(name, 'node-pty')
  }
  for (const name of ['prepare', 'preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts[name], undefined)
  const [packed] = JSON.parse(execFileSync(existsSync(npmCli) ? process.execPath : 'npm', [...(existsSync(npmCli) ? [npmCli] : []), 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }))
  const files = new Set(packed.files.map(file => file.path))
  // Splitting the entry must not leave any directly imported runtime module out of the package.
  const entryPath = 'tavern-plugin/lib/index.js'
  for (const node of parse(read(entryPath), { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), node.source.value))
    assert.ok(files.has(target), `entry imports missing runtime module: ${target}`)
  }
  for (const name of [
    'plugin.patch.yml', 'bin/plugin-package-guard.mjs', 'bin/update-diagnostics.mjs',
    'config/dsh-compatibility.json', 'config/plugin-web.LICENSE',
    'tavern-plugin/package.json', 'tavern-plugin/lib/index.js', 'tavern-plugin/lib/client.js',
    'presets/tavern/preset.yml', 'presets/tavern/agent.cordis.yml',
    'tavern-plugin/packages/dsh-tavern-card-memory/index.js',
    'tavern-plugin/packages/dsh-tavern-card-memory/package.json',
    'tavern-plugin/packages/dsh-image-gen/src/module.js',
    'tavern-plugin/packages/dsh-tavern-remote/lib/typert.host.js',
    'tavern-plugin/packages/dsh-better-sidebar/lib/client-mermaid.js',
    'tavern-plugin/packages/dsh-dream-skin/lib/index.js',
    'tavern-plugin/packages/dsh-dream-skin/lib/client.js',
    'tavern-plugin/packages/dsh-dream-skin/LICENSE',
    'tavern-plugin/packages/dsh-asset-library/package.json',
    'tavern-plugin/packages/dsh-asset-library/cordis.patch.yml',
    'tavern-plugin/packages/dsh-asset-library/lib/index.js',
    'tavern-plugin/packages/dsh-asset-library/lib/pack-v2/plugin.js',
    'tavern-plugin/packages/dsh-asset-library/lib/pack-v2/transport.js',
    'tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js',
    'tavern-plugin/packages/dsh-tts/lib/index.js',
    'tavern-plugin/packages/dsh-tts/lib/client.js',
    'tavern-plugin/packages/dsh-tavern-ui/package.json',
    'tavern-plugin/packages/dsh-tavern-ui/lib/index.js',
    'tavern-plugin/packages/dsh-tavern-ui/lib/client.js',
    'tavern-plugin/packages/dsh-tavern-ui/cordis.patch.yml',
    'tavern-plugin/packages/dsh-tts-local/lib/index.js',
    'tavern-plugin/packages/dsh-tts-local/lib/client.js',
    // private fork: local synthesis is an external service; the Python worker was removed.
    'tavern-plugin/lib/vendor/st-prompt-template/upstream/settings.html',
    'tavern-plugin/lib/vendor/st-prompt-template/server-artifact/engine.js',
    'tavern-plugin/lib/vendor/runtime-assets/jquery/jquery.min.js',
    'tavern-plugin/lib/vendor/runtime-assets/lodash/lodash.min.js',
  ]) assert.ok(files.has(name), `missing runtime resource: ${name}`)
  assert.equal(files.has('tavern-plugin/packages/dsh-tts-local/worker/serve.py'), false)
  for (const name of ['client.js', 'service.js', 'routes.js', 'contracts.d.ts', 'card-pack.js', 'library-pack.js', 'model-library.js', 'borrowed-assets.js']) {
    assert.equal(files.has('tavern-plugin/packages/dsh-asset-library/lib/' + name), false, 'v1 package surface is not shipped')
  }
  assert.ok([...files].some(name => name.startsWith('presets/tavern/skills/')))
  assert.ok(![...files].some(name => /(^|\/)(node_modules|tests|docs)\//.test(name)))
  assert.deepEqual([...files].filter(name => name.includes('/upstream/')), ['tavern-plugin/lib/vendor/st-prompt-template/upstream/settings.html'])
  // Presets are mounted lazily when a game/background task starts. A successful
  // Web boot alone does not prove that their private modules are resolvable.
  for (const preset of ['presets/tavern/agent.cordis.yml', 'presets/tavern-background/agent.cordis.yml']) {
    const source = read(preset)
    assert.ok(!source.includes('name: dsh-tavern-plugin'), 'private preset modules must travel with the package')
    for (const [, specifier] of source.matchAll(/^\s*name: (\.\.?\/\S+)\s*$/gm)) {
      assert.ok(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(preset), specifier))), `${preset}: missing ${specifier}`)
    }
  }
  parse(read('tavern-plugin/lib/client.js'), { ecmaVersion: 'latest', sourceType: 'script' })
})

test('standard bundle and sidebar distribution match their maintained sources', () => {
  execFileSync(process.execPath, ['bin/build-plugin-package.mjs', '--check'], { cwd: root })
  for (const name of ['index.js', 'client.js', 'client-registry.js', 'client-terminal.js', 'client-editor.js', 'client-mermaid.js', 'invariant.js']) {
    assert.equal(read(`tavern-plugin/packages/dsh-better-sidebar/lib/${name}`), publicVendor(readFileSync(path.join(sidebarRoot, 'lib', name), 'utf8')))
  }
  assert.match(read('tavern-plugin/packages/dsh-better-sidebar/lib/index.js'), /function threadBoundaryEvents\(/)
})

test('real DSH composes the standard package alongside the host Web bundle without duplicating it', { skip: !process.env.DSH_BOOT_MODULE }, async () => {
  const boot = await import(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const hostRoot = path.resolve(path.dirname(process.env.DSH_BOOT_MODULE), '../..')
  const policy = JSON.parse(read('config/dsh-compatibility.json'))
  assert.equal(JSON.parse(readFileSync(path.join(hostRoot, 'dsh-web-app/package.json'), 'utf8')).version, policy.adaptedDshVersion)
  const load = file => boot.loadOverlayPatches('test', file)
  const base = load(path.join(hostRoot, 'dsh-base/cordis.patch.yml'))
  const web = load(path.join(hostRoot, 'dsh-web-app/cordis.patch.yml'))
  const legacy = boot.composeEntries([base, web,
    load(path.join(sidebarRoot, 'cordis.patch.yml')),
    load(path.join(root, 'tavern-plugin/packages/dsh-dream-skin/cordis.patch.yml')),
    load(path.join(root, 'tavern-plugin/cordis.patch.yml')),
    load(path.join(root, 'tavern-plugin/packages/dsh-tavern-remote/cordis.patch.yml')),
    load(path.join(root, 'tavern-plugin/packages/dsh-tts/cordis.patch.yml')),
    load(path.join(root, 'tavern-plugin/packages/dsh-tts-local/cordis.patch.yml')),
    load(path.join(root, 'tavern-plugin/packages/dsh-asset-library/cordis.patch.yml')),
  ])
  const standard = boot.composeEntries([base, web, load(path.join(root, 'plugin.patch.yml'))])
    .filter(entry => entry.id !== 'tavern-package-guard')
  const names = Object.fromEntries(legacy.map(entry => [entry.id, entry.name]))
  for (const entry of standard) entry.name = names[entry.id]
  // The standalone package owns exactly one sidebar. Legacy sidebar's
  // multi-bundle duplicate guard is irrelevant to this aggregate.
  delete legacy.find(entry => entry.id === 'better-sidebar').disabled
  assert.deepEqual(standard, legacy)
})
