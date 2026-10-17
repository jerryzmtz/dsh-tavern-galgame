// private fork: include source literally, without String.replace replacement-token expansion.
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const fixture = async name => JSON.parse(await readFile(new URL('./fixtures/presentation/' + name + '.json', import.meta.url), 'utf8'))

test('P0 golden source grammar and paragraph identities remain unchanged', async () => {
  const bubbles = (await read('fork-bubbles.js')).split('// @include fork-bubble-line.cjs').join(await read('fork-bubble-line.cjs')).replace('__TAVERN_BUBBLE_MOODS__', '[]')
  const stage = await read('fork-gal-stage.js'), ctx = {}
  vm.runInNewContext(bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings')) + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// Speakers up to the page'))) + ';this.parse=forkParseBubbles;this.pages=forkGalPages;', ctx)
  for (const item of await fixture('source-units')) {
    const segments = ctx.parse(item.source, false), pages = ctx.pages([{ segments }])
    assert.deepEqual(JSON.parse(JSON.stringify({ source: item.source, segments, pages })), item)
  }
})

// private fork: freeze wheel isolation, uncapped emotes and allocation-free canonical key comparison.
// private fork: no whole-bundle digest golden; build-tavern-client --check keeps lib/client.js current and the
// assertions below cover the composition behaviour.
test('complete browser composition inlines shared contracts and keeps no-plugin behaviour', async () => {
  const source = await assembleTavernClient()
  // private fork: shared modules keep guarded Node imports; the browser uses the earlier inlined contract.
  assert.ok(source.indexOf('const directorCommands =') < source.indexOf("const commands = typeof directorCommands"))
  assert.ok(source.indexOf('const forkFigureResolution =') < source.indexOf("const resolver = typeof forkFigureResolution"))
  const browser = source
    .replaceAll("typeof forkFigureResolution !== 'undefined' ? forkFigureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs')", 'forkFigureResolution')
    .replace(/typeof module !== 'undefined' && typeof window === 'undefined' \? require\('\.\.\/\.\.\/packages\/dsh-presentation-protocol\/src\/stage-skin\.cjs'\) : null/g, 'null')
    .replace(/typeof directorCommands !== 'undefined' \? directorCommands : require\('\.\.\/\.\.\/packages\/dsh-presentation-protocol\/src\/director-commands\.cjs'\)/g, 'directorCommands')
  assert.doesNotMatch(browser, /dsh-presentation-protocol|@include-protocol/)
  const matrix = await fixture('format-matrix')
  assert.deepEqual(matrix.noPlugins.actions, ['send', 'choose', 'guide', 'retry'])
  assert.equal(matrix.noPlugins.modelCallsOnRead, 0)
  // This freezes existing composition, not the future optional-plugin runtime matrix.
  assert.ok(matrix.current.includes('playback-v3') && matrix.converterOnly.includes('record-index-v2'))
})

test('P0 offline plan schema has no executable migration or unbound writes', async () => {
  const schema = JSON.parse(await readFile(new URL('./fixtures/presentation/migration-plan.schema.json', import.meta.url), 'utf8'))
  assert.equal(schema.additionalProperties, false)
  assert.ok(schema.required.includes('baselineDigest') && schema.required.includes('unresolved'))
  assert.deepEqual(schema.$defs.file.required, ['relativePath', 'digest', 'kind'])
  const pattern = new RegExp(schema.$defs.file.properties.relativePath.pattern)
  for (const name of ['../escape', '/absolute', 'C:/escape', 'safe/../../escape', 'a\\b']) assert.equal(pattern.test(name), false, name)
  assert.equal(pattern.test('stage/direction/synthetic/index.json'), true)
})
