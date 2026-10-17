import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { coreTests, dependents, selectChanged, classifyTests, schedule, discoverTests, buildGraph, gitChanges } from '../tools/public-test/test-windows-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const first = 'tests/first.test.mjs', second = 'testsets/tests/second.test.mjs'
const files = [...coreTests, first, second]
const reverse = new Map([
  ['src/leaf.js', new Set(['src/owner.js'])],
  ['src/owner.js', new Set(['src/leaf.js', first])],
  ['tests/helper.mjs', new Set([second])],
  ['tavern-plugin/lib/client.js', new Set([second])],
])

test('changed selection follows transitive imports and cycles, plus the always-on safety set', () => {
  assert.deepEqual([...dependents(reverse, ['src/leaf.js'])], ['src/leaf.js', 'src/owner.js', first])
  const selected = selectChanged(files, ['src/leaf.js'], { reverse })
  assert.deepEqual(selected.files, [...coreTests, first])
  assert.deepEqual(selected.fallback, [])
  assert.deepEqual(selectChanged(files, ['tests/helper.mjs'], { reverse }).files, [...coreTests, second])
  assert.deepEqual(selectChanged(files, [first], { reverse }).files, [...coreTests, first])
})

test('unknown/deleted unmapped paths and dependency changes fall back to full, not an empty green run', () => {
  for (const file of ['src/gone.js', 'package.json', 'pnpm-lock.yaml', '.pi/skills/x/scripts/test.mjs']) {
    const selected = selectChanged(files, [file], { reverse })
    assert.deepEqual(selected.files, files)
    assert.equal(selected.fallback.length, 1)
  }
  assert.deepEqual(selectChanged(files, ['docs/fork/test-speedup.md'], { reverse }).files, coreTests)
  assert.deepEqual(selectChanged(files, [], { reverse }).files, coreTests)
  assert.deepEqual(selectChanged(files, ['tavern-plugin/src/client/new-fragment.js'], { reverse }).files, [...coreTests, second])
})

test('browser dependencies are transitive; performance and environment jobs remain exclusive', () => {
  const graph = { reverse: new Map([['helper.mjs', new Set([first])]]), sources: new Map([['helper.mjs', "import { chromium } from 'playwright'"]]) }
  assert.deepEqual(classifyTests([first, second, 'tests/request-performance.test.mjs', 'tests/launcher.test.mjs'], graph), {
    [first]: 'browser', [second]: 'parallel', 'tests/request-performance.test.mjs': 'exclusive', 'tests/launcher.test.mjs': 'exclusive',
  })
})

test('scheduler runs every file exactly once, bounds both pools, and never overlaps an exclusive job', async () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const classes = { a: 'parallel', b: 'browser', c: 'exclusive', d: 'parallel', e: 'browser', f: 'parallel', g: 'exclusive' }
  const active = { parallel: 0, browser: 0, exclusive: 0 }, seen = [], peak = { parallel: 0, browser: 0 }
  await schedule(items, classes, { parallel: 2, browser: 1 }, async (file, lane) => {
    if (lane === 'exclusive') assert.equal(Object.values(active).reduce((a, b) => a + b), 0)
    else assert.equal(active.exclusive, 0)
    active[lane]++
    if (lane !== 'exclusive') peak[lane] = Math.max(peak[lane], active[lane])
    await nextTurn()
    assert.ok(active.parallel <= 2 && active.browser <= 1)
    seen.push(file)
    active[lane]--
  })
  assert.deepEqual(seen.slice(0, 2), ['c', 'g'])
  assert.deepEqual(seen.sort(), items)
  assert.deepEqual(peak, { parallel: 2, browser: 1 })
  await assert.rejects(schedule(['x'], { x: 'exclusive' }, { parallel: 1, browser: 1 }, async () => { throw Error('spawn failed') }), /spawn failed/)
})

// private fork: reproduce the actual performance merges that exposed gate omissions.
test('affected gate selects package suites and stage consumers for the performance merges', () => {
  const select = range => JSON.parse(execFileSync(process.execPath,
    ['tools/public-test/test-affected.mjs', range, '--dry-run'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).selected
  const summary = select('9fa03f9b5^..9fa03f9b5')
  for (const name of ['pack-cache', 'pack-v2']) assert.ok(summary.includes(`tavern-plugin/packages/dsh-asset-library/tests/${name}.test.mjs`))
  for (const selected of [summary, select('15235e48b^..15235e48b')]) {
    for (const name of ['fork-alias-resolve', 'fork-madoka-stage-open-browser']) assert.ok(selected.includes(`tests/${name}.test.mjs`))
  }
})

test('affected gate selects export tests for additions and always rejects unclassified deployment targets', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-affected-paths-'))
  t.after(() => rm(temporary, {recursive:true, force:true}))
  const scripts = '.pi/skills/maintain-local-dsh-tavern/scripts'
  await mkdir(path.join(temporary, scripts), {recursive:true})
  await mkdir(path.join(temporary, 'tests'))
  await mkdir(path.join(temporary, 'testsets/tests'), {recursive:true})
  for (const file of ['test-affected.mjs', 'test-windows-policy.mjs']) await copyFile(path.join(root, scripts, file), path.join(temporary, scripts, file))
  for (const file of ['old.test.mjs', 'public-export.test.mjs']) await writeFile(path.join(temporary, 'tests', file), '// fixture\n')
  await mkdir(path.join(temporary, 'bin/lib'), {recursive:true})
  await copyFile(path.join(root, 'bin/lib/public-export.mjs'), path.join(temporary, 'bin/lib/public-export.mjs'))
  await mkdir(path.join(temporary, 'public'))
  await writeFile(path.join(temporary, 'public/include.json'), '[]')
  await writeFile(path.join(temporary, 'public/exclude.json'), JSON.stringify({paths:[],directories:['.pi/','bin/','public/','tests/']}))
  const git = (...args) => execFileSync('git', args, {cwd:temporary, encoding:'utf8'})
  git('init', '--quiet')
  const commit = () => {
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
    return git('rev-parse', 'HEAD').trim()
  }
  const select = (from, to) => JSON.parse(execFileSync(process.execPath, [path.join(scripts, 'test-affected.mjs'), from+'..'+to, '--dry-run'], {cwd:temporary, encoding:'utf8'})).selected
  const initial = commit()
  await writeFile(path.join(temporary, 'tests/old.test.mjs'), '// edited fixture\n')
  const edited = commit()
  assert.equal(select(initial, edited).includes('tests/public-export.test.mjs'), false)
  await writeFile(path.join(temporary, 'tests/added.test.mjs'), '// new test\n')
  const added = commit()
  assert.ok(select(edited, added).includes('tests/public-export.test.mjs'))
  git('mv', 'tests/old.test.mjs', 'tests/renamed.test.mjs')
  const renamed = commit()
  assert.ok(select(added, renamed).includes('tests/public-export.test.mjs'))
  await writeFile(path.join(temporary, 'new-runtime.mjs'), '// new exporter input\n')
  const unclassified = commit()
  assert.ok(select(renamed, unclassified).includes('tests/public-export.test.mjs'))
  const deploy = (from, to) => spawnSync(process.execPath, [path.join(scripts, 'test-affected.mjs'), from+'..'+to], {cwd:temporary, encoding:'utf8'})
  assert.match(deploy(renamed, unclassified).stderr, /Unclassified public-export inputs[^]*new-runtime\.mjs/)
  await writeFile(path.join(temporary, 'tests/added.test.mjs'), '// ordinary edit, no new paths\n')
  const ordinary = commit()
  assert.equal(select(unclassified, ordinary).includes('tests/public-export.test.mjs'), false)
  const rejected = deploy(unclassified, ordinary)
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /Unclassified public-export inputs[^]*new-runtime\.mjs/)
})

test('repository graph covers literal source reads, helper imports and both discovery directories', () => {
  const graph = buildGraph(root), discovered = discoverTests(root)
  for (const file of coreTests) assert.ok(discovered.includes(file), file)
  assert.ok(discovered.some(file => file.startsWith('testsets/tests/')))
  // private fork: these package-local suites were silently absent from full and affected gates.
  for (const name of ['pack-cache', 'pack-v2']) assert.ok(discovered.includes(`tavern-plugin/packages/dsh-asset-library/tests/${name}.test.mjs`))
  assert.ok(dependents(graph.reverse, ['tests/helpers/stage-resource-harness.mjs']).has('tests/fork-asset-runtime.test.mjs'))
  assert.ok(dependents(graph.reverse, ['tavern-plugin/src/client/fork-gal-stage.js']).has('tests/fork-stage-perf.test.mjs'))
  assert.equal(classifyTests(['tests/fork-stage-mounted-source.test.mjs'], graph)['tests/fork-stage-mounted-source.test.mjs'], 'browser')
  assert.throws(() => gitChanges(root, 'does-not-exist-test-speedup-ref'))
})
