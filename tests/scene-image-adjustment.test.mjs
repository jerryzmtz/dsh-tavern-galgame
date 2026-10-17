import assert from 'node:assert/strict'
import test from 'node:test'
import { applyImageAdjustment } from '../tavern-plugin/lib/domain/scene-image-adjustment.js'

const base = { id: 'original', profile: 'tags-a', description: '雨中人物', people: [{ id: 'p1', name: '林岚' }], blocks: [
  { id: 'hair', owner: 'p1', field: 'appearance', text: '黑色短发', tags: 'short black hair' },
  { id: 'coat', owner: 'p1', field: 'clothing', text: '白外套', tags: 'white coat' },
  { id: 'rain', owner: 'scene', field: 'environment', text: '雨夜', tags: 'rainy night' }
] }
const update = patches => ({ description: '调整后的画面', patches })

test('conversion covers every nonempty block and cannot alter facts or invent owners', () => {
  const patches = base.blocks.map(({ owner, field, text, tags }) => ({ owner, field, text, tags: tags + ', converted' }))
  const converted = applyImageAdjustment(base, update(patches), 'tags-b', 'convert')
  assert.equal(converted.profile, 'tags-b')
  assert.deepEqual(converted.blocks.map(block => block.text), base.blocks.map(block => block.text))
  assert.throws(() => applyImageAdjustment(base, update(patches.slice(1)), 'tags-b', 'convert'), /缺少/)
  assert.throws(() => applyImageAdjustment(base, update(patches.slice(1)), 'tags-b'), /混用旧表达/)
  assert.throws(() => applyImageAdjustment(base, update([{ ...patches[0], text: '金发' }]), 'tags-b', 'convert'), /不能改变/)
  assert.throws(() => applyImageAdjustment(base, update([{ ...patches[0], owner: 'stranger' }]), 'tags-a'), /不属于/)
  assert.throws(() => applyImageAdjustment(base, update([patches[0], patches[0]]), 'tags-a'), /只能修改一次/)
  assert.throws(() => applyImageAdjustment(base, update([{ ...patches[0], tags: '' }]), 'tags-a'), /同时清除/)
})
