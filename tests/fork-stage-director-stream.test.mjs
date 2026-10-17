// private fork: include source literally, without String.replace replacement-token expansion.
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: distance focus is no longer a submission value.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import {stageParagraphs} from '../tavern-plugin/lib/domain/stage-paragraphs.js'
import { cleanDirectorUnits } from '../tavern-plugin/lib/domain/stage-director-text.js'
import { projectRuntimeReply } from '../tavern-plugin/lib/domain/runtime-content-projection.js'

const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const bubbles = (await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', '[]')
const history = await readFile(new URL('../tavern-plugin/src/client/fork-gal-history.js', import.meta.url), 'utf8')
const client = {}
vm.runInNewContext(bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings')) + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode'))) + ';this.pages=forkGalPages;this.parse=forkParseBubbles;this.cue=forkGalCue;this.covers=forkGalDirectionCovers;this.effects=forkGalNewEffects;', client)

test('hidden reasoning/status/variable blocks never reach director and share client paragraph numbers', () => {
  // <status> stays visible: cards render status bars from it.
  const tags = ['think', 'thinking', 'analysis', 'reasoning', 'UpdateVariable', 'initvar', 'variable-update']
  const source = 'Before\n\n' + tags.map(tag => `<${tag}>PRIVATE ${tag}\n\n@bubble:a|A|calm|[PRIVATE]</${tag}>`).join('\n\n') + '\n\n@bubble:a|A|calm|[Visible]\n\nAfter'
  const parts = projectRuntimeReply(source).displayParts
  const units = cleanDirectorUnits(stageParagraphs(source, parts))
  const pages = client.pages(parts.filter(part => part.kind === 'markdown').map(part => ({ segments: client.parse(part.text, false) })))
  assert.deepEqual(Array.from(pages, page => [page.para, page.kind]), [[1, 'narration'], [2, 'line'], [3, 'narration']])
  assert.deepEqual(units.map(unit => unit.kind), Array.from(pages, page => page.kind))
  assert.deepEqual(cleanDirectorUnits(stageParagraphs(source)), units)
  assert.doesNotMatch(JSON.stringify(units), /PRIVATE/) // private fork: production consumes these cleaned units.
  assert.deepEqual(cleanDirectorUnits(stageParagraphs('Before\n\n<think>private reasoning</think>\n\nAfter')).map(unit => unit.text), ['Before', 'After'])
  assert.deepEqual(cleanDirectorUnits(stageParagraphs('Before\n\n<thinking>PRIVATE unfinished')).map(unit => unit.text), ['Before'])
})

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

// private fork: observation is session-owned; same-source regeneration cannot depend on a hook mount.
test('source reconciles completed direction without any React hook',async t=>{
  const {harness,drain}=await import('./helpers/stage-resource-harness.mjs')
  const h=await harness(t);assert.equal(h.f.calls.length,0)
  await h.direct();assert.equal(h.store.getSnapshot().director.phase,'done')
  const before=h.store.getSnapshot().director.revision
  await h.f.director.retry(h.f.read(),1);await h.f.director.drain();await drain()
  assert.ok(h.store.getSnapshot().director.revision>before)
  assert.equal(h.store.getSnapshot().director.phase,'done')
})

test('client polls partial work quickly, retains scene beyond prefix, and deduplicates final effects', () => {
  const direction = { status: 'running', partial: true, start: { scene: 'old', cast: ['b'] }, entries: [{ at: 1, scene: 'room', cast: ['a'], commands: [{ op: 'beat', value: 'flash' }] }] }
  assert.equal(client.covers(direction, 1), true)
  assert.equal(client.covers(direction, 2), false)
  assert.equal(client.cue(direction, 1).cast[0], 'a')
  assert.equal(client.cue(direction, 2).cast, null, 'later paragraphs use heuristic speakers')
  assert.equal(client.cue(direction, 2).scenes.at(-1), 'room')
  const memory = {}, effects = direction.entries[0].commands
  assert.equal(client.effects(memory, 'turn:page1', effects).length, 1)
  assert.equal(client.effects(memory, 'turn:page1', structuredClone(effects)).length, 0, 'done does not replay streamed effects')
  assert.equal(client.effects(memory, 'turn:page1', [...effects, { op: 'sfx', value: 'bell' }]).length, 1, 'new effects on current paragraph can arrive later')
  client.effects(memory, 'turn:page2', [])
  assert.equal(client.effects(memory, 'turn:page1', effects).length, 1, 'deliberate backtracking preserves replay behavior')
  assert.equal(client.covers({ ...direction, status: 'done' }, 4), true)
})
