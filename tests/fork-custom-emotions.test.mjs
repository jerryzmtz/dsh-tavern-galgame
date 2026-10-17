// private fork: no implicit vocabulary or reserved old builtin names.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBubbleConfig, bubbleInjection, bubbleInstruction, effectiveBubbleMoods, resolveBubbleMood } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

import { cleanDirectorText } from '../tavern-plugin/lib/domain/stage-director-text.js'
import {stageParagraphs} from '../tavern-plugin/lib/domain/stage-paragraphs.js'

const emotion = { id: 'spark-2_x', label: '闪耀', note: '充满魔力' }
const emotions = [emotion]
const config = { emotions }
const png = 'data:image/webp;base64,AAAA'
const groups = effectiveBubbleMoods(config)

test('custom emotion validation: IDs, builtin words, duplicates, code point lengths and limits', () => {
  assert.deepEqual(normalizeBubbleConfig(config).emotions, emotions)
  for (const id of ['1spark', 'Bad', 'a'.repeat(25), '../bad', '']) assert.throws(() => normalizeBubbleConfig({ emotions: [{ ...emotion, id }] }), /ID/)
  for (const label of ['', '七个字七个字七', 'a|b', '[x]', 'a\nb']) assert.throws(() => normalizeBubbleConfig({ emotions: [{ ...emotion, label }] }), /名称/)
  assert.throws(() => normalizeBubbleConfig({ emotions: [emotion, { ...emotion, id: 'other' }] }), /名称/)
  assert.throws(() => normalizeBubbleConfig({ emotions: [emotion, { ...emotion, label: '魔力' }] }), /ID/)
  assert.throws(() => normalizeBubbleConfig({ emotions: [{ ...emotion, note: '字'.repeat(61) }] }), /60/)
  assert.throws(() => normalizeBubbleConfig({ emotions: [null] }), /ID/)
  assert.throws(() => normalizeBubbleConfig({ emotions: {} }), /256/)
  const many = Array.from({ length: 256 }, (_, i) => ({ id: 'e' + i, label: '状态' + i }))
  assert.equal(normalizeBubbleConfig({ emotions: many }).moods.length, 256) // private fork: declarations only
  assert.throws(() => normalizeBubbleConfig({ emotions: [...many, { id: 'last', label: '末尾' }] }), /256/)
  assert.equal(normalizeBubbleConfig({ emotions: [{ id: 'emoji', label: '🌟'.repeat(6), note: '🌟'.repeat(60) }] }).emotions.length, 1)
  assert.equal(groups.length, 1) // private fork: no injected stock rows
  assert.deepEqual(groups.at(-1), { ...emotion, color: '#888888' })
  assert.deepEqual(normalizeBubbleConfig({ emotions: [{ id: 'spark', label: '闪耀', note: '' }] }).emotions, [{ id: 'spark', label: '闪耀' }])
  const normalized = normalizeBubbleConfig(config)
  assert.deepEqual(normalizeBubbleConfig(normalized), normalized)
})

test('ordinary emotions allow old fallback IDs and reject case-insensitive label/ID collisions in either order', () => {
  for (const id of ['default', 'neutral']) {
    assert.equal(normalizeBubbleConfig({ emotions: [{ id, label: '闪耀' }] }).emotions[0].id,id) // private fork
  }
  // private fork: historical stock names are ordinary when no actual row conflicts.
  for (const [id,label] of [['joy','喜悦'],['anger','开心'],['neutral','困惑']]) {
    assert.equal(normalizeBubbleConfig({emotions:[{id,label}]}).emotions[0].label,label)
  }
  for (const label of ['spark', 'SPARK', ' Spark ']) {
    assert.equal(normalizeBubbleConfig({ emotions: [{ id: 'spark', label }] }).emotions[0].label,label.trim()) // private fork: self-alias is unambiguous
    const pair = [{ id: 'spark', label: '闪耀' }, { id: 'magic', label }]
    assert.throws(() => normalizeBubbleConfig({ emotions: pair }), /名称/)
    assert.throws(() => normalizeBubbleConfig({ emotions: [...pair].reverse() }), /名称/)
  }
  const valid = [{ id: 'spark', label: 'Glow' }, { id: 'magic', label: '闪耀' }]
  assert.deepEqual(normalizeBubbleConfig({ emotions: valid }).emotions, valid)
})

test('instructions use declared labels and guidance only; voice rules depend only on enabled and bound voices', () => {
  const base = { enabled: true, emotions, characters: [{ alias: 'f_neuro', aliases:['neuro'], name:'Neuro', ref:{packId:'pack',figureId:'neuro'}, emotions:[{id:emotion.id,label:emotion.label,guidance:emotion.note}], voice: 'neuro', voiceLang: 'en' }] }
  assert.match(bubbleInjection(base)[1].text, /闪耀（充满魔力）/) // private fork: builtin guidance is figure-owned and opt-in
  assert.doesNotMatch(bubbleInstruction(base), /默认克制落泪/)
  for (const voice of [undefined, null, { enabled: false }]) assert.doesNotMatch(bubbleInstruction({ ...base, voice }), /voice text/)
  assert.doesNotMatch(bubbleInstruction({ ...base, voice: { enabled: true }, characters: [{ alias: 'unvoiced', voice: '' }] }), /voice text/)
  assert.match(bubbleInstruction({ ...base, voice: { enabled: true } }), /voice text/)
  assert.doesNotMatch(bubbleInstruction({ ...base, stage: { textLanguage: 'en' }, voice: { enabled: true } }), /@bubble-voice|配音语言/)
})

test('custom avatar and full-image keys survive normalization; removing the emotion prunes only its images', () => {
  const full = '/api/dsh-tavern/bubble-image?card=' + 'a'.repeat(24) + '&key=neuro@spark-2_x&v=123'
  const input = { emotions, characters: [{ alias: 'neuro', emotions:[{id:emotion.id,label:emotion.label}], avatar: png, moods: { joy: png, [emotion.id]: png, removed: png }, full: { default: 'avatars/default.webp', joy: 'avatars/joy.webp', [emotion.id]: full, removed: 'avatars/removed.webp' } }] }
  const normalized = normalizeBubbleConfig(input)
  assert.deepEqual(normalized.characters[0].moods, { [emotion.id]: png })
  assert.equal(normalized.characters[0].full[emotion.id], full)
  const removed = normalizeBubbleConfig({ ...normalized, emotions: [], characters:normalized.characters.map(row=>({...row,emotions:[]})) }).characters[0] // private fork: figure owns its vocabulary
  assert.deepEqual(removed.moods, {})
  assert.deepEqual(removed.full, { default: 'avatars/default.webp' })
  assert.equal(removed.avatar, png)
})

test('host lookup accepts custom labels and IDs plus historical detailed words; director keeps arbitrary labels', () => {
  assert.equal(resolveBubbleMood('闪耀', config).id, emotion.id)
  assert.equal(resolveBubbleMood(emotion.id, config).id, emotion.id)
  assert.equal(resolveBubbleMood('困惑', config), null)
  assert.equal(resolveBubbleMood('困惑',{emotions:[{id:'shy',label:'害羞',words:'困惑'}]}).id,'shy') // private fork: historical aliases are explicit metadata
  // private fork: smug is a card-owned state; joy no longer reserves its label.
  assert.equal(resolveBubbleMood('得意', config), null)
  const smug = normalizeBubbleConfig({emotions:[{id:'smug',label:'得意'}]})
  assert.equal(resolveBubbleMood('得意', smug).id, 'smug')
  assert.equal(resolveBubbleMood('平和', config), null)
  assert.equal(resolveBubbleMood('闪耀', {}), null)
  for (const line of ['@bubble:a|角色|闪耀|[你好]', '@bubble-voice:a|角色|闪耀|[你好]|[Hello]', '@bubble-voice:a|角色|闪耀|[Hello]']) {
    assert.equal(stageParagraphs(line)[0].kind, 'line')
    assert.match(cleanDirectorText(line), /角色〔a〕（闪耀）：/)
    assert.doesNotMatch(cleanDirectorText(line), /@bubble/)
  }
})
