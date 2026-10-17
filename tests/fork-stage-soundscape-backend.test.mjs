import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareSoundscapeDraft, replaySoundscapeDraft } from '../tavern-plugin/lib/domain/stage-soundscape.js'
import { forkCreateSoundscapePlayer } from '../tavern-plugin/src/client/fork-stage-soundscape-player.cjs'

const scene = { name: 'cafe', source: 'library', libraryId: 'general', id: 'cafe', soundscape: { place: 'amb-cafe', exposure: 'indoor' } }
// Synthetic catalogue fixture, not a claim that cafe audio is shipped.
const sounds = ['amb-cafe', 'amb-rain', 'amb-rain-window'].map(id => ({ id, kind: 'ambience', url: '/fixtures/' + id + '.ogg' }))
const input = () => ({ start: { scene: 'cafe', weather: 'rain', assetRefs: { scene: { source: 'general', id: 'cafe' } } }, units: 6, scenes: [scene], sounds,
  entries: [{ at: 2, sound: ['empty'] }, { at: 3, sound: ['empty', 'sealed'] },
    { at: 5, sound: [] }, { at: 6, sound: ['open', 'empty'] }] })

test('offline end to end: beat sound arrays, backend replay and existing player handle coexistence, empty, restoration and disposal', async () => {
  const nodes = [], levels = new Map()
  class Audio {
    constructor() { this.volume = 0; this.src = ''; this.events = new Map(); nodes.push(this) }
    addEventListener(name, fn) { this.events.set(name, fn) }
    removeEventListener(name) { this.events.delete(name) }
    play() { return Promise.resolve() }
    pause() {}
    removeAttribute() { this.src = '' }
    load() {}
  }
  const mixer = { bind() {}, filter() {}, release() {}, level(node, value) { if (value === undefined) return levels.get(node) || 0; levels.set(node, value) } }
  const player = forkCreateSoundscapePlayer({ Audio, mixer, requestFrame() { assert.fail('snap playback needs no RAF') }, cancelFrame() {}, now: () => 0 })
  const record = prepareSoundscapeDraft(input())
  for (const [para, count] of [[1, 2], [2, 1], [3, 0], [5, 2], [6, 1], [1, 2]]) {
    // private fork: the retained old-protocol fold test supplies explicit fixture media identities to the migrated sink.
    const plan = replaySoundscapeDraft(record, para).plan
    const snapshot = player.apply({...plan,layers:plan.layers.map(layer=>({...layer,identity:'fixture:'+layer.id}))}, { snap: true })
    await Promise.resolve()
    assert.deepEqual(snapshot.warnings, [])
    assert.equal(nodes.filter(node => node.src).length, count)
  }
  player.dispose()
  assert.equal(nodes.filter(node => node.src).length, 0)
})

test('backend snapshots are frozen, current enabled only, detached from caller edits, and invertible', () => {
  const source = structuredClone(input())
  source.sounds.push({ ...sounds[0], id: 'disabled', enabled: false }, { ...sounds[0], id: 'hidden', hidden: true }, { ...sounds[0], id: 'oneshot', kind: 'oneshot' })
  const original = structuredClone(source)
  const record = prepareSoundscapeDraft(source)
  assert.deepEqual(source, original)
  assert.equal(record.soundscapeVersion, undefined)
  assert.equal(record.start.soundscape.version, undefined)
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.scenes[0].soundscape) && Object.isFrozen(record.entries[0].sound) && Object.isFrozen(record.sounds[0]))
  assert.equal(record.sounds.length, 3)
  assert.deepEqual(record.entries[3].sound, ['empty', 'open'])
  source.scenes[0].soundscape.exposure = 'sealed'
  source.sounds[0].url = '/changed.ogg'
  const first = replaySoundscapeDraft(record, 1)
  assert.deepEqual(first.plan.layers.map(x => x.id), ['amb-cafe', 'amb-rain-window'])
  assert.deepEqual(first.plan.warnings, [])
  assert.equal(first.plan.layers[0].url, '/fixtures/amb-cafe.ogg')
  assert.equal(first.plan.layers[1].gain, 0.4 * 0.7)
  assert.deepEqual(replaySoundscapeDraft(record, 2).plan.layers.map(x => x.slot), ['weather'])
  assert.deepEqual(replaySoundscapeDraft(record, 3).plan.layers, [])
  assert.deepEqual(replaySoundscapeDraft(record, 3).carry.tags, ['empty', 'sealed'])
  assert.equal(replaySoundscapeDraft(record, 5).plan.layers.length, 2)
  assert.equal(replaySoundscapeDraft(record, 6).plan.layers[0].id, 'amb-rain')
  assert.deepEqual(replaySoundscapeDraft(record, 1), first)
  first.state.tags.push('empty')
  assert.deepEqual(replaySoundscapeDraft(record, 1).state.tags, [])
})

test('snapshot retains scene and sound people flags; empty keeps noncrowd sources and weather', () => {
  for (const classification of ['scene', 'sound', 'neither']) {
    const source = structuredClone(input())
    source.scenes[0].soundscape.place = 'custom-bed'
    source.sounds[0].id = 'custom-bed'
    source.scenes[0].soundscape.people = classification === 'scene'
    if (classification !== 'scene') source.sounds[0].people = classification === 'sound'
    const record = prepareSoundscapeDraft(source)
    source.scenes[0].soundscape.people = false
    source.sounds[0].people = false
    assert.equal(record.scenes[0].soundscape.people, classification === 'scene')
    assert.equal(record.sounds[0].people, classification === 'scene' ? undefined : classification === 'sound')
    const layers = replaySoundscapeDraft(record, 2).plan.layers
    assert.deepEqual(layers.map(x => x.slot), classification === 'neither' ? ['place', 'weather'] : ['weather'])
  }
})

test('canonical source aliases match, qualified cross-library identities distinguish and duplicates reject', () => {
  const source = structuredClone(input())
  source.scenes[0].source = 'general'
  source.scenes.push({ ...scene, libraryId: 'other', soundscape: { place: 'none', exposure: 'sealed' } })
  source.entries.push({ at: 4, scene: 'cafe', assetRefs: { scene: { source: 'library', libraryId: 'other', id: 'cafe' } } })
  const record = prepareSoundscapeDraft(source)
  assert.equal(replaySoundscapeDraft(record, 1).plan.layers.length, 2)
  assert.deepEqual(replaySoundscapeDraft(record, 4).state.tags, [])
  assert.deepEqual(replaySoundscapeDraft(record, 4).plan.layers, [])
  delete source.start.assetRefs
  assert.ok(replaySoundscapeDraft(prepareSoundscapeDraft(source), 1).plan.warnings.includes('ambiguous scene identity'))
  source.scenes = [{ ...scene, source: 'general' }, scene]
  assert.throws(() => prepareSoundscapeDraft(source), /Duplicate/)
  const carry = replaySoundscapeDraft(prepareSoundscapeDraft(input()), 6).carry
  const carried = prepareSoundscapeDraft({ start: { soundscape: carry }, units: 1, scenes: [scene], sounds })
  assert.deepEqual(replaySoundscapeDraft(carried, 1).state, carry)
})

test('catalogue duplicate IDs retain enabled catalogue priority, no cross-source substitution', () => {
  const source = structuredClone(input())
  source.sounds[0].source = 'card'
  source.sounds.push({ ...sounds[0], source: 'library', libraryId: 'general', url: '/other.ogg' })
  assert.equal(replaySoundscapeDraft(prepareSoundscapeDraft(source), 1).plan.layers[0].url, sounds[0].url)
  source.sounds[0].enabled = false
  assert.equal(replaySoundscapeDraft(prepareSoundscapeDraft(source), 1).plan.layers[0].url, '/other.ogg')
})

test('backend normalizes old states, rejects malformed tags and obsolete controls; weather survives', () => {
  for (const soundscape of [{}, { version: 1 }, { version: '2' }]) {
    assert.deepEqual(prepareSoundscapeDraft({ ...input(), start: { soundscape } }).start.soundscape.tags, [])
  }
  assert.throws(() => prepareSoundscapeDraft({ ...input(), start: { soundscape: null } }), /Invalid/)
  for (const sound of [null, {}, ['open', 'sealed'], ['empty', 'empty'], ['rain'], ['empty', 'open', 'sealed']]) {
    assert.throws(() => prepareSoundscapeDraft({ ...input(), entries: [{ at: 1, sound }] }), TypeError)
  }
  for (const key of ['place', 'exposure', 'level', 'rain', 'hushUntil', 'soundscape', 'amb']) {
    assert.throws(() => prepareSoundscapeDraft({ ...input(), entries: [{ at: 1, [key]: 'none' }] }), /Obsolete/)
  }
  for (const op of ['soundscape', 'amb']) assert.throws(() => prepareSoundscapeDraft({ ...input(), entries: [{ at: 1, commands: [{ op }] }] }), /Obsolete/)
  const record = prepareSoundscapeDraft({ ...input(), entries: [{ at: 1, sound: ['empty'], commands: [{ op: 'weather', value: 'storm' }, { op: 'bgm', value: 'fixture' }] }] })
  assert.equal(replaySoundscapeDraft(record, 1).state.weather, 'storm')
  assert.deepEqual(replaySoundscapeDraft(record, 1).state.tags, ['empty'])
  assert.equal(record.entries[0].commands[1].op, 'bgm')
  for (const draft of [undefined, false]) assert.throws(() => replaySoundscapeDraft({ draft }, 1), /explicitly/)
  assert.throws(() => replaySoundscapeDraft(record, 7), /paragraph/)
  assert.throws(() => prepareSoundscapeDraft({ ...input(), units: 0 }), /paragraph/)
  assert.throws(() => prepareSoundscapeDraft({ ...input(), entries: [{ at: 0 }] }), /paragraph/)
  assert.throws(() => prepareSoundscapeDraft({ ...input(), entries: [{ at: 1, commands: {} }] }), /commands/)
})
