import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacterDesignDocumentTools } from '../tavern-plugin/lib/domain/character-design-document.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'

import { cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

const design = { name: '林霜', aliases: ['阿霜'], identity: '钟楼守卫', personality: '认真谨慎', appearance: '蓝色制服', speechStyle: '简短直接', narrativeRole: '可能成为同伴' }
function fixture(document = { name: '原世界书', entries: {} }) {
  const source = { kind: 'card', cardPath: 'cards/test.json', cardName: '测试卡' }
  const card = { name: '测试卡', character_book: structuredClone(document) }
  let chat = { id: 'chat', sessionId: 'session', cardPath: 'cards/test.json', messages: [], cardContentDigest: cardContentDigest(card), cardContextSnapshot: '固定前缀', cardContextRevision: 1 }
  const original = structuredClone(document)
  const tools = createCharacterDesignDocumentTools({
    readWorldBook: async () => ({ source, document: original }),
    store: { readChat: async () => structuredClone(chat), updateChat: async (_id, mutate) => {
      const next = await mutate(structuredClone(chat)); if (next) chat = next; return next
    } }
  })
  const library = createWorldBookLibrary({ resources: { bindingForCard: async () => ({ kind: 'embedded', cardPath: 'cards/test.json', available: true }) }, cards: { read: async () => structuredClone(card) }, normalizePath: path => path, removeStandalone: async () => {} })
  return { get: () => chat, card, original, library,
    save: async (input = design) => JSON.parse(await tools.execute('chat', { name: 'character_design_save', arguments: input })),
    edit: operations => { chat.openingWorldbookSnapshot.document = updateWorldBookDocument(chat.openingWorldbookSnapshot.document, { operations }).document },
    entries: () => inspectWorldBookDocument(chat.openingWorldbookSnapshot.document).entries }
}

for (const document of [{ name: '独立格式', entries: { 5: { uid: 5, key: ['城市'], content: '原始设定', constant: true } } }, { name: '内置格式', entries: [{ id: 5, keys: ['城市'], content: '原始设定', constant: true, enabled: true }] }]) {
  test(document.name + '保留原条目，重复设计更新原条目，第四个人物照常保存', async () => {
    const run = fixture(document)
    await run.save()
    await run.save({ ...design, aliases: ['小林'], appearance: '白色制服' })
    assert.equal(run.entries().length, 2)
    assert.match(run.entries()[1].content, /白色制服/)
    assert.deepEqual(run.entries()[1].primaryKeys, ['林霜', '小林'])
    for (let n = 2; n <= 4; n++) assert.equal((await run.save({ ...design, name: '人物' + n })).ok, true)
    assert.equal(run.entries().length, 5)
    assert.equal(run.entries()[0].content, '原始设定')
    assert.deepEqual(run.original, document)
  })
}

test('保留手动关键词和启用设置；手动正文冲突时档案与世界书都不覆盖', async () => {
  const run = fixture()
  await run.save()
  run.edit([{ op: 'update', ref: run.entries()[0].ref, patch: { primaryKeys: ['守卫'], enabled: false } }])
  assert.equal((await run.save({ ...design, personality: '坦率' })).ok, true)
  assert.equal(run.entries()[0].enabled, false)
  assert.deepEqual(run.entries()[0].primaryKeys, ['守卫'])
  run.edit([{ op: 'update', ref: run.entries()[0].ref, patch: { content: '用户手动设定' } }])
  const before = structuredClone(run.get())
  const result = await run.save({ ...design, personality: '开朗' })
  assert.equal(result.ok, false)
  assert.match(result.error, /已被手动修改/)
  assert.deepEqual(run.get(), before)
})
