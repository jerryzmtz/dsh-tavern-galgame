import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanDirectorText, cleanDirectorUnits } from '../tavern-plugin/lib/domain/stage-director-text.js'

const u = JSON.parse('"\u7532\u3014a\u3015\uff08\u5e73\u9759\uff09\uff1a\u4f60\u597d"')
test('director cleaning keeps speaker, alias, mood and Chinese dialogue, dropping voice readings', () => {
  assert.equal(cleanDirectorText('@bubble:a|\u7532|\u5e73\u9759|[\u4f60\u597d]'), u)
  assert.equal(cleanDirectorText('@bubble-voice:a|\u7532|\u5e73\u9759|[\u4f60\u597d]|[こんにちは]'), u)
  assert.equal(cleanDirectorText('@bubble:a|\u7532|\u5e73\u9759|[\u4f60\u597d]|[こんにちは]'), u)
  assert.equal(cleanDirectorText('@bubble:a|\u7532|\u5e73\u9759|[*\u4f60\u597d*]|[*voice*]'), u.replace('\uff1a', '\uff1a\uff08\u5fc3\u58f0\uff09'))
  assert.equal(cleanDirectorText('@bubble-voice:a|\u7532|\u5e73\u9759|[*\u4f60\u597d*]|[voice]'), u.replace('\uff1a', '\uff1a\uff08\u5fc3\u58f0\uff09'))
  assert.equal(cleanDirectorText('*Narration*, **important** and __strong__, _quiet_ and ~~old~~.'), 'Narration, important and strong, quiet and old.')
  assert.equal(cleanDirectorText('actor_one remains actor_one'), 'actor_one remains actor_one')
})

test('director cleaning removes HTML/status/thinking/variables and surplus blank lines', () => {
  const text = '**Before**\n\n<div class="status">HP\n\n<script>secret</script></div>\n<think>private\n\nreasoning</think>\n<UpdateVariable>secret update</UpdateVariable>\n<variable-update>secret</variable-update>\n<status>secret</status>\n\nAfter'
  assert.equal(cleanDirectorText(text), 'Before\nAfter')
  assert.equal(cleanDirectorText('Before<think>unfinished private'), 'Before')
  assert.equal(cleanDirectorText('Before\n```html\n<div>secret</div>\n```\nAfter'), 'Before\nAfter')
})

test('director cleaning never removes/reorders units or mutates the numbered input', () => {
  const units = [{ kind: 'narration', text: '**First**' }, { kind: 'narration', text: '<div>status only</div>' }, { kind: 'line', alias: 'a', name: 'A', text: '@bubble-voice:a|A|calm|[Last]|[voice]' }]
  const copy = structuredClone(units)
  const clean = cleanDirectorUnits(units)
  assert.deepEqual(units, copy)
  assert.equal(clean.length, 3)
  assert.deepEqual(clean.map(unit => unit.text), ['First', '', 'A\u3014a\u3015\uff08calm\uff09\uff1aLast'])
  assert.deepEqual(clean.map(({ text, ...metadata }) => metadata), units.map(({ text, ...metadata }) => metadata))
})
