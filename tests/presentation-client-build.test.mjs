import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

async function setup(t) {
  // private fork: isolated worktree evidence; never recursively delete test directories.
  await mkdir(new URL('../.tmp/', import.meta.url), {recursive:true})
  const root = await mkdtemp(publicJoin(publicTmpdir(), 'presentation-builder-'))
  const put = async (name, value) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); return file }
  const builder = await put('bin/build-tavern-client.mjs', '')
  await copyFile(new URL('../bin/build-tavern-client.mjs', import.meta.url), builder)
    await cp(new URL('../tavern-plugin/packages/dsh-tavern-ui/', import.meta.url), path.join(root, 'tavern-plugin/packages/dsh-tavern-ui'), { recursive: true })
  // private fork: copy real first-party build dependencies, including the lazy chunk sources.
  for (const name of ['fork-surfaces.cjs', ...['motion', 'phase', 'timing', 'script', 'player'].map(part => 'fork-skin-overlay-' + part + '.cjs')]) {
    await put('tavern-plugin/src/client/' + name, await readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url)))
  }
  for (const css of ['tavern.css', 'fork-theme.css', 'fork-layered-sprite.css', 'fork-phone.css', 'fork-mod-config.css', 'fork-textcard.css']) await put('tavern-plugin/lib/client-assets/' + css, '')
  for (const svg of ['logo', 'lockup', 'lockup-dark']) await put('tavern-plugin/lib/client-assets/' + svg + '.svg', '<svg/>')
  await put('tavern-plugin/shared/keyword-catalogue.cjs', 'module.exports = {};')
  await put('tavern-plugin/packages/dsh-presentation-protocol/src/reducer.cjs', 'function reducer(value) { return value + 1; }\n')
  await put('tavern-plugin/lib/domain/pure.js', 'const domainValue = 1;\nexport { domainValue };\n')
  const run = () => spawnSync(process.execPath, [builder], { encoding: 'utf8', timeout: 10000 })
  return { put, run, output: () => readFile(path.join(root, 'tavern-plugin/lib/client.js'), 'utf8') }
}

test('protocol include root assembles alongside confined client/domain includes', async t => {
  const { put, run, output } = await setup(t)
  await put('tavern-plugin/src/client/main.js', '// @include-protocol reducer.cjs\n// @include-domain pure.js\nconst result = reducer(domainValue);\n')
  const result = run(); assert.ifError(result.error); assert.equal(result.status, 0, result.stderr)
  assert.match(await output(), /function reducer\(value\)/); assert.doesNotMatch(await output(), /@include|export \{/)
})

for (const directive of ['include', 'include-domain', 'include-protocol']) {
  for (const relative of ['..', '../outside.js', '../../outside.js']) test(`${directive} cannot escape its root via ${relative}`, async t => {
    const { put, run } = await setup(t)
    await put('tavern-plugin/src/client/main.js', `// @${directive} ${relative}\n`)
    const result = run(); assert.ifError(result.error); assert.equal(result.status, 1)
    assert.match(result.stderr, /include/); assert.doesNotMatch(result.stderr, /ENOENT/)
  })
}

test('duplicate protocol includes and cycles fail before replacing the bundle', async t => {
  const { put, run, output } = await setup(t)
  await put('tavern-plugin/src/client/main.js', 'const original = true;\n'); assert.equal(run().status, 0)
  const previous = await output()
  await put('tavern-plugin/src/client/main.js', '// @include-protocol reducer.cjs\n// @include-protocol reducer.cjs\n')
  assert.equal(run().status, 1); assert.equal(await output(), previous)
  await put('tavern-plugin/src/client/main.js', '// @include-protocol reducer.cjs\n')
  await put('tavern-plugin/packages/dsh-presentation-protocol/src/reducer.cjs', '// @include-protocol reducer.cjs\n')
  assert.equal(run().status, 1); assert.equal(await output(), previous)
})
