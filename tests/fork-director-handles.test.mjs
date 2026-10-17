import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {createDirectorHandles} from '../tavern-plugin/lib/domain/stage-director-handles.js'
import {buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'

const batch=ops=>({sequence:1,through:8,done:true,beats:[{at:1,ops}]})
test('stable readable handles do not depend on recall order, other candidates, or turn',async()=>{
 const f=await performanceFixture(),p=f.prepare(),a=createDirectorHandles(p.context),c=structuredClone(p.context)
 for(const rows of Object.values(c.catalogue.candidates))rows.reverse()
 const b=createDirectorHandles(c)
 for(const rows of Object.values(c.catalogue.candidates))for(const row of rows)if(row.ref.kind!=='ambience')assert.equal(a.ref(row.ref),b.ref(row.ref))
 c.catalogue.candidates.music=c.catalogue.candidates.music.slice(0,1)
 const d=createDirectorHandles(c)
 assert.equal(a.ref(c.catalogue.candidates.music[0].ref),d.ref(c.catalogue.candidates.music[0].ref))
 assert.match(a.ref(c.catalogue.candidates.music[0].ref),/^[\p{L}\p{N}-]+~[a-z0-9]+$/u)
})
test('model DTO omits canonical references and renderer anatomy without mutating prepared input',async()=>{
 const f=await performanceFixture(),p=f.prepare({mods:{commands:[],schemaCommands:[]}}),before=structuredClone(p),r=buildAssetPackRequest(p,true,undefined,'',true)
 const wire=JSON.stringify({system:r.system,messages:r.messages,tools:r.tools})
 assert.doesNotMatch(wire,/packId|figureId|headRatio|elevationCm|ruler|f_[0-9a-f]{16}/)
 assert.deepEqual(p,before)
})
test('mapped model operations produce the exact canonical record and carried state',async()=>{
 const f=await performanceFixture(),p=f.prepare(),h=createDirectorHandles(p.context),id=Object.keys(p.context.actors)[0]
 const ops=[{op:'scene.set',background:p.context.catalogue.candidates.backgrounds[0].ref,time:null},{op:'cast.add',actor:id},{op:'actor.light.set',actor:id,light:'glow'},{op:'actor.outfit.set',actor:id,outfit:p.context.actors[id].outfits[0].key},{op:'music.set',ref:p.context.catalogue.candidates.music[0].ref}]
 const canonical=f.transaction(p),model=f.transaction(p)
 assert.equal(canonical.submit(batch(ops)).ok,true)
 assert.equal(model.submitModel(batch(ops.map(op=>h.operation(op)))).ok,true)
 assert.deepEqual(model.effect(),canonical.effect())
 assert.deepEqual(f.prepare({record:model.effect()}).baseline,f.prepare({record:canonical.effect()}).baseline)
})
test('raw canonical references and foreign handles reject at entry, accepted siblings survive repairs',async()=>{
 const f=await performanceFixture(),p=f.prepare(),h=createDirectorHandles(p.context),tx=f.transaction(p)
 const raw={op:'scene.set',background:p.context.catalogue.candidates.backgrounds[0].ref,time:null}
 const dropped=tx.submitModel(batch([raw,{op:'screen.play',effect:'flash'}]))
 assert.equal(dropped.accepted,1);assert.equal(dropped.retryable,true)
 assert.doesNotMatch(JSON.stringify(dropped),/packId|figureId/)
 const fixed=tx.submitModel(batch([h.operation(raw)]))
 assert.equal(fixed.ok,true);assert.equal(tx.effect().entries.flatMap(e=>e.ops).filter(op=>op.op==='screen.play').length,1)
 assert.deepEqual(tx.effect().end.scene.background,raw.background)
})

// private fork: names are mutable metadata; each request rebuilds every model identity view.
test('renamed aliases and assets refresh catalogue, carried state, enums and canonical progress together',async()=>{
 const f=await performanceFixture(),p=f.prepare(),old=createDirectorHandles(p.context),id=Object.keys(p.context.actors)[0]
 const background=p.context.catalogue.candidates.backgrounds[0].ref
 const tx=f.transaction(p)
 assert.equal(tx.submit(batch([{op:'cast.add',actor:id},{op:'scene.set',background,time:null}])).ok,true)
 const record=tx.effect(),saved=structuredClone(record)
 const next=structuredClone(f.prepare({record}))
 const figure=next.context.figureRows.find(row=>row.actorKey===id)
 figure.aliases=['Renamed person'];figure.name='Renamed person';next.context.actors[id].name='Renamed person'
 next.context.catalogue.candidates.backgrounds.find(row=>JSON.stringify(row.ref)===JSON.stringify(background)).asset.name='Renamed place'
 const fresh=createDirectorHandles(next.context)
 assert.notEqual(fresh.actor(id),old.actor(id));assert.notEqual(fresh.ref(background),old.ref(background))
 assert.equal(fresh.actor(id).split('~')[1],old.actor(id).split('~')[1])
 assert.equal(fresh.ref(background).split('~')[1],old.ref(background).split('~')[1])
 const request=buildAssetPackRequest(next,true,{choices:[id,background]})
 const wire=JSON.stringify({system:request.system,messages:request.messages,tools:request.tools})
 assert.ok(!wire.includes(old.actor(id)));assert.ok(!wire.includes(old.ref(background)))
 const data=directorPromptData(request)
 assert.deepEqual(data.carried.cast,[fresh.actor(id)])
 assert.equal(data.carried.scene.background,fresh.ref(background))
 assert.deepEqual(data.progress.choices,[fresh.actor(id),fresh.ref(background)])
 const variants=request.tools[0].parameters.properties.beats.items.properties.ops.items.anyOf[0].oneOf
 assert.equal(variants.find(row=>row.properties.op.const==='cast.add').properties.actor.type,'string')
 assert.equal(variants.find(row=>row.properties.op.const==='music.set').properties.ref.type,'string')
 assert.doesNotMatch(JSON.stringify(request.tools),/\$(?:ref|defs)/)
 assert.deepEqual(request.tools,buildAssetPackRequest(p).tools)
 const correction=f.transaction(next).submitModel(batch([{op:'cast.add',actor:'unknown'}]))
 assert.deepEqual(correction.errors[0].choices,[fresh.actor(id)])
 assert.ok(!JSON.stringify(correction).includes(old.actor(id)))
 assert.deepEqual(record,saved)
 assert.deepEqual(request.messages.map(message=>message.role),['user'],'no old director tool history crosses requests')
})

// P2-03: display punctuation is normalized before canonical admission, never by suffix alone.
test('display separator variants share handle creation normalization without broadening admission',async()=>{
 const f=await performanceFixture(),p=structuredClone(f.prepare()),id=Object.keys(p.context.actors)[0]
 const sound=p.context.catalogue.candidates.sfx[0]
 sound.asset.name='灵魂宝石・共鸣'
 const figure=p.context.figureRows.find(row=>row.actorKey===id)
 figure.aliases=['人物・甲'];figure.name='人物・甲'
 const outfit=p.context.actors[id].outfits[0];outfit.key='便服・外出'
 const h=createDirectorHandles(p.context),handle=h.ref(sound.ref)
 const separators=['\u00b7','\u30fb','\uff65']
 for(const separator of separators){
  const variant=handle.replace('-',separator)
  const tx=f.transaction(p)
  assert.equal(tx.submitModel(batch([{op:'sfx.play',ref:variant}])).ok,true)
  assert.deepEqual(tx.effect().entries[0].ops[0].ref,sound.ref)
  assert.deepEqual(h.operation({op:'actor.outfit.set',actor:h.actor(id).replace('-',separator),outfit:h.outfit(id,outfit.key).replace('-',separator)},true),{op:'actor.outfit.set',actor:id,outfit:outfit.key})
 }
 for(const ref of [handle+'x',handle.replace('灵魂宝石','其他素材'),sound.asset.name]){
  assert.throws(()=>h.operation({op:'sfx.play',ref},true),{code:'REF_UNAVAILABLE'})
 }
 assert.throws(()=>h.operation({op:'music.set',ref:handle},true),{code:'REF_UNAVAILABLE'})
 const absent=structuredClone(p.context);absent.catalogue.candidates.sfx=[]
 assert.throws(()=>createDirectorHandles(absent).operation({op:'sfx.play',ref:handle},true),{code:'REF_UNAVAILABLE'})
})
