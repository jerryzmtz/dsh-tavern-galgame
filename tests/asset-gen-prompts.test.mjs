// private fork (gen prompts, owner 2026-10): 设置 → 生图 — one global override per whole-image template.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetGeneration, composeAssetPrompt} from '../tavern-plugin/lib/domain/asset-generation.js'
import {assetPromptValues} from '../tavern-plugin/lib/domain/asset-production-contract.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'

const template = kind => readFile(new URL('../tavern-plugin/presets/asset-gen/templates/' + kind + '.md', import.meta.url), 'utf8')
async function fixture(t) {
  const base = fileURLToPath(new URL('../.preview/asset-gen-prompts-tests/', import.meta.url)); await mkdir(base, {recursive:true})
  const root = await mkdtemp(base + 'case-'), store = createProfileDataStore({dataRoot:root + '/data'}), library = createAssetPackService({assetRoot:root + '/packs'})
  const service = createAssetGeneration({store, imageModule:null, capture:() => assert.fail('a preview never captures a channel'), getLibrary:() => library})
  t.after(async () => { await service.dispose(); await library.dispose() })
  const pack = (await library.createPack({name:'Prompts', expectedRevision:null})).snapshot
  const created = await library.createFigure({packId:pack.manifest.id, expectedRevision:pack.revision, figure:{schemaVersion:1, name:'Mio', appearance:'sprite',
    emotions:[{id:'calm', label:'平和'}, {id:'e-joy', label:'喜悦'}], identityAppearance:'silver hair', outfits:[{key:'daily', label:'Daily', enabled:true, defaultEmotion:'calm', outfitAppearance:'blue ribbon'}]}})
  const target = {packId:pack.manifest.id, figureId:created.figureId, outfitKey:'daily', kind:'sprite', emotionId:'e-joy'}
  const preview = async (extra = {}) => service.prepare({target, expectedRevision:(await library.getPackSnapshot({packId:pack.manifest.id})).revision, userPrompt:'双手叉腰', preview:true, ...extra})
  return {service, store, preview, target, figure:created.snapshot.figures[created.figureId]}
}

test('no override sends the template bytes; an override is applied; reset restores the default bytes', async t => {
  const f = await fixture(t), sprite = await template('sprite')
  const untouched = await f.preview()
  assert.equal(untouched.prompt, composeAssetPrompt(sprite, assetPromptValues({figure:f.figure, outfit:f.figure.outfits[0], emotion:f.figure.emotions[1], userPrompt:'双手叉腰'})))
  assert.equal(untouched.parts, undefined)
  const listed = await f.service.prompts()
  assert.deepEqual(listed.kinds.map(k => k.kind), ['sprite', 'avatar', 'avatar-sheet', 'settei', 'identity-settei', 'background'])
  assert.equal(listed.kinds[0].text, sprite); assert.equal(listed.kinds[0].edited, false)
  assert.ok(listed.kinds[0].required.includes('emotionGuidance'))

  const edited = sprite.replace(/^Finish: .*$/m, 'Finish: soft watercolour wash.')
  const saved = await f.service.setPrompt({kind:'sprite', text:edited, expectedRevision:listed.revision})
  assert.equal(saved.kinds[0].edited, true); assert.equal(saved.kinds[0].text, edited)
  const shown = await f.preview()
  assert.match(shown.prompt, /Finish: soft watercolour wash\./); assert.doesNotMatch(shown.prompt, /cel-shaded/)
  assert.ok(shown.prompt.startsWith('双手叉腰\n\n'), 'the cell prompt still leads'); assert.match(shown.prompt, /Character: Mio\. Outfit: Daily\. Emotion: 喜悦\./)
  assert.equal(shown.parts.map(p => p.text).join(''), shown.prompt)
  assert.deepEqual(shown.parts.filter(p => p.edited).map(p => p.text.trim()), ['Finish: soft watercolour wash.'])
  // Other kinds keep their template.
  assert.match((await f.preview({target:{packId:f.target.packId, figureId:f.target.figureId, outfitKey:'daily', kind:'settei'}})).prompt, /cel-shaded/)

  await assert.rejects(f.service.setPrompt({kind:'sprite', text:null, expectedRevision:listed.revision}), e => e.code === 'REVISION_CONFLICT')
  await f.service.setPrompt({kind:'sprite', text:null, expectedRevision:saved.revision})
  const back = await f.preview()
  assert.equal(back.prompt, untouched.prompt); assert.equal(back.parts, undefined)
  assert.equal((await f.service.prompts()).kinds[0].edited, false)
})

test('a write keeps the template slots, knows no other slot and has a length cap; the default text is no override', async t => {
  const f = await fixture(t), avatar = await template('avatar'), {revision} = await f.service.prompts()
  const bad = async (text, pattern) => assert.rejects(f.service.setPrompt({kind:'avatar', text, expectedRevision:revision}), e => e.code === 'INVALID_ARGUMENT' && pattern.test(e.message))
  await bad(avatar.replace(/\{\{emotionGuidance\}\}/g, ''), /\{\{emotionGuidance\}\}/)
  await bad(avatar + '{{mood}}', /\{\{mood\}\}/)
  await bad(avatar + 'x'.repeat(12000), /12000/)
  await bad('   ', /不能为空/)
  await assert.rejects(f.service.setPrompt({kind:'mouth', text:'x', expectedRevision:revision}), e => e.code === 'INVALID_ARGUMENT')
  const same = await f.service.setPrompt({kind:'avatar', text:avatar.trimEnd(), expectedRevision:revision})
  assert.equal(same.kinds.find(k => k.kind === 'avatar').edited, false)
})
