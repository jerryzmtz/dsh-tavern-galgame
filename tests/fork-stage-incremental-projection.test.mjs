import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: follow protocol extraction paths; historical position/distance now render normal.
import { presentationSourceUrl } from './helpers/presentation-sources.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { initialStageState, createStageTransaction, replayStage } from '../tavern-plugin/lib/domain/stage-incremental.js'
import { projectIncrementalStageEffect, projectIncrementalStageState } from '../tavern-plugin/lib/domain/stage-incremental-projection.js'
import { widgetsAt, forkWidgetBuiltins, forkWidgetPresentation } from '../tavern-plugin/src/client/fork-stage-widgets.cjs'
import { forkFigureDirection, forkFigureCarry } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
import { forkSoundscapeReplay } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs'
const read = name => readFile(presentationSourceUrl(name), 'utf8')
const source = await read('fork-gal-stage.js')
const sceneSource = await read('fork-gal-scene.js'), effectsSource = await read('fork-gal-effects.js')
const effectHelpers = sceneSource.slice(sceneSource.indexOf('// ---------- Scene helpers'), sceneSource.indexOf('// ---------- Scene runtime')) + effectsSource.slice(effectsSource.indexOf('// ---------- Effect helpers'), effectsSource.indexOf('// ---------- Effect runtime'))
const ctx = { forkLive2dSlots: n => n === 1 ? [0.5] : n === 2 ? [0.33, 0.67] : [0.2, 0.5, 0.8] }
vm.runInNewContext(await read('fork-stage-light.cjs') + await read('fork-stage-pacing.cjs') + await read('fork-figure-scale.cjs') + effectHelpers + (stagePageSource + '\n' + source.slice(source.indexOf('// Plain reading text'), source.indexOf('// The stage is a full-screen mode'))), ctx)
const plain = value => JSON.parse(JSON.stringify(value))
const catalog = { actors: { a: { defaultVariant: 'uniform', variants: ['uniform', 'performance'] }, b: { defaultVariant: 'uniform', variants: ['uniform'] } }, scene: ['room', 'street'], music: ['song'], lighting: { time: ['night'], mood: ['memory'] } }
const looks = [{ id: 'night', layer: 'time' }, { id: 'memory', layer: 'mood' }]
function effect(beats = [], { baseline, units = 8, presentation, ...extra } = {}) {
  const tx = createStageTransaction({ baseline, units, catalog, target: { sourceKey: 'source' }, ...extra })
  const result = tx.submit({ sequence: 1, through: units, done: true, beats })
  assert.equal(result.ok, true, JSON.stringify(result))
  return { ...tx.effect(), presentation: { key: 'renderer-key', ...presentation } }
}
const widgets = (record, para) => widgetsAt({ key: record.key }, { para }, record)
const staged = (record, para) => plain(ctx.forkGalStaging(record, para, new Set(), undefined, looks))
function baseline() {
  const state = initialStageState(catalog)
  Object.assign(state, { scene: 'room', cast: ['a', 'b'], music: 'song', sound: ['sealed'], weather: 'rain', lighting: { time: 'night', mood: 'memory' }, camera: { mode: 'close', actor: 'a' }, dof: 'a' })
  Object.assign(state.actors.a, { variant: 'performance', position: 'far-left', focus: 'near', gaze: 'b', figureLight: 'glow' })
  return state
}

test('incremental projection: empty turn retains every actual client field without restating commands', () => {
  const canonical = effect([], { baseline: baseline() }), record = projectIncrementalStageEffect(canonical), stage = staged(record, 8), cue = plain(ctx.forkGalCue(record, 8))
  assert.deepEqual(record.entries, [])
  assert.equal(record.protocol, 'incremental-v1'); assert.equal(record.key, 'renderer-key')
  assert.deepEqual(cue.scenes, ['room']); assert.equal(cue.music, 'song'); assert.equal(cue.outfits.a, 'performance')
  assert.deepEqual(stage.order, ['a', 'b']); assert.deepEqual(stage.lighting, { time: 'night', mood: 'memory' })
  assert.equal(stage.weather, 'rain'); assert.equal(stage.dof, 'a');
  // private fork: soundscape replay input replaces manual ambience.
  assert.deepEqual(record.start.soundscape, { scene: 'room', weather: 'rain', tags: ['sealed'] }); assert.deepEqual(forkSoundscapeReplay(record.start, record.entries, 8).tags, ['sealed'])
  assert.equal(stage.amb, undefined)
  // private fork: a carried close-up holds for four paragraphs, then the stage returns to normal framing.
  assert.deepEqual(staged(record, 4).camera, { value: 'close', id: 'a' }); assert.deepEqual(stage.camera, { value: '' })
  assert.deepEqual(stage.members.map(m => [m.id, m.x, m.focus, m.look, m.light]), [['a', 0.33, 'normal', 'b', 'glow'], ['b', 0.67, 'normal', 'viewer', '']])
  const next = projectIncrementalStageEffect(effect([], { baseline: replayStage(canonical) }))
  // private fork: everything carries into the next turn except the close-up, released at turn end.
  assert.deepEqual(next.start, { ...record.start, camera: { value: 'reset' } }); assert.deepEqual(staged(next, 1), { ...staged(record, 1), camera: { value: '' } })
})

test('incremental projection: offstage outfit, gaze, light, camera and DOF resume at the new arrival slot', () => {
  const canonical = effect([{ at: 2, ops: [{ op: 'actor.exit', actor: 'a' }] }, { at: 4, ops: [{ op: 'actor.enter', actor: 'a' }] }], { baseline: baseline() })
  const record = projectIncrementalStageEffect(canonical)
  assert.deepEqual(staged(record, 3).order, ['b']); assert.deepEqual(staged(record, 3).camera, { value: '' }); assert.equal(staged(record, 3).dof, '')
  const at4 = staged(record, 4)
  assert.deepEqual(at4.order, ['b', 'a'])
  assert.deepEqual(at4.members.find(m => m.id === 'a'), { id: 'a', x: 0.67, focus: 'normal', look: 'b', light: 'glow', visible: true, enter: 'soft', exit: '' })
  assert.deepEqual(at4.camera, { value: 'close', id: 'a' }); assert.equal(at4.dof, 'a')
  assert.equal(ctx.forkGalCue(record, 4).outfits.a, 'performance')
  const next = projectIncrementalStageEffect(effect([], { baseline: canonical.end }))
  assert.equal(staged(next, 1).members.find(m => m.id === 'a').light, 'glow')
})

// private fork: explicit resets still work without repositioning on-stage actors.
test('incremental projection: cast order stays fixed; defaults reset only when requested', () => {
  const record = projectIncrementalStageEffect(effect([{ at: 2, ops: [{ op: 'stage.patch', value: { cast: ['a', 'b'] } }, { op: 'actor.patch', actor: 'a', value: { focus: 'normal', gaze: 'viewer', figureLight: 'lit' } }] }, { at: 3, ops: [{ op: 'actor.reset', actor: 'a' }] }], { baseline: baseline() }))
  const at2 = staged(record, 2)
  assert.deepEqual(at2.order, ['a', 'b']); assert.equal(at2.members[0].x, 0.33); assert.equal(at2.members[0].focus, 'normal'); assert.equal(at2.members[0].look, ''); assert.equal(at2.members[0].light, '')
  assert.equal(ctx.forkGalCue(record, 2).outfits.a, 'performance'); assert.equal(ctx.forkGalCue(record, 3).outfits.a, '')
})

test('incremental projection: explicit clears/stops/global reset survive actual client pacing and remove card background fallback', () => {
  const record = projectIncrementalStageEffect(effect([{ at: 1, ops: [{ op: 'scene.clear' }, { op: 'music.stop' }, { op: 'stage.patch', value: { sound: [] } }] }, { at: 2, ops: [{ op: 'stage.reset' }] }], { baseline: baseline() }))
  const pages = [{ kind: 'narration', para: 1 }, { kind: 'narration', para: 2 }]
  const carried = ctx.forkGalCarriedDirection(record, null, pages, 0)
  assert.deepEqual(plain(carried.entries), record.entries, 'legacy pacing cannot retain old music or scene')
  assert.deepEqual(plain(ctx.forkGalCue(carried, 1).scenes), []); assert.equal(ctx.forkGalCue(carried, 1).sceneCleared, true); assert.equal(ctx.forkGalCue(carried, 1).music, '')
  assert.deepEqual(record.entries[0].sound, [], 'scene clear restores default sound tags')
  assert.deepEqual(forkSoundscapeReplay(record.start, record.entries, 1).tags, [])
  assert.deepEqual(staged(record, 2).order, []); assert.deepEqual(staged(record, 2).lighting, { time: 'auto', mood: 'none' }); assert.equal(staged(record, 2).weather, '')
  assert.deepEqual(plain(ctx.forkGalEndState(record, null, pages, new Set(), looks)), { ...record.end, moods: {} })
  // private fork: the live stage now consumes an explicit P4 background or silence.
  assert.match(source, /background:pack.scene\?\.backgroundUrl \?/); assert.doesNotMatch(source, /const baseBackground =/)
})

test('incremental projection: accepted empty partial prefix covers paragraphs and opens the reading gate', () => {
  const tx = createStageTransaction({ baseline: baseline(), catalog, target: { sourceKey: 'partial' }, units: 8 })
  assert.equal(tx.submit({ sequence: 1, through: 3, done: false, beats: [] }).ok, true)
  const record = projectIncrementalStageEffect(tx.effect({ allowPartial: true }))
  assert.equal(ctx.forkGalDirectionCovers(record, 3), true); assert.equal(ctx.forkGalDirectionCovers(record, 4), false)
  // private fork: prefix coverage is protocol math; F has no opening gate.
  assert.doesNotMatch(source, /function forkGalOpeningGate/)
})

test('incremental projection: one-shots remain paragraph-only and never leak into history state or a next-turn start', () => {
  const canonical = effect([{ at: 2, ops: [{ op: 'act', actor: 'a', value: 'bow' }, { op: 'act', actor: 'a', value: 'bow' }] }], { baseline: baseline() }), record = projectIncrementalStageEffect(canonical)
  assert.equal(staged(record, 2).effects.length, 2); assert.deepEqual(staged(record, 3).effects, [])
  // private fork: the turn end releases the baseline close-up; nothing else changes.
  assert.deepEqual(replayStage(canonical), { ...baseline(), camera: { mode: 'reset', actor: null } })
  const memory = {}, once = ctx.forkGalNewEffects(memory, 'same-page', staged(record, 2).effects)
  assert.equal(once.length, 2); assert.equal(ctx.forkGalNewEffects(memory, 'same-page', staged(record, 2).effects).length, 0)
  const next = projectIncrementalStageEffect(effect([], { baseline: canonical.end }))
  assert.deepEqual(staged(next, 2).effects, []); assert.deepEqual(next.entries, [])
})

test('incremental widgets: new default persists across turns, partial props preserve timer anchors, explicit lifetimes expire', () => {
  const canonical = effect([{ at: 1, ops: [
    { op: 'widget.show', widgetId: 'timer', type: 'countdown', props: { remainingSeconds: 90, label: 'Tea' } },
    { op: 'widget.show', widgetId: 'turn', type: 'note', props: { body: 'Turn only' }, lifetime: { until: 'turn-end' } },
    { op: 'widget.show', widgetId: 'scene', type: 'note', props: { body: 'Scene only' }, lifetime: { until: 'scene-change' } }
  ] }, { at: 2, ops: [{ op: 'clock.advance', value: 20 }, { op: 'widget.update', widgetId: 'timer', props: { label: 'Updated' } }] }], { baseline: baseline() })
  const record = projectIncrementalStageEffect(canonical)
  assert.equal(widgets(record, 2).find(w => w.widgetId === 'timer').remainingSeconds, 70)
  assert.equal(widgets(record, 8).length, 3)
  const nextCanonical = effect([{ at: 2, ops: [{ op: 'scene.clear' }] }, { at: 3, ops: [{ op: 'widget.hide', widgetId: 'timer' }] }], { baseline: canonical.end }), next = projectIncrementalStageEffect(nextCanonical)
  assert.deepEqual(widgets(next, 1).map(w => w.widgetId), ['timer', 'scene']); assert.equal(widgets(next, 1)[0].remainingSeconds, 70)
  assert.deepEqual(widgets(next, 2).map(w => w.widgetId), ['timer']); assert.deepEqual(widgets(next, 3), [])
  const timed = projectIncrementalStageEffect(effect([{ at: 1, ops: [{ op: 'widget.show', widgetId: 'short', type: 'note', props: { body: 'Five story seconds' }, lifetime: { until: 'explicit', durationSeconds: 5 } }] }, { at: 2, ops: [{ op: 'clock.advance', value: 5 }] }]))
  assert.equal(widgets(timed, 1).length, 1); assert.deepEqual(widgets(timed, 2), [])
})

test('incremental projection: cache can be rebuilt deterministically without mutating authority, calibration metadata retained', () => {
  const figureCatalog = { a: { performance: [{ heightCm: 165, headRatio: 1, elevationCm: 0 }] }, b: { '': [{ heightCm: 180, headRatio: 1, elevationCm: 0 }] } }
  const figureScale = { version: 6, scene: 3, hMax: 182, rescales: 0 } // private fork: current height-curve carry
  const canonical = effect([{ at: 2, ops: [{ op: 'actor.exit', actor: 'a' }] }], { baseline: baseline(), presentation: { figureCatalog, start: { figureScale }, selection: { model: 'small' }, warnings: ['example'], rulesHash: 'rules' } })
  const saved = structuredClone(canonical), record = projectIncrementalStageEffect(canonical)
  assert.deepEqual(record.start.figureScale, figureScale)
  assert.deepEqual(record.end.figureScale, forkFigureCarry(forkFigureDirection(record.start, record.entries, figureCatalog)))
  // private fork: derived replay carry survives without an acknowledgement overlay.
  assert.equal(ctx.forkGalEndState(record, null, [{kind:'narration',para:8}], new Set(), looks, figureCatalog).figureScale.hMax,182)
  assert.deepEqual(projectIncrementalStageEffect(canonical), record)
  record.start.outfits.a = 'bad'; record.figureCatalog.a = {}; record.warnings.push('cache-corruption')
  assert.deepEqual(canonical, saved); assert.notEqual(projectIncrementalStageEffect(canonical).start.outfits.a, 'bad')
  const invalid = structuredClone(canonical); invalid.end.music = 'tampered'; assert.throws(() => projectIncrementalStageEffect(invalid), /end-state mismatch/)
})

test('incremental renderer gates preserve legacy pruning, stable order, pacing and turn-local widgets', () => {
  const legacy = { status: 'done', key: 'legacy', units: 4, widgetsVersion: 1, start: projectIncrementalStageState(baseline(), catalog), entries: [{ at: 2, cast: ['b'] }, { at: 3, cast: ['b', 'a'] }] }
  const member = staged(legacy, 3).members.find(m => m.id === 'a')
  assert.equal(member.focus, 'normal'); assert.equal(member.look, ''); assert.equal(member.light, ''); assert.equal(member.x, 0.67)
  const seeded = { ...legacy, start: { ...legacy.start, widgets: [{ widgetId: 'unsafe', type: 'note', props: { body: 'legacy carry ignored' } }] } }
  assert.deepEqual(widgets(seeded, 1), [])
  assert.deepEqual(widgets({ ...seeded, widgetsVersion: 2 }, 1), [], 'version 2 requires the incremental protocol discriminator')
})


test('incremental events: ordered close-focus cancellation, finite overlay return, and full legacy event vocabulary', () => {
  const normal = initialStageState(catalog); normal.cast = ['a']
  const cancelled = projectIncrementalStageEffect(effect([{ at: 1, ops: [{ op: 'event', value: { op: 'focus', id: 'a', value: 'close' } }, { op: 'actor.patch', actor: 'a', value: { focus: 'normal' } }] }], { baseline: normal }))
  assert.equal(staged(cancelled, 1).members[0].focus, 'normal')
  const reverse = projectIncrementalStageEffect(effect([{ at: 1, ops: [{ op: 'actor.patch', actor: 'a', value: { focus: 'normal' } }, { op: 'event', value: { op: 'focus', id: 'a', value: 'close' } }] }], { baseline: normal }))
  assert.equal(staged(reverse, 1).members[0].focus, 'close'); assert.equal(staged(reverse, 3).members[0].focus, 'close'); assert.equal(staged(reverse, 4).members[0].focus, 'normal')
  const vocabulary = { ...catalog, sfx: ['bell'] }
  const events = [{ op: 'act', id: 'a', value: 'step-back' }, { op: 'emote', id: 'a', value: 'heart' }, { op: 'beat', value: 'flash' }, { op: 'title', value: 'Title' }, { op: 'sfx', value: 'bell' }, { op: 'trans', value: 'black' }]
  const record = projectIncrementalStageEffect(effect([{ at: 1, ops: [{ op: 'scene.set', value: 'street' }, ...events.map(value => ({ op: 'event', value }))] }], { baseline: normal, catalog: vocabulary }))
  assert.equal(staged(record, 1).effects.length, 5); assert.equal(staged(record, 1).transition, 'black'); assert.deepEqual(staged(record, 2).effects, [])
})

test('incremental widgets: immutable instance survives carry; same-paragraph hide/re-show gets a new instance', () => {
  const first = effect([{ at: 1, ops: [{ op: 'widget.show', widgetId: 'note', type: 'note', props: { body: 'first' } }] }])
  const a = widgets(projectIncrementalStageEffect(first), 1)[0]
  const second = effect([{ at: 1, ops: [{ op: 'widget.hide', widgetId: 'note' }, { op: 'widget.show', widgetId: 'note', type: 'note', props: { body: 'second' } }] }], { baseline: first.end, target: { sourceKey: 'second-source' } })
  const b = widgets(projectIncrementalStageEffect(second), 1)[0]
  assert.notEqual(a.originKey, b.originKey)
  const carry = widgets(projectIncrementalStageEffect(effect([], { baseline: second.end })), 1)[0]
  assert.equal(b.originKey, carry.originKey)
  const local = effect([{ at: 1, ops: [{ op: 'widget.show', widgetId: 'note', type: 'note', props: { body: 'first' } }] }, { at: 1, ops: [{ op: 'widget.hide', widgetId: 'note' }, { op: 'widget.show', widgetId: 'note', type: 'note', props: { body: 'second' } }] }])
  assert.notEqual(a.instanceId, widgets(projectIncrementalStageEffect(local), 1)[0].instanceId)
})

test('incremental widgets: third-party typed props stay on the existing registry/sandbox path', () => {
  const definition = { id: 'custom-meter', thirdParty: true, slot: 'corner-right', propsSchema: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, amount: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['label', 'amount'] }, caps: { bytes: 1000 } }
  const customCatalog = { ...catalog, widgets: [definition] }
  const canonical = effect([{ at: 1, ops: [{ op: 'widget.show', widgetId: 'meter', type: 'custom-meter', props: { label: 'Energy', amount: 75 } }] }, { at: 2, ops: [{ op: 'widget.update', widgetId: 'meter', props: { amount: 80 } }] }], { catalog: customCatalog })
  const record = projectIncrementalStageEffect(canonical), definitions = [...forkWidgetBuiltins, definition]
  const at2 = widgetsAt({ key: record.key }, { para: 2 }, record, definitions)
  assert.equal(at2.length, 1); assert.deepEqual(at2[0].props, { label: 'Energy', amount: 80 })
  assert.deepEqual(widgets(record, 2), [], 'missing local registry definition safely hides instead of injecting a new renderer')
  const next = projectIncrementalStageEffect(effect([], { baseline: canonical.end, catalog: customCatalog }))
  assert.deepEqual(widgetsAt({ key: next.key }, { para: 1 }, next, definitions)[0].props, at2[0].props)
})


test('incremental hold: waiting/player-input carry keeps explicit scene clear and cast order', () => {
  const record = projectIncrementalStageEffect(effect([{ at: 1, ops: [{ op: 'scene.clear' }] }], { baseline: baseline() }))
  const held = ctx.forkGalEndState(record, null, [{ kind: 'narration', para: 1 }], new Set(), looks)
  const carried = ctx.forkGalCarriedDirection({ status: 'running' }, held, [], -1)
  assert.equal(carried.protocol, 'incremental-v1'); assert.equal(ctx.forkGalCue(carried, 1).sceneCleared, true)
  assert.equal(staged(carried, 1).members[0].x, 0.33)
  // private fork: retained P4 presentation replaces synthetic held direction records.
  // private fork: accepted visual state is the only retainer after F.
  assert.doesNotMatch(source, /const retainedScene =|presentationHolding/); assert.match(source, /const accepted = runtime.accepted/)
})


test('incremental appearance: missing requested model falls back without erasing requested outfit, restored media resumes it', () => {
  const characters = [{ alias: 'a', portrait: 'default', outfits: [{ label: 'performance', model: 'performance' }] }], defaultModel = { id: 'default' }, outfitModel = { id: 'performance' }, outfits = { a: 'performance' }
  assert.equal(ctx.forkGalPortraitOf('a', characters, [defaultModel], outfits, 'incremental-v1').model, defaultModel)
  assert.equal(outfits.a, 'performance')
  assert.equal(ctx.forkGalPortraitOf('a', characters, [defaultModel, outfitModel], outfits, 'incremental-v1').model, outfitModel)
  assert.equal(ctx.forkGalPortraitOf('a', characters, [defaultModel], outfits, 'text-dsl').model, null, 'legacy missing-media behavior unchanged')
})


test('incremental widgets: explicit slot overrides author tuning; omitted slot still follows the existing tuning seam', () => {
  const canonical = effect([{ at: 1, ops: [{ op: 'widget.show', widgetId: 'explicit', type: 'note', props: { body: 'Explicit' }, slot: 'corner-left' }, { op: 'widget.show', widgetId: 'default', type: 'note', props: { body: 'Default' } }] }])
  const record = projectIncrementalStageEffect(canonical), definition = { ...forkWidgetBuiltins.find(item => item.id === 'note'), tuning: { slot: 'corner-right', scale: 0.8 } }
  const [explicit, implicit] = widgets(record, 1).map(widget => forkWidgetPresentation(widget, definition))
  assert.equal(explicit.slot, 'corner-left'); assert.equal(implicit.slot, 'corner-right'); assert.equal(explicit.scale, 0.8)
})
