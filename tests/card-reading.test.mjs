import assert from 'node:assert/strict'
import test from 'node:test'

import { readCardField } from '../tavern-plugin/lib/domain/card-reading.js'

test('人物卡字段读取按页返回正文，不泄露其他字段', () => {
  const card = { name: '阿芙拉', description: '绝密人物设定', tags: ['佣兵'] }
  assert.deepEqual(readCardField(card, { field: 'description', limit: 3 }), {
    field: 'description', text: '绝密人', totalChars: 6, from: 1, to: 3, done: false
  })
  assert.deepEqual(readCardField(card, { field: 'description', offset: 4, limit: 3 }), {
    field: 'description', text: '物设定', totalChars: 6, from: 4, to: 6, done: true
  })
  assert.equal(readCardField(card, { field: 'tags' }).text, JSON.stringify(card.tags, null, 2))
  assert.throws(() => readCardField(card, { field: 'extensions' }), /不支持的人物卡字段/)
})
