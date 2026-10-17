// private fork: new director commands use the catalogue's deterministic FigureRef identity.
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID as actorPackId,FIGURE_ID as actorFigureId} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:actorPackId,figureId:actorFigureId})
// private fork: real pack transactions through production projection and client consumers.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fixture } from './helpers/stage-director-harness.mjs'
import { PACK_ID } from './fixtures/asset-packs/pack.mjs'
import { readStageProjection } from '../tavern-plugin/lib/domain/stage-projection.js'
import { validateStageDirection } from '../tavern-plugin/src/client/fork-stage-director-source.cjs'
import { forkWidgetThread } from '../tavern-plugin/src/client/fork-widget-thread.cjs'
const submit = async (request,call) => { const reply = JSON.parse(await request.onToolCall(call)); assert.equal(reply.ok,true,JSON.stringify(reply)); return reply }
const scene = {op:"scene.set", background:{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}, time:'day'}
const event = (op,value,id) => op === 'focus' ? {op:'closeup.play',actor:id} : {op:'transition.play',transition:value} // private fork: one close-up command
const source = fs.readFileSync(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
// Execute the actual GAL renderer-input expressions, not a duplicate implementation.
const backgroundExpression = source.match(/background:(pack\.scene\?\.backgroundUrl[^\n]+),\n/)[1]
const project = async (f,direction,at) => {
  const result = await readStageProjection({at,expectedDirectionToken:direction.token,revision:()=>f.assets.revision,
    readSettings:()=>f.engineSettings.read(),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readDirection:async()=>direction})
  assert.equal(result.status,'ready',JSON.stringify({result,phase:direction.phase,error:direction.error}))
  return result.value
}
for (const transition of ['cut','fade','black','white','wipe','iris']) test('pack trans reaches GAL background: '+transition,async t=>{
  const f = await fixture(async request => {
    const reply = await submit(request,{name:'stage_update',arguments:{sequence:1,through:2,done:true,beats:[{at:1,ops:[scene,event('trans',transition)]}]}})
    assert.equal(reply.ok,true)
  }); t.after(()=>f.dispose())
  await f.director.get(f.read(),1); await f.director.drain()
  const direction = await f.director.get(f.read(),1,null,{readOnly:true})
  for (const at of [1,2]) {
    const pack = await project(f,direction,at)
    const consume = (forwardReading,skipping) => vm.runInNewContext('('+backgroundExpression+')',{pack,forwardReading,skipping})
    assert.equal(consume(true,false).transition,transition)
    assert.equal(consume(false,false).transition,'cut')
    assert.equal(consume(true,true).transition,'cut')
  }
})
// private fork: projection uses the camera, never a separate sprite-scale focus field.
test('pack close-up projects four paragraphs and expires without a focus field',async t=>{
  const f = await fixture(async request=>{
    assert.equal((await submit(request,{name:'stage_update',arguments:{sequence:1,through:5,done:true,beats:[{at:1,ops:[scene,{op:'cast.add',actor:actorKey},event('focus','close',actorKey)]}]}})).ok,true)
  }); t.after(()=>f.dispose())
  await f.store.updateChat('chat',chat=>{chat.messages.find(m=>m.role==='assistant').text='Synthetic fixture.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.';return chat})
  await f.director.get(f.read(),1);await f.director.drain()
  const direction = await f.director.get(f.read(),1,null,{readOnly:true})
  for (const at of [1,2,3,4,5,2]) {
    const pack = await project(f,direction,at)
    assert.equal(pack.state.camera.mode,at<=4 ? 'close' : 'reset')
    assert.equal(Object.hasOwn(pack.scene,'focus'),false)
  }
  assert.equal(direction.record.end.actors[actorKey].focus,undefined,'projection does not persist transient focus')
})
test('retired phone names are rejected; model stop seals the partial result without a v3 widget thread',async t=>{
  let partial
  const f = await fixture(async request=>{
    // private fork: publish a valid prefix, then stop after an invalid final-window command.
    await submit(request,{name:'stage_update',arguments:{sequence:1,through:1,done:false,beats:[]}})
    partial = await f.director.get(f.read(),1,null,{readOnly:true})
    const reply=JSON.parse(await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[{at:2,ops:[{op:'phone.mark',contact:actorKey,side:'in'}]}]}}))
    assert.equal(reply.ok,false);assert.equal(reply.outcome,'not_applied');assert.equal(reply.retryable,true)
  });t.after(()=>f.dispose())
  await f.store.updateChat('chat',chat=>{chat.messages.find(m=>m.role==='assistant').text='@bubble:actor|Actor|calm|[Synthetic phone message.]\n\nLater.';return chat})
  await f.director.get(f.read(),1);await f.director.drain()
  const done = await f.director.get(f.read(),1,null,{readOnly:true})
  const pages = done.displayUnits.map((unit,index)=>({...unit,para:index+1}))
  assert.equal(pages[0].kind,'line')
  for (const value of [partial,done]) {
    // private fork: e63fbc55 / docs/fork/skin-overlay-runtime.md require canonical page anchors as well as units.
    const text = {streaming:false,units:done.displayUnits,pages:done.pageIndex.pages.map(({para,offset})=>({anchor:{para,offset}}))}
    const direction = await validateStageDirection(value,{sessionId:'session',turn:1},text)
    const mismatched = {...text,pages:text.pages.map(page=>({anchor:{...page.anchor,offset:page.anchor.offset+1}}))}
    await assert.rejects(validateStageDirection(value,{sessionId:'session',turn:1},mismatched),{code:'STAGE_PAGE_MISMATCH'})
    await project(f,value,1)
    // private fork: old phone marks remain readable, but only widget.source feeds v3 threads.
    const thread = forkWidgetThread({rows:[{turn:1,sourceKey:direction.token.sourceKey,pages,record:direction}],
      ref:{packId:PACK_ID,kind:'widgets',assetId:'clock'},cursor:{turn:1,page:0,para:1},visibleText:pages[0].text,revealed:true})
    assert.deepEqual(thread.messages,[])
    assert.equal(thread.current,null)
  }
})
