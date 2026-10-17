// private fork: ordinary pack sources are authoring inputs, not runtime defaults.
// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import {
  forkSoundscapeInitial as initial, forkSoundscapeReplay as replay,
  forkSoundscapeCarry as carry, forkSoundscapePreset as preset, forkSoundscapePlan as plan,
  forkSoundscapeTags as tags, forkSoundscapeSceneSnapshots as snapshots, forkSoundscapeRecordPlan as recordPlan
} from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs'

const cafe = { category: '\u57ce\u9547/\u5546\u4e1a/\u5496\u5561\u5385' }
const start = (overrides = {}) => ({ scene: 'cafe', weather: 'rain', soundscape: { ...overrides } })
const sounds = (...ids) => ids.map(id => ({ id, kind: 'ambience', url: '/enabled/' + id + '.ogg' }))
const baseSounds = sounds('amb-cafe', 'amb-rain')
const mix = (overrides = {}, catalogue = baseSounds, scene = cafe) => plan(initial(start(overrides)), scene, catalogue)
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, actual + ' != ' + expected)

test('cafe and rain are separate layers with shared gain budget and indoor filtering', () => {
  const result = mix()
  assert.equal(result.version, 1)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.layers.map(({ slot, id, lowpassHz }) => ({ slot, id, lowpassHz })), [
    { slot: 'place', id: 'amb-cafe', lowpassHz: null }, { slot: 'weather', id: 'amb-rain', lowpassHz: 1600 }
  ])
  close(result.layers[0].gain, 0.56)
  close(result.layers[1].gain, 0.28)
})

test('empty classrooms never suggest crowd ambience', () => {
  // private fork: rooms have no ventilation hum.
  assert.equal(preset({ category: '\u5b66\u6821/\u5ba4\u5185/\u7a7a\u6559\u5ba4' }).place, 'none')
})

test('same URL aliases collapse to weather before gain budgeting', () => {
  const catalogue = baseSounds.map(sound => ({ ...sound, url: '/same.ogg' }))
  const result = mix({}, catalogue)
  assert.equal(result.layers.length, 1)
  assert.equal(result.layers[0].slot, 'weather')
  assert.equal(result.layers[0].lowpassHz, 1600)
  close(result.layers[0].gain, 0.4)
  assert.deepEqual(result.warnings, ['duplicate ambience URL: kept weather'])
})

test('finite category presets match bundled categories, explicit metadata wins, names do not guess', () => {
  const cases = [
    [cafe.category, 'amb-cafe', 'indoor'],
    ['\u57ce\u9547/\u5546\u4e1a/\u5bb6\u5ead\u9910\u5385', 'amb-cafe', 'indoor'],
    ['\u5b66\u6821/\u5ba4\u5185/\u6559\u5ba4', 'amb-classroom', 'indoor'],
    ['\u4f4f\u5b85/\u5ba4\u5185/\u5367\u5ba4', 'none', 'indoor'], // private fork
    ['\u5b97\u95e8/\u5ba4\u5185/\u9759\u5ba4', 'none', 'indoor'], // private fork
    ['\u57ce\u9547/\u5ba4\u5185/\u516c\u4f1a', 'none', 'indoor'], // private fork
    ['\u4f4f\u5b85/\u5ba4\u5916/\u8857\u5df7', 'none', 'open'], // private fork
    ['\u81ea\u7136/\u68ee\u6797\u5c0f\u5f84', 'amb-forest', 'open'],
    ['\u81ea\u7136/\u516c\u56ed', 'amb-park-birds', 'open'],
    ['\u81ea\u7136/\u5c71\u95f4\u6eaa\u6d41', 'amb-stream-flow', 'open'],
    ['\u4f4f\u5b85/\u5ba4\u5916/\u6cb3\u5824', 'amb-river-waves', 'open'],
    ['\u6d3b\u52a8/\u51fa\u884c/\u6d77\u6ee9', 'amb-sea', 'open'],
    ['\u57ce\u9547/\u4ea4\u901a/\u7535\u8f66\u8f66\u53a2', 'amb-train-clatter', 'indoor'] // private fork
  ]
  for (const [category, place, exposure] of cases) assert.deepEqual(preset({ category }), { place, exposure, warnings: [] })
  assert.deepEqual(preset({ ...cafe, soundscape: { place: 'none', exposure: 'sealed' } }), { place: 'none', exposure: 'sealed', warnings: [] })
  assert.deepEqual(preset({ ...cafe, soundscape: { place: '../unsafe', exposure: 'open' } }), preset(cafe))
  for (const scene of [null, { name: 'cafe forest rain', description: 'sea park train' }, { category: 'unknown/cafe' }]) {
    assert.deepEqual(preset(scene), { place: 'none', exposure: 'indoor', warnings: ['unknown acoustic preset'] })
    const result = mix({}, baseSounds, scene)
    assert.equal(result.layers.length, 1)
    assert.equal(result.layers[0].lowpassHz, 1600)
    assert.ok(result.warnings.includes('unknown acoustic preset'))
  }
})

// private fork: pin actual bundled backgrounds, including both train categories and the quiet residential exceptions.
test('bundled train cars use clatter and quiet residential streets preserve weather without city ambience', async t => {
  if (!(await import('node:fs')).existsSync(new URL('../assets/packs/jp-general/backgrounds/index.json', import.meta.url))) return t.skip('Private authored background catalogue is not distributed; synthetic acoustic presets remain tested')
  const { backgrounds } = JSON.parse(await readFile(new URL('../assets/packs/jp-general/backgrounds/index.json', import.meta.url), 'utf8'))
  const background = id => {
    const item = backgrounds.find(item => item.id === id)
    assert.ok(item, id)
    return item
  }
  const catalogue = sounds('amb-train-clatter', 'amb-city-street', 'amb-rain', 'amb-rain-window', 'amb-night-crickets')
  for (const id of ['general-train-car', 'general-shinkansen']) {
    const scene = background(id)
    assert.deepEqual(preset(scene), { place: 'amb-train-clatter', exposure: 'indoor', warnings: [] })
    assert.deepEqual(mix({}, catalogue, scene).layers.map(item => item.id), ['amb-train-clatter', 'amb-rain-window'])
  }
  for (const id of ['school-commute-street', 'general-residential-lane-dusk', 'general-slope']) {
    const scene = background(id)
    assert.deepEqual(preset(scene), { place: 'none', exposure: 'open', warnings: [] })
    const rainy = mix({}, catalogue, scene)
    assert.deepEqual(rainy.layers.map(item => item.id), ['amb-rain'])
    assert.equal(rainy.layers[0].gain, 1)
    assert.equal(rainy.layers[0].lowpassHz, null)
    assert.deepEqual(plan(initial({ scene: scene.name, weather: 'none' }), scene, catalogue).layers, [])
    assert.deepEqual(mix({ tags: ['sealed'] }, catalogue, scene).layers, [])
    assert.equal(snapshots([scene])[0].soundscape.place, 'none')
  }
  for (const id of ['general-crossroad', 'general-shopping-street-afternoon', 'general-downtown']) {
    const scene = background(id)
    assert.deepEqual(preset(scene), { place: 'amb-city-street', exposure: 'open', warnings: [] })
    assert.deepEqual(mix({}, catalogue, scene).layers.map(item => item.id), ['amb-city-street', 'amb-rain'])
  }
})

test('standalone browser include is inert without CommonJS, DOM, timers, fetch or audio', async () => {
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs', import.meta.url), 'utf8')
  const context = vm.createContext({})
  vm.runInContext(source, context)
  assert.equal(typeof context.forkSoundscapeReplay, 'function')
  assert.equal(context.forkSoundscapeInitial({ amb: 'none' }).tags.length, 0)
  assert.equal(context.forkSoundscapePlan(null).version, 0)
  assert.ok(!/[^\x00-\x7f]/.test(source), 'include remains ASCII')
})

test('Electron browser include preserves the enclosing plugin module exports', async () => {
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs', import.meta.url), 'utf8')
  const pluginExports = { apply() {}, inject() {} }
  const context = vm.createContext({ window: {}, module: { exports: pluginExports } })
  vm.runInContext(source, context)
  assert.equal(context.module.exports, pluginExports)
  assert.deepEqual(Object.keys(context.module.exports), ['apply', 'inject'])
  assert.equal(typeof context.forkSoundscapePlan, 'function')
})

test('all records use scene/weather/tags regardless obsolete version and manual ambience', () => {
  for (const legacy of [{}, { amb: 'none' }, { soundscape: {} }, { soundscape: { version: 1, place: 'none' } }, { soundscape: { version: '2' } }]) {
    assert.deepEqual(initial(legacy).tags, [])
    assert.deepEqual(replay(legacy, [{ at: 1, sound: ['empty'] }]).tags, ['empty'])
  }
  for (const invalid of [null, undefined]) assert.equal(initial(invalid), null)
  assert.deepEqual(plan(null), { version: 0, layers: [], warnings: [] })
  assert.deepEqual(initial(start()), { sceneKey: '["cafe"]', scene: 'cafe', weather: 'rain', tags: [] })
  assert.deepEqual(initial({ ...start(), amb: 'none' }), initial(start()))
  assert.deepEqual(carry(initial(start())), initial(start()))
  assert.deepEqual(carry({ version: 1 }).tags, [])
})

test('sound is a complete replacement: omission preserves, [] restores, replacement never merges', () => {
  const seed = start({ tags: ['empty', 'open'] })
  assert.deepEqual(replay(seed, [{ at: 1 }]).tags, ['empty', 'open'])
  assert.deepEqual(replay(seed, [{ at: 1, sound: [] }]).tags, [])
  const replaced = replay(seed, [{ at: 1, sound: ['empty'] }])
  assert.deepEqual(replaced.tags, ['empty'])
  assert.equal(plan(replaced, cafe, baseSounds).layers[0].gain, 0.4)
  assert.deepEqual(replay(seed, [{ at: 1, sound: ['sealed'] }]).tags, ['sealed'])
  assert.deepEqual(replay(seed, [{ at: 1, sound: ['sealed', 'empty'] }]).tags, ['empty', 'sealed'])
})

test('qualified same scene carries; real name/source/library changes reset before explicit tags', () => {
  const ref = { source: 'general', id: 'cafe-id' }
  const seed = { ...start({ tags: ['empty', 'sheltered'] }), assetRefs: { scene: ref } }
  for (const entry of [
    { at: 1, scene: 'cafe' }, { at: 1, scene: 'cafe', assetRefs: { scene: ref } },
    { at: 1, scene: 'cafe', assetRefs: { scene: { source: 'library', libraryId: 'general', id: 'cafe-id' } } }
  ]) assert.deepEqual(replay(seed, [entry]), initial(seed))
  const carried = carry(initial(seed))
  assert.deepEqual(replay({ soundscape: carried }, [{ at: 1, scene: 'cafe' }]), carried)
  for (const entry of [
    { at: 2, scene: 'forest' },
    { at: 2, scene: 'cafe', assetRefs: { scene: { source: 'card', id: 'cafe-id' } } },
    { at: 2, scene: 'cafe', assetRefs: { scene: { source: 'library', libraryId: 'other', id: 'cafe-id' } } },
    { at: 2, scene: 'cafe', assetRefs: { scene: { source: 'general', id: 'different' } } }
  ]) {
    assert.deepEqual(replay(seed, [entry]).tags, [])
    assert.equal(replay(seed, [entry]).weather, 'rain')
    assert.deepEqual(replay(seed, [{ ...entry, sound: ['open'] }]).tags, ['open'])
  }
  assert.deepEqual(initial({ scene: 'forest', soundscape: carried }).tags, [])
})

test('qualifying a name-only carried scene preserves tags without masking actual identity changes', () => {
  const carried = replay(start(), [{ at: 1, sound: ['empty', 'open'] }])
  const ref = { source: 'general', id: 'cafe-id' }
  const qualified = initial({ scene: 'cafe', assetRefs: { scene: ref }, soundscape: carried })
  assert.deepEqual(qualified.tags, ['empty', 'open'])
  assert.equal(qualified.weather, 'rain')
  assert.equal(qualified.sceneKey, '["cafe","library","general","cafe-id"]')
  assert.deepEqual(replay({ soundscape: carried }, [{ at: 1, scene: 'cafe', assetRefs: { scene: ref } }]), qualified)
  assert.deepEqual(initial({ scene: 'park', assetRefs: { scene: ref }, soundscape: carried }).tags, [])
  assert.deepEqual(initial({ scene: 'cafe', assetRefs: { scene: { source: 'card', id: 'cafe-id' } }, soundscape: qualified }).tags, [])
  assert.deepEqual(replay({ soundscape: carried }, [{ at: 1, scene: 'cafe', assetRefs: { scene: ref }, sound: ['sealed'] }]).tags, ['sealed'])
  assert.deepEqual(carried.tags, ['empty', 'open'])
})

test('empty suppresses only finite/explicit crowd, not equipment, nature or weather', () => {
  assert.deepEqual(mix({ tags: ['empty'] }).layers.map(x => x.slot), ['weather'])
  for (const id of ['amb-cafe', 'amb-classroom', 'custom']) {
    const scene = { soundscape: { place: id, exposure: 'indoor', ...(id === 'custom' ? { people: true } : {}) } }
    assert.deepEqual(mix({ tags: ['empty'] }, sounds(id, 'amb-rain'), scene).layers.map(x => x.slot), ['weather'])
  }
  const explicit = { soundscape: { place: 'custom', exposure: 'open' } }
  const catalogue = [{ ...sounds('custom')[0], people: true }, ...sounds('amb-rain')]
  assert.deepEqual(mix({ tags: ['empty'] }, catalogue, explicit).layers.map(x => x.slot), ['weather'])
  // private fork: retired indoor hums are no longer catalogue examples.
  for (const id of ['amb-park-birds', 'amb-stream-flow', 'amb-cafe-equipment']) {
    const scene = { soundscape: { place: id, exposure: 'indoor', people: false } }
    assert.deepEqual(mix({ tags: ['empty'] }, sounds(id, 'amb-rain'), scene).layers.map(x => x.id), [id, 'amb-rain'])
  }
  assert.deepEqual(preset({ soundscape: { place: 'custom', exposure: 'indoor', people: true } }),
    { place: 'custom', exposure: 'indoor', people: true, warnings: [] })
  assert.deepEqual(mix({ tags: ['empty'] }, sounds('amb-rain')).layers.map(x => x.id), ['amb-rain'], 'no synthetic replacement for missing crowd')
})

test('sealed affects only weather; fixed gains, indoor window attenuation and storm fallback survive', () => {
  assert.deepEqual(mix({ tags: ['sealed'] }).layers.map(x => x.id), ['amb-cafe'])
  assert.equal(mix({ tags: ['sealed'] }).layers[0].gain, 0.8)
  assert.deepEqual(mix({ tags: ['empty', 'sealed'] }).layers, [])
  for (const [tag, gain, lowpassHz] of [['open', 1, null], ['sheltered', 0.7, 4500]]) {
    const weather = mix({ tags: ['empty', tag] }).layers[0]
    assert.equal(weather.gain, gain)
    assert.equal(weather.lowpassHz, lowpassHz)
  }
  const catalogue = sounds('amb-cafe', 'amb-rain', 'amb-rain-window', 'amb-heavy-rain')
  const window = mix({}, catalogue).layers[1]
  assert.equal(window.id, 'amb-rain-window')
  assert.equal(window.lowpassHz, null)
  close(window.gain, 0.28)
  const storm = initial({ ...start(), weather: 'storm' })
  assert.equal(plan(storm, cafe, catalogue).layers[1].id, 'amb-heavy-rain')
  close(plan(storm, cafe, catalogue).layers[1].gain, 1.25 * 0.4 * 0.7)
  assert.equal(plan(storm, cafe, baseSounds).layers[1].id, 'amb-rain')
  assert.ok(plan(storm, cafe, baseSounds).warnings.includes('missing ambience: amb-heavy-rain'))
})

test('rain-family presets never stack beds and keep weather exposure/filtering', () => {
  const catalogue = sounds('amb-rain', 'amb-heavy-rain', 'amb-rain-light', 'amb-rain-window')
  for (const { id } of catalogue) {
    const scene = { soundscape: { place: id, exposure: 'indoor' } }
    const result = mix({}, catalogue, scene)
    assert.deepEqual(result.layers.map(x => [x.slot, x.id]), [['weather', 'amb-rain-window']])
    assert.equal(result.layers[0].gain, 0.4)
    assert.deepEqual(mix({ tags: ['sealed'] }, catalogue, scene).layers, [])
    assert.deepEqual(plan(initial({ ...start(), weather: 'none' }), scene, catalogue).layers, [])
    assert.deepEqual(mix({ tags: ['open'] }, catalogue, scene).layers.map(x => x.id), ['amb-rain'])
    assert.deepEqual(plan(initial({ ...start(), weather: 'storm' }), scene, catalogue).layers.map(x => x.id), ['amb-heavy-rain'])
  }
})

test('weather stays independent through tags, omission and inverse replay', () => {
  const entries = [
    { at: 8, commands: [{ op: 'weather', value: 'none' }] },
    { at: 2, sound: ['empty', 'open'] }, { at: 5, sound: [] },
    { at: 3, commands: [{ op: 'weather', value: 'storm' }] }
  ]
  const before = structuredClone(entries)
  assert.equal(replay(start(), entries, 8).weather, 'none')
  assert.deepEqual(replay(start(), entries, 2).tags, ['empty', 'open'])
  assert.equal(replay(start(), entries, 2).weather, 'rain')
  assert.equal(replay(start(), entries, 3).weather, 'storm')
  assert.deepEqual(replay(start(), entries, 5).tags, [])
  assert.deepEqual(replay(start(), entries, 1), initial(start()))
  assert.deepEqual(entries, before)
  for (const weather of ['none', 'snow', 'leaves', 'sakura', 'sparkle']) {
    assert.deepEqual(plan(initial({ ...start({ tags: ['empty'] }), weather }), cafe, baseSounds).layers, [])
  }
})

test('invalid tags never partially apply; retired commands do not control renderer', () => {
  const seed = start({ tags: ['sheltered'] })
  for (const sound of [null, {}, 'empty', ['empty', 'empty'], ['open', 'sealed'], ['EMPTY'], ['indoor'], ['empty', 'open', 'sealed']]) {
    assert.equal(tags(sound).tags, null)
    assert.deepEqual(replay(seed, [{ at: 1, sound }]), initial(seed))
    assert.equal(initial(start({ tags: sound })), null)
  }
  const commands = [{ op: 'amb', value: 'none' }, { op: 'soundscape', level: 'low', rain: 'heavy', exposure: 'sealed', hushUntil: 8 }]
  assert.deepEqual(replay(seed, [{ at: 1, commands }]), initial(seed))
  assert.deepEqual(mix({ place: 'none', level: 'low', exposure: 'sealed', rain: 'light', hushUntil: 8 }), mix())
})

test('enabled catalogue only, no synthesis, fresh immutable inputs and bounded plans', () => {
  const seed = start({ tags: ['empty'] })
  const entries = [{ at: 2, sound: ['open'] }]
  const before = JSON.stringify([seed, entries, cafe, baseSounds])
  const state = replay(seed, entries, 2)
  carry(state).tags.push('empty')
  plan(state, cafe, baseSounds).layers[0].gain = 99
  assert.deepEqual(state.tags, ['open'])
  assert.equal(JSON.stringify([seed, entries, cafe, baseSounds]), before)
  for (const flags of [{ enabled: false }, { hidden: true }, { missing: true }, { kind: 'oneshot' }]) assert.deepEqual(mix({}, baseSounds.map(x => ({ ...x, ...flags }))).layers, [])
  assert.deepEqual(mix({}, []).warnings, ['missing ambience: amb-cafe', 'missing ambience: amb-rain'])
  assert.deepEqual(mix({}, baseSounds.map(x => ({ ...x, url: '' }))).layers, [])
  for (const tags of [[], ['empty'], ['open'], ['sheltered'], ['sealed'], ['empty', 'sealed']]) {
    const result = mix({ tags })
    assert.equal(result.version, 1, 'transport version stays v1')
    assert.ok(result.layers.length <= 2)
    assert.ok(result.layers.every(x => Number.isFinite(x.gain) && x.gain >= 0 && x.gain <= 1))
  }
})

test('selected sound classification wins, then explicit preset, then known crowd IDs only', () => {
  const classifiedCategory = { ...cafe, soundscape: { people: false } }
  assert.equal(preset(classifiedCategory).people, false)
  assert.deepEqual(mix({ tags: ['empty'] }, baseSounds, classifiedCategory).layers.map(x => x.slot), ['place', 'weather'])
  for (const [id, soundPeople, presetPeople, muted] of [
    ['amb-cafe', false, true, false], ['amb-classroom', undefined, false, false],
    ['custom-bed', true, false, true], ['custom-bed', undefined, true, true],
    ['amb-cafe', undefined, undefined, true], ['custom-crowd-name', undefined, undefined, false]
  ]) {
    const catalogue = sounds(id, 'amb-rain')
    if (soundPeople !== undefined) catalogue[0].people = soundPeople
    const scene = { soundscape: { place: id, exposure: 'indoor', ...(presetPeople !== undefined ? { people: presetPeople } : {}) } }
    assert.deepEqual(mix({ tags: ['empty'] }, catalogue, scene).layers.map(x => x.slot), muted ? ['weather'] : ['place', 'weather'])
  }
})


test('record planning freezes presets, resolves canonical identities and uses only live enabled audio', () => {
  const scenes = [{ name: 'cafe', id: 'cafe', source: 'general', ...cafe },
    { name: 'cafe', id: 'cafe', source: 'library', libraryId: 'other', soundscape: { place: 'none', exposure: 'sealed' } }]
  const frozen = snapshots(scenes)
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen[0].soundscape.warnings))
  scenes[0].category = 'changed'
  const direction = { start: { scene: 'cafe', weather: 'rain', amb: 'none', assetRefs: { scene: { source: 'library', libraryId: 'general', id: 'cafe' } } },
    entries: [{ at: 2, sound: ['empty', 'open'] }, { at: 3, sound: [] }], soundscapeScenes: frozen }
  const original = structuredClone(direction)
  assert.deepEqual(recordPlan(direction, 1, baseSounds).layers.map(x => x.id), ['amb-cafe', 'amb-rain'])
  assert.deepEqual(recordPlan(direction, 2, baseSounds).layers.map(x => x.id), ['amb-rain'])
  assert.equal(recordPlan(direction, 2, baseSounds).layers[0].gain, 1)
  assert.deepEqual(recordPlan(direction, 3, baseSounds), recordPlan(direction, 1, baseSounds))
  assert.deepEqual(recordPlan(direction, 1, baseSounds.map(s => ({ ...s, enabled: false }))).layers, [])
  assert.deepEqual(recordPlan(direction, 1, baseSounds.map(s => ({ ...s, missing: true }))).layers, [])
  assert.deepEqual(recordPlan(direction, 1, baseSounds.map(s => ({ ...s, url: '' }))).layers, [])
  assert.equal(recordPlan(direction, 1, baseSounds.map(s => ({ ...s, url: '/new/' + s.id }))).layers[0].url, '/new/amb-cafe')
  assert.deepEqual(direction, original)
  direction.start.scene = 'renamed'
  assert.equal(recordPlan(direction, 1, baseSounds).layers.length, 2, 'qualified identity survives a renamed picture')
  direction.start.assetRefs.scene = { source: 'other', id: 'cafe' }
  assert.deepEqual(recordPlan(direction, 1, baseSounds).layers, [])
  delete direction.start.assetRefs
  direction.start.scene = 'cafe'
  assert.ok(recordPlan(direction, 1, baseSounds).warnings.includes('ambiguous scene identity'))
  assert.equal(recordPlan({ start: { weather: 'rain', amb: 'none' } }, 1, baseSounds).version, 1)
})
