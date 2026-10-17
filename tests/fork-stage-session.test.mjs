// private fork: correctness input is a native binding, never a mounted publication.
import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeNode, nativeBinding, sessionHarness, stageVoiceDescriptor} from './helpers/stage-session-harness.mjs'
const plain = value => JSON.parse(JSON.stringify(value))

test('no transcript: send, first byte, streamed append and completion reach the same session store', () => {
  const h = sessionHarness()
  try {
    const store = h.owner.get('s')
    h.binding.set([nativeNode(2, 'hello', {kind: 'user'})]); h.binding.run(true)
    assert.equal(h.state().pending.text, true)
    assert.equal(h.state().text.hasReadableText, false)
    h.binding.set([nativeNode(2, 'First', {status: 'running'})])
    const source = h.state().source, paragraph = h.state().cursor.anchor.paragraphId
    assert.equal(h.state().text.pages[0].text, 'First')
    store.dispatch({type: 'READ_PROGRESS', source, readThrough: 3})
    h.binding.chunk(nativeNode(2, 'First word.', {status: 'running'}))
    assert.equal(h.state().text.pages[0].text, 'First word.')
    assert.equal(h.state().source, source)
    assert.equal(h.state().cursor.anchor.paragraphId, paragraph)
    assert.equal(h.state().cursor.readThrough, 3)
    h.binding.chunk(nativeNode(2, 'First word.')); h.binding.run(false)
    assert.equal(h.state().text.streaming, false)
    assert.equal(h.state().pending.text, false)
    assert.equal(h.owner.get('s'), store)
  } finally {h.dispose()}
})

test('native per-node publication wakes the adapter even without a chat snapshot notification', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'A', {status: 'running'})], running: true})
  try {
    const chat = h.binding.chat.getSnapshot()
    h.binding.chunk(nativeNode(1, 'AB', {status: 'running'}))
    assert.equal(h.binding.chat.getSnapshot(), chat)
    assert.equal(h.state().text.pages[0].text, 'AB')
  } finally {h.dispose()}
})

test('same-turn regeneration withdraws every old native node and rejects late old binding callbacks', () => {
  const h = sessionHarness({nodes: [nativeNode(62, 'Old'), nativeNode(62, 'More old', {id: '62:2', order: 621})]})
  try {
    const oldSource = h.state().source, store = h.owner.get('s')
    h.binding.set([nativeNode(62, 'Old'), nativeNode(65, 'New', {status: 'running'})])
    h.view({regeneratedDshTurns: {62: 65}, suppressedDshTurns: [65]})
    assert.deepEqual(plain(h.state().text.pages.map(page => page.text)), ['New'])
    assert.equal(h.state().source.turn, 62)
    assert.notEqual(h.state().source.generation, oldSource.generation)
    const previous = h.binding, replacement = nativeBinding([nativeNode(65, 'New complete')])
    h.bindings.set('s', replacement); h.list.publish(h.list.getSnapshot())
    assert.equal(h.owner.get('s'), store)
    assert.equal(previous.listeners(), 0)
    previous.chunk(nativeNode(65, 'STALE'))
    assert.equal(h.state().text.pages[0].text, 'New complete')
  } finally {h.dispose()}
})

test('same node content replacement advances generation, plain append does not', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'Original')]})
  try {
    const generation = h.state().source.generation
    h.binding.chunk(nativeNode(1, 'Replacement', {status: 'running'}))
    assert.equal(h.state().source.generation, generation + 1)
    h.binding.chunk(nativeNode(1, 'Replacement continues', {status: 'running'}))
    assert.equal(h.state().source.generation, generation + 1)
  } finally {h.dispose()}
})

test('multi-node ordering and paragraph ordinals are independent of mount/Map order', () => {
  const h = sessionHarness({nodes: [nativeNode(10, 'Third', {id: '10:2', order: 20}),
    nativeNode(10, '', {id: '10:1', order: 10, blocks: [{kind: 'reasoning', text: 'hidden'}, {kind: 'text', text: 'First'}, {kind: 'image'}, {kind: 'text', text: 'Second'}]})]})
  try {
    assert.deepEqual(plain(h.state().text.pages.map(page => [page.anchor.para, page.text])), [[1, 'First'], [2, 'Second'], [3, 'Third']])
    assert.equal(new Set(h.state().text.pages.map(page => page.anchor.paragraphId)).size, 3)
  } finally {h.dispose()}
})

test('settled template output replaces raw native text once per turn, no script/React execution', () => {
  const projection = {version: 2, turn: 3, parts: [{kind: 'markdown', text: 'Template **shown**'}, {kind: 'html', content: '<div>not narration</div>'}, {kind: 'markdown', text: '@bubble:alice|Alice|happy|[Hello]'}]}
  const h = sessionHarness({nodes: [nativeNode(3, 'Raw 1'), nativeNode(3, 'Raw 2', {id: '3:2'})], view: {replyProjections: [projection]}})
  try {
    assert.deepEqual(plain(h.state().text.pages.map(page => page.text)), ['Template shown', 'Hello'])
    assert.deepEqual(plain(h.state().text.pages.map(page => page.anchor.para)), [1, 2])
    const unit = h.state().textIndex.get(3).units[1]
    const voice = stageVoiceDescriptor(unit, h.state().settings)
    assert.equal(voice.speech, 'Hello')
    assert.equal(voice.character.alias, 'alice')
    assert.equal(voice.owner, undefined)
    assert.equal(voice.play, undefined)
  } finally {h.dispose()}
})

test('running nodes ignore stale final template output until native completion', () => {
  const h = sessionHarness({nodes: [nativeNode(2, 'live', {status: 'running'})], running: true,
    view: {replyProjections: [{version: 2, turn: 2, text: 'final template'}]}})
  try {
    assert.equal(h.state().text.pages[0].text, 'live')
    h.binding.chunk(nativeNode(2, 'raw complete'))
    assert.equal(h.state().text.pages[0].text, 'final template')
  } finally {h.dispose()}
})

test('greeting projection without a native node is indexed; HTML-only ends without awaiting text', () => {
  const h = sessionHarness({view: {replyProjections: [{version: 2, turn: 1, text: 'Greeting'}]}})
  try {
    assert.equal(h.state().text.pages[0].text, 'Greeting')
    h.view({replyProjections: [{version: 2, turn: 1, mode: 'html', html: '<main>widget</main>'}]})
    assert.equal(h.state().source.turn, 1)
    assert.equal(h.state().text.hasReadableText, false)
    assert.equal(h.state().pending.text, false)
  } finally {h.dispose()}
})

test('settings and preferences update without republishing text, voice hooks or media effects', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'Text')]})
  try {
    const text = h.state().text, index = h.state().textIndex
    h.effects.length = 0
    h.settings.publish({...h.settings.getSnapshot(), engineSettings: {revision: 2}})
    h.prefs.publish({...h.prefs.getSnapshot(), film: true, audio: {master: .2, muted: {voice: true}}})
    assert.equal(h.state().settings.engineSettings.revision, 2)
    assert.equal(h.state().preferences.film, true)
    assert.equal(h.state().text, text)
    assert.equal(h.state().textIndex, index)
    assert.equal(h.effects.length, 0)
    h.owner.get('s').dispatch({type: 'VISIBILITY', visible: false})
    assert.equal(h.state().preferences.audio.master, .2)
    assert.equal(h.state().preferences.audio.muted.voice, true)
    assert.ok(!h.effects.some(effect => /playback|presentation/.test(effect.type)))
  } finally {h.dispose()}
})

test('coordination/reconnect is a wake; snapshots are reread and no signal becomes text', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'Authoritative')]})
  try {
    h.coordination.publish({view: {cardPath: 'card', runtimeGeneration: 'host-1'}, text: 'wrong'})
    assert.equal(h.state().text.pages[0].text, 'Authoritative')
    assert.equal(h.invalidateCount(), 1)
    assert.ok(h.loadCount() >= 2)
  } finally {h.dispose()}
})

test('cancellation and failure stop awaiting text without a transcript completion', () => {
  const h = sessionHarness({nodes: [nativeNode(2, '', {status: 'running'})], running: true})
  try {
    h.binding.chunk(nativeNode(2, '', {status: 'interrupted'})); h.binding.run(false)
    assert.equal(h.state().pending.text, false)
    assert.equal(h.state().interrupted, true)
    h.view({foregroundError: 'send failed'})
    assert.equal(h.state().pending.error, 'send failed')
  } finally {h.dispose()}
})

test('send cancelled before an assistant node exists retains the failed target instead of rewinding', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'Old text')]})
  try {
    h.binding.set([nativeNode(1, 'Old text'), nativeNode(2, 'input', {kind: 'user'})]); h.binding.run(true)
    const source = h.state().source
    assert.equal(source.turn, 2)
    h.binding.run(false)
    assert.equal(h.state().source, source)
    assert.equal(h.state().pending.text, false)
    assert.equal(h.state().pending.error, 'cancelled')
  } finally {h.dispose()}
})

test('rollback and card replacement invalidate context; closing releases all subscriptions', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'One'), nativeNode(2, 'Two')]})
  const store = h.owner.get('s')
  const first = h.state().source
  h.binding.set([nativeNode(1, 'One')])
  assert.notEqual(h.state().source.branchId, first.branchId)
  assert.equal(h.state().source.turn, 1)
  const epoch = h.state().source.authorityEpoch
  h.view({card: {path: 'different'}})
  assert.equal(h.state().source.authorityEpoch, epoch + 1)
  h.binding.set([])
  assert.equal(h.state().source, null)
  h.close()
  assert.equal(store.getSnapshot().disposed, true)
  assert.equal(h.binding.listeners(), 0)
  for (const source of [h.views, h.coordination, h.settings, h.prefs]) assert.equal(source.subscribers, 0)
  assert.equal(h.owner.get('s'), null)
  h.dispose(); h.dispose()
  assert.equal(h.list.subscribers, 0)
})

test('cold listed sessions do not create stores, chat bindings or host reads until selected', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'Open')]})
  try {
    const cold = nativeBinding([nativeNode(7, 'Cold')])
    h.bindings.set('cold', cold)
    h.list.publish({current: 's', byId: {s: {}, cold: {}}})
    assert.equal(h.owner.get('cold'), null)
    assert.equal(cold.listeners(), 0)
    h.list.publish({current: 'cold', byId: {s: {}, cold: {}}})
    assert.equal(h.owner.get('cold').getSnapshot().text.pages[0].text, 'Cold')
    assert.equal(h.owner.get('s').getSnapshot().text.pages[0].text, 'Open')
  } finally {h.dispose()}
})

test('native prompt admission failures are readable errors without a host-view refresh', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'Previous')]})
  try {
    h.binding.session.publish({running: false, promptError: {op: 'send', error: {message: 'native admission failed'}}})
    assert.equal(h.state().pending.error, 'native admission failed')
    assert.equal(h.state().text.pages[0].text, 'Previous')
    assert.equal(h.state().pending.text, false)
  } finally {h.dispose()}
})

test('two native sessions have independent stores, and stage close does not release text input', () => {
  const h = sessionHarness({nodes: [nativeNode(1, 'One')]})
  try {
    const other = nativeBinding([nativeNode(9, 'Other')])
    h.bindings.set('t', other); h.list.publish({current: 't', byId: {s: {}, t: {}}})
    assert.notEqual(h.owner.get('s'), h.owner.get('t'))
    h.owner.get('s').dispatch({type: 'STAGE_OPEN', opened: false})
    h.binding.chunk(nativeNode(1, 'One changed'))
    assert.equal(h.state().text.pages[0].text, 'One changed')
    assert.equal(h.owner.get('t').getSnapshot().text.pages[0].text, 'Other')
  } finally {h.dispose()}
})
