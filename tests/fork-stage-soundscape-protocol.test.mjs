// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SOUNDSCAPE_RULES, buildSoundscapeFieldSchema, validateSoundTags } from '../tavern-plugin/lib/domain/stage-soundscape-protocol.js'
import { forkSoundscapeTags } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs'

test('portable sound array schema bounds shape; both validators enforce all tag combinations', () => {
  const schema = buildSoundscapeFieldSchema()
  assert.equal(schema.type, 'array')
  assert.deepEqual(schema.items, { type: 'string', enum: ['empty', 'open', 'sheltered', 'sealed'] })
  assert.equal(schema.maxItems, 2)
  assert.equal(Object.hasOwn(schema, 'enum'), false, 'providers must not receive array-valued enum entries')
  const candidates = [[], null, {}, 'empty', 1, undefined, { place: 'none' }, { hushUntil: 3 }]
  const values = ['empty', 'open', 'sheltered', 'sealed', 'indoor', 'auto', 'EMPTY', null, 1]
  for (const a of values) {
    candidates.push([a])
    for (const b of values) {
      candidates.push([a, b])
      for (const c of values) candidates.push([a, b, c])
    }
  }
  for (const raw of candidates) {
    const accepted = Array.isArray(raw) && raw.length <= schema.maxItems
      && raw.every(tag => schema.items.enum.includes(tag)) && new Set(raw).size === raw.length
      && raw.filter(tag => tag !== 'empty').length <= 1
    const result = validateSoundTags(raw)
    assert.equal(result.errors.length === 0, accepted, JSON.stringify(raw))
    assert.deepEqual(result, forkSoundscapeTags(raw))
    if (!accepted) assert.equal(result.tags, null)
  }
  assert.deepEqual(validateSoundTags([]), { tags: [], errors: [] })
  assert.deepEqual(validateSoundTags(['open', 'empty']), { tags: ['empty', 'open'], errors: [] })
  const raw = ['empty', 'sealed']
  assert.notEqual(validateSoundTags(raw).tags, raw)
  schema.items.enum.push('unsafe')
  assert.deepEqual(buildSoundscapeFieldSchema().items.enum, ['empty', 'open', 'sheltered', 'sealed'])
})
