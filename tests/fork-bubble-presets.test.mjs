// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: display variants consistently and never inject an empty roster fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_BUBBLE_PRESETS as builtins, createDialogueBubblePresets, normalizeBubbleInjection } from '../tavern-plugin/lib/domain/dialogue-bubble-presets.js'
import { bubbleInstruction, BUBBLE_MOOD_GROUPS } from "../tavern-plugin/lib/domain/dialogue-bubbles.js"

async function storage(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bubble-presets-'))
  const data = {
    async readJson(file) { try { return JSON.parse(await readFile(path.join(root, file), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    async writeJson(file, value) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), JSON.stringify(value)) }
  }
  try { await run(data) } finally { await rm(root, { recursive: true, force: true }) }
}
const custom = (name = '自定义', presetId = '') => ({ ...builtins[0], presetId, name })

test('legacy presets are RPC metadata only; cards use the current nine labels and automatic voice rules', () => {
  assert.deepEqual(builtins.map(item => [item.name, item.emotionMode, item.bilingual]), [
    ['细分', 'detailed', false], ['简洁八类', 'simple', false], ['细分＋双语', 'detailed', true], ['简洁八类＋双语', 'simple', true]
  ])
  assert.deepEqual(BUBBLE_MOOD_GROUPS,[]) // private fork: preset metadata supplies no vocabulary
  for (const injection of builtins) {
    const text = bubbleInstruction({ enabled: true, voice: { enabled: true }, injection, characters: [{ alias: 'f_dress', aliases:['dress'], ref:{packId:'pack',figureId:'dress'}, name: '焰的新装', voice: 'homura' }, { alias: 'f_madoka', aliases:['madoka'], ref:{packId:'pack',figureId:'madoka'}, name: '鹿目圆', voice: '' }] })
    assert.doesNotMatch(text, /玩家（你）|故事正文和显示台词/)
    assert.equal(text.includes('@bubble-voice:'), false)
    assert.match(text, /For a character assigned a voice language, append a translation: `@bubble:[^\n]*\n- Their inner thoughts: `@bubble:/)
    assert.match(text, /焰的新装 \(dress\) \[Voice language: Japanese\]/)
    assert.match(text, /鹿目圆 \(madoka\):(?:\n|$)/)
    assert.doesNotMatch(text, /\[配音：|\[无配音\]/)
    assert.doesNotMatch(text, /通用差分|每句按情景选一个差分/) // private fork: no default builtin guidance
    assert.ok(!text.includes('困惑'))
    assert.match(text, /For a character assigned a voice language/)
  }
  const roster = bubbleInstruction({ enabled: true, injection: builtins[3], characters: [{ alias: 'f_madoka', aliases:['madoka'], ref:{packId:'pack',figureId:'madoka'}, name: '鹿目圆', voice: 'madoka' }, { alias: 'f_kyoko', aliases:['kyoko'], ref:{packId:'pack',figureId:'kyoko'}, name: '佐仓杏子', voice: 'vclone01' }] })
  assert.match(roster, /鹿目圆 \(madoka\)、/)
  assert.match(roster, /佐仓杏子 \(kyoko\):\n<\/speaker_roster>\n<\/dialogue_format>$/)
  assert.match(bubbleInstruction({ enabled: true, characters: [{ alias: 'f_kyoko', aliases:['kyoko'], ref:{packId:'pack',figureId:'kyoko'}, name: '杏子', voice: 'vclone01' }] }), /杏子 \(kyoko\):\n<\/speaker_roster>\n<\/dialogue_format>$/)
  const text = bubbleInstruction({ enabled: true, injection: builtins[3], voice: { enabled: false } })
  assert.doesNotMatch(text, /未配置角色表/)
  assert.doesNotMatch(text, /@bubble-voice|不要求翻译/)
})

test('template substitution is single-pass and resolves user names', () => {
  const injection = { ...builtins[0], template: '{{user}}\n{{bubble_characters}}\n{{bubble_format}}\n{{bubble_emotions}}' }
  const text = bubbleInstruction({ enabled: true, injection, characters: [{ alias: 'a', emotions: [{id:'joy',label:'喜悦',guidance:'{{bubble_format}}'}] }] })
  assert.ok(text.startsWith('<dialogue_format>\n你\n'))
  assert.match(text, /a \(a\): 喜悦（\{\{bubble_format\}\}）/)
  assert.throws(() => normalizeBubbleInjection({ ...injection, template: '{{user}}' }), /必须保留/)
  for (const patch of [{ presetId: '../x' }, { presetId: null }, { name: '' }, { name: 'a'.repeat(61) }, { emotionMode: 'other' }, { bilingual: 'true' }]) {
    assert.deepEqual(normalizeBubbleInjection({ ...builtins[0], ...patch }), { template: '', extra: '' })
  }
  for (const template of [123, 'x'.repeat(12001)]) assert.throws(() => normalizeBubbleInjection({ template }))
  for (const value of [undefined, null, {}, { template: '', extra: '' }, builtins[0]]) assert.deepEqual(normalizeBubbleInjection(value), { template: '', extra: '' })
  assert.deepEqual(normalizeBubbleInjection(injection), { template: injection.template, extra: '' })
})

test('custom CRUD, concurrent writers, reload, builtin protection, and limits use temporary storage', async () => storage(async data => {
  const library = createDialogueBubblePresets(data)
  assert.equal((await library.list()).length, 4)
  assert.throws(() => library.upsert(builtins[0]), /不能覆盖/)
  assert.throws(() => library.remove(builtins[0].presetId), /不能删除/)
  assert.throws(() => library.remove('../bad'), /无效/)
  assert.throws(() => library.upsert({ ...custom(), presetId: null }), /无效/)
  const items = await Promise.all(Array.from({ length: 12 }, (_, i) => library.upsert(custom('模板' + i))))
  assert.equal(new Set(items.map(item => item.presetId)).size, 12)
  assert.equal((await createDialogueBubblePresets(data).list()).length, 16)
  const edited = await library.upsert({ ...items[0], name: '新名', bilingual: true })
  assert.equal(edited.name, '新名')
  assert.equal((await library.list()).length, 16)
  await library.remove(items[1].presetId)
  assert.equal((await library.list()).length, 15)
  await Promise.all(Array.from({ length: 21 }, (_, i) => library.upsert(custom('后续' + i))))
  await assert.rejects(library.upsert(custom()), /32/)
  assert.equal((await library.list()).length, 36)
  await library.remove(items[0].presetId)
  await library.upsert(custom('错误后仍可保存'))
}))
