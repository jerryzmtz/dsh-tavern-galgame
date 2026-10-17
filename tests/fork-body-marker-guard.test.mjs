// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {scanBodyPromptSources, markerFindings, compareMarkerAllowance, isBodyPromptSource} from './helpers/body-marker-audit.mjs'
import {validateModManifest} from '../tavern-plugin/lib/domain/mods/manifest.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const allowance = JSON.parse(await readFile(new URL('./fixtures/body-marker-allowlist.json', import.meta.url),'utf8'))
const manifest = JSON.parse(await readFile(new URL('./fixtures/mods/demo/manifest.json', import.meta.url),'utf8'))

test('body presentation markers are a shrink-only exact-source allowance', async () => {
  const found = await scanBodyPromptSources(root)
  const {added, stale} = compareMarkerAllowance(found, allowance.entries)
  assert.deepEqual(added, [], 'New body presentation syntax: move it to a director command, never extend the allowance')
  assert.deepEqual(stale, [], 'Removed or changed offenders must shrink the allowance in the same change')
  assert.equal(allowance.entries.some(row => row.rule === 'phone'), false,
    'No tracked phone prose marker exists at the audited baseline; do not invent a blanket phone exception')
})

test('new paths, changed instructions and duplicate occurrences cannot spend old allowances', () => {
  const original = markerFindings('fork/skills/test.md', 'Write an output marker image###scene###.')
  assert.ok(original.length)
  assert.deepEqual(compareMarkerAllowance(original,original), {added:[],stale:[]})
  for (const rows of [original.map(row => ({...row,path:'fork/skills/new.md'})),
    markerFindings('fork/skills/test.md','Write an output marker image###new scene###.'), [...original,...original]]) {
    assert.ok(compareMarkerAllowance(rows,original).added.length)
  }
  assert.equal(compareMarkerAllowance([],original).stale.length,original.length)
})

test('guard recognizes phone, visual variants, media tags and plugin marker definitions', () => {
  for (const source of ['（手机短信）', '(SMS)', '\\uff08\\u624b\\u673a\\u77ed\\u4fe1\\uff09',
    '@bubble:ID|角色名|差分|[台词]', '@bubble:alice|Alice|happy|[Hello]',
    '@bubble:alice|Alice||[Hello]|[Translated]', '每句按情景选一个差分', 'image###a scene###',
    '正文必须输出显示标记', '<sfx src="rain">', '[BGM: rain]', '【表情：开心】',
    '<item id="key">', '<emote name="heart">', '<CG:room>', '<phone contact="a">',
    '每轮末尾输出固定标签格式']) assert.ok(markerFindings('test.md',source).length,source)
  for (const source of ['甲说：“你好。”', '@bubble:id|甲||[你好。]', '<UpdateVariable>', '<initvar>',
    '<mvu-status/>', '用 mvu_submit_update 提交变量', '【舱内广播】“请坐好。”',
    '无标记=人物行为；「场景变化」=可以结束当前场景。']) assert.deepEqual(markerFindings('test.md',source),[],source)
})

test('source discovery includes new prompts, templates, presets, skills and mod manifests', () => {
  for (const path of ['tavern-plugin/prompts/new.md', 'fork/skills/new/references/new.md',
    'presets/custom/preset.json', 'examples/new/card-source.mjs',
    'fork/mods/new/prompts/body.txt', 'fork/mods/new/manifest.json',
    'tavern-plugin/mods/new/prompts/rules.txt', 'tavern-plugin/lib/domain/new-prompt.js',
    'tavern-plugin/lib/domain/dialogue-bubbles.js']) assert.equal(isBodyPromptSource(path),true,path)
  for (const path of ['data/private/card.json','output/report.md','tavern-plugin/lib/client.js',
    'tavern-plugin/lib/vendor/st-prompt-template/engine.js']) assert.equal(isBodyPromptSource(path),false,path)
})

test('manifest admission rejects every body target and body placement before loading snippet text', () => {
  // API v1 has no body slot at all: stronger than trying to recognize arbitrary prose markers.
  for (const target of ['body','foreground','story']) {
    const value = structuredClone(manifest)
    value.prompts[0].target = target
    assert.throws(() => validateModManifest(value), error => error.code === 'MOD_API_UNSUPPORTED'
      && error.path.endsWith('.target') && /Body-placement/.test(error.message))
  }
  for (const target of ['director','settlement']) for (const section of ['body','body.rules','body.presentation','foreground.rules','story.rules']) {
    const value = structuredClone(manifest)
    value.prompts[0].target = target
    value.prompts[0].placement.section = section
    assert.throws(() => validateModManifest(value), error => error.code === 'MOD_API_UNSUPPORTED' && error.path.endsWith('.section'))
  }
  const command = structuredClone(manifest)
  command.commands[0].placement.section = 'body.presentation'
  assert.throws(() => validateModManifest(command), error => error.code === 'MOD_API_UNSUPPORTED' && error.path.endsWith('.section'))
  const inline = structuredClone(manifest)
  inline.prompts[0].body = 'Emit <sfx:rain>'
  assert.throws(() => validateModManifest(inline), error => error.code === 'UNKNOWN_FIELD')
  assert.deepEqual(validateModManifest(manifest),manifest)
  const settlement = structuredClone(manifest)
  settlement.commands = []
  settlement.prompts[0].target = 'settlement'
  settlement.prompts[0].placement.section = 'settlement.rules'
  assert.deepEqual(validateModManifest(settlement),settlement)
})
