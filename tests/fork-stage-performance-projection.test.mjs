// private fork: canonical page coordinates precede performance phase integration.
import test from 'node:test'
import assert from 'node:assert/strict'
import {stagePageIndex, stagePageAtAnchor, stageBlockPages} from '../tavern-plugin/src/client/fork-stage-page-index.cjs'
import {stageParagraphs} from '../tavern-plugin/lib/domain/stage-paragraphs.js'
import {cleanDirectorUnits} from '../tavern-plugin/lib/domain/stage-director-text.js'
import {createStageTextIndex, textHelpers, nativeNode} from './helpers/stage-session-harness.mjs'
import {prepareAssetPackDirector, createAssetPackTransaction, buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {cardExtension} from './fixtures/asset-packs/pack.mjs'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {fixture} from './helpers/stage-director-harness.mjs'
import {validateStageDirection} from '../tavern-plugin/src/client/fork-stage-director-source.cjs'
const plain = value => JSON.parse(JSON.stringify(value))
const narration = 'a'.repeat(90) + '!  ' + 'b'.repeat(90) + '!'
const text = narration + '\n\n@bubble:a|A|calm|[Hello]|[Speech]'
const parts = [{kind:'markdown',text}]
const coordinates = row => plain(row.text.pages.map((page,index) => ({page:index,para:page.anchor.para,offset:page.anchor.offset})))

test('host, native/projected client and hydrated bookmark coordinates share the unclean display index', () => {
  const units = stageParagraphs('',parts), expected = stagePageIndex(units)
  assert.deepEqual(expected, {version:1,pages:[{page:0,para:1,offset:0},{page:1,para:1,offset:93},{page:2,para:2,offset:0}],firstPageByPara:{1:0,2:2}})
  assert.equal(stagePageAtAnchor(expected,{para:2,offset:0}),2)
  assert.equal(stagePageAtAnchor(expected,{para:1,offset:94}),1)
  assert.equal(stagePageAtAnchor(expected,{para:3,offset:0}),null)
  const index = createStageTextIndex(textHelpers())
  const native = index.reconcile({chat:{nodes:new Map([['n',nativeNode(1,text)]])},view:{},branchId:'b'}).get(1)
  assert.deepEqual(coordinates(native),expected.pages)
  const projected = index.reconcile({chat:{nodes:new Map()},view:{mode:'story',replyProjections:[{version:2,turn:1,parts}]},branchId:'b'}).get(1)
  assert.deepEqual(coordinates(projected),expected.pages)
  assert.deepEqual(coordinates(index.ingest(1,units)),expected.pages)
  const helpers = textHelpers()
  assert.deepEqual(plain(helpers.api.forkGalPages(projected.parts).map(page => page.text)),projected.text.pages.map(page => page.text))
})

test('UTF-16 offsets include trimmed inter-page whitespace; unreadable narration does not invent a page', () => {
  const first = '\ud83d\ude00'.repeat(50) + '!', second = '\ud83d\ude00'.repeat(50) + '!'
  const units = [{kind:'narration',text:'**'+first+'**   '+second},{kind:'narration',text:'<i></i>'},{kind:'line',text:'@bubble:a|long name|mood|['+'x'.repeat(500)+']'}]
  assert.deepEqual(stagePageIndex(units).pages,[{page:0,para:1,offset:0},{page:1,para:1,offset:104},{page:2,para:3,offset:0}])
  assert.equal(stagePageIndex(units).firstPageByPara[2],undefined)
  assert.deepEqual(stagePageIndex(stageParagraphs('<div>hidden</div>')).pages,[])
  assert.deepEqual(stageBlockPages('word '.repeat(60)),['word '.repeat(60).trim()], 'long sentences retain the old unsplit behavior')
})

test('canonical page index is frozen into the prepared/checkpoint binding, never into the prompt', () => {
  const display = stageParagraphs('',parts), pageIndex = stagePageIndex(display)
  const input = {raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'1',engine:{},target:{turn:1,sourceKey:'s',branchId:'b',revision:1},units:cleanDirectorUnits(display),pageIndex}
  const prepared = prepareAssetPackDirector(input)
  assert.equal(prepared.binding.pageDigest,assetPackDigest(pageIndex))
  assert.ok(Object.isFrozen(prepared.pageIndex.pages))
  assert.deepEqual(buildAssetPackRequest(prepared),buildAssetPackRequest(prepareAssetPackDirector({...input,pageIndex:undefined})), 'page metadata adds zero prompt or tool bytes')
  const tx = createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const checkpoint = tx.savepoint()
  assert.doesNotThrow(()=>createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding,checkpoint}))
  const changed = prepareAssetPackDirector({...input,pageIndex:stagePageIndex([{kind:'narration',text:'different'}])})
  assert.throws(()=>createAssetPackTransaction({prepared:changed,getCurrentBinding:()=>changed.binding,checkpoint}),/stale draft/)
})

test('real director freezes display pages and read-side mismatch fails without inventing paragraph-minus-one pages', async t => {
  const f = await fixture(async request => {
    const receipt = JSON.parse(await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:2,done:true,beats:[]}}))
    assert.equal(receipt.ok,true)
  })
  t.after(()=>f.dispose())
  await f.store.updateChat('chat',chat=>{chat.messages[0].text=text;return chat})
  await f.director.get(f.read(),1)
  await f.director.drain()
  const value = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.equal(value.status,'done',JSON.stringify(value))
  assert.deepEqual(value.pageIndex,stagePageIndex(stageParagraphs('',parts)))
  assert.equal(value.binding.pageDigest,assetPackDigest(value.pageIndex))
  const row = createStageTextIndex(textHelpers()).reconcile({chat:{nodes:new Map([['n',nativeNode(1,text)]])},view:{},branchId:'b'}).get(1)
  const source = {sessionId:'session',turn:1}
  await validateStageDirection(value,source,row.text,assetPackDigest)
  const bad = structuredClone(row.text)
  bad.pages[2].anchor.para=1
  await assert.rejects(validateStageDirection(value,source,bad,assetPackDigest),{code:'STAGE_PAGE_MISMATCH'})
  assert.equal(row.text.pages.length,3,'a failed direction read does not block or rewrite text')
})
